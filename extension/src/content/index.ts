/**
 * Content Script
 * 用于复杂 DOM 操作、Shadow DOM 访问和控制遮罩
 */

import type { ContentMessage, ContentResponse } from '@/types/message';

// ============================================================================
// Agent 控制遮罩层
// ============================================================================

interface OverlayState {
  enabled: boolean;
  status: string;
  element: HTMLDivElement | null;
}

const overlayState: OverlayState = {
  enabled: false,
  status: '',
  element: null,
};

/**
 * 创建控制遮罩层的样式
 */
function createOverlayStyles(): HTMLStyleElement {
  const style = document.createElement('style');
  style.id = 'agents-cc-overlay-styles';
  style.textContent = `
    @keyframes agents-cc-border-pulse {
      0%, 100% {
        box-shadow: inset 0 0 0 4px rgba(59, 130, 246, 0.8),
                    inset 0 0 30px rgba(59, 130, 246, 0.3),
                    0 0 20px rgba(59, 130, 246, 0.4);
      }
      50% {
        box-shadow: inset 0 0 0 4px rgba(59, 130, 246, 1),
                    inset 0 0 50px rgba(59, 130, 246, 0.5),
                    0 0 40px rgba(59, 130, 246, 0.6);
      }
    }

    @keyframes agents-cc-dot-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    @keyframes agents-cc-shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }

    #agents-cc-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 2147483646;
      pointer-events: auto;
      animation: agents-cc-border-pulse 2s ease-in-out infinite;
      transition: opacity 0.3s ease;
    }

    #agents-cc-overlay.agents-cc-hidden {
      opacity: 0;
      pointer-events: none;
    }

    #agents-cc-overlay-blocker {
      position: absolute;
      top: 4px;
      left: 4px;
      right: 4px;
      bottom: 4px;
      background: transparent;
      cursor: not-allowed;
    }

    #agents-cc-status-bar {
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      background: linear-gradient(135deg, rgba(30, 58, 138, 0.95), rgba(59, 130, 246, 0.9));
      backdrop-filter: blur(10px);
      padding: 10px 20px;
      border-radius: 50px;
      box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4),
                  0 0 0 1px rgba(255, 255, 255, 0.1);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    #agents-cc-status-icon {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    #agents-cc-status-icon svg {
      width: 20px;
      height: 20px;
      fill: white;
    }

    #agents-cc-status-dot {
      width: 8px;
      height: 8px;
      background: #4ade80;
      border-radius: 50%;
      animation: agents-cc-dot-pulse 1.5s ease-in-out infinite;
      box-shadow: 0 0 10px #4ade80;
    }

    #agents-cc-status-text {
      color: white;
      font-size: 14px;
      font-weight: 500;
      letter-spacing: 0.3px;
      max-width: 400px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      background: linear-gradient(90deg, white 40%, rgba(255,255,255,0.6) 50%, white 60%);
      background-size: 200% auto;
      -webkit-background-clip: text;
      background-clip: text;
    }

    #agents-cc-status-text.agents-cc-shimmer {
      animation: agents-cc-shimmer 2s linear infinite;
      -webkit-text-fill-color: transparent;
    }

    #agents-cc-corner-indicator {
      position: absolute;
      bottom: 20px;
      right: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(30, 58, 138, 0.9);
      backdrop-filter: blur(10px);
      padding: 8px 14px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    }

    #agents-cc-corner-indicator span {
      color: rgba(255, 255, 255, 0.9);
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
  `;
  return style;
}

/**
 * 创建遮罩层 DOM 结构
 */
function createOverlayElement(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.id = 'agents-cc-overlay';
  overlay.className = 'agents-cc-hidden';

  overlay.innerHTML = `
    <div id="agents-cc-overlay-blocker"></div>
    <div id="agents-cc-status-bar">
      <div id="agents-cc-status-icon">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
      </div>
      <div id="agents-cc-status-dot"></div>
      <span id="agents-cc-status-text">Agent is controlling this page</span>
    </div>
    <div id="agents-cc-corner-indicator">
      <div id="agents-cc-status-dot" style="width:6px;height:6px;"></div>
      <span>Agents CC Active</span>
    </div>
  `;

  // 阻止所有用户输入事件
  const blocker = overlay.querySelector('#agents-cc-overlay-blocker') as HTMLDivElement;

  const blockEvent = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  };

  // 阻止鼠标事件
  ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel'].forEach(event => {
    blocker.addEventListener(event, blockEvent, true);
  });

  // 阻止键盘事件（在 document 级别）
  const keyBlocker = (e: KeyboardEvent) => {
    if (overlayState.enabled) {
      // 允许一些系统快捷键
      if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) {
        return; // 允许打开 DevTools
      }
      e.preventDefault();
      e.stopPropagation();
    }
  };

  document.addEventListener('keydown', keyBlocker, true);
  document.addEventListener('keyup', keyBlocker, true);
  document.addEventListener('keypress', keyBlocker, true);

  return overlay;
}

/**
 * 初始化遮罩层
 */
