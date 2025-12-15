#!/usr/bin/env node
/**
 * Browser Agent MCP Server
 *
 * 通过 stdio 与 AI 客户端通信 (MCP 协议)
 * 通过 WebSocket 与浏览器扩展通信
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer, WebSocket } from 'ws';

const WS_PORT = process.env.BROWSER_AGENT_WS_PORT ? parseInt(process.env.BROWSER_AGENT_WS_PORT) : 3026;
const HEARTBEAT_INTERVAL = 30000; // 30秒心跳间隔
const HEARTBEAT_TIMEOUT = 10000;  // 10秒心跳超时

// 存储当前连接的扩展客户端
let extensionClient: WebSocket | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let wssInstance: WebSocketServer | null = null;

// 请求ID计数器
let requestIdCounter = 0;

// 等待响应的 Promise 映射
const pendingRequests = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
}>();

/**
 * 清理所有待处理的请求（连接断开时调用）
 */
function clearPendingRequests(reason: string): void {
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(`Request cancelled: ${reason}`));
  }
  pendingRequests.clear();
}

/**
 * 启动心跳检测
 */
function startHeartbeat(ws: WebSocket): void {
  stopHeartbeat();

  heartbeatTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();

      // 设置超时检测
      const pongTimeout = setTimeout(() => {
        console.error('[MCP Server] Heartbeat timeout, closing connection');
        ws.terminate();
      }, HEARTBEAT_TIMEOUT);

      ws.once('pong', () => {
        clearTimeout(pongTimeout);
      });
    }
  }, HEARTBEAT_INTERVAL);
}

/**
 * 停止心跳检测
 */
function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * 发送请求到浏览器扩展
 */
async function sendToExtension(action: string, params?: Record<string, unknown>): Promise<unknown> {
  if (!extensionClient || extensionClient.readyState !== WebSocket.OPEN) {
    throw new Error(
      'Browser extension not connected. ' +
      'Please ask the user to: 1) Open Chrome browser, 2) Click the Browser Agent extension icon, 3) Open the Side Panel. ' +
      'You can use browser_get_connection_status to check connection state.'
    );
  }

  const id = `req_${++requestIdCounter}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Request timeout: ${action}`));
    }, 30000); // 30秒超时

    pendingRequests.set(id, { resolve, reject, timeout });

    const request = {
      type: 'REQUEST',
      id,
      action,
      params,
    };

    extensionClient!.send(JSON.stringify(request));
  });
}

/**
 * 定义 MCP 工具
 */
