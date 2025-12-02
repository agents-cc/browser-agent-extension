# Browser Agent Extension

[English](./README.md)

一个开源的 Chrome 扩展，让 AI 助手通过 MCP（Model Context Protocol）协议控制你的浏览器。

> 灵感来源于 Google 的 [Antigravity 浏览器扩展](https://chromewebstore.google.com/detail/antigravity-browser-exten/eeijfnjmjelapkebgockoeaadonbchdd) —— 一个非常好用的浏览器自动化工具。本项目是其开源复刻版，支持任意兼容 MCP 协议的 AI Agent（Claude Code、Cursor、Gemini CLI 等）。

> **提示：** 插件已提交 Chrome Web Store 审核，审核通过前可以自己构建后通过开发者模式加载使用。

## 概述

Browser Agent Extension 将 AI 助手（Claude Code、Cursor、Gemini CLI 等）与 Chrome 浏览器连接起来，实现自动化网页操作，如导航、点击、输入、截图等。

```
┌─────────────────────────────────────┐
│  AI 客户端 (Claude Code / Cursor)    │
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
│          Chrome 扩展                 │
│  Side Panel ←→ Service Worker       │
│              ↓                      │
│     Chrome DevTools Protocol        │
└─────────────────────────────────────┘
```

## 功能特性

- **完整浏览器控制** - 导航、点击、输入、滚动，与任意网页交互
- **截图捕获** - 捕获视口或整页截图
- **网络监控** - 捕获和过滤 XHR/Fetch 请求
- **多标签页管理** - 切换标签页，管理会话
- **智能等待** - 等待元素、页面加载或自定义条件
- **弹窗处理** - 自动处理 alert、confirm、prompt
- **控制台捕获** - 监控页面控制台日志
- **文件上传** - 程序化文件输入支持

## 安装

### 1. 安装 Chrome 扩展

**方式 A：Chrome Web Store（推荐）**

从 [Chrome Web Store](#) 安装（链接即将上线）

**方式 B：开发者模式加载**

1. 克隆本仓库
2. 构建扩展：
   ```bash
   cd extension
   npm install
   npm run build
   ```
3. 打开 Chrome，访问 `chrome://extensions/`
4. 开启「开发者模式」
5. 点击「加载已解压的扩展程序」，选择 `extension/dist` 文件夹

### 2. 构建 MCP Server

```bash
cd mcp-server
npm install
npm run build
```

### 3. 配置 AI 客户端

#### Claude Code

添加到 Claude Code 的 MCP 配置文件（`~/.claude/claude_desktop_config.json` 或使用 `claude mcp add`）：

```json
{
  "mcpServers": {
    "browser-agent": {
      "command": "node",
      "args": ["/绝对路径/browser-agent-extension/mcp-server/dist/index.js"]
    }
  }
}
```

或使用命令行：

```bash
claude mcp add browser-agent node /绝对路径/browser-agent-extension/mcp-server/dist/index.js
```

#### Cursor

添加到 Cursor 的 MCP 配置（Settings → MCP Servers）：

```json
{
  "browser-agent": {
    "command": "node",
    "args": ["/绝对路径/browser-agent-extension/mcp-server/dist/index.js"]
  }
}
```

#### Gemini CLI

添加到 Gemini CLI 配置文件：

```json
{
  "mcpServers": {
    "browser-agent": {
      "command": "node",
      "args": ["/绝对路径/browser-agent-extension/mcp-server/dist/index.js"]
    }
  }
}
```

#### 其他 MCP 客户端

任何兼容 MCP 协议的客户端都可以使用。配置运行：

```bash
node /路径/browser-agent-extension/mcp-server/dist/index.js
```

## 使用方法

1. **启动 MCP Server** - 配置好后，AI 客户端会自动启动
2. **打开 Chrome** - 点击扩展图标打开 Side Panel
3. **建立连接** - Side Panel 会自动连接 MCP Server（localhost:3026）
4. **开始自动化** - 让你的 AI 助手控制浏览器！

### 示例对话

```
"打开 github.com 并搜索 'browser automation'"

"在这个页面上填写联系表单"

"截取当前页面的截图"

"点击登录按钮并输入我的账号密码"

"向下滚动，找出页面上所有商品的价格"
```

## 可用的 MCP 工具

| 工具 | 描述 |
|------|------|
| `browser_navigate` | 导航到指定 URL |
| `browser_click` | 点击元素或坐标 |
| `browser_type` | 在元素中输入文本 |
| `browser_scroll` | 滚动页面 |
| `browser_screenshot` | 截取屏幕截图 |
| `browser_extract` | 提取元素的文本/HTML |
| `browser_evaluate` | 执行 JavaScript |
| `browser_get_page_info` | 获取当前页面 URL 和标题 |
| `browser_get_tabs` | 列出所有打开的标签页 |
| `browser_switch_tab` | 切换到指定标签页 |
| `browser_press_key` | 按下键盘按键 |
| `browser_select_option` | 选择下拉选项 |
| `browser_go_back/forward` | 历史导航 |
| `browser_reload` | 重新加载页面 |
| `browser_wait_for_*` | 等待元素/条件 |
| `browser_*_network` | 网络请求监控 |
| `browser_*_dialog` | 弹窗处理 |
| `browser_hover/double_click/right_click` | 高级鼠标操作 |
| `browser_lock/unlock` | 自动化时锁定页面 |

## 项目结构

```
browser-agent-extension/
├── extension/           # Chrome 扩展
│   ├── src/
│   │   ├── background/  # Service Worker
│   │   ├── sidepanel/   # Side Panel UI
│   │   ├── content/     # Content Script
│   │   └── cdp/         # CDP 封装
│   └── manifest.json
│
└── mcp-server/          # MCP Server
    └── src/
        └── index.ts     # 服务器入口
```

## 隐私说明

本扩展完全在本地运行：

- 不收集任何数据
- 没有外部服务器
- WebSocket 仅连接 localhost
- 所有自动化操作都在你的电脑上执行

详见 [隐私政策](./privacy.md)。

## 许可证

MIT

## 贡献

欢迎贡献代码！请提交 Issue 或 Pull Request。