function initOverlay(): void {
  // 检查是否已初始化
  if (document.getElementById('agents-cc-overlay')) {
    return;
  }

  // 添加样式
  const existingStyle = document.getElementById('agents-cc-overlay-styles');
  if (!existingStyle) {
    document.head.appendChild(createOverlayStyles());
  }

  // 创建遮罩层
  overlayState.element = createOverlayElement();
  document.body.appendChild(overlayState.element);
}

/**
 * 显示遮罩层
 */
function showOverlay(status?: string): ContentResponse<boolean> {
  try {
    initOverlay();

    if (overlayState.element) {
      overlayState.element.classList.remove('agents-cc-hidden');
      overlayState.enabled = true;

      if (status) {
        updateOverlayStatus(status);
      }
    }

    return { success: true, data: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to show overlay',
    };
  }
}

/**
 * 隐藏遮罩层
 */
function hideOverlay(): ContentResponse<boolean> {
  try {
    if (overlayState.element) {
      overlayState.element.classList.add('agents-cc-hidden');
      overlayState.enabled = false;
    }

    return { success: true, data: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to hide overlay',
    };
  }
}

/**
 * 更新遮罩层状态文本
 */
function updateOverlayStatus(status: string, shimmer: boolean = false): ContentResponse<boolean> {
  try {
    initOverlay();

    const statusText = document.getElementById('agents-cc-status-text');
    if (statusText) {
      statusText.textContent = status;
      overlayState.status = status;

      if (shimmer) {
        statusText.classList.add('agents-cc-shimmer');
      } else {
        statusText.classList.remove('agents-cc-shimmer');
      }
    }

    return { success: true, data: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update status',
    };
  }
}

/**
 * 获取遮罩层状态
 */
function getOverlayState(): ContentResponse<{ enabled: boolean; status: string }> {
  return {
    success: true,
    data: {
      enabled: overlayState.enabled,
      status: overlayState.status,
    },
  };
}

/**
 * 构建 DOM 树（带元素索引）- 完整版
 */
function buildDomTree(): DOMTreeNode[] {
  let index = 0;

  function processNode(node: Element): DOMTreeNode | null {
    // 跳过不可见元素
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return null;
    }

    const rect = node.getBoundingClientRect();

    // 跳过零尺寸元素
    if (rect.width === 0 && rect.height === 0) {
      return null;
    }

    const currentIndex = index++;
    const children: DOMTreeNode[] = [];

    // 处理 Shadow DOM
    if (node.shadowRoot) {
      for (const child of node.shadowRoot.children) {
        if (child instanceof Element) {
          const childNode = processNode(child);
          if (childNode) {
            children.push(childNode);
          }
        }
      }
    }

    // 处理普通子节点
    for (const child of node.children) {
      const childNode = processNode(child);
      if (childNode) {
        children.push(childNode);
      }
    }

    // 获取文本内容（仅直接文本）
    let text = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent?.trim() || '';
      }
    }

    return {
      index: currentIndex,
      tagName: node.tagName.toLowerCase(),
      id: node.id || undefined,
      className: node.className || undefined,
      text: text.slice(0, 200),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      attributes: getImportantAttributes(node),
      children: children.length > 0 ? children : undefined,
    };
  }

  const result: DOMTreeNode[] = [];
  const root = processNode(document.body);
  if (root) {
    result.push(root);
  }

  return result;
}

// ============================================================================
// 紧凑格式 DOM 树（参考 Playwright ARIA Snapshot）
// ============================================================================

// 元素索引到 DOM 元素的映射（用于 click/type 操作）
let elementIndexMap: Map<number, Element> = new Map();

/**
 * 可交互元素的标签列表
 */
const INTERACTIVE_TAGS = new Set([
  'a', 'button', 'input', 'textarea', 'select', 'option',
  'details', 'summary', 'dialog', 'menu', 'menuitem',
  'video', 'audio', // 媒体元素
]);

/**
 * 可交互的 role 属性
 */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'radio', 'switch', 'tab', 'treeitem', 'checkbox',
  'combobox', 'listbox', 'searchbox', 'slider', 'spinbutton', 'textbox',
  'gridcell', 'row', 'progressbar', 'scrollbar', 'separator', 'tooltip',
]);

/**
 * 暗示可交互的类名关键词（用于检测非标准交互元素）
 */
const INTERACTIVE_CLASS_KEYWORDS = [
  'btn', 'button', 'click', 'link', 'tab', 'toggle', 'switch',
  'dropdown', 'menu', 'action', 'submit', 'close', 'open',
  'expand', 'collapse', 'play', 'pause', 'like', 'share', 'comment',
  'follow', 'subscribe', 'download', 'upload', 'search', 'nav',
];

/**
 * 语义区域标签（这些容器会被保留以提供结构）
 */
const LANDMARK_TAGS = new Set([
  'header', 'nav', 'main', 'aside', 'footer', 'form',
]);

/**
 * 有意义的文本标签（独立输出文本）
 */
const TEXT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'label', 'li', 'td', 'th', 'caption', 'figcaption',
]);

/**
 * 需要排除的标签
 */
const EXCLUDED_TAGS = new Set([
  'script', 'style', 'noscript', 'svg', 'path', 'defs', 'clippath',
  'lineargradient', 'radialgradient', 'stop', 'symbol', 'use',
  'meta', 'link', 'head', 'title',
]);

interface CompactElement {
  index: number;
  element: Element;
  tag: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  attrs: Record<string, string>;
  landmark?: string;
}

interface CompactDomTreeOptions {
  selector?: string;      // 限定范围选择器
  maxDepth?: number;      // 最大遍历深度
  excludeTags?: string[]; // 额外排除的标签
}

/**
 * 判断元素是否可交互
 */
function isInteractive(el: Element): boolean {
  const tag = el.tagName.toLowerCase();

  // 检查标签
  if (INTERACTIVE_TAGS.has(tag)) return true;

  // 检查 role
  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;

  // 检查 contenteditable
  if (el.getAttribute('contenteditable') === 'true') return true;
  if ((el as HTMLElement).isContentEditable) return true;

  // 检查 tabindex（可聚焦元素）
  const tabindex = el.getAttribute('tabindex');
  if (tabindex && parseInt(tabindex) >= 0) return true;

  // 检查点击事件（通过 onclick 属性）
  if (el.hasAttribute('onclick')) return true;

  // 检查 data-action 等常见交互属性
  if (el.hasAttribute('data-action') || el.hasAttribute('data-click')) return true;

  // 对于 div/span 等通用容器，需要更严格的检测
  // 因为它们经常被用作布局容器而非交互元素
  const isGenericContainer = ['div', 'span', 'section', 'article', 'li', 'ul', 'ol'].includes(tag);

  // 对于通用容器，如果有子元素包含真正的交互元素（a, button, input等），
  // 则不应该将容器标记为交互元素，应该让子元素来承担交互角色
  if (isGenericContainer) {
    const hasInteractiveChild = el.querySelector('a, button, input, textarea, select, [role="button"], [role="link"], [role="tab"]');
    if (hasInteractiveChild) {
      // 容器内有交互子元素，不将容器本身标记为交互
      return false;
    }
  }

  // 检查 cursor:pointer 样式（常见的交互暗示）
  try {
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer') {
      // 对于通用容器，cursor:pointer 不足以判定为交互元素
      // 需要有明确的交互暗示（如 aria-label、title）
      if (isGenericContainer) {
        const ariaLabel = el.getAttribute('aria-label');
        const title = el.getAttribute('title');
        // 只有当有 aria-label 或 title 时才认为是交互元素
        if (ariaLabel || title) {
          return true;
        }
        // 对于没有子元素的叶子节点，且有直接文本，可以认为是交互元素
        const hasDirectText = Array.from(el.childNodes).some(
          node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
        );
        const childCount = el.children.length;
        // 只有叶子节点或近乎叶子节点才考虑
        if (hasDirectText && childCount === 0) {
          return true;
        }
      } else {
        // 非通用容器，cursor:pointer 可以作为交互暗示
        const hasText = el.textContent?.trim();
        const hasAriaLabel = el.getAttribute('aria-label');
        const hasTitle = el.getAttribute('title');
        if (hasText || hasAriaLabel || hasTitle) {
          return true;
        }
      }
    }
  } catch {
    // 忽略样式计算错误
  }

  // 对于通用容器，跳过类名检测（容易误判）
  if (isGenericContainer) {
    return false;
  }

  // 检查类名是否包含交互关键词（仅用于非通用容器）
  const className = el.className;
  if (typeof className === 'string' && className) {
    const lowerClassName = className.toLowerCase();
    for (const keyword of INTERACTIVE_CLASS_KEYWORDS) {
      if (lowerClassName.includes(keyword)) {
        return true;
      }
    }
  }

  // 检查常见的交互数据属性
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const attrName = attrs[i].name.toLowerCase();
    if (attrName.startsWith('data-') &&
        (attrName.includes('click') || attrName.includes('action') ||
         attrName.includes('toggle') || attrName.includes('trigger'))) {
      return true;
    }
  }

  return false;
}

/**
 * 判断元素是否可见
 */
function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;

  return true;
}

/**
 * 获取元素的可访问名称
 */
function getAccessibleName(el: Element): string {
  // 优先级：aria-label > aria-labelledby > alt > title > placeholder > text content
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const labelEl = document.getElementById(ariaLabelledBy);
    if (labelEl) return labelEl.textContent?.trim() || '';
  }

  const alt = el.getAttribute('alt');
  if (alt) return alt.trim();

  const title = el.getAttribute('title');
  if (title) return title.trim();

  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return placeholder.trim();

  // 获取直接文本内容（不包括子元素）
  let text = '';
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent?.trim() || '';
    }
  }

  // 如果没有直接文本，获取完整文本（但限制长度）
  if (!text) {
    text = el.textContent?.trim() || '';
  }

  return text.slice(0, 80);
}

/**
 * 查找最近的 landmark 祖先
 */
function findLandmark(el: Element): string | undefined {
  let current: Element | null = el.parentElement;
  while (current) {
    const tag = current.tagName.toLowerCase();
    if (LANDMARK_TAGS.has(tag)) {
      return tag;
    }
    const role = current.getAttribute('role');
    if (role && ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'form', 'search', 'region'].includes(role)) {
      return role;
    }
    current = current.parentElement;
  }
  return undefined;
}

/**
 * 格式化边界框
 */
function formatRect(rect: DOMRect): string {
  return `@(${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)})`;
}

/**
 * 内部节点结构（用于两阶段处理）
 */
interface InternalNode {
  element: Element;
  tag: string;
  interactive: boolean;
  isLandmark: boolean;
  isTextTag: boolean;
  text: string;
  depth: number;
  children: InternalNode[];
}

/**
 * 构建紧凑格式的 DOM 树（树状结构）
 * 返回文字、可操作元素，以及构建树状结构必须的容器节点
 *
 * 使用两阶段处理：
 * 1. 第一阶段：收集需要输出的节点，构建内部树
 * 2. 第二阶段：按输出顺序分配索引，生成输出文本
 */
function buildCompactDomTree(options: CompactDomTreeOptions = {}): string {
  const { selector, maxDepth = 15, excludeTags = [] } = options;
  const excludeSet = new Set([...EXCLUDED_TAGS, ...excludeTags.map(t => t.toLowerCase())]);

  // 重置元素索引映射
  elementIndexMap = new Map();

  // 获取根元素
  const root = selector ? document.querySelector(selector) : document.body;
  if (!root) {
    return `# DOM Tree (0 elements)\n\nNo elements found${selector ? ` for selector: ${selector}` : ''}`;
  }

  /**
   * 获取元素的直接文本内容（不包括子元素的文本）
   */
  function getDirectText(el: Element): string {
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent?.trim();
        if (t) text += t + ' ';
      }
    }
    return text.trim().slice(0, 100);
  }

  /**
   * 第一阶段：递归收集需要输出的节点
   * @returns 如果节点或其子节点需要输出，返回 InternalNode；否则返回 null
   */
  function collectNode(el: Element, depth: number, insideInteractive: boolean = false): InternalNode | null {
    if (depth > maxDepth) return null;

    const tag = el.tagName.toLowerCase();

    // 跳过排除的标签
    if (excludeSet.has(tag)) return null;

    // 跳过遮罩层元素
    if (el.id === 'agents-cc-overlay') return null;

    // 检查可见性
    if (!isVisible(el)) return null;

    // 判断当前节点的类型
    const interactive = isInteractive(el);
    const isLandmark = LANDMARK_TAGS.has(tag);
    const isTextTag = TEXT_TAGS.has(tag);
    const directText = getDirectText(el);

    // 如果在可交互元素内部，且当前不是可交互或 landmark，只收集子节点
    if (insideInteractive && !interactive && !isLandmark) {
      const children: InternalNode[] = [];

      // 处理 Shadow DOM
      if (el.shadowRoot) {
        for (const child of el.shadowRoot.children) {
          if (child instanceof Element) {
            const childNode = collectNode(child, depth, true);
            if (childNode) children.push(childNode);
          }
        }
      }

      // 处理普通子元素
      for (const child of el.children) {
        const childNode = collectNode(child, depth, true);
        if (childNode) children.push(childNode);
      }

      // 如果有子节点，返回一个虚拟的透传节点
      if (children.length > 0) {
        return {
          element: el,
          tag,
          interactive: false,
          isLandmark: false,
          isTextTag: false,
          text: '',
          depth,
          children,
        };
      }
      return null;
    }

    // 收集子节点
    const children: InternalNode[] = [];
    const childInsideInteractive = insideInteractive || interactive;

    // 处理 Shadow DOM
    if (el.shadowRoot) {
      for (const child of el.shadowRoot.children) {
        if (child instanceof Element) {
          const childNode = collectNode(child, depth + 1, childInsideInteractive);
          if (childNode) children.push(childNode);
        }
      }
    }

    // 处理普通子元素
    for (const child of el.children) {
      const childNode = collectNode(child, depth + 1, childInsideInteractive);
      if (childNode) children.push(childNode);
    }

    // 决定是否需要输出当前节点
    const hasChildren = children.length > 0;
    const needsOutput = interactive || (isTextTag && directText.length > 0) || (isLandmark && hasChildren);

    if (needsOutput) {
      return {
        element: el,
        tag,
        interactive,
        isLandmark,
        isTextTag,
        text: directText,
        depth,
        children,
      };
    } else if (hasChildren) {
      // 当前节点不需要输出，但有子节点需要输出
      // 创建一个"透传"节点，不会被分配索引
      return {
        element: el,
        tag,
        interactive: false,
        isLandmark: false,
        isTextTag: false,
        text: '',
        depth,
        children,
      };
    }

    return null;
  }

  /**
   * 格式化单个节点为紧凑字符串
   */
  function formatNode(
    node: InternalNode,
    nodeIndex: number,
    outputDepth: number
  ): string {
    const { element: el, tag, interactive, isLandmark, text } = node;
    const indent = '  '.repeat(outputDepth);
    const parts: string[] = [];

    // 索引和标签
    parts.push(`[${nodeIndex}]`);
    parts.push(tag);

    // role 属性（如果有且不是标签本身）
    const role = el.getAttribute('role');
    if (role && role !== tag) {
      parts.push(`[role=${role}]`);
    }

    // 类型（对于 input）
    if (tag === 'input') {
      const type = el.getAttribute('type') || 'text';
      parts.push(`[type=${type}]`);
    }

    // 文本/名称（对于非 landmark 节点）
    if (!isLandmark) {
      const displayText = interactive ? getAccessibleName(el) : text;
      if (displayText) {
        parts.push(`"${displayText.replace(/"/g, '\\"').slice(0, 60)}"`);
      }
    }

    // placeholder（对于输入框）
    if (tag === 'input' || tag === 'textarea') {
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) parts.push(`placeholder="${placeholder.slice(0, 30)}"`);
    }

    // value（对于输入框，显示当前值）
    if (tag === 'input') {
      const type = el.getAttribute('type') || 'text';
      const inputEl = el as HTMLInputElement;
      if (!['password', 'hidden'].includes(type) && inputEl.value) {
        parts.push(`value="${inputEl.value.slice(0, 30)}"`);
      }
    }

    // textarea 内容
    if (tag === 'textarea') {
      const textareaEl = el as HTMLTextAreaElement;
      if (textareaEl.value) {
        parts.push(`value="${textareaEl.value.slice(0, 50)}"`);
      }
    }

    // select 当前选中项和选项列表
    if (tag === 'select') {
      const selectEl = el as HTMLSelectElement;
      const selectedOption = selectEl.options[selectEl.selectedIndex];
      if (selectedOption) {
        parts.push(`selected="${selectedOption.text.slice(0, 20)}"`);
      }
      // 列出所有选项（最多5个）
      const selectOptions = Array.from(selectEl.options).slice(0, 5).map(o => o.text.slice(0, 15));
      if (selectOptions.length > 0) {
        parts.push(`options=[${selectOptions.join('|')}]`);
      }
    }

    // name 属性（对于表单元素）
    if (['input', 'select', 'textarea'].includes(tag)) {
      const name = el.getAttribute('name');
      if (name) parts.push(`name="${name}"`);
    }

    // href（对于链接）
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href) {
        try {
          const url = new URL(href, window.location.origin);
          const shortHref = url.origin === window.location.origin
            ? url.pathname + url.search
            : href.slice(0, 50);
          parts.push(`→ ${shortHref}`);
        } catch {
          parts.push(`→ ${href.slice(0, 50)}`);
        }
      }
    }

    // video/audio 元素
    if (tag === 'video' || tag === 'audio') {
      const src = el.getAttribute('src');
      if (src) {
        const shortSrc = src.length > 30 ? '...' + src.slice(-27) : src;
        parts.push(`src="${shortSrc}"`);
      }
      if (tag === 'video') {
        const videoEl = el as HTMLVideoElement;
        if (videoEl.duration && !isNaN(videoEl.duration)) {
          const mins = Math.floor(videoEl.duration / 60);
          const secs = Math.floor(videoEl.duration % 60);
          parts.push(`duration=${mins}:${secs.toString().padStart(2, '0')}`);
        }
        if (videoEl.paused) parts.push('[paused]');
      }
    }

    // img src 和 alt
    if (tag === 'img') {
      const alt = el.getAttribute('alt');
      if (alt) parts.push(`alt="${alt.slice(0, 30)}"`);
      const src = el.getAttribute('src');
      if (src) {
        const shortSrc = src.length > 40 ? src.slice(0, 37) + '...' : src;
        parts.push(`src="${shortSrc}"`);
      }
    }

    // 状态属性
    const stateAttrs: string[] = [];
    if (el.hasAttribute('disabled')) stateAttrs.push('disabled');
    if (el.hasAttribute('readonly')) stateAttrs.push('readonly');
    if (el.hasAttribute('required')) stateAttrs.push('required');
    if (tag === 'input') {
      const type = el.getAttribute('type');
      if ((type === 'checkbox' || type === 'radio') && (el as HTMLInputElement).checked) {
        stateAttrs.push('checked');
      }
    }
    const expanded = el.getAttribute('aria-expanded');
    if (expanded === 'true') stateAttrs.push('expanded');
    if (expanded === 'false') stateAttrs.push('collapsed');
    const selected = el.getAttribute('aria-selected');
    if (selected === 'true') stateAttrs.push('selected');

    if (stateAttrs.length > 0) {
      parts.push(`[${stateAttrs.join(',')}]`);
    }

    // 边界框
    const rect = el.getBoundingClientRect();
    parts.push(`@(${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)})`);

    return `${indent}${parts.join(' ')}`;
  }

  /**
   * 第二阶段：遍历内部树，按顺序分配索引并生成输出
   */
  function generateOutput(node: InternalNode, outputDepth: number): { lines: string[]; index: number; interactiveCount: number; textCount: number } {
    let index = 0;
    let interactiveCount = 0;
    let textCount = 0;
    const lines: string[] = [];

    function traverse(n: InternalNode, depth: number): void {
      const needsIndex = n.interactive || n.isLandmark || n.isTextTag;

      if (needsIndex) {
        const currentIndex = index++;

        // 存储索引映射
        elementIndexMap.set(currentIndex, n.element);

        // 给元素添加 data-agent-index 属性
        (n.element as HTMLElement).dataset.agentIndex = String(currentIndex);

        if (n.interactive) interactiveCount++;
        if (n.isTextTag) textCount++;

        // 格式化当前节点
        lines.push(formatNode(n, currentIndex, depth));

        // 递归处理子节点
        for (const child of n.children) {
          traverse(child, depth + 1);
        }
      } else {
        // 透传节点：不输出自身，但处理子节点（保持深度不变）
        for (const child of n.children) {
          traverse(child, depth);
        }
      }
    }

    traverse(node, outputDepth);
    return { lines, index, interactiveCount, textCount };
  }

  // 第一阶段：收集节点
  const rootNode = collectNode(root, 0);

  if (!rootNode) {
    return `# DOM Tree (0 elements)\n\nNo interactive elements found${selector ? ` in selector: ${selector}` : ''}`;
  }

  // 第二阶段：生成输出
  const result = generateOutput(rootNode, 0);

  // 构建输出头
  const header = [
    `# DOM Tree`,
    `# ${result.index} elements, ${result.interactiveCount} interactive, ${result.textCount} text`,
  ].join('\n');

  return header + '\n\n' + result.lines.join('\n');
}

