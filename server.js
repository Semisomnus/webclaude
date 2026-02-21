const express = require('express');
const WebSocket = require('ws');
const spawn = require('cross-spawn');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 3000;
const CONV_DIR = path.join(__dirname, 'conversations');
const MODELS_FILE = path.join(__dirname, 'models.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(CONV_DIR)) fs.mkdirSync(CONV_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json({ limit: '50mb' }));

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

function buildPrompt(history, newMessage, images) {
  let prompt = '';
  if (history && history.length > 0) {
    prompt = 'The following is our conversation history:\n\n';
    history.forEach(m => {
      prompt += `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}\n\n`;
    });
    prompt += `Human: ${newMessage}`;
  } else {
    prompt = newMessage;
  }

  // Append image file paths for Claude CLI to read
  if (images && images.length > 0) {
    prompt += '\n\n' + images.map(img => img.path).join('\n');
  }

  if (history && history.length > 0) {
    prompt += '\n\nPlease respond to my latest message only.';
  }

  return prompt;
}

function saveConversation(conv) {
  const file = path.join(CONV_DIR, `${conv.id}.json`);
  fs.writeFileSync(file, JSON.stringify(conv, null, 2), 'utf8');
}

// Read models.json (hot-reload on every request so user edits take effect immediately)
function loadModels() {
  try {
    return JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Find which provider + args to use for a given model ID
function resolveModel(modelId) {
  const config = loadModels();
  for (const [provider, info] of Object.entries(config)) {
    if (info.models && info.models.includes(modelId)) {
      return { provider, cmd: info.cmd, argsTemplate: info.args, format: info.format || 'raw' };
    }
  }
  return null;
}

// Upload API
app.post('/api/upload', (req, res) => {
  try {
    const { data, filename } = req.body;
    if (!data || !filename) return res.status(400).json({ error: 'Missing data or filename' });

    // Extract base64 content (strip data URL prefix if present)
    const base64Match = data.match(/^data:([^;]+);base64,(.+)$/);
    const buffer = base64Match
      ? Buffer.from(base64Match[2], 'base64')
      : Buffer.from(data, 'base64');

    const ext = path.extname(filename).toLowerCase() || '.png';
    const safeName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(UPLOADS_DIR, safeName);
    fs.writeFileSync(filePath, buffer);

    res.json({ path: filePath, url: `/uploads/${safeName}`, name: safeName });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Models API
app.get('/api/models', (req, res) => {
  res.json(loadModels());
});

// Conversations API
app.get('/api/conversations', (req, res) => {
  try {
    const files = fs.readdirSync(CONV_DIR).filter(f => f.endsWith('.json'));
    const list = files.map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(CONV_DIR, f), 'utf8'));
        return { id: d.id, title: d.title || 'Untitled', updatedAt: d.updatedAt, model: d.model };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(list);
  } catch { res.json([]); }
});

app.get('/api/conversations/:id', (req, res) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const file = path.join(CONV_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

app.delete('/api/conversations/:id', (req, res) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const file = path.join(CONV_DIR, `${req.params.id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

app.put('/api/conversations/:id', (req, res) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const file = path.join(CONV_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  const conv = req.body;
  conv.id = req.params.id;
  fs.writeFileSync(file, JSON.stringify(conv, null, 2), 'utf8');
  res.json({ ok: true });
});

// CLAUDE.md API — read/write the CLAUDE.md file in the working directory
app.get('/api/claude-md', (req, res) => {
  // Search common locations for CLAUDE.md
  const candidates = [
    path.join(__dirname, 'CLAUDE.md'),
    path.join(process.cwd(), 'CLAUDE.md'),
    path.join(os.homedir(), '.claude', 'CLAUDE.md'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return res.json({ path: p, content: fs.readFileSync(p, 'utf8') });
    }
  }
  // Default: project root
  res.json({ path: candidates[0], content: '' });
});

app.put('/api/claude-md', (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    const target = filePath || path.join(__dirname, 'CLAUDE.md');
    // Only allow writing to known safe locations
    const allowed = [
      path.join(__dirname, 'CLAUDE.md'),
      path.join(process.cwd(), 'CLAUDE.md'),
      path.join(os.homedir(), '.claude', 'CLAUDE.md'),
    ];
    if (!allowed.includes(path.resolve(target))) {
      return res.status(403).json({ error: 'Writing to this path is not allowed' });
    }
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    res.json({ ok: true, path: target });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CLI parameters API — persist user's custom CLI args per provider
const PARAMS_FILE = path.join(__dirname, 'cli-params.json');
app.get('/api/cli-params', (req, res) => {
  try {
    if (fs.existsSync(PARAMS_FILE)) {
      res.json(JSON.parse(fs.readFileSync(PARAMS_FILE, 'utf8')));
    } else {
      res.json({});
    }
  } catch { res.json({}); }
});

app.put('/api/cli-params', (req, res) => {
  try {
    fs.writeFileSync(PARAMS_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Summarize API — uses haiku to generate short conversation titles
app.post('/api/summarize', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text' });
  try {
    const proc = spawn('claude', ['-p', '--model', 'claude-haiku-4-5-20251001'], { env: process.env });
    proc.stdin.write(`用10个字以内总结这段对话的主题，只输出总结，不要任何其他内容：\n${text}`);
    proc.stdin.end();
    let result = '';
    proc.stdout.on('data', d => result += d.toString());
    proc.on('close', () => res.json({ title: result.trim().slice(0, 60) }));
    proc.on('error', () => res.json({ title: text.slice(0, 40) }));
  } catch {
    res.json({ title: text.slice(0, 40) });
  }
});

const server = app.listen(PORT, () => {
  const models = loadModels();
  console.log(`\nChat running at http://localhost:${PORT}`);
  console.log(`Models config: ${MODELS_FILE}`);
  for (const [p, info] of Object.entries(models)) {
    console.log(`  ${info.label}: ${info.models.join(', ')}`);
  }
  console.log('');
});

// WebSocket
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let currentProc = null;
  let procGeneration = 0;  // Track process generation to ignore stale events

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === 'cancel') {
      if (currentProc) { currentProc.kill(); currentProc = null; }
      return;
    }

    if (msg.type === 'tool_response') {
      // Confirm mode: user accepted/rejected a tool call
      if (currentProc && currentProc.stdin && !currentProc.stdin.destroyed) {
        if (msg.approved) {
          // Send permission grant via stdin — CLI expects user-type messages
          currentProc.stdin.write(JSON.stringify({
            type: 'user',
            message: {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: msg.tool_use_id, content: 'approved' }]
            }
          }) + '\n');
        } else {
          // Send rejection
          currentProc.stdin.write(JSON.stringify({
            type: 'user',
            message: {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: msg.tool_use_id, content: 'rejected', is_error: true }]
            }
          }) + '\n');
        }
      }
      return;
    }

    if (msg.type === 'chat') {
      const { conversationId, message, model, history, images, extraArgs, systemPrompt } = msg;

      const resolved = resolveModel(model);
      if (!resolved) {
        ws.send(JSON.stringify({ type: 'error', data: `Unknown model: ${model}` }));
        return;
      }

      const isClaudeStreamMode = resolved.provider === 'claude';

      // If we have a running interactive Claude process for the same conversation, reuse it
      if (isClaudeStreamMode && currentProc && !currentProc.killed && currentProc.stdin && !currentProc.stdin.destroyed && currentProc._convId === conversationId) {
        console.log(`[${resolved.cmd}] reusing existing process for ${conversationId}`);
        const prompt = buildPrompt([], message, images);  // No history needed — CLI remembers
        currentProc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n');
        return;
      }

      // Kill any existing process before starting a new one
      if (currentProc) {
        const oldProc = currentProc;
        currentProc = null;
        try {
          oldProc.stdin.destroy();
          oldProc.stdout.removeAllListeners();
          oldProc.stderr.removeAllListeners();
          oldProc.removeAllListeners('close');
          // On Windows, use taskkill to force-kill the process tree
          if (process.platform === 'win32' && oldProc.pid) {
            require('child_process').execFile('taskkill', ['/F', '/T', '/PID', String(oldProc.pid)], () => {});
          } else {
            oldProc.kill('SIGTERM');
          }
        } catch {}
      }

      procGeneration++;
      const myGeneration = procGeneration;

      const prompt = buildPrompt(history, message, images);
      console.log(`[chat] convId=${conversationId} historyLen=${history ? history.length : 0} msg=${message.slice(0, 50)}`);

      // Write prompt to temp file to avoid shell escaping issues
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'));
      const tmpFile = path.join(tmpDir, 'prompt.txt');
      fs.writeFileSync(tmpFile, prompt, 'utf8');

      // Claude always uses interactive stream-json mode for permission control

      let args;
      if (isClaudeStreamMode) {
        args = ['--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', '--model', model];
        if (systemPrompt) {
          args.push('--system-prompt', systemPrompt);
        }
      } else {
        // Original path: use argsTemplate from models.json
        args = resolved.argsTemplate
          .filter(a => a !== '{prompt}')
          .map(a => a.replace('{model}', model).replace('{prompt_file}', tmpFile));
      }

      // Append user-defined extra CLI args if any
      if (extraArgs && Array.isArray(extraArgs)) {
        args = args.concat(extraArgs.filter(a => typeof a === 'string' && a.trim()));
      }

      console.log(`[${resolved.cmd}] model=${model} args=${JSON.stringify(args)}`);

      try {
        currentProc = spawn(resolved.cmd, args, { env: process.env, cwd: __dirname });
        currentProc._convId = conversationId;  // Tag process with conversation ID
      } catch (e) {
        fs.unlinkSync(tmpFile);
        ws.send(JSON.stringify({ type: 'error', data: e.message }));
        return;
      }

      if (isClaudeStreamMode) {
        // Interactive mode: send user message via stdin, keep stdin open for permission responses
        currentProc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n');
      } else {
        // Non-Claude: pipe prompt to stdin then close
        currentProc.stdin.write(prompt);
        currentProc.stdin.end();
      }

      let fullResponse = '';
      let stdoutBuffer = '';
      // Collect structured blocks for agentic modes
      let agenticBlocks = [];

      currentProc.stdout.on('data', (data) => {
        if (myGeneration !== procGeneration) return;  // Stale process, ignore
        const raw = stripAnsi(data.toString());
        console.log(`[${resolved.cmd} stdout] ${raw.slice(0, 300)}`);

        if (resolved.format === 'codex-json') {
          // Codex --json outputs JSONL; extract text from item.completed events
          stdoutBuffer += raw;
          const lines = stdoutBuffer.split('\n');
          stdoutBuffer = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const evt = JSON.parse(line);
              if (evt.type === 'item.completed' && evt.item && evt.item.type === 'agent_message' && evt.item.text) {
                const text = evt.item.text;
                fullResponse += text;
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'stream', data: text }));
                }
              }
            } catch {}
          }
        } else if (isClaudeStreamMode) {
          // NDJSON stream-json parsing for claude agentic modes
          stdoutBuffer += raw;
          const lines = stdoutBuffer.split('\n');
          stdoutBuffer = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const evt = JSON.parse(line);
              console.log(`[stream-json evt] type=${evt.type} subtype=${evt.subtype || ''} keys=${Object.keys(evt).join(',')}`);
              if (ws.readyState !== WebSocket.OPEN) continue;

              if (evt.type === 'assistant' && evt.message) {
                // assistant message — extract text content and forward
                ws.send(JSON.stringify({ type: 'assistant_start', data: evt.message }));
                // Extract text from message content blocks
                const content = evt.message.content;
                if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block.type === 'text' && block.text) {
                      fullResponse += block.text;
                      ws.send(JSON.stringify({ type: 'text_delta', data: block.text }));
                    } else if (block.type === 'tool_use') {
                      ws.send(JSON.stringify({
                        type: 'tool_use',
                        tool_use_id: block.id,
                        name: block.name,
                        input: block.input || {}
                      }));
                      agenticBlocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input || {} });
                    }
                  }
                } else if (typeof content === 'string') {
                  fullResponse += content;
                  ws.send(JSON.stringify({ type: 'text_delta', data: content }));
                }
              } else if (evt.type === 'content_block_start') {
                const block = evt.content_block || {};
                if (block.type === 'tool_use') {
                  ws.send(JSON.stringify({
                    type: 'tool_use',
                    tool_use_id: block.id,
                    name: block.name,
                    input: block.input || {}
                  }));
                  agenticBlocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input || {} });
                }
              } else if (evt.type === 'content_block_delta') {
                const delta = evt.delta || {};
                if (delta.type === 'text_delta') {
                  fullResponse += delta.text || '';
                  ws.send(JSON.stringify({ type: 'text_delta', data: delta.text || '' }));
                } else if (delta.type === 'input_json_delta') {
                  // Streaming tool input JSON
                  ws.send(JSON.stringify({ type: 'tool_input_delta', data: delta.partial_json || '' }));
                }
              } else if (evt.type === 'content_block_stop') {
                ws.send(JSON.stringify({ type: 'content_block_stop', index: evt.index }));
              } else if (evt.type === 'message_start') {
                // Top-level message start
              } else if (evt.type === 'message_delta') {
                // Message-level delta (stop_reason, usage, etc.)
                ws.send(JSON.stringify({ type: 'message_delta', data: evt.delta || {} }));
              } else if (evt.type === 'message_stop') {
                // Message complete
              } else if (evt.type === 'result') {
                // Final result with cost/duration info — signals end of turn
                ws.send(JSON.stringify({
                  type: 'result',
                  cost: evt.total_cost_usd || evt.cost_usd || evt.cost,
                  duration: evt.duration_ms || evt.duration,
                  turns: evt.num_turns || evt.turns,
                  session_id: evt.session_id
                }));
                // In interactive mode, result means turn is done — send end to frontend
                ws.send(JSON.stringify({ type: 'end' }));
                // Reset for next turn
                fullResponse = '';
                agenticBlocks = [];
              } else if (evt.type === 'tool_use') {
                // Some CLI versions emit tool_use as a top-level event
                ws.send(JSON.stringify({
                  type: 'tool_use',
                  tool_use_id: evt.tool_use_id || evt.id,
                  name: evt.name,
                  input: evt.input || {}
                }));
                agenticBlocks.push({ type: 'tool_use', id: evt.tool_use_id || evt.id, name: evt.name, input: evt.input || {} });
              } else if (evt.type === 'tool_result') {
                // Tool execution result
                const output = typeof evt.output === 'string' ? evt.output : JSON.stringify(evt.output || '');
                ws.send(JSON.stringify({
                  type: 'tool_result',
                  tool_use_id: evt.tool_use_id,
                  output: output.length > 51200 ? output.slice(0, 51200) + '\n... (truncated)' : output,
                  is_error: evt.is_error || false
                }));
                agenticBlocks.push({ type: 'tool_result', id: evt.tool_use_id, output: output.slice(0, 51200), is_error: evt.is_error || false });
              } else if (evt.type === 'system') {
                // System messages from CLI (e.g. permission requests)
                ws.send(JSON.stringify({ type: 'system', data: evt }));
              }
            } catch (parseErr) {
              console.log(`[stream-json parse error] ${parseErr.message} | line: ${line.slice(0, 200)}`);
            }
          }
        } else {
          // Raw text mode (claude -p without stream-json, etc.)
          fullResponse += raw;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'stream', data: raw }));
          }
        }
      });

      currentProc.stderr.on('data', (data) => {
        const msg = data.toString().slice(0, 500);
        console.log(`[${resolved.cmd} stderr] ${msg}`);
        // Forward stderr to frontend for debugging
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'system', data: { subtype: 'stderr', text: msg } }));
        }
      });

      currentProc.on('close', (code) => {
        const isStale = myGeneration !== procGeneration;
        if (!isStale) currentProc = null;
        console.log(`[${resolved.cmd}] exited with code ${code}${isStale ? ' (stale, ignored)' : ''}`);
        try { fs.unlinkSync(tmpFile); } catch {}

        if (isStale) return;  // Don't send end event or save for stale processes

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'end' }));
        }

        const convFile = path.join(CONV_DIR, `${conversationId}.json`);
        let conv;
        if (fs.existsSync(convFile)) {
          conv = JSON.parse(fs.readFileSync(convFile, 'utf8'));
        } else {
          conv = {
            id: conversationId,
            title: message.slice(0, 60),
            model,
            createdAt: new Date().toISOString(),
            messages: [],
          };
        }
        conv.messages.push({ role: 'user', content: message, images: images || [], timestamp: new Date().toISOString() });
        const assistantMsg = { role: 'assistant', content: fullResponse.trim(), timestamp: new Date().toISOString() };
        if (isClaudeStreamMode && agenticBlocks.length > 0) {
          assistantMsg.blocks = agenticBlocks;
        }
        conv.messages.push(assistantMsg);
        conv.updatedAt = new Date().toISOString();
        saveConversation(conv);
      });

      currentProc.on('error', (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', data: `Failed to run ${resolved.cmd}: ${e.message}` }));
        }
      });
    }
  });

  ws.on('close', () => {
    if (currentProc) currentProc.kill();
  });
});
