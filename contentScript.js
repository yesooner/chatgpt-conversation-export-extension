/*
 * ChatGPT Conversation Toolkit - Bootstrap and DOM observers
 */
const isToolkitSupportedPage =
  !window.location.pathname.startsWith("/backend-api/") &&
  !window.location.pathname.startsWith("/backend-api");

if (isToolkitSupportedPage && !window[TOOLKIT_BOOTSTRAP_FLAG]) {
  window[TOOLKIT_BOOTSTRAP_FLAG] = true;

  initI18n();
  observeThemeOnBodyIfNeeded();

  let resizeListenerAdded = false;

  const setupResizeListener = () => {
    if (resizeListenerAdded) {
      return;
    }
    resizeListenerAdded = true;

    window.addEventListener("resize", () => {
      const btn = document.getElementById(MINIMIZED_ID);
      if (
        btn &&
        btn.classList.contains("is-visible") &&
        !minimizedButtonState.pointerDown &&
        !minimizedButtonState.dragging
      ) {
        ensureButtonVisible(btn);
      }
    });
  };

  setupThemeSync();
  attachToolbar();
  setupResizeListener();

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "chatgpt-toolkit-debugger-export-result") {
      return false;
    }
    if (message.ok) {
      updateStatusByKey("status.exportDone", "success", {
        format: message.format,
        count: message.count,
      });
    } else {
      updateStatusText(`Export failed: ${message.error || "Unknown debugger export error"}`, "error");
    }
    return false;
  });

  let observerRafId = 0;
  let observerNeedsPresenceCheck = false;

  const getObservedElement = (node) => {
    if (node instanceof Element) {
      return node;
    }
    if (node instanceof Text) {
      return node.parentElement;
    }
    return null;
  };

  const isToolkitMutationNode = (node) => {
    const element = getObservedElement(node);
    if (!(element instanceof Element)) {
      return false;
    }
    return Boolean(
      element.closest([`#${TOOLKIT_ID}`, `#${MINIMIZED_ID}`].join(", ")),
    );
  };

  const markObserverWorkFromNode = (node) => {
    if (isToolkitMutationNode(node)) {
      return;
    }

    observerNeedsPresenceCheck = true;
  };

  const observerCallback = () => {
    const needsPresenceCheck = observerNeedsPresenceCheck;

    observerNeedsPresenceCheck = false;

    if (needsPresenceCheck) {
      const toolbar = document.getElementById(TOOLKIT_ID);
      const minimizedButton = document.getElementById(MINIMIZED_ID);
      if (!toolbar) {
        attachToolbar();
      }

      if (!minimizedButton) {
        ensureMinimizedButton();
      }

      observeThemeOnBodyIfNeeded();
    }
  };

  const observer = new MutationObserver((mutations) => {
    // 跳过由插件自身渲染触发的 DOM 变更，防止无限循环
    if (window.__toolkitIsRendering) {
      return;
    }

    mutations.forEach((mutation) => {
      markObserverWorkFromNode(mutation.target);
      mutation.addedNodes.forEach((node) => {
        markObserverWorkFromNode(node);
      });
      mutation.removedNodes.forEach((node) => {
        markObserverWorkFromNode(node);
      });
    });

    if (!observerNeedsPresenceCheck) {
      return;
    }

    // 使用 requestAnimationFrame 节流，避免频繁执行
    if (observerRafId) {
      return;
    }
    observerRafId = requestAnimationFrame(() => {
      observerRafId = 0;
      observerCallback();
    });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
}