/**
 * 获取紧凑格式的属性
 */
function getCompactAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  const tag = el.tagName.toLowerCase();

  // 对于链接，获取 href
  if (tag === 'a') {
    const href = el.getAttribute('href');
    if (href) {
      // 简化 URL，只保留路径部分
      try {
        const url = new URL(href, window.location.origin);
        if (url.origin === window.location.origin) {
          attrs.href = url.pathname + url.search + url.hash;
        } else {
          attrs.href = href.slice(0, 50);
        }
      } catch {
        attrs.href = href.slice(0, 50);
      }
    }
  }

  // 对于输入框，获取 type 和 placeholder
  if (tag === 'input') {
    const type = el.getAttribute('type') || 'text';
    if (type !== 'text') attrs.type = type;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) attrs.placeholder = placeholder.slice(0, 30);
    const value = (el as HTMLInputElement).value;
    if (value && type !== 'password') attrs.value = value.slice(0, 20);
  }

  // 检查禁用状态
  if (el.hasAttribute('disabled')) attrs.disabled = 'true';

  // 检查选中状态
  if (tag === 'input') {
    const type = el.getAttribute('type');
    if (type === 'checkbox' || type === 'radio') {
      if ((el as HTMLInputElement).checked) attrs.checked = 'true';
    }
  }

  // 检查展开状态
  const expanded = el.getAttribute('aria-expanded');
  if (expanded) attrs.expanded = expanded;

  // 检查选中状态（aria）
  const selected = el.getAttribute('aria-selected');
  if (selected) attrs.selected = selected;

  return attrs;
}

