/**
 * Page - 单标签页操作封装
 * 提供高级浏览器操作 API
 */

import { ExtensionTransport } from './transport';
import type {
  CaptureScreenshotParams,
  MouseEventParams,
  EvaluateResult,
  BoxModel,
  NetworkRequest
} from '@/types/cdp';

// 网络请求存储
interface StoredNetworkRequest {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  resourceType: string;
  timestamp: number;
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    mimeType: string;
    timing?: {
      requestTime: number;
      receiveHeadersEnd: number;
    };
  };
  responseBody?: string;
  error?: string;
}

// 弹窗信息
interface DialogInfo {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
  defaultPrompt?: string;
  timestamp: number;
}

export class Page {
  private tabId: number;
  private transport: ExtensionTransport;
  private initialized: boolean = false;

  // 网络请求存储
  private networkRequests: Map<string, StoredNetworkRequest> = new Map();
  private networkCaptureEnabled: boolean = false;
  private maxNetworkRequests: number = 500;

  // 弹窗队列
  private pendingDialogs: DialogInfo[] = [];
  private dialogHandler: ((accept: boolean, promptText?: string) => void) | null = null;

  constructor(tabId: number) {
    this.tabId = tabId;
    this.transport = new ExtensionTransport(tabId);
  }

  /**
   * 初始化页面连接
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.transport.attach();

    // 启用必要的 CDP 域
    await Promise.all([
      this.transport.send('Page.enable'),
      this.transport.send('DOM.enable'),
      this.transport.send('Runtime.enable'),
    ]);

    // 设置弹窗事件监听
    this.setupDialogHandler();

    this.initialized = true;
  }

  /**
   * 设置弹窗处理器
   */
  private setupDialogHandler(): void {
    this.transport.on((method: string, params: unknown) => {
      if (method === 'Page.javascriptDialogOpening') {
        const dialogParams = params as {
          type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          message: string;
          defaultPrompt?: string;
        };

        this.pendingDialogs.push({
          type: dialogParams.type,
          message: dialogParams.message,
          defaultPrompt: dialogParams.defaultPrompt,
          timestamp: Date.now(),
        });
      }
    });
  }

  /**
   * 关闭页面连接
   */
  async close(): Promise<void> {
    if (!this.initialized) return;
    await this.transport.detach();
    this.initialized = false;
  }

  /**
   * 导航到指定 URL
   */
  async navigateTo(url: string): Promise<{ frameId: string; loaderId: string }> {
    const result = await this.transport.send<{ frameId: string; loaderId: string }>(
      'Page.navigate',
      { url }
    );
    return result;
  }

