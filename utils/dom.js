/*
 * ChatGPT Conversation Toolkit - DOM utilities
 */
const getConversationKey = () => {
  const domConversationId =
    document
      .querySelector("[data-conversation-id]")
      ?.getAttribute("data-conversation-id") ||
    document
      .querySelector("[data-message-id][data-conversation-id]")
      ?.getAttribute("data-conversation-id");
  if (domConversationId) {
    return domConversationId;
  }

  const match = window.location.pathname.match(/\/c\/([^/]+)/);
  if (match) {
    return match[1];
  }
  return `${window.location.pathname}${window.location.search}`;
};

const resetConversationState = () => {
  state.searchQuery = '';
  state.searchMatches = [];
  state.currentMatchIndex = -1;
};

const ensureConversationState = () => {
  const nextKey = getConversationKey();
  if (state.conversationKey !== nextKey) {
    state.conversationKey = nextKey;
    resetConversationState();
  }
};

const normalizeMessageNode = (node) =>
  node.closest('[data-testid^="conversation-turn-"]') ||
  node.closest("article") ||
  node;

const getMessageNodes = () => {
  const main = document.querySelector("main");
  if (!main) {
    return [];
  }

  const candidates = [
    ...Array.from(main.querySelectorAll('[data-testid^="conversation-turn-"]')),
    ...Array.from(main.querySelectorAll("[data-message-author-role]")),
    ...Array.from(main.querySelectorAll("article")),
  ];

  const normalized = candidates.map((node) => normalizeMessageNode(node)).filter(Boolean);

  const uniqueNodes = [];
  const seen = new Set();
  normalized.forEach((node) => {
    const messageId = node.getAttribute("data-message-id");
    const testId = node.getAttribute("data-testid");
    const key = messageId || testId || node;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    uniqueNodes.push(node);
  });

  return uniqueNodes;
};

const detectRole = (node) => {
  const explicitRole =
    node?.getAttribute("data-message-author-role") ||
    node?.dataset?.messageAuthorRole ||
    node?.getAttribute("data-turn");
  if (explicitRole) {
    return explicitRole;
  }

  if (node?.querySelector('[data-message-author-role="assistant"]')) {
    return "assistant";
  }
  if (node?.querySelector('[data-message-author-role="user"]')) {
    return "user";
  }
  if (node?.querySelector('img[alt*="ChatGPT"], svg[aria-label*="ChatGPT"], svg[aria-label*="Assistant"]')) {
    return "assistant";
  }
  if (node?.querySelector('img[alt*="User"], svg[aria-label*="User"]')) {
    return "user";
  }
  if (node?.querySelector(".markdown, .prose, [class*='markdown'], [class*='prose']")) {
    return "assistant";
  }

  const testId = node?.getAttribute("data-testid") || "";
  const turnMatch = testId.match(/^conversation-turn-(\d+)$/);
  if (turnMatch) {
    return Number(turnMatch[1]) % 2 === 1 ? "user" : "assistant";
  }
  return "unknown";
};

const getCodeLanguage = (codeNode, preNode) => {
  const languageSource = [
    codeNode?.getAttribute("data-language"),
    preNode?.getAttribute("data-language"),
    codeNode?.className,
    preNode?.className,
  ]
    .filter((value) => typeof value === "string")
    .join(" ");
  const match = languageSource.match(/(?:language-|lang-)([\w+-]+)/i);
  return match?.[1] || (languageSource.toLowerCase().includes("mermaid") ? "mermaid" : "");
};

const MERMAID_LOADING_PATTERN =
  /mermaid\s*(?:\u6b63\u5728)?\u52a0\u8f7d\u56fe\u8868[\s\u2026.]*|loading\s+mermaid|loading\s+diagram/i;

const getLatexSource = (node) => {
  const annotation = node.querySelector?.(
    'annotation[encoding="application/x-tex"], annotation[encoding="application/x-tex; mode=display"]',
  );
  const source =
    annotation?.textContent ||
    node.getAttribute?.("data-latex") ||
    node.getAttribute?.("data-tex") ||
    node.getAttribute?.("data-formula") ||
    "";
  return source.trim();
};