/**
 * 计算一组元素的边界框
 */
function calculateGroupRect(elements: CompactElement[]): DOMRect {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const el of elements) {
    minX = Math.min(minX, el.rect.x);
    minY = Math.min(minY, el.rect.y);
    maxX = Math.max(maxX, el.rect.x + el.rect.width);
    maxY = Math.max(maxY, el.rect.y + el.rect.height);
  }

  return new DOMRect(minX, minY, maxX - minX, maxY - minY);
}

/**
 * 格式化单个元素为紧凑字符串
 */
function formatElement(el: CompactElement): string {
  const parts: string[] = [];

  // 索引
  parts.push(`[${el.index}]`);

  // 标签
  parts.push(el.tag);

  // 类型（对于 input）
  if (el.attrs.type) {
    parts.push(`[type=${el.attrs.type}]`);
  }

  // 文本/名称
  if (el.text) {
    parts.push(`"${el.text.replace(/"/g, '\\"')}"`);
  }

  // placeholder（对于输入框）
  if (el.attrs.placeholder && !el.text) {
    parts.push(`(${el.attrs.placeholder})`);
  }

  // href（对于链接）
  if (el.attrs.href) {
    parts.push(`→ ${el.attrs.href}`);
  }

  // 状态属性
  const stateAttrs: string[] = [];
  if (el.attrs.disabled) stateAttrs.push('disabled');
  if (el.attrs.checked) stateAttrs.push('checked');
  if (el.attrs.expanded === 'true') stateAttrs.push('expanded');
  if (el.attrs.selected === 'true') stateAttrs.push('selected');

  if (stateAttrs.length > 0) {
    parts.push(`[${stateAttrs.join(',')}]`);
  }

  // 边界框
  parts.push(`@(${el.rect.x},${el.rect.y},${el.rect.width},${el.rect.height})`);

  return parts.join(' ');
}

/**
 * 通过索引获取元素
 * 优先使用 data-agent-index 属性查找，这样即使 React/Vue 重新渲染也能找到正确的元素
 */
function getElementByIndex(index: number): Element | undefined {
  // 首先尝试通过 data-agent-index 属性查找（更可靠，能处理框架重新渲染的情况）
  const elementByAttr = document.querySelector(`[data-agent-index="${index}"]`);
  if (elementByAttr) {
    return elementByAttr;
  }

  // 回退到 Map 中的缓存引用
  return elementIndexMap.get(index);
}

/**
 * 通过索引点击元素
 */