  /**
   * 等待页面加载完成
   */
  async waitForNavigation(timeout: number = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.transport.off(handler);
        reject(new Error('Navigation timeout'));
      }, timeout);

      const handler = (method: string) => {
        if (method === 'Page.loadEventFired') {
          clearTimeout(timer);
          this.transport.off(handler);
          resolve();
        }
      };

      this.transport.on(handler);
    });
  }

  /**
   * 后退
   */
  async goBack(): Promise<void> {
    const history = await this.transport.send<{ currentIndex: number; entries: unknown[] }>(
      'Page.getNavigationHistory'
    );

    if (history.currentIndex > 0) {
      await this.transport.send('Page.navigateToHistoryEntry', {
        entryId: (history.entries[history.currentIndex - 1] as { id: number }).id,
      });
    }
  }

  /**
   * 前进
   */
  async goForward(): Promise<void> {
    const history = await this.transport.send<{ currentIndex: number; entries: unknown[] }>(
      'Page.getNavigationHistory'
    );

    if (history.currentIndex < history.entries.length - 1) {
      await this.transport.send('Page.navigateToHistoryEntry', {
        entryId: (history.entries[history.currentIndex + 1] as { id: number }).id,
      });
    }
  }

  /**
   * 刷新页面
   */
  async reload(): Promise<void> {
    await this.transport.send('Page.reload');
  }

  /**
   * 截图
   */
  async captureScreenshot(options: CaptureScreenshotParams = {}): Promise<string> {
    const result = await this.transport.send<{ data: string }>(
      'Page.captureScreenshot',
      {
        format: options.format || 'png',
        quality: options.quality,
        clip: options.clip,
        captureBeyondViewport: options.captureBeyondViewport ?? true,
      }
    );
    return result.data;
  }

  /**
   * 执行 JavaScript
   */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.transport.send<EvaluateResult>(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }
    );

    if (result.exceptionDetails) {
      // 构建详细的错误信息
      const details = result.exceptionDetails;
      const errorMessage = [
        details.text,
        details.exception?.description ? `Description: ${details.exception.description}` : '',
        details.stackTrace ? `Stack: ${JSON.stringify(details.stackTrace, null, 2)}` : '',
        `Line: ${details.lineNumber}, Column: ${details.columnNumber}`,
      ].filter(Boolean).join('\n');

      throw new Error(errorMessage);
    }

    return result.result.value as T;
  }

  /**
   * 点击坐标
   */
  async clickAt(x: number, y: number, options: { button?: 'left' | 'right' | 'middle'; clickCount?: number } = {}): Promise<void> {
    const button = options.button || 'left';
    const clickCount = options.clickCount || 1;

    // 移动鼠标
    await this.transport.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
    });

    // 按下
    await this.transport.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      clickCount,
    });

    // 释放
    await this.transport.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      clickCount,
    });
  }

  /**
   * 通过选择器点击元素
   * 支持富文本编辑器和 contenteditable 元素
   */
  async clickElement(selector: string): Promise<{ tagName: string; text: string }> {
    // 获取元素信息并确保可点击
    const elementInfo = await this.evaluate<{
      x: number;
      y: number;
      tagName: string;
      text: string;
      isVisible: boolean;
      isInViewport: boolean;
      actualSelector: string;
    }>(`
      (function() {
        let el = document.querySelector(${JSON.stringify(selector)});
        if (!el) {
          throw new Error('Element not found: ${selector}');
        }

        // 对于富文本编辑器容器，尝试找到实际的可编辑区域
        const editableSelectors = [
          '[contenteditable="true"]',
          '.vditor-ir', '.vditor-sv', '.vditor-wysiwyg',
          '.ProseMirror', '.ql-editor', '.cke_editable',
        ];

        // 如果当前元素不是可交互元素，尝试找到内部的可交互元素
        const isInteractive = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
          el.tagName === 'BUTTON' || el.tagName === 'A' ||
          el.isContentEditable || el.getAttribute('contenteditable') === 'true' ||
          el.onclick || el.getAttribute('role') === 'button';

        if (!isInteractive) {
          for (const editableSelector of editableSelectors) {
            const editable = el.querySelector(editableSelector);
            if (editable) {
              el = editable;
              break;
            }
          }
        }

        // 检查可见性
        const style = window.getComputedStyle(el);
        const isVisible = style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0';

        if (!isVisible) {
          throw new Error('Element is not visible: ${selector}');
        }

        // 滚动元素进入视口
        el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });

        // 获取最新的位置
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        // 检查是否在视口内
        const isInViewport = x >= 0 && y >= 0 &&
          x <= window.innerWidth && y <= window.innerHeight;

        // 检查点击位置是否被其他元素遮挡
        const elementAtPoint = document.elementFromPoint(x, y);
        if (elementAtPoint && !el.contains(elementAtPoint) && elementAtPoint !== el) {
          // 被遮挡了，尝试点击遮挡元素（可能是蒙层需要关闭）
          console.warn('Element is covered by:', elementAtPoint.tagName, elementAtPoint.className);
        }

        return {
          x,
          y,
          tagName: el.tagName,
          text: el.textContent?.slice(0, 100) || '',
          isVisible,
          isInViewport,
          actualSelector: ${JSON.stringify(selector)}
        };
      })()
    `);

    // 等待一下确保滚动完成
    await this.sleep(50);

    await this.clickAt(elementInfo.x, elementInfo.y);

    return {
      tagName: elementInfo.tagName,
      text: elementInfo.text,
    };
  }

  /**
   * 输入文本
   */
  async type(text: string, delay: number = 0): Promise<void> {
    if (delay === 0) {
      // 快速输入
      await this.transport.send('Input.insertText', { text });
    } else {
      // 逐字输入
      for (const char of text) {
        await this.transport.send('Input.insertText', { text: char });
        await this.sleep(delay);
      }
    }
  }

  /**
   * 在元素中输入文本
   * 支持：input、textarea、contenteditable 元素和富文本编辑器（Vditor、TinyMCE 等）
   */
  async typeInElement(selector: string, text: string, options: { clearFirst?: boolean; delay?: number } = {}): Promise<void> {
    // 检测元素类型并获取实际可输入的元素
    const elementInfo = await this.evaluate<{
      found: boolean;
      actualSelector: string;
      elementType: 'input' | 'textarea' | 'contenteditable' | 'unknown';
      tagName: string;
    }>(`
      (function() {
        let el = document.querySelector(${JSON.stringify(selector)});
        if (!el) {
          return { found: false, actualSelector: '', elementType: 'unknown', tagName: '' };
        }

        const tagName = el.tagName.toUpperCase();

        // 1. 原生 input/textarea
        if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
          return { found: true, actualSelector: ${JSON.stringify(selector)}, elementType: tagName.toLowerCase(), tagName };
        }

        // 2. 直接是 contenteditable
        if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
          return { found: true, actualSelector: ${JSON.stringify(selector)}, elementType: 'contenteditable', tagName };
        }

        // 3. 查找内部的 contenteditable 元素（富文本编辑器场景）
        // 常见的富文本编辑器选择器
        const editableSelectors = [
          '[contenteditable="true"]',
          '.vditor-ir',                    // Vditor IR 模式
          '.vditor-sv',                    // Vditor SV 模式
          '.vditor-wysiwyg',               // Vditor WYSIWYG 模式
          '.ProseMirror',                  // ProseMirror / TipTap
          '.ql-editor',                    // Quill
          '.tox-edit-area iframe',         // TinyMCE
          '.cke_editable',                 // CKEditor
          '.CodeMirror-code',              // CodeMirror
          '.monaco-editor .view-lines',    // Monaco Editor
        ];

        for (const editableSelector of editableSelectors) {
          const editable = el.querySelector(editableSelector);
          if (editable) {
            // 为找到的元素生成唯一选择器
            editable.__browserAgentTemp = true;
            return {
              found: true,
              actualSelector: '[__browserAgentTemp="true"]',
              elementType: 'contenteditable',
              tagName: editable.tagName
            };
          }
        }

        // 4. 查找任何 contenteditable 子元素
        const anyEditable = el.querySelector('[contenteditable="true"]');
        if (anyEditable) {
          anyEditable.__browserAgentTemp = true;
          return {
            found: true,
            actualSelector: '[__browserAgentTemp="true"]',
            elementType: 'contenteditable',
            tagName: anyEditable.tagName
          };
        }

        return { found: false, actualSelector: '', elementType: 'unknown', tagName };
      })()
    `);

    if (!elementInfo.found) {
      throw new Error(`Cannot find editable element for selector: ${selector}. Make sure the element is an input, textarea, or contenteditable element.`);
    }

    // 先点击元素获取焦点
    await this.clickElement(elementInfo.actualSelector);

    // 清空现有内容
    if (options.clearFirst) {
      if (elementInfo.elementType === 'input' || elementInfo.elementType === 'textarea') {
        // 对于 input/textarea，使用全选+删除
        await this.evaluate(`
          (function() {
            const el = document.querySelector(${JSON.stringify(elementInfo.actualSelector)});
            if (el) {
              el.select();
              el.value = '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          })()
        `);
      } else if (elementInfo.elementType === 'contenteditable') {
        // 对于 contenteditable，使用全选+删除
        await this.evaluate(`
          (function() {
            const el = document.querySelector(${JSON.stringify(elementInfo.actualSelector)});
            if (el) {
              el.focus();
              // 方法1：使用 Selection API 全选然后删除
              const selection = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(el);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          })()
        `);
        // 删除选中内容
        await this.pressKey('Backspace');
      }
    }

    // 清理临时标记
    await this.evaluate(`
      (function() {
        const el = document.querySelector('[__browserAgentTemp="true"]');
        if (el) el.removeAttribute('__browserAgentTemp');
      })()
    `);

    // 输入文本
    await this.type(text, options.delay);
  }

  /**
   * 按键
   */
  async pressKey(key: string): Promise<void> {
    await this.transport.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
    });
    await this.transport.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
    });
  }

  /**
   * 滚动页面
   */
  async scroll(direction: 'up' | 'down' | 'left' | 'right', distance: number = 500): Promise<{ x: number; y: number }> {
    let deltaX = 0;
    let deltaY = 0;

    switch (direction) {
      case 'up':
        deltaY = -distance;
        break;
      case 'down':
        deltaY = distance;
        break;
      case 'left':
        deltaX = -distance;
        break;
      case 'right':
        deltaX = distance;
        break;
    }

    await this.transport.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 400,
      y: 300,
      deltaX,
      deltaY,
    });

    // 返回当前滚动位置
    return this.evaluate<{ x: number; y: number }>(`
      ({ x: window.scrollX, y: window.scrollY })
    `);
  }

  /**
   * 滚动到元素
   */
  async scrollToElement(selector: string): Promise<void> {
    await this.evaluate(`
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      })()
    `);
  }

  /**
   * 滚动到指定位置
   */
  async scrollTo(x: number, y: number): Promise<void> {
    await this.evaluate(`window.scrollTo(${x}, ${y})`);
  }

  /**
   * 获取页面信息
   */
  async getPageInfo(): Promise<{ url: string; title: string }> {
    return this.evaluate<{ url: string; title: string }>(`
      ({ url: window.location.href, title: document.title })
    `);
  }

  /**
   * 获取视口尺寸
   */
  async getViewportSize(): Promise<{ width: number; height: number }> {
    return this.evaluate<{ width: number; height: number }>(`
      ({ width: window.innerWidth, height: window.innerHeight })
    `);
  }

  /**
   * 辅助方法：延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 移动鼠标到指定坐标
   */
  async moveMouse(x: number, y: number, steps: number = 1): Promise<void> {
    if (steps <= 1) {
      await this.transport.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
      });
    } else {
      // 获取当前鼠标位置（默认从视口中心开始）
      const viewport = await this.getViewportSize();
      let currentX = viewport.width / 2;
      let currentY = viewport.height / 2;

      const deltaX = (x - currentX) / steps;
      const deltaY = (y - currentY) / steps;

      for (let i = 1; i <= steps; i++) {
        currentX += deltaX;
        currentY += deltaY;
        await this.transport.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: Math.round(currentX),
          y: Math.round(currentY),
        });
        await this.sleep(10);
      }
    }
  }

  /**
   * 选择下拉框选项
   */
  async selectOption(
    selector: string,
    options: { value?: string; text?: string; index?: number }
  ): Promise<{ value: string; text: string }> {
    const result = await this.evaluate<{ value: string; text: string }>(`
      (function() {
        const select = document.querySelector(${JSON.stringify(selector)});
        if (!select || select.tagName !== 'SELECT') {
          throw new Error('Element is not a SELECT: ${selector}');
        }

        let optionToSelect = null;

        ${options.value !== undefined ? `
        // 按 value 选择
        optionToSelect = Array.from(select.options).find(opt => opt.value === ${JSON.stringify(options.value)});
        ` : ''}

        ${options.text !== undefined ? `
        // 按 text 选择
        if (!optionToSelect) {
          optionToSelect = Array.from(select.options).find(opt => opt.text === ${JSON.stringify(options.text)});
        }
        ` : ''}

        ${options.index !== undefined ? `
        // 按 index 选择
        if (!optionToSelect) {
          optionToSelect = select.options[${options.index}];
        }
        ` : ''}

        if (!optionToSelect) {
          throw new Error('Option not found');
        }

        select.value = optionToSelect.value;

        // 触发 change 事件
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('input', { bubbles: true }));

        return {
          value: optionToSelect.value,
          text: optionToSelect.text
        };
      })()
    `);

    return result;
  }

  /**
   * 启用控制台日志收集
   */
  async enableConsoleCapture(): Promise<void> {
    await this.transport.send('Runtime.enable');
    await this.transport.send('Log.enable');
  }

  /**
   * 获取控制台日志
   */
  async getConsoleLogs(): Promise<Array<{
    type: 'log' | 'info' | 'warn' | 'error' | 'debug';
    text: string;
    timestamp: number;
    url?: string;
    lineNumber?: number;
  }>> {
    // 通过注入脚本获取控制台日志
    const logs = await this.evaluate<Array<{
      type: string;
      text: string;
      timestamp: number;
      url?: string;
      lineNumber?: number;
    }>>(`
      (function() {
        // 如果还没有设置日志收集器，设置一个
        if (!window.__agentsCCConsoleLogs) {
          window.__agentsCCConsoleLogs = [];
          window.__agentsCCMaxLogs = 1000;

          const originalConsole = {
            log: console.log,
            info: console.info,
            warn: console.warn,
            error: console.error,
            debug: console.debug
          };

          ['log', 'info', 'warn', 'error', 'debug'].forEach(type => {
            console[type] = function(...args) {
              window.__agentsCCConsoleLogs.push({
                type: type,
                text: args.map(arg => {
                  try {
                    return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
                  } catch {
                    return String(arg);
                  }
                }).join(' '),
                timestamp: Date.now()
              });

              // 限制日志数量
              if (window.__agentsCCConsoleLogs.length > window.__agentsCCMaxLogs) {
                window.__agentsCCConsoleLogs.shift();
              }

              originalConsole[type].apply(console, args);
            };
          });

          // 监听全局错误
          window.addEventListener('error', (event) => {
            window.__agentsCCConsoleLogs.push({
              type: 'error',
              text: event.message,
              timestamp: Date.now(),
              url: event.filename,
              lineNumber: event.lineno
            });
          });

          // 监听未处理的 Promise 错误
          window.addEventListener('unhandledrejection', (event) => {
            window.__agentsCCConsoleLogs.push({
              type: 'error',
              text: 'Unhandled Promise Rejection: ' + String(event.reason),
              timestamp: Date.now()
            });
          });
        }

        // 返回并清空日志
        const logs = window.__agentsCCConsoleLogs.slice();
        window.__agentsCCConsoleLogs = [];
        return logs;
      })()
    `);

    return logs as Array<{
      type: 'log' | 'info' | 'warn' | 'error' | 'debug';
      text: string;
      timestamp: number;
      url?: string;
      lineNumber?: number;
    }>;
  }

  /**
   * 获取 transport 实例（用于高级操作）
   */
  getTransport(): ExtensionTransport {
    return this.transport;
  }

  /**
   * 获取标签页 ID
   */
  getTabId(): number {
    return this.tabId;
  }

  // ============================================================================
  // 网络请求捕获
  // ============================================================================

  /**
   * 启用网络请求捕获
   */
  async enableNetworkCapture(): Promise<void> {
    if (this.networkCaptureEnabled) return;

    await this.transport.send('Network.enable');

    // 监听网络事件
    this.transport.on((method: string, params: unknown) => {
      this.handleNetworkEvent(method, params);
    });

    this.networkCaptureEnabled = true;
  }

  /**
   * 禁用网络请求捕获
   */
  async disableNetworkCapture(): Promise<void> {
    if (!this.networkCaptureEnabled) return;

    await this.transport.send('Network.disable');
    this.networkCaptureEnabled = false;
  }

  /**
   * 处理网络事件
   */
  private handleNetworkEvent(method: string, params: unknown): void {
    switch (method) {
      case 'Network.requestWillBeSent': {
        const data = params as {
          requestId: string;
          request: {
            url: string;
            method: string;
            headers: Record<string, string>;
            postData?: string;
          };
          timestamp: number;
          type: string;
        };

        // 限制存储数量
        if (this.networkRequests.size >= this.maxNetworkRequests) {
          const oldestKey = this.networkRequests.keys().next().value;
          if (oldestKey) {
            this.networkRequests.delete(oldestKey);
          }
        }

        this.networkRequests.set(data.requestId, {
          requestId: data.requestId,
          url: data.request.url,
          method: data.request.method,
          headers: data.request.headers,
          postData: data.request.postData,
          resourceType: data.type,
          timestamp: data.timestamp * 1000,
        });
        break;
      }

      case 'Network.responseReceived': {
        const data = params as {
          requestId: string;
          response: {
            status: number;
            statusText: string;
            headers: Record<string, string>;
            mimeType: string;
            timing?: {
              requestTime: number;
              receiveHeadersEnd: number;
            };
          };
        };

        const request = this.networkRequests.get(data.requestId);
        if (request) {
          request.response = {
            status: data.response.status,
            statusText: data.response.statusText,
            headers: data.response.headers,
            mimeType: data.response.mimeType,
            timing: data.response.timing,
          };
        }
        break;
      }

      case 'Network.loadingFailed': {
        const data = params as {
          requestId: string;
          errorText: string;
        };

        const request = this.networkRequests.get(data.requestId);
        if (request) {
          request.error = data.errorText;
        }
        break;
      }
    }
  }

  /**
   * 获取捕获的网络请求
   */
  getNetworkRequests(options?: {
    urlPattern?: string;
    method?: string;
    statusCode?: number;
    resourceType?: string;
    clear?: boolean;
  }): StoredNetworkRequest[] {
    let requests = Array.from(this.networkRequests.values());

    // 按URL模式过滤
    if (options?.urlPattern) {
      const regex = new RegExp(options.urlPattern);
      requests = requests.filter(r => regex.test(r.url));
    }

    // 按方法过滤
    if (options?.method) {
      requests = requests.filter(r => r.method.toUpperCase() === options.method!.toUpperCase());
    }

    // 按状态码过滤
    if (options?.statusCode !== undefined) {
      requests = requests.filter(r => r.response?.status === options.statusCode);
    }

    // 按资源类型过滤
    if (options?.resourceType) {
      requests = requests.filter(r => r.resourceType === options.resourceType);
    }

    // 清空已捕获的请求
    if (options?.clear) {
      this.networkRequests.clear();
    }

    return requests;
  }

  /**
   * 清空捕获的网络请求
   */
  clearNetworkRequests(): void {
    this.networkRequests.clear();
  }

  /**
   * 等待指定的网络响应
   */
  async waitForResponse(
    urlPattern: string,
    options?: {
      method?: string;
      timeout?: number;
    }
  ): Promise<StoredNetworkRequest | null> {
    const timeout = options?.timeout || 30000;
    const startTime = Date.now();
    const regex = new RegExp(urlPattern);

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        // 检查是否已有匹配的请求
        for (const request of this.networkRequests.values()) {
          if (regex.test(request.url) && request.response) {
            if (!options?.method || request.method.toUpperCase() === options.method.toUpperCase()) {
              clearInterval(checkInterval);
              resolve(request);
              return;
            }
          }
        }

        // 超时检查
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          resolve(null);
        }
      }, 100);
    });
  }

  // ============================================================================
  // 等待机制
  // ============================================================================

  /**
   * 等待选择器出现
   */
  async waitForSelector(
    selector: string,
    options?: {
      visible?: boolean;
      hidden?: boolean;
      timeout?: number;
    }
  ): Promise<boolean> {
    const timeout = options?.timeout || 30000;
    const startTime = Date.now();
    const visible = options?.visible ?? true;
    const hidden = options?.hidden ?? false;

    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        try {
          const result = await this.evaluate<{
            found: boolean;
            visible: boolean;
          }>(`
            (function() {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return { found: false, visible: false };

              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              const isVisible = style.display !== 'none'
                && style.visibility !== 'hidden'
                && style.opacity !== '0'
                && rect.width > 0
                && rect.height > 0;

              return { found: true, visible: isVisible };
            })()
          `);

          // 等待隐藏
          if (hidden) {
            if (!result.found || !result.visible) {
              clearInterval(checkInterval);
              resolve(true);
              return;
            }
          }
          // 等待出现并可见
          else if (visible) {
            if (result.found && result.visible) {
              clearInterval(checkInterval);
              resolve(true);
              return;
            }
          }
          // 只等待存在
          else {
            if (result.found) {
              clearInterval(checkInterval);
              resolve(true);
              return;
            }
          }
        } catch {
          // 忽略错误，继续等待
        }

        // 超时检查
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          resolve(false);
        }
      }, 100);
    });
  }

  /**
   * 等待指定时间
   */
  async waitForTimeout(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 等待页面加载状态
   */
  async waitForLoadState(
    state: 'load' | 'domcontentloaded' | 'networkidle',
    options?: { timeout?: number }
  ): Promise<boolean> {
    const timeout = options?.timeout || 30000;

    if (state === 'networkidle') {
      // 等待网络空闲（500ms内没有新请求）
      return this.waitForNetworkIdle(timeout);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.transport.off(handler);
        resolve(false);
      }, timeout);

      const eventName = state === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired';

      const handler = (method: string) => {
        if (method === eventName) {
          clearTimeout(timer);
          this.transport.off(handler);
          resolve(true);
        }
      };

      this.transport.on(handler);

      // 也检查当前状态
      this.evaluate<string>('document.readyState').then((readyState) => {
        if (state === 'load' && readyState === 'complete') {
          clearTimeout(timer);
          this.transport.off(handler);
          resolve(true);
        } else if (state === 'domcontentloaded' && (readyState === 'interactive' || readyState === 'complete')) {
          clearTimeout(timer);
          this.transport.off(handler);
          resolve(true);
        }
      }).catch(() => {});
    });
  }

  /**
   * 等待网络空闲
   */
  private async waitForNetworkIdle(timeout: number, idleTime: number = 500): Promise<boolean> {
    const startTime = Date.now();
    let lastRequestTime = Date.now();

    return new Promise((resolve) => {
      const handler = (method: string) => {
        if (method === 'Network.requestWillBeSent' || method === 'Network.responseReceived') {
          lastRequestTime = Date.now();
        }
      };

      this.transport.on(handler);

      const checkInterval = setInterval(() => {
        // 检查是否已空闲
        if (Date.now() - lastRequestTime > idleTime) {
          clearInterval(checkInterval);
          this.transport.off(handler);
          resolve(true);
          return;
        }

        // 超时检查
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          this.transport.off(handler);
          resolve(false);
        }
      }, 100);
    });
  }

  /**
   * 等待函数返回真值
   */
  async waitForFunction(
    fn: string,
    options?: { timeout?: number; polling?: number }
  ): Promise<boolean> {
    const timeout = options?.timeout || 30000;
    const polling = options?.polling || 100;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        try {
          const result = await this.evaluate<unknown>(fn);
          if (result) {
            clearInterval(checkInterval);
            resolve(true);
            return;
          }
        } catch {
          // 忽略错误，继续等待
        }

        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          resolve(false);
        }
      }, polling);
    });
  }

  // ============================================================================
  // 文件上传
  // ============================================================================

  /**
   * 设置文件输入
   */
  async setInputFiles(selector: string, files: string[]): Promise<void> {
    // 获取文件输入元素的节点ID
    const nodeInfo = await this.evaluate<{ backendNodeId: number } | null>(`
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el || el.tagName !== 'INPUT' || el.type !== 'file') {
          return null;
        }
        return { found: true };
      })()
    `);

    if (!nodeInfo) {
      throw new Error(`File input not found: ${selector}`);
    }

    // 使用 DOM.querySelector 获取节点ID
    const doc = await this.transport.send<{ root: { nodeId: number } }>('DOM.getDocument');
    const queryResult = await this.transport.send<{ nodeId: number }>('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector,
    });

    if (!queryResult.nodeId) {
      throw new Error(`Cannot find node for selector: ${selector}`);
    }

    // 使用 DOM.setFileInputFiles 设置文件
    await this.transport.send('DOM.setFileInputFiles', {
      nodeId: queryResult.nodeId,
      files,
    });
  }

  // ============================================================================
  // 弹窗处理
  // ============================================================================

  /**
   * 获取当前弹窗信息
   */
  getDialog(): DialogInfo | null {
    return this.pendingDialogs[0] || null;
  }

  /**
   * 处理弹窗
   */
  async handleDialog(accept: boolean, promptText?: string): Promise<boolean> {
    const dialog = this.pendingDialogs.shift();
    if (!dialog) {
      return false;
    }

    await this.transport.send('Page.handleJavaScriptDialog', {
      accept,
      promptText,
    });

    return true;
  }

  /**
   * 自动处理弹窗（设置默认行为）
   */
  setAutoDialogHandler(handler: 'accept' | 'dismiss' | null): void {
    if (handler === null) {
      // 移除自动处理
      if (this.autoDialogListener) {
        this.transport.off(this.autoDialogListener);
        this.autoDialogListener = null;
      }
      return;
    }

    // 如果之前有监听器，先移除
    if (this.autoDialogListener) {
      this.transport.off(this.autoDialogListener);
    }

    this.autoDialogListener = (method: string) => {
      if (method === 'Page.javascriptDialogOpening') {
        this.transport.send('Page.handleJavaScriptDialog', {
          accept: handler === 'accept',
        }).catch(() => {});
      }
    };

    this.transport.on(this.autoDialogListener);
  }

  private autoDialogListener: ((method: string, params?: unknown) => void) | null = null;

  /**
   * 获取所有待处理的弹窗
   */
  getPendingDialogs(): DialogInfo[] {
    return [...this.pendingDialogs];
  }

  /**
   * 清空待处理弹窗
   */
  clearPendingDialogs(): void {
    this.pendingDialogs = [];
  }

  // ============================================================================
  // Hover 和高级鼠标操作
  // ============================================================================

  /**
   * 悬停在元素上
   */
  async hover(selector: string): Promise<void> {
    const elementInfo = await this.evaluate<{ x: number; y: number }>(`
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      })()
    `);

    await this.moveMouse(elementInfo.x, elementInfo.y);
  }

  /**
   * 双击元素
   */
  async doubleClick(selector: string): Promise<void> {
    const elementInfo = await this.evaluate<{ x: number; y: number }>(`
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      })()
    `);

    await this.clickAt(elementInfo.x, elementInfo.y, { clickCount: 2 });
  }

  /**
   * 右键点击元素
   */
  async rightClick(selector: string): Promise<void> {
    const elementInfo = await this.evaluate<{ x: number; y: number }>(`
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      })()
    `);

    await this.clickAt(elementInfo.x, elementInfo.y, { button: 'right' });
  }
}
