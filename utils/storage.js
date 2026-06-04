/*
 * ChatGPT Conversation Toolkit - Storage utilities
 */
let minimizedPositionCache = null;

const saveMinimizedPosition = (position) => {
  minimizedPositionCache = position;
};

const loadMinimizedPosition = () => minimizedPositionCache;