function clickElementByIndex(index: number): ContentResponse<{ tagName: string; text: string }> {
  const el = getElementByIndex(index);
  if (!el) {
    return { success: false, error: `Element with index ${index} not found. Please refresh DOM tree first.` };
  }

  try {
    // 滚动到元素可见
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });

    // 模拟点击
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // 使用原生 click() 方法，它会正确触发所有事件（包括 mousedown, mouseup, click）
    // 不要同时使用 dispatchEvent 和 .click()，否则会导致双重点击
    (el as HTMLElement).click();

    return {
      success: true,
      data: {
        tagName: el.tagName.toLowerCase(),
        text: getAccessibleName(el).slice(0, 100),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to click element',
    };
  }
}

/**
 * 通过索引在元素中输入文本
 */
function typeInElementByIndex(
  index: number,
  text: string,
  clearFirst: boolean = false
): ContentResponse<{ tagName: string }> {
  const el = getElementByIndex(index);
  if (!el) {
    return { success: false, error: `Element with index ${index} not found. Please refresh DOM tree first.` };
  }

  try {
    // 滚动到元素可见
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });

    // 聚焦元素
    (el as HTMLElement).focus();

    const tag = el.tagName.toLowerCase();

    if (tag === 'input' || tag === 'textarea') {
      const inputEl = el as HTMLInputElement | HTMLTextAreaElement;

      if (clearFirst) {
        inputEl.value = '';
      }

      inputEl.value += text;

      // 触发 input 事件
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else if ((el as HTMLElement).isContentEditable || el.getAttribute('contenteditable') === 'true') {
      if (clearFirst) {
        el.textContent = '';
      }

      // 使用 execCommand 或直接修改
      document.execCommand('insertText', false, text);
    } else {
      return { success: false, error: `Element is not editable: ${tag}` };
    }

    return {
      success: true,
      data: { tagName: tag },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to type in element',
    };
  }
}

/**
 * 移除元素焦点（blur）
 * 可以通过 index、selector 或者直接 blur 当前聚焦的元素
 */
function blurElement(
  index?: number,
  selector?: string
): ContentResponse<{ tagName: string }> {
  try {
    let el: Element | null = null;

    if (index !== undefined) {
      // 通过索引查找元素
      el = getElementByIndex(index) || null;
      if (!el) {
        return { success: false, error: `Element with index ${index} not found. Please refresh DOM tree first.` };
      }
    } else if (selector) {
      // 通过选择器查找元素
      el = document.querySelector(selector);
      if (!el) {
        return { success: false, error: `Element not found: ${selector}` };
      }
    } else {
      // 默认 blur 当前聚焦的元素
      el = document.activeElement;
      if (!el || el === document.body) {
        return { success: true, data: { tagName: 'body' } }; // 没有元素聚焦，直接返回成功
      }
    }

    const tagName = el.tagName.toLowerCase();

    // 调用 blur 方法
    (el as HTMLElement).blur();

    return {
      success: true,
      data: { tagName },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to blur element',
    };
  }
}

/**
 * 在当前聚焦的元素中输入文本
 */
