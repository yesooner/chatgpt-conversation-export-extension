/*
 * ChatGPT Conversation Toolkit - Internationalization
 */
const I18N_MESSAGES = {
  en: {
    "toolbar.title": "ChatGPT Toolkit",
    "toolbar.subtitle": "Search · Export",
    "toolbar.minimize": "Hide",
    "toolbar.minimizeAria": "Hide toolkit",
    "toolbar.expandAria": "Open ChatGPT Toolkit",
    "toolbar.exportFormat": "Export format",
    "toolbar.export": "Export",
    "toolbar.exportJson": "JSON",
    "toolbar.exportMarkdown": "Markdown",
    "toolbar.searchPlaceholder": "Search messages...",
    "toolbar.search": "Search",
    "toolbar.searchTitle": "Search",
    "toolbar.searchPrev": "Prev",
    "toolbar.searchPrevTitle": "Previous match",
    "toolbar.searchNext": "Next",
    "toolbar.searchNextTitle": "Next match",
    "status.ready": "Ready to search or export",
    "status.exporting": "Preparing export...",
    "status.exportDebuggerStarted": "Reloading conversation for complete export...",
    "status.exportCollecting": "Collecting conversation · {count} messages",
    "status.exportDone": "{format} exported · {count} messages",
    "status.exportFailed": "Export failed",
    "search.noMatch": "No matches",
  },
};

const formatMessageTemplate = (template, params = {}) =>
  template.replace(/\{(\w+)\}/g, (matched, key) => {
    const value = params[key];
    return value === null || value === undefined ? matched : String(value);
  });

const t = (key, params = {}) => {
  const localized = I18N_MESSAGES.en[key] || key;
  return formatMessageTemplate(localized, params);
};

const initI18n = () => {};