const TOOLS: Tool[] = [
  // ========== 连接状态 ==========
  {
    name: 'browser_get_connection_status',
    description: `Check if the browser extension is connected to the MCP server.

Use this tool FIRST before performing any browser operations to verify the extension is ready.
If not connected, inform the user to open the browser extension side panel.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ========== 页面控制锁定 ==========
  {
    name: 'browser_lock',
    description: `Lock the browser page to prevent user interaction during automation.

IMPORTANT: You MUST call browser_lock BEFORE performing any browser operations (navigate, click, type, etc.) and call browser_unlock AFTER all operations are complete.

Recommended workflow:
1. Call browser_lock first (with optional status message)
2. Perform all your browser operations (navigate, click, type, screenshot, etc.)
3. Call browser_unlock when done

This displays a blue glowing overlay on the page with a status message, blocking all user input to prevent interference with automation.`,
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Status message to display on the overlay (e.g., "Automating form submission...")'
        },
      },
    },
  },
  {
    name: 'browser_unlock',
    description: `Unlock the browser page to restore user interaction after automation.

IMPORTANT: Always call this after completing your browser operations to allow the user to interact with the page again.

This hides the overlay and re-enables all user input.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_update_status',
    description: 'Update the status message on the lock overlay without unlocking. Useful for showing progress during multi-step operations.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'New status message to display' },
        shimmer: { type: 'boolean', description: 'Enable shimmer animation effect on the text' },
      },
      required: ['status'],
    },
  },

  // ========== 基础导航和交互 ==========
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL in the browser. Remember to call browser_lock before and browser_unlock after.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_click',
    description: `Click on an element using index (recommended), CSS selector, or coordinates.

RECOMMENDED: Use 'index' parameter with the element index from browser_get_dom_tree output.
Example: After getting DOM tree showing "[5] button "Submit" @(100,200,80,32)", use index: 5 to click it.`,
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Element index from browser_get_dom_tree output (recommended)' },
        selector: { type: 'string', description: 'CSS selector of the element to click' },
        x: { type: 'number', description: 'X coordinate to click at' },
        y: { type: 'number', description: 'Y coordinate to click at' },
      },
    },
  },
  {
    name: 'browser_type',
    description: `Type text into an element using index (recommended), CSS selector, or the currently focused element.

RECOMMENDED: Use 'index' parameter with the element index from browser_get_dom_tree output.
Example: After getting DOM tree showing "[5] input placeholder="Search..." @(100,200,200,40)", use index: 5 to type into it.

For contenteditable elements (rich text editors like Vditor), always use index parameter.`,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to type' },
        index: { type: 'number', description: 'Element index from browser_get_dom_tree output (recommended for reliable input)' },
        selector: { type: 'string', description: 'CSS selector of the element to type into (optional)' },
        clearFirst: { type: 'boolean', description: 'Clear the element before typing' },
      },
      required: ['text'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page in a direction or to an element',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Direction to scroll' },
        distance: { type: 'number', description: 'Distance to scroll in pixels' },
        selector: { type: 'string', description: 'CSS selector of element to scroll to' },
      },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page',
    inputSchema: {
      type: 'object',
      properties: {
        fullPage: { type: 'boolean', description: 'Capture the full page or just the viewport' },
        format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Image format' },
      },
    },
  },
  {
    name: 'browser_extract',
    description: 'Extract text and HTML content from an element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to extract' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_evaluate',
    description: 'Execute JavaScript code in the page context',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'JavaScript code to execute' },
      },
      required: ['script'],
    },
  },
  {
    name: 'browser_get_page_info',
    description: 'Get information about the current page (URL, title)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_get_dom_tree',
    description: `Get a compact, token-efficient DOM tree of the current page.

Returns ONLY interactive elements (buttons, links, inputs, etc.) grouped by semantic regions.
Each element includes a bounding box for understanding layout.

Format: [index] tag [type=x] "text" → href (placeholder) @(x,y,width,height)

Example output:
# DOM Tree (12 interactive elements)

## header @(0,0,1200,64)
[0] a "Home" → / @(16,16,60,32)
[1] button "Menu" @(1100,16,80,32)

## main @(0,64,1200,800)
[2] input (Search...) @(100,100,400,40)
[3] button "Submit" @(520,100,80,40)
[4] a "Learn more" → /about @(100,200,100,24)

## aside @(900,64,300,800)
[5] a "Dashboard" → /dashboard @(920,100,260,40)

Use browser_click with 'index' parameter to interact with elements.
Example: browser_click({ index: 3 }) clicks the "Submit" button.`,
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to limit scope (e.g., "main", "#content", ".sidebar")'
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum depth to traverse (default: 15)'
        },
        excludeTags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional tags to exclude (svg, script, style already excluded)'
        },
      },
    },
  },
  {
    name: 'browser_get_dom_tree_full',
    description: `Get the complete DOM tree in full JSON format.

Returns a structured tree of visible DOM elements including:
- Element tag name, id, className
- Text content (truncated to 200 chars)
- Bounding rect (x, y, width, height)
- Important attributes (href, src, alt, title, placeholder, type, name, value, role, aria-label)

WARNING: This returns a large JSON structure that may consume many tokens.
Use browser_get_dom_tree (compact format) for most use cases.
Only use this when you need precise bounding rectangles or full attribute data.`,
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'Optional CSS selector to get DOM tree of a specific element. If not provided, returns the entire body.'
        },
      },
    },
  },
  {
    name: 'browser_get_tabs',
    description: 'Get list of all open browser tabs',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_switch_tab',
    description: 'Switch to a specific browser tab',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'The ID of the tab to switch to' },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a keyboard key',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press (e.g., "Enter", "Escape", "Tab")' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_blur',
    description: `Remove focus from the currently focused element.

Use this after typing into an input field to close any dropdown menus, autocomplete suggestions, or popups that appear when the element has focus.

Example workflow:
1. browser_click({ index: 5 }) - click on search input
2. browser_type({ text: "search query" }) - type text
3. browser_blur() - remove focus to close dropdown suggestions
4. Continue with other operations...`,
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Optional: Element index to blur. If not provided, blurs the currently focused element.' },
        selector: { type: 'string', description: 'Optional: CSS selector of element to blur. If not provided, blurs the currently focused element.' },
      },
    },
  },
  {
    name: 'browser_select_option',
    description: 'Select an option from a dropdown/select element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the select element' },
        value: { type: 'string', description: 'Value of the option to select' },
        text: { type: 'string', description: 'Text content of the option to select' },
        index: { type: 'number', description: 'Index of the option to select' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_go_back',
    description: 'Navigate back in browser history',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_go_forward',
    description: 'Navigate forward in browser history',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_reload',
    description: 'Reload the current page',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ========== 网络请求捕获 ==========
  {
    name: 'browser_enable_network',
    description: 'Enable network request capturing to monitor XHR, Fetch, and other network requests',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_disable_network',
    description: 'Disable network request capturing',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_get_network_requests',
    description: 'Get captured network requests with optional filtering',
    inputSchema: {
      type: 'object',
      properties: {
        urlPattern: { type: 'string', description: 'Regex pattern to filter requests by URL' },
        method: { type: 'string', description: 'HTTP method to filter (GET, POST, etc.)' },
        statusCode: { type: 'number', description: 'Status code to filter' },
        resourceType: { type: 'string', description: 'Resource type (XHR, Fetch, Document, etc.)' },
        clear: { type: 'boolean', description: 'Clear captured requests after returning' },
      },
    },
  },
  {
    name: 'browser_clear_network_requests',
    description: 'Clear all captured network requests',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_get_network_requests_with_response',
    description: 'Get captured network requests with response body included. This calls Network.getResponseBody for each request to fetch the actual response content. Use this when you need to inspect API response data or debug network issues.',
    inputSchema: {
      type: 'object',
      properties: {
        urlPattern: { type: 'string', description: 'Regex pattern to filter requests by URL' },
        method: { type: 'string', description: 'HTTP method to filter (GET, POST, etc.)' },
        statusCode: { type: 'number', description: 'Status code to filter' },
        resourceType: { type: 'string', description: 'Resource type (XHR, Fetch, Document, etc.)' },
        clear: { type: 'boolean', description: 'Clear captured requests after returning' },
      },
    },
  },
  {
    name: 'browser_wait_for_response',
    description: 'Wait for a network response matching the URL pattern',
    inputSchema: {
      type: 'object',
      properties: {
        urlPattern: { type: 'string', description: 'Regex pattern to match request URL' },
        method: { type: 'string', description: 'HTTP method to match' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['urlPattern'],
    },
  },

  // ========== 等待机制 ==========
  {
    name: 'browser_wait_for_selector',
    description: 'Wait for an element matching the selector to appear in the DOM',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        visible: { type: 'boolean', description: 'Wait for element to be visible (default: true)' },
        hidden: { type: 'boolean', description: 'Wait for element to be hidden or removed' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_wait_for_timeout',
    description: 'Wait for a specified amount of time',
    inputSchema: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Time to wait in milliseconds' },
      },
      required: ['ms'],
    },
  },
  {
    name: 'browser_wait_for_load_state',
    description: 'Wait for the page to reach a specific load state',
    inputSchema: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          description: 'Load state to wait for'
        },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
    },
  },
  {
    name: 'browser_wait_for_function',
    description: 'Wait for a JavaScript function to return a truthy value',
    inputSchema: {
      type: 'object',
      properties: {
        function: { type: 'string', description: 'JavaScript function/expression to evaluate' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
        polling: { type: 'number', description: 'Polling interval in milliseconds (default: 100)' },
      },
      required: ['function'],
    },
  },

  // ========== 文件上传 ==========
  {
    name: 'browser_upload_file',
    description: 'Upload files to a file input element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the file input element' },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of absolute file paths to upload'
        },
      },
      required: ['selector', 'files'],
    },
  },

  // ========== 弹窗处理 ==========
  {
    name: 'browser_get_dialog',
    description: 'Get information about the current JavaScript dialog (alert, confirm, prompt)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_handle_dialog',
    description: 'Handle a JavaScript dialog by accepting or dismissing it',
    inputSchema: {
      type: 'object',
      properties: {
        accept: { type: 'boolean', description: 'Whether to accept (true) or dismiss (false) the dialog' },
        promptText: { type: 'string', description: 'Text to enter for prompt dialogs' },
      },
    },
  },
  {
    name: 'browser_set_auto_dialog',
    description: 'Set automatic handling for all JavaScript dialogs',
    inputSchema: {
      type: 'object',
      properties: {
        handler: {
          type: 'string',
          enum: ['accept', 'dismiss', 'null'],
          description: 'Auto-handler: accept, dismiss, or null to disable'
        },
      },
    },
  },

  // ========== 控制台日志 ==========
  {
    name: 'browser_get_console_logs',
    description: 'Get console logs from the page (requires console capture to be enabled)',
    inputSchema: {
      type: 'object',
      properties: {
        types: {
          type: 'array',
          items: { type: 'string', enum: ['log', 'info', 'warn', 'error', 'debug'] },
          description: 'Filter by log types'
        },
      },
    },
  },
  {
    name: 'browser_enable_console_capture',
    description: 'Enable capturing of console logs from the page',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ========== 高级鼠标操作 ==========
  {
    name: 'browser_hover',
    description: 'Hover over an element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to hover' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_double_click',
    description: 'Double-click on an element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to double-click' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_right_click',
    description: 'Right-click (context menu click) on an element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to right-click' },
      },
      required: ['selector'],
    },
  },
];

/**
 * 工具名称到操作的映射
 */
function getActionFromToolName(toolName: string): string {
  const mapping: Record<string, string> = {
    // 页面控制锁定
    browser_lock: 'lock',
    browser_unlock: 'unlock',
    browser_update_status: 'update_status',

    // 基础导航和交互
    browser_navigate: 'navigate',
    browser_click: 'click',
    browser_type: 'type',
    browser_scroll: 'scroll',
    browser_screenshot: 'screenshot',
    browser_extract: 'extract',
    browser_evaluate: 'evaluate',
    browser_get_page_info: 'get_page_info',
    browser_get_dom_tree: 'get_dom_tree',
    browser_get_dom_tree_full: 'get_dom_tree_full',
    browser_get_tabs: 'get_tabs',
    browser_switch_tab: 'switch_tab',
    browser_press_key: 'press_key',
    browser_blur: 'blur',
    browser_select_option: 'select_option',
    browser_go_back: 'go_back',
    browser_go_forward: 'go_forward',
    browser_reload: 'reload',

    // 网络请求捕获
    browser_enable_network: 'enable_network',
    browser_disable_network: 'disable_network',
    browser_get_network_requests: 'get_network_requests',
    browser_get_network_requests_with_response: 'get_network_requests_with_response',
    browser_clear_network_requests: 'clear_network_requests',
    browser_wait_for_response: 'wait_for_response',

    // 等待机制
    browser_wait_for_selector: 'wait_for_selector',
    browser_wait_for_timeout: 'wait_for_timeout',
    browser_wait_for_load_state: 'wait_for_load_state',
    browser_wait_for_function: 'wait_for_function',

    // 文件上传
    browser_upload_file: 'upload_file',

    // 弹窗处理
    browser_get_dialog: 'get_dialog',
    browser_handle_dialog: 'handle_dialog',
    browser_set_auto_dialog: 'set_auto_dialog',

    // 控制台日志
    browser_get_console_logs: 'get_console_logs',
    browser_enable_console_capture: 'enable_console_capture',

    // 高级鼠标操作
    browser_hover: 'hover',
    browser_double_click: 'double_click',
    browser_right_click: 'right_click',
  };
  return mapping[toolName] || toolName;
}