function typeInFocusedElement(
  text: string,
  clearFirst: boolean = false
): ContentResponse<{ tagName: string }> {
  const el = document.activeElement;
  if (!el || el === document.body) {
    return { success: false, error: 'No element is currently focused. Please click on an element first or use index parameter.' };
  }

  try {
    const tag = el.tagName.toLowerCase();

    if (tag === 'input' || tag === 'textarea') {
      const inputEl = el as HTMLInputElement | HTMLTextAreaElement;

      if (clearFirst) {
        inputEl.value = '';
      }

      inputEl.value += text;

      // 触发 input 事件
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else if ((el as HTMLElement).isContentEditable || el.getAttribute('contenteditable') === 'true') {
      if (clearFirst) {
        el.textContent = '';
      }

      // 使用 execCommand 插入文本
      document.execCommand('insertText', false, text);
    } else {
      return { success: false, error: `Focused element is not editable: ${tag}. Please use index parameter to specify the target element.` };
    }

    return {
      success: true,
      data: { tagName: tag },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to type in focused element',
    };
  }
}

interface DOMTreeNode {
  index: number;
  tagName: string;
  id?: string;
  className?: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  attributes: Record<string, string>;
  children?: DOMTreeNode[];
}

/**
 * 获取重要属性
 */
function getImportantAttributes(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  const important = ['href', 'src', 'alt', 'title', 'placeholder', 'type', 'name', 'value', 'role', 'aria-label'];

  for (const attr of important) {
    const value = element.getAttribute(attr);
    if (value) {
      attrs[attr] = value;
    }
  }

  return attrs;
}

/**
 * 获取元素信息
 */
function getElementInfo(selector: string): ContentResponse<ElementInfo> {
  try {
    const element = document.querySelector(selector);
    if (!element) {
      return { success: false, error: `Element not found: ${selector}` };
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return {
      success: true,
      data: {
        tagName: element.tagName.toLowerCase(),
        text: element.textContent?.trim().slice(0, 500) || '',
        html: element.outerHTML.slice(0, 2000),
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        visible: style.display !== 'none' && style.visibility !== 'hidden',
        attributes: Object.fromEntries(
          Array.from(element.attributes).map(a => [a.name, a.value])
        ),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

interface ElementInfo {
  tagName: string;
  text: string;
  html: string;
  rect: { x: number; y: number; width: number; height: number };
  visible: boolean;
  attributes: Record<string, string>;
}

/**
 * 提取多个元素
 */
function extractElements(
  selector: string,
  multiple: boolean,
  attributes?: string[]
): ContentResponse<ExtractedElement[]> {
  try {
    const elements = multiple
      ? Array.from(document.querySelectorAll(selector))
      : [document.querySelector(selector)].filter((e): e is Element => e !== null);

    const result: ExtractedElement[] = elements.map((el, idx) => {
      const rect = el.getBoundingClientRect();
      const attrs: Record<string, string> = {};

      if (attributes && attributes.length > 0) {
        for (const attr of attributes) {
          const value = el.getAttribute(attr);
          if (value !== null) {
            attrs[attr] = value;
          }
        }
      } else {
        for (const attr of el.attributes) {
          attrs[attr.name] = attr.value;
        }
      }

      return {
        index: idx,
        tagName: el.tagName.toLowerCase(),
        text: el.textContent?.trim().slice(0, 500) || '',
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        attributes: attrs,
      };
    });

    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

interface ExtractedElement {
  index: number;
  tagName: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  attributes: Record<string, string>;
}

/**
 * 滚动到元素
 */
function scrollToElement(selector: string): ContentResponse<boolean> {
  try {
    const element = document.querySelector(selector);
    if (!element) {
      return { success: false, error: `Element not found: ${selector}` };
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { success: true, data: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 高亮元素
 */
function highlightElement(selector: string): ContentResponse<boolean> {
  try {
    // 移除之前的高亮
    document.querySelectorAll('.agents-cc-highlight').forEach(el => el.remove());

    const element = document.querySelector(selector);
    if (!element) {
      return { success: false, error: `Element not found: ${selector}` };
    }

    const rect = element.getBoundingClientRect();

    const highlight = document.createElement('div');
    highlight.className = 'agents-cc-highlight';
    highlight.style.cssText = `
      position: fixed;
      left: ${rect.x}px;
      top: ${rect.y}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 2px solid #4CAF50;
      background: rgba(76, 175, 80, 0.2);
      pointer-events: none;
      z-index: 999999;
      transition: opacity 0.3s;
    `;

    document.body.appendChild(highlight);

    // 3秒后移除
    setTimeout(() => {
      highlight.style.opacity = '0';
      setTimeout(() => highlight.remove(), 300);
    }, 3000);

    return { success: true, data: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 执行脚本
 */
function executeScript(script: string): ContentResponse<unknown> {
  try {
    const result = eval(script);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 消息处理器
 */
chrome.runtime.onMessage.addListener(
  (message: ContentMessage, sender, sendResponse) => {
    let response: ContentResponse<unknown>;

    switch (message.type) {
      // ========== PING（检测 content script 是否加载）==========
      case 'PING':
        response = { success: true, data: 'pong' };
        break;

      // ========== DOM 树操作 ==========
      case 'GET_DOM_TREE':
        // 紧凑格式 DOM 树（默认，节省 token）
        response = {
          success: true,
          data: buildCompactDomTree({
            selector: message.payload?.selector,
            maxDepth: message.payload?.maxDepth,
            excludeTags: message.payload?.excludeTags,
          }),
        };
        break;

      case 'GET_DOM_TREE_FULL':
        // 完整 JSON 格式 DOM 树
        response = { success: true, data: buildDomTree() };
        break;

      // ========== 索引操作（配合紧凑 DOM 树）==========
      case 'CLICK_BY_INDEX':
        response = clickElementByIndex(message.payload.index);
        break;

      case 'TYPE_BY_INDEX':
        response = typeInElementByIndex(
          message.payload.index,
          message.payload.text,
          message.payload.clearFirst
        );
        break;

      case 'TYPE_IN_FOCUSED':
        response = typeInFocusedElement(
          message.payload.text,
          message.payload.clearFirst
        );
        break;

      case 'BLUR_ELEMENT':
        response = blurElement(
          message.payload?.index,
          message.payload?.selector
        );
        break;

      // ========== 选择器操作 ==========
      case 'GET_ELEMENT_INFO':
        response = getElementInfo(message.payload.selector);
        break;

      case 'EXTRACT_ELEMENTS':
        response = extractElements(
          message.payload.selector,
          message.payload.multiple,
          message.payload.attributes
        );
        break;

      case 'SCROLL_TO_ELEMENT':
        response = scrollToElement(message.payload.selector);
        break;

      case 'HIGHLIGHT_ELEMENT':
        response = highlightElement(message.payload.selector);
        break;

      case 'EXECUTE_SCRIPT':
        response = executeScript(message.payload.script);
        break;

      // ========== 遮罩层控制 ==========
      case 'SHOW_OVERLAY':
        response = showOverlay(message.payload?.status);
        break;

      case 'HIDE_OVERLAY':
        response = hideOverlay();
        break;

      case 'UPDATE_OVERLAY_STATUS':
        response = updateOverlayStatus(
          message.payload.status,
          message.payload.shimmer
        );
        break;

      case 'GET_OVERLAY_STATE':
        response = getOverlayState();
        break;

      default:
        // 对于未知消息类型，不响应，让其他监听器处理
        return false;
    }

    sendResponse(response);
    return true;
  }
);

// 标识 Content Script 已加载
console.log('[Browser Agent] Content Script loaded');
