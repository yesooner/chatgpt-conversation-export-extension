const activeExports = new Map();

const decodeResponseBody = (result) => {
  if (!result?.base64Encoded) {
    return result?.body || "";
  }
  const binary = atob(result.body || "");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const findConversationObject = (value, visited = new Set()) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return findConversationObject(JSON.parse(trimmed), visited);
      } catch (error) {
        return null;
      }
    }
    return null;
  }
  if (!value || typeof value !== "object" || visited.has(value)) {
    return null;
  }
  visited.add(value);
  if (value.mapping && typeof value.mapping === "object" && value.current_node) {
    return value;
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const matched = findConversationObject(child, visited);
    if (matched) {
      return matched;
    }
  }
  return null;
};

const parseJsonCandidates = (body) => {
  const candidates = [body];
  body.split(/\r?\n/).forEach((line) => {
    const trimmed = line
      .replace(/^data:\s*/, "")
      .replace(/^\s*[0-9a-f]+:[A-Z]?\s*/i, "")
      .trim();
    if (trimmed && trimmed !== "[DONE]") {
      candidates.push(trimmed);
      const objectStart = trimmed.indexOf("{");
      const arrayStart = trimmed.indexOf("[");
      const starts = [objectStart, arrayStart].filter((index) => index >= 0);
      if (starts.length > 0) {
        candidates.push(trimmed.slice(Math.min(...starts)));
      }
    }
  });

  for (const candidate of candidates) {
    try {
      const matched = findConversationObject(JSON.parse(candidate));
      if (matched) {
        return matched;
      }
    } catch (error) {
      // Non-JSON responses are expected while inspecting page traffic.
    }
  }
  return null;
};

const stringifyContentPart = (part) => {
  if (typeof part === "string") {
    return part;
  }
  if (!part || typeof part !== "object") {
    return "";
  }
  return part.text || part.content || (part.asset_pointer ? "[Image]" : "");
};

const extractMessageText = (message) => {
  const content = message?.content;
  if (Array.isArray(content?.parts)) {
    return content.parts.map(stringifyContentPart).filter(Boolean).join("\n\n").trim();
  }
  return String(content?.text || content?.result || "").trim();
};

const buildMessages = (conversation) => {
  const mapping = conversation.mapping || {};
  const nodes = [];
  const visited = new Set();
  let nodeId = conversation.current_node;
  while (nodeId && mapping[nodeId] && !visited.has(nodeId)) {
    visited.add(nodeId);
    nodes.push(mapping[nodeId]);
    nodeId = mapping[nodeId].parent;
  }
  nodes.reverse();
  return nodes
    .map((node) => {
      const role = node?.message?.author?.role;
      const text = extractMessageText(node?.message);
      return text && ["user", "assistant", "system"].includes(role) ? { role, text } : null;
    })
    .filter(Boolean)
    .map((message, index) => ({ index: index + 1, ...message }));
};

const buildMarkdown = (messages, exportedAt, sourceUrl) => {
  const labels = { user: "User", assistant: "Assistant", system: "System" };
  return [
    "# ChatGPT Conversation",
    "",
    `- Exported: ${exportedAt}`,
    `- Source: ${sourceUrl}`,
    `- Messages: ${messages.length}`,
    "",
    ...messages.map(
      (message) => `## ${message.index}. ${labels[message.role] || "Message"}\n\n${message.text}`,
    ),
  ].join("\n\n");
};

const sanitizeFilename = (value) =>
  String(value || "chatgpt")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "chatgpt";

const getDateTag = () => {
  const now = new Date();
  return `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const downloadText = async (content, mimeType, filename) => {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  await chrome.downloads.download({
    url: `data:${mimeType};base64,${btoa(binary)}`,
    filename,
    saveAs: false,
  });
};

const processResponse = async (job, requestId) => {
  if (!job.requests.has(requestId) || job.finished) {
    return;
  }
  try {
    const result = await chrome.debugger.sendCommand(job.target, "Network.getResponseBody", {
      requestId,
    });
    const conversation = parseJsonCandidates(decodeResponseBody(result));
    if (conversation) {
      job.finished = true;
      job.resolve(conversation);
    }
  } catch (error) {
    // Some cached, streamed, or redirected responses do not expose a body.
  }
};

chrome.debugger.onEvent.addListener((source, method, params) => {
  const job = activeExports.get(source.tabId);
  if (!job) {
    return;
  }
  if (method === "Network.responseReceived") {
    const response = params.response || {};
    if (
      /chatgpt\.com|chat\.openai\.com/i.test(response.url || "") &&
      /json|text|event-stream|javascript/i.test(response.mimeType || "")
    ) {
      job.requests.add(params.requestId);
    }
  }
  if (method === "Network.loadingFinished") {
    void processResponse(job, params.requestId);
  }
});

const captureConversation = async (tabId) => {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    await chrome.debugger.sendCommand(target, "Network.enable", {
      maxTotalBufferSize: 100000000,
      maxResourceBufferSize: 50000000,
    });
    const conversationPromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        activeExports.delete(tabId);
        reject(new Error("No complete conversation response was captured"));
      }, 45000);
      activeExports.set(tabId, {
        target,
        requests: new Set(),
        finished: false,
        resolve: (conversation) => {
          clearTimeout(timeoutId);
          activeExports.delete(tabId);
          resolve(conversation);
        },
      });
    });
    await chrome.debugger.sendCommand(target, "Page.reload", { ignoreCache: true });
    return await conversationPromise;
  } finally {
    activeExports.delete(tabId);
    await chrome.debugger.detach(target).catch(() => {});
  }
};

const runDebuggerExport = async ({ tabId, format, title, sourceUrl }) => {
  const conversation = await captureConversation(tabId);
  const messages = buildMessages(conversation);
  if (messages.length === 0) {
    throw new Error("Captured conversation contains no exportable messages");
  }
  const exportedAt = new Date().toISOString();
  const safeTitle = sanitizeFilename(conversation.title || title);
  const extension = format === "json" ? "json" : "md";
  const filename = `${safeTitle}-${getDateTag()}.${extension}`;
  const content =
    format === "json"
      ? JSON.stringify(
          {
            exportedAt,
            url: sourceUrl,
            exportSource: "chromium-debugger-network",
            messageCount: messages.length,
            messages,
          },
          null,
          2,
        )
      : buildMarkdown(messages, exportedAt, sourceUrl);
  await downloadText(
    content,
    format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8",
    filename,
  );
  return { count: messages.length, format: format.toUpperCase() };
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "chatgpt-toolkit-debugger-export" || !sender.tab?.id) {
    return false;
  }
  sendResponse({ ok: true });
  void runDebuggerExport({
    tabId: sender.tab.id,
    format: message.format,
    title: message.title,
    sourceUrl: sender.tab.url || message.sourceUrl,
  })
    .then((result) =>
      chrome.tabs
        .sendMessage(sender.tab.id, {
          type: "chatgpt-toolkit-debugger-export-result",
          ok: true,
          ...result,
        })
        .catch(() => {}),
    )
    .catch((error) =>
      chrome.tabs
        .sendMessage(sender.tab.id, {
          type: "chatgpt-toolkit-debugger-export-result",
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
        .catch(() => {}),
    );
  return false;
});
