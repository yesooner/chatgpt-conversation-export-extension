/*
 * ChatGPT Conversation Toolkit - Global state and configuration
 */
const TOOLKIT_ID = "chatgpt-conversation-toolkit";
const STATUS_ID = "chatgpt-conversation-toolkit-status";
const MINIMIZED_ID = "chatgpt-conversation-toolkit-minimized";
const POSITION_KEY = "chatgpt-toolkit-position";
const THEME_ATTR = "data-toolkit-theme";

const state = {
  isMinimized: true,
  conversationKey: null,
  // 搜索相关状态
  searchQuery: '',
  searchMatches: [],
  currentMatchIndex: -1,
};

const minimizedButtonState = {
  pointerDown: false,
  dragging: false,
};

let themeObserver = null;
let themeMediaQuery = null;
let bodyThemeObserved = false;

const themeAttributeFilter = ["class", "data-theme", "style"];

const TOOLKIT_BOOTSTRAP_FLAG = "__chatgptConversationToolkitBootstrapped";
