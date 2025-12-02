# Browser Agent Extension

[中文文档](./README_CN.md)

A 25KB MCP Server + 60KB browser extension that enables your Claude Code / Codex / Gemini CLI / Cursor and other AI Agents to seamlessly control your browser.

MIT Licensed Open Source

Ditch the bulky Playwright. Ditch the bloated MCP Servers stuffed with complex features.

> Inspired by [Antigravity Browser Extension](https://chromewebstore.google.com/detail/antigravity-browser-exten/eeijfnjmjelapkebgockoeaadonbchdd) by Google - a fantastic tool for browser automation. This project is an open-source alternative that works with any MCP-compatible AI agent (Claude Code, Cursor, Gemini CLI, and more).

> **Note:** The extension has been submitted to Chrome Web Store and is pending review. Before approval, please use the "Manual Installation" method to install the extension.

## Architecture

![Browser Agent Extension](assets/702e311d-c491-4bf4-a56e-9fd353852974.jpg)

## Quick Start

### 1. Install the Chrome Extension

**Option A: Chrome Web Store (Recommended)**

Search for "Browser Agent Extension" in the Chrome Web Store and install.

**Option B: Manual Installation**

1. Download [browser-agent-extension-v1.0.1.zip](https://github.com/agents-cc/browser-agent-extension/releases/download/v1.0.1/browser-agent-extension-v1.0.1.zip)
2. Extract to any folder
3. Open Chrome and go to `chrome://extensions/`
4. Enable "Developer mode"
5. Click "Load unpacked" and select the extracted folder

### 2. Install the MCP Service

You can configure it manually, or simply copy the following prompt to Claude Code / Codex / Gemini CLI / Cursor and let it install for you:

---

**Prompt:**

Please help me install and configure the browser-agent MCP service:

1. Install the npm package globally: `npm install -g browser-agent-extension-mcp`
2. Configure MCP for the current project (create or update `.mcp.json`):
   ```json
   {
     "mcpServers": {
       "browser-agent": {
         "type": "stdio",
         "command": "browser-agent-extension-mcp"
       }
     }
   }
   ```

After installation, tell me how to reload the MCP configuration.

---

## Further Reading

- [Architecture Design](docs/architecture.md)
- [Capabilities List](docs/capabilities.md)
- [Optimization Todo List](docs/todos.md)

## License

MIT