/**
 * 启动 WebSocket 服务器
 */
function startWebSocketServer(): WebSocketServer {
  const wss = new WebSocketServer({ host: '0.0.0.0', port: WS_PORT });
  wssInstance = wss;

  wss.on('connection', (ws) => {
    console.error(`[MCP Server] Browser extension connected`);
    extensionClient = ws;

    // 启动心跳检测
    startHeartbeat(ws);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'RESPONSE') {
          const pending = pendingRequests.get(message.id);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingRequests.delete(message.id);

            if (message.payload.success) {
              pending.resolve(message.payload.data);
            } else {
              pending.reject(new Error(message.payload.error || 'Unknown error'));
            }
          }
        }
      } catch (error) {
        console.error('[MCP Server] Failed to parse message:', error);
      }
    });

    ws.on('close', () => {
      console.error(`[MCP Server] Browser extension disconnected`);
      stopHeartbeat();
      if (extensionClient === ws) {
        extensionClient = null;
        // 清理所有待处理的请求
        clearPendingRequests('Browser extension disconnected');
      }
    });

    ws.on('error', (error) => {
      console.error('[MCP Server] WebSocket error:', error);
    });
  });

  wss.on('listening', () => {
    console.error(`[MCP Server] WebSocket server listening on port ${WS_PORT}`);
  });

  return wss;
}

