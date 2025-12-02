# Browser Agent Extension

[English](./README.md)

25KB 的 MCP Server + 60KB 的浏览器插件，让你的 Claude Code / Codex / Gemini CLI / Cursor 等 AI Agent 流畅操作浏览器

MIT 协议开源

丢掉庞大的 Playwright，丢掉被塞进各种复杂功能的臃肿 MCP Server

> 灵感来源于 Google 的 [Antigravity 浏览器扩展](https://chromewebstore.google.com/detail/antigravity-browser-exten/eeijfnjmjelapkebgockoeaadonbchdd) —— 一个非常好用的浏览器自动化工具。本项目是其开源复刻版，支持任意兼容 MCP 协议的 AI Agent（Claude Code、Cursor、Gemini CLI 等）。

> **提示：** 插件已提交 Chrome Web Store 审核，审核通过前请使用「手动安装」的方式安装插件。

## 架构

![Browser Agent Extension](assets/702e311d-c491-4bf4-a56e-9fd353852974.jpg)

## 快速安装使用

### 1. 安装浏览器插件

**方式 A：Chrome Web Store（推荐）**

在 Chrome Web Store 搜索 "Browser Agent Extension" 并安装。

**方式 B：手动安装**

1. 下载 [browser-agent-extension-v1.0.1.zip](https://github.com/agents-cc/browser-agent-extension/releases/download/v1.0.1/browser-agent-extension-v1.0.1.zip)
2. 解压到任意文件夹
3. 打开 Chrome，访问 `chrome://extensions/`
4. 开启「开发者模式」
5. 点击「加载已解压的扩展程序」，选择解压后的文件夹

### 2. 安装 MCP 服务

可以手动配置，或者直接把下面的提示词复制给 Claude Code / Codex / Gemini CLI / Cursor 让它自己安装：

---

**指令/Prompt:**

请帮我安装并配置 browser-agent MCP 服务：

1. 全局安装 npm 包：`npm install -g browser-agent-extension-mcp`
2. 在当前项目配置 MCP（创建或更新 `.mcp.json`）：
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

安装完成后告诉我如何重新加载 MCP 配置。

---

## 扩展阅读

- [架构设计文档](docs/architecture.md)
- [能力清单](docs/capabilities.md)
- [优化待办清单](docs/todos.md)

## 许可证

MIT