const replaceLatexNodes = (root) => {
  const candidates = Array.from(
    root.querySelectorAll(
      ".katex-display, .katex, mjx-container, math, [data-latex], [data-tex], [data-formula]",
    ),
  ).filter(
    (node, index, nodes) =>
      !nodes.some((otherNode, otherIndex) => otherIndex !== index && otherNode.contains(node)),
  );

  candidates.forEach((formulaNode) => {
    const source = getLatexSource(formulaNode);
    if (!source) {
      return;
    }
    const isDisplay =
      formulaNode.classList?.contains("katex-display") ||
      formulaNode.getAttribute?.("display") === "block" ||
      formulaNode.getAttribute?.("display") === "true";
    formulaNode.replaceWith(
      document.createTextNode(isDisplay ? `\n\n$$\n${source}\n$$\n\n` : `$${source}$`),
    );
  });
};

const findMermaidSource = (node) => {
  const containers = Array.from(
    node.querySelectorAll(
      "[data-mermaid-code], [data-mermaid], [class*='mermaid'], [aria-label*='Mermaid'], [aria-label*='mermaid']",
    ),
  );
  for (const container of containers) {
    const attributeSource = [
      "data-mermaid-code",
      "data-code",
      "data-content",
      "data-source",
      "data-diagram",
    ]
      .map((name) => container.getAttribute(name))
      .find((value) => typeof value === "string" && value.trim() && !MERMAID_LOADING_PATTERN.test(value));
    if (attributeSource) {
      return attributeSource.trim();
    }

    const nestedSourceNode = container.querySelector("pre code, code, textarea, script");
    const sourceNode =
      nestedSourceNode ||
      (container.previousElementSibling?.matches("pre, code")
        ? container.previousElementSibling
        : null);
    const source = (sourceNode?.value || sourceNode?.textContent || "").trim();
    if (source && !MERMAID_LOADING_PATTERN.test(source)) {
      return source;
    }
  }

  const mermaidCode = Array.from(node.querySelectorAll("pre, code, textarea, script")).find((sourceNode) => {
    const language = getCodeLanguage(sourceNode.querySelector?.("code") || sourceNode, sourceNode);
    const source = (sourceNode.value || sourceNode.textContent || "").trim();
    return (
      language === "mermaid" ||
      /^(?:---[\s\S]*?---\s*)?(?:graph\s+(?:TD|TB|BT|RL|LR)|flowchart\s+(?:TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|timeline)\b/i.test(
        source,
      )
    );
  });
  return (mermaidCode?.value || mermaidCode?.textContent || "").trim();
};

const serializeAssistantContent = (node) => {
  const mermaidSource = findMermaidSource(node);
  const roots = Array.from(node.querySelectorAll(".markdown, .prose, [class*='markdown'], [class*='prose']"))
    .filter(
      (contentNode, index, nodes) =>
        !nodes.some((otherNode, otherIndex) => otherIndex !== index && otherNode.contains(contentNode)),
    );

  return roots
    .map((root) => {
      const clone = root.cloneNode(true);
      clone.querySelectorAll("pre").forEach((preNode) => {
        const codeNode = preNode.querySelector("code") || preNode;
        const language = getCodeLanguage(codeNode, preNode);
        const source = (codeNode.textContent || "").trim();
        preNode.replaceWith(document.createTextNode(`\n\n\`\`\`${language}\n${source}\n\`\`\`\n\n`));
      });
      replaceLatexNodes(clone);
      clone.querySelectorAll("[data-mermaid-code]").forEach((mermaidNode) => {
        const source = (mermaidNode.getAttribute("data-mermaid-code") || "").trim();
        if (source) {
          mermaidNode.replaceWith(document.createTextNode(`\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\n`));
        }
      });
      clone.querySelectorAll("svg").forEach((svgNode) => {
        if (svgNode.closest("pre, code, [data-mermaid-code]")) {
          return;
        }
        const svgDescription = [
          svgNode.getAttribute("aria-label"),
          svgNode.getAttribute("role"),
          svgNode.querySelector("title")?.textContent,
          svgNode.querySelector("desc")?.textContent,
        ]
          .filter(Boolean)
          .join(" ");
        const isMermaid = Boolean(
          svgNode.closest("[class*='mermaid'], [data-mermaid]") ||
          /mermaid|flowchart|sequenceDiagram|graph\s+(?:TD|LR|RL|BT)/i.test(svgDescription),
        );
        if (isMermaid) {
          svgNode.replaceWith(
            document.createTextNode(`\n\n\`\`\`svg\n${svgNode.outerHTML}\n\`\`\`\n\n`),
          );
          return;
        }
        svgNode.remove();
      });
      const text = (clone.textContent || "")
        .replace(new RegExp(MERMAID_LOADING_PATTERN.source, "gi"), "")
        .trim();
      if (mermaidSource && !text.includes(mermaidSource)) {
        return `${text}\n\n\`\`\`mermaid\n${mermaidSource}\n\`\`\``.trim();
      }
      return text;
    })
    .filter(Boolean)
    .join("\n\n");
};

const extractMessageText = (node) => {
  if (!node) {
    return "";
  }

  const role = detectRole(node);
  if (role === "assistant" && node.querySelectorAll) {
    const markdownText = serializeAssistantContent(node);
    if (markdownText) {
      return markdownText;
    }
  }

  const roleNode = node.querySelector?.("[data-message-author-role]");
  const roleText = (roleNode?.textContent || "").trim();
  const turnText = (node.textContent || "").trim();
  return turnText.length > roleText.length ? turnText : roleText;
};

const buildMessagePayload = (nodes) => {
  const seenIds = new Set();
  return nodes
    .map((node) => {
      const roleNode = node.matches("[data-message-author-role]")
        ? node
        : node.querySelector("[data-message-author-role]") || node;
      const messageId = roleNode?.getAttribute("data-message-id") || node.getAttribute("data-message-id");
      if (messageId && seenIds.has(messageId)) {
        return null;
      }
      if (messageId) {
        seenIds.add(messageId);
      }

      const role = detectRole(node);
      const text = extractMessageText(node);

      if (!text) {
        return null;
      }

      return { role, text };
    })
    .filter(Boolean)
    .map((message, index) => ({
      index: index + 1,
      role: message.role,
      text: message.text,
    }));
};

const updateStatusByKey = (key, tone = "info", params = {}) => {
  const status = document.getElementById(STATUS_ID);
  if (!(status instanceof HTMLElement)) {
    return;
  }
  status.dataset.i18nKey = key;
  status.dataset.i18nParams = JSON.stringify(params);
  status.dataset.tone = tone;
  status.textContent = t(key, params);
};

const updateStatusText = (text, tone = "info") => {
  const status = document.getElementById(STATUS_ID);
  if (!(status instanceof HTMLElement)) {
    return;
  }
  status.dataset.i18nKey = "";
  status.dataset.i18nParams = "{}";
  status.dataset.tone = tone;
  status.textContent = text;
};

const refreshStatusLocalization = () => {
  const status = document.getElementById(STATUS_ID);
  if (!(status instanceof HTMLElement)) {
    return;
  }
  let params = {};
  try {
    params = JSON.parse(status.dataset.i18nParams || "{}");
  } catch (error) {
    params = {};
  }
  status.textContent = t(status.dataset.i18nKey || "status.ready", params);
};

const createRafDragController = (applyPosition) => {
  let frameId = 0;
  let pendingPosition = null;

  const flush = () => {
    frameId = 0;
    if (!pendingPosition) {
      return;
    }
    const nextPosition = pendingPosition;
    pendingPosition = null;
    applyPosition(nextPosition);
  };

  return {
    schedule(position) {
      pendingPosition = position;
      if (frameId) {
        return;
      }
      frameId = requestAnimationFrame(flush);
    },
    flush() {
      if (!pendingPosition) {
        return;
      }
      if (frameId) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      }
      const nextPosition = pendingPosition;
      pendingPosition = null;
      applyPosition(nextPosition);
    },
    cancel() {
      if (frameId) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      }
      pendingPosition = null;
    },
  };
};

const applyDragTransform = (element, translateX, translateY, baseTransform = "") => {
  if (!(element instanceof HTMLElement)) {
    return;
  }
  const translate = `translate3d(${Math.round(translateX)}px, ${Math.round(translateY)}px, 0)`;
  element.style.transform =
    baseTransform && baseTransform !== "none"
      ? `${baseTransform} ${translate}`
      : translate;
};

const resetDragTransform = (element, baseTransform = "") => {
  if (!(element instanceof HTMLElement)) {
    return;
  }
  element.style.transform = baseTransform && baseTransform !== "none" ? baseTransform : "";
};
