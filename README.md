# Browser Agent Extension

[中文文档](./README_CN.md)

An open-source Chrome extension that enables AI agents to control your browser through the Model Context Protocol (MCP).

> Inspired by [Antigravity Browser Extension](https://chromewebstore.google.com/detail/antigravity-browser-exten/eeijfnjmjelapkebgockoeaadonbchdd) by Google - a fantastic tool for browser automation. This project is an open-source alternative that works with any MCP-compatible AI agent (Claude Code, Cursor, Gemini CLI, and more).

> **Note:** The extension has been submitted to Chrome Web Store and is pending review. Before approval, you can build it yourself and load it via Developer Mode.

## Overview

Browser Agent Extension bridges AI assistants (Claude Code, Cursor, Gemini CLI, etc.) with your Chrome browser, enabling automated web interactions like navigation, clicking, typing, screenshots, and more.

```
┌─────────────────────────────────────┐
│  AI Client (Claude Code / Cursor)   │
│            MCP Client               │
└──────────────────┬──────────────────┘
                   │ stdio (JSON-RPC)
                   ▼
┌─────────────────────────────────────┐
│         MCP Server (Node.js)        │
│         WebSocket Server :3026      │
└──────────────────┬──────────────────┘
                   │ WebSocket
                   ▼
┌─────────────────────────────────────┐
│        Chrome Extension             │
│  Side Panel ←→ Service Worker       │
│              ↓                      │
│     Chrome DevTools Protocol        │
└─────────────────────────────────────┘
```

## Features

- **Full Browser Control** - Navigate, click, type, scroll, and interact with any webpage
- **Screenshot Capture** - Capture viewport or full-page screenshots
- **Network Monitoring** - Capture and filter XHR/Fetch requests
- **Multi-Tab Management** - Switch between tabs and manage sessions
- **Smart Waiting** - Wait for elements, page loads, or custom conditions
- **Dialog Handling** - Handle alerts, confirms, and prompts automatically
- **Console Capture** - Monitor page console logs
- **File Uploads** - Programmatic file input support

## Installation

### 1. Install the Chrome Extension

**Option A: Chrome Web Store (Recommended)**

Install from [Chrome Web Store](#) (link coming soon)

**Option B: Load Unpacked (Development)**

1. Clone this repository
2. Build the extension:
   ```bash
   cd extension
   npm install
   npm run build
   ```
3. Open Chrome and go to `chrome://extensions/`
4. Enable "Developer mode"
5. Click "Load unpacked" and select the `extension/dist` folder

### 2. Build the MCP Server

```bash
cd mcp-server
npm install
npm run build
```

### 3. Configure Your AI Client

#### Claude Code

Add to your Claude Code MCP settings (`~/.claude/claude_desktop_config.json` or use `claude mcp add`):

```json
{
  "mcpServers": {
    "browser-agent": {
      "command": "node",
      "args": ["/absolute/path/to/browser-agent-extension/mcp-server/dist/index.js"]
    }
  }
}
```

Or use the CLI:

```bash
claude mcp add browser-agent node /absolute/path/to/browser-agent-extension/mcp-server/dist/index.js
```

#### Cursor

Add to Cursor's MCP configuration (Settings → MCP Servers):

```json
{
  "browser-agent": {
    "command": "node",
    "args": ["/absolute/path/to/browser-agent-extension/mcp-server/dist/index.js"]
  }
}
```

#### Gemini CLI

Add to your Gemini CLI settings file:

```json
{
  "mcpServers": {
    "browser-agent": {
      "command": "node",
      "args": ["/absolute/path/to/browser-agent-extension/mcp-server/dist/index.js"]
    }
  }
}
```

#### Other MCP Clients

Any MCP-compatible client can use this server. Configure it to run:

```bash
node /path/to/browser-agent-extension/mcp-server/dist/index.js
```

## Usage

1. **Start the MCP Server** - Your AI client will start it automatically when configured
2. **Open Chrome** - Click the extension icon to open the Side Panel
3. **Connect** - The Side Panel will connect to the MCP server (localhost:3026)
4. **Automate** - Ask your AI assistant to control the browser!

### Example Prompts

```
"Go to github.com and search for 'browser automation'"

"Fill out the contact form on this page with test data"

"Take a screenshot of the current page"

"Click the login button and enter my credentials"

"Scroll down and find all product prices on this page"
```

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL |
| `browser_click` | Click an element or coordinates |
| `browser_type` | Type text into an element |
| `browser_scroll` | Scroll the page |
| `browser_screenshot` | Capture a screenshot |
| `browser_extract` | Extract text/HTML from elements |
| `browser_evaluate` | Execute JavaScript |
| `browser_get_page_info` | Get current page URL and title |
| `browser_get_tabs` | List all open tabs |
| `browser_switch_tab` | Switch to a specific tab |
| `browser_press_key` | Press keyboard keys |
| `browser_select_option` | Select dropdown options |
| `browser_go_back/forward` | Navigate history |
| `browser_reload` | Reload the page |
| `browser_wait_for_*` | Wait for elements/conditions |
| `browser_*_network` | Network request monitoring |
| `browser_*_dialog` | Dialog handling |
| `browser_hover/double_click/right_click` | Advanced mouse actions |
| `browser_lock/unlock` | Lock page during automation |

## Project Structure

```
browser-agent-extension/
├── extension/           # Chrome Extension
│   ├── src/
│   │   ├── background/  # Service Worker
│   │   ├── sidepanel/   # Side Panel UI
│   │   ├── content/     # Content Script
│   │   └── cdp/         # CDP wrapper
│   └── manifest.json
│
└── mcp-server/          # MCP Server
    └── src/
        └── index.ts     # Server entry point
```

## Privacy

This extension operates entirely locally:

- No data collection
- No external servers
- WebSocket connects only to localhost
- All automation happens on your machine

See [Privacy Policy](./privacy.md) for details.

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
