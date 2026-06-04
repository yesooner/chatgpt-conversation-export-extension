/*
 * ChatGPT Conversation Toolkit - Conversation export
 */
const getConversationTitle = () => {
  const currentPath = window.location.pathname;
  const activeConversation =
    document.querySelector(`a[href="${CSS.escape(currentPath)}"]`) ||
    document.querySelector('a[href^="/c/"][aria-current="page"]') ||
    document.querySelector('a[href^="/c/"].active');
  const rawTitle =
    activeConversation?.textContent?.trim() ||
    document.title.replace(/\s*[-|]\s*ChatGPT\s*$/i, "").trim() ||
    "chatgpt";
  return rawTitle
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "chatgpt";
};

const getSessionDateTag = () => {
  const now = new Date();
  return `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const downloadConversationFile = (content, mimeType, extension) => {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = `${getConversationTitle()}-${getSessionDateTag()}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};

const buildMarkdownExport = (messages, exportedAt) => {
  const roleLabels = {
    user: "User",
    assistant: "Assistant",
    system: "System",
    unknown: "Message",
  };
  const sections = messages.map((message) => {
    const role = roleLabels[message.role] || roleLabels.unknown;
    return `## ${message.index}. ${role}\n\n${message.text}`;
  });
  return [
    "# ChatGPT Conversation",
    "",
    `- Exported: ${exportedAt}`,
    `- Source: ${window.location.href}`,
    `- Messages: ${messages.length}`,
    "",
    ...sections,
  ].join("\n\n");
};

const waitForConversationRender = (milliseconds = 250) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForConversationStable = (container, quietMs = 100, maxMs = 650) =>
  new Promise((resolve) => {
    let quietTimer = 0;
    let maxTimer = 0;
    const finish = () => {
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      observer.disconnect();
      resolve();
    };
    const scheduleQuietFinish = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    };
    const observer = new MutationObserver(scheduleQuietFinish);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    maxTimer = setTimeout(finish, maxMs);
    scheduleQuietFinish();
  });

const getConversationScrollContainer = () => {
  const firstMessage = getMessageNodes()[0];
  let current = firstMessage?.parentElement;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (
      ["auto", "scroll"].includes(style.overflowY) &&
      current.scrollHeight > current.clientHeight + 20
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return document.scrollingElement || document.documentElement;
};

const captureRenderedMessageBatch = (scrollContainer) =>
  getMessageNodes()
    .map((node, visibleIndex) => {
      const payload = buildMessagePayload([node])[0];
      if (!payload) {
        return null;
      }
      const roleNode = node.matches("[data-message-author-role]")
        ? node
        : node.querySelector("[data-message-author-role]") || node;
      const messageId =
        roleNode.getAttribute("data-message-id") ||
        node.getAttribute("data-message-id") ||
        node.getAttribute("data-testid") ||
        `${payload.role}:${payload.text}`;
      const testId =
        node.getAttribute("data-testid") ||
        node.closest('[data-testid^="conversation-turn-"]')?.getAttribute("data-testid") ||
        "";
      const turnMatch = testId.match(/^conversation-turn-(\d+)$/);
      const rect = node.getBoundingClientRect();
      return {
        key: messageId,
        role: payload.role,
        text: payload.text,
        turnIndex: turnMatch ? Number(turnMatch[1]) : null,
        position: scrollContainer.scrollTop + rect.top,
        visibleIndex,
      };
    })
    .filter(Boolean);

const collectAllConversationMessages = async (onProgress = null) => {
  const scrollContainer = getConversationScrollContainer();
  const originalScrollTop = scrollContainer.scrollTop;
  const wasAtBottom =
    scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 40;
  const collected = new Map();

  const capture = () => {
    captureRenderedMessageBatch(scrollContainer).forEach((message) => {
      const collectionKey =
        message.turnIndex === null ? message.key : `conversation-turn-${message.turnIndex}`;
      const existing = collected.get(collectionKey);
      if (!existing || message.text.length > existing.text.length) {
        collected.set(collectionKey, message);
      }
    });
    if (typeof onProgress === "function") {
      onProgress(collected.size);
    }
  };

  const scanUpOnce = async () => {
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    await waitForConversationStable(scrollContainer, 100, 700);
    capture();

    let stableTopChecks = 0;
    let previousHeight = -1;
    for (let iteration = 0; iteration < 1600; iteration += 1) {
      const currentTop = scrollContainer.scrollTop;
      if (currentTop <= 2) {
        await waitForConversationStable(scrollContainer, 120, 800);
        capture();
        const currentHeight = scrollContainer.scrollHeight;
        stableTopChecks = currentHeight === previousHeight ? stableTopChecks + 1 : 0;
        previousHeight = currentHeight;
        if (stableTopChecks >= 2) {
          break;
        }
        continue;
      }

      const step = Math.max(80, Math.floor(scrollContainer.clientHeight * 0.18));
      scrollContainer.scrollTop = Math.max(0, currentTop - step);
      await waitForConversationStable(scrollContainer, 70, 400);
      capture();
    }
  };

  await scanUpOnce();

  scrollContainer.scrollTop = wasAtBottom ? scrollContainer.scrollHeight : originalScrollTop;
  const orderedMessages = [...collected.values()].sort((left, right) => {
    if (left.turnIndex !== null && right.turnIndex !== null) {
      return left.turnIndex - right.turnIndex;
    }
    if (left.turnIndex !== null) {
      return -1;
    }
    if (right.turnIndex !== null) {
      return 1;
    }
    return left.position - right.position || left.visibleIndex - right.visibleIndex;
  });

  return orderedMessages.map((message, index) => ({
    index: index + 1,
    role: message.role,
    text: message.text,
    turnIndex: message.turnIndex,
  }));
};

const exportMessages = async (format = "json") => {
  ensureConversationState();
  const exportButton = document.querySelector(`#${TOOLKIT_ID} [data-action="export"]`);
  if (exportButton instanceof HTMLButtonElement && exportButton.disabled) {
    return;
  }
  if (exportButton instanceof HTMLButtonElement) {
    exportButton.disabled = true;
  }
  updateStatusByKey("status.exporting", "info");

  try {
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "chatgpt-toolkit-debugger-export",
          format,
          title: getConversationTitle(),
          sourceUrl: window.location.href,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || "Could not start debugger export"));
            return;
          }
          resolve();
        },
      );
    });
    updateStatusByKey("status.exportDebuggerStarted", "info");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateStatusText(`Export failed: ${message}`, "error");
  } finally {
    if (exportButton instanceof HTMLButtonElement) {
      exportButton.disabled = false;
    }
  }
};
