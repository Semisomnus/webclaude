[English](README.md)

# WebClaude

本地运行的 Claude / Codex CLI 网页聊天界面。简洁 UI、多模型切换、流式响应、Agent 工具调用、对话管理、图片上传，全部在本地完成。

## 功能特性

- **多供应商支持** — 在 Claude 和 Codex 模型之间自由切换；随时编辑 `models.json`（热加载，无需重启）
- **流式响应** — 实时 token 流输出，工具调用状态实时展示
- **Agent 模式** — 工具调用审批、自动批准开关、工具状态追踪
- **对话管理** — 自动生成标题、本地持久化历史记录、重命名与删除
- **图片上传** — 粘贴或拖拽图片，支持视觉模型
- **系统提示词 & CLAUDE.md** — 在界面中直接编辑系统提示词和 CLAUDE.md
- **自定义 CLI 参数** — 在设置面板中为每个供应商配置额外的命令行参数
- **深色主题** — 深色/浅色切换，响应式布局

## 前置要求

- [Node.js](https://nodejs.org/) v18+
- 至少安装并登录以下 CLI 工具之一：
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — 在终端运行 `claude` 验证是否可用
  - [Codex CLI](https://github.com/openai/codex) — 在终端运行 `codex` 验证是否可用

> WebClaude 是这些 CLI 工具的网页前端，不直接调用任何 API。请先确保 CLI 已安装并完成登录。

## 快速开始

```bash
git clone https://github.com/Semisomnus/webclaude.git
cd webclaude
npm install
npm start
```

在浏览器中打开 `http://localhost:3000`。

## 配置说明

### models.json

定义供应商、命令、参数和可用模型。修改后自动生效，无需重启。

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

`{model}` 会在运行时替换为用户选择的模型名称。

### CLI 参数

可在界面设置面板中为每个供应商添加额外的命令行参数。

### 系统提示词 & CLAUDE.md

均可在设置面板中编辑。系统提示词会添加到每条消息前；CLAUDE.md 通过 `--claude-md` 参数传递给 Claude Code。

## 许可证

[MIT](LICENSE)