/**
 * 优雅关闭
 */
function gracefulShutdown(signal: string): void {
  console.error(`[MCP Server] Received ${signal}, shutting down gracefully...`);

  // 停止心跳
  stopHeartbeat();

  // 清理待处理请求
  clearPendingRequests('Server shutting down');

  // 关闭 WebSocket 连接
  if (extensionClient) {
    extensionClient.close(1000, 'Server shutting down');
    extensionClient = null;
  }

  // 关闭 WebSocket 服务器
  if (wssInstance) {
    wssInstance.close(() => {
      console.error('[MCP Server] WebSocket server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }

  // 强制退出超时
  setTimeout(() => {
    console.error('[MCP Server] Force exit after timeout');
    process.exit(1);
  }, 5000);
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  // 注册信号处理
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // 启动 WebSocket 服务器
  startWebSocketServer();

  // 创建 MCP 服务器
  const server = new Server(
    {
      name: 'browser-agent',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 处理工具列表请求
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // 处理工具调用请求
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // 特殊处理连接状态检查（不需要实际连接扩展）
    if (name === 'browser_get_connection_status') {
      const isConnected = extensionClient !== null && extensionClient.readyState === WebSocket.OPEN;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              connected: isConnected,
              message: isConnected
                ? 'Browser extension is connected and ready.'
                : 'Browser extension is not connected. Please ask the user to open the Browser Agent extension side panel in Chrome.',
            }, null, 2),
          },
        ],
      };
    }

    try {
      const action = getActionFromToolName(name);
      const result = await sendToExtension(action, args as Record<string, unknown>);

      // 特殊处理截图结果
      if (name === 'browser_screenshot' && result && typeof result === 'object') {
        const screenshotResult = result as { image?: string; width?: number; height?: number };
        if (screenshotResult.image) {
          return {
            content: [
              {
                type: 'image',
                data: screenshotResult.image,
                mimeType: 'image/png',
              },
              {
                type: 'text',
                text: `Screenshot captured: ${screenshotResult.width}x${screenshotResult.height}`,
              },
            ],
          };
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });

  // 连接 stdio 传输
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[MCP Server] MCP Server started');
}

main().catch((error) => {
  console.error('[MCP Server] Fatal error:', error);
  process.exit(1);
});
