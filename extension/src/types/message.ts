/**
 * 消息类型定义
 */

// Background ↔ Content Script 消息
export type ContentMessage =
  // 健康检查
  | { type: 'PING'; payload?: undefined }
  // DOM 树操作
  | { type: 'GET_DOM_TREE'; payload?: { selector?: string; maxDepth?: number; excludeTags?: string[] } }
  | { type: 'GET_DOM_TREE_FULL'; payload?: { selector?: string } }
  // 索引操作（配合紧凑 DOM 树）
  | { type: 'CLICK_BY_INDEX'; payload: { index: number } }
  | { type: 'TYPE_BY_INDEX'; payload: { index: number; text: string; clearFirst?: boolean } }
  // 在当前聚焦元素中输入
  | { type: 'TYPE_IN_FOCUSED'; payload: { text: string; clearFirst?: boolean } }
  // 移除元素焦点
  | { type: 'BLUR_ELEMENT'; payload?: { index?: number; selector?: string } }
  // 选择器操作
  | { type: 'GET_ELEMENT_INFO'; payload: { selector: string } }
  | { type: 'EXTRACT_ELEMENTS'; payload: { selector: string; multiple: boolean; attributes?: string[] } }
  | { type: 'SCROLL_TO_ELEMENT'; payload: { selector: string } }
  | { type: 'HIGHLIGHT_ELEMENT'; payload: { selector: string } }
  | { type: 'EXECUTE_SCRIPT'; payload: { script: string } }
  // 遮罩层控制
  | { type: 'SHOW_OVERLAY'; payload?: { status?: string } }
  | { type: 'HIDE_OVERLAY'; payload?: undefined }
  | { type: 'UPDATE_OVERLAY_STATUS'; payload: { status: string; shimmer?: boolean } }
  | { type: 'GET_OVERLAY_STATE'; payload?: undefined };

export type ContentResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };
