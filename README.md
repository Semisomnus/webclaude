[中文版](README_CN.md)

# WebClaude

A local web-based chat interface for Claude and Codex CLI tools. Clean UI, multi-model support, streaming responses, agentic tool use, conversation management, and image uploads — all running locally.

## Features

- **Multi-provider support** — switch between Claude and Codex models; edit `models.json` at any time (hot-reload, no restart needed)
- **Streaming responses** — real-time token streaming with live tool-use display
- **Agentic mode** — tool approval prompts, auto-approve toggle, and tool status tracking
- **Conversation management** — auto-titling, persistent local history, rename and delete
- **Image upload** — paste or drag-and-drop images with vision model support
- **System prompt & CLAUDE.md** — edit system prompts and CLAUDE.md directly from the UI
- **Custom CLI parameters** — configure extra CLI arguments per provider in settings
- **Dark theme** — dark/light toggle, responsive design

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- At least one of the following CLI tools installed and authenticated:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — verify with `claude` in your terminal
  - [Codex CLI](https://github.com/openai/codex) — verify with `codex` in your terminal

> WebClaude is a web UI wrapper around these CLI tools. It does not call any API directly — you must have the CLI installed and logged in first.

## Quick Start

```bash
git clone https://github.com/Semisomnus/webclaude.git
cd webclaude
npm install
npm start
```

Open `http://localhost:3000` in your browser.

## Configuration

### models.json

Define providers, commands, arguments, and available models. Changes are picked up automatically.

```json
{
  "claude": {
    "label": "Claude",
    "cmd": "claude",
    "args": ["--model", "{model}"],
    "models": ["claude-sonnet-4-6", "claude-opus-4-6"]
  },
  "codex": {
    "label": "Codex",
    "cmd": "codex",
    "args": ["exec", "-m", "{model}", "--skip-git-repo-check", "--json"],
    "format": "codex-json",
    "models": ["gpt-5.3-codex"]
  }
}
```

`{model}` is replaced at runtime with the selected model name.

### CLI Parameters

Additional CLI arguments can be added per provider from the settings panel in the UI.

### System Prompt & CLAUDE.md

Both can be edited in the settings panel. The system prompt is prepended to every message; CLAUDE.md is passed via the `--claude-md` flag when using Claude Code.

## License

[MIT](LICENSE)
