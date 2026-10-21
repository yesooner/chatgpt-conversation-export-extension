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
  if (
    (value.mapping && typeof value.mapping === "object" && value.current_node) ||
    (Array.isArray(value.messages) && value.page_info && value.conversation_id)
  ) {
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
  let rawMessages;
  if (Array.isArray(conversation.messages)) {
    rawMessages = conversation.messages.map((entry) => entry?.message || entry);
  } else {
    const mapping = conversation.mapping || {};
    const nodes = [];
    const visited = new Set();
    let nodeId = conversation.current_node;
    while (nodeId && mapping[nodeId] && !visited.has(nodeId)) {
      visited.add(nodeId);
      nodes.push(mapping[nodeId]);
      nodeId = mapping[nodeId].parent;
    }
    rawMessages = nodes.reverse().map((node) => node?.message);
  }
  return rawMessages
    .map((message) => {
      const role = message?.author?.role;
      const text = extractMessageText(message);
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
  const downloadId = await chrome.downloads.download({
    url: `data:${mimeType};base64,${btoa(binary)}`,
    filename,
    saveAs: false,
  });
  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => finish(new Error("Download did not complete within two minutes")), 120000);
    const finish = (error = null) => {
      clearTimeout(timeoutId);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (error) reject(error);
      else resolve();
    };
    const checkState = (state, reason) => {
      if (state === "complete") finish();
      else if (state === "interrupted") finish(new Error(`Download interrupted: ${reason || "unknown reason"}`));
    };
    const onChanged = (change) => {
      if (change.id === downloadId) {
        checkState(change.state?.current, change.error?.current);
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id: downloadId })
      .then((items) => checkState(items[0]?.state, items[0]?.error))
      .catch(finish);
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
    if (conversation && (!conversation.conversation_id || conversation.conversation_id === job.conversationId)) {
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

const getConversationId = (sourceUrl) => {
  try {
    return new URL(sourceUrl).pathname.match(/\/c\/([^/]+)/)?.[1] || null;
  } catch (error) {
    return null;
  }
};

const fetchConversationPage = async (target, sourceUrl, conversationId, cursor = null) => {
  const endpoint = new URL(
    `/backend-api/conversations/${encodeURIComponent(conversationId)}`,
    sourceUrl,
  );
  endpoint.searchParams.set("num_turns", "100");
  if (cursor) {
    endpoint.searchParams.set("before", cursor);
  }
  const expression = `(async () => {
    const sessionResponse = await fetch('/api/auth/session', {
      credentials: 'include', signal: AbortSignal.timeout(20000),
    });
    const session = sessionResponse.ok ? await sessionResponse.json() : null;
    const token = session?.accessToken;
    const response = await fetch(${JSON.stringify(endpoint.href)}, {
      credentials: 'include',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error('Conversation page request failed: HTTP ' + response.status);
    return JSON.stringify(await response.json());
  })()`;
  const evaluation = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (evaluation.exceptionDetails || typeof evaluation.result?.value !== "string") {
    throw new Error(
      `Could not fetch a conversation page: ${evaluation.exceptionDetails?.text || "empty response"}`,
    );
  }
  const page = JSON.parse(evaluation.result.value);
  if (
    !Array.isArray(page.messages) ||
    !page.page_info ||
    page.conversation_id !== conversationId
  ) {
    throw new Error("Conversation page has an unexpected format");
  }
  return page;
};

const completeConversation = async (target, sourceUrl, conversation) => {
  if (!Array.isArray(conversation.messages)) {
    return conversation;
  }
  const conversationId = getConversationId(sourceUrl);
  let currentPage = conversation;
  let messages = [...currentPage.messages];
  const seenCursors = new Set();
  while (currentPage.page_info?.has_previous_page === true) {
    const cursor = currentPage.page_info.start_cursor;
    if (!cursor || seenCursors.has(cursor) || seenCursors.size >= 1000) {
      throw new Error("Conversation pagination stopped before reaching the first page");
    }
    seenCursors.add(cursor);
    currentPage = await fetchConversationPage(target, sourceUrl, conversationId, cursor);
    if (currentPage.messages.length === 0) {
      throw new Error("An older conversation page contains no messages");
    }
    messages = [...currentPage.messages, ...messages];
  }
  const seenIds = new Set();
  return {
    ...conversation,
    messages: messages.filter((entry) => {
      const id = entry?.id || entry?.message?.id;
      if (!id || !seenIds.has(id)) {
        if (id) seenIds.add(id);
        return true;
      }
      return false;
    }),
    page_info: { ...conversation.page_info, has_previous_page: false },
  };
};

const captureConversation = async (tabId, sourceUrl) => {
  const target = { tabId };
  const conversationId = getConversationId(sourceUrl);
  if (!conversationId) {
    throw new Error("Open a ChatGPT conversation before exporting");
  }
  await chrome.debugger.attach(target, "1.3");
  try {
    let directError;
    let firstPage;
    try {
      firstPage = await fetchConversationPage(target, sourceUrl, conversationId);
    } catch (error) {
      directError = error;
    }
    if (firstPage) {
      return {
        conversation: await completeConversation(target, sourceUrl, firstPage),
        exportSource: "chatgpt-browser-api",
      };
    }
    await chrome.debugger.sendCommand(target, "Network.enable", {
      maxTotalBufferSize: 100000000,
      maxResourceBufferSize: 50000000,
    });
    let timeoutId;
    const conversationPromise = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        activeExports.delete(tabId);
        reject(new Error(`Could not read this conversation: ${directError.message}; network capture also timed out`));
      }, 45000);
      activeExports.set(tabId, {
        target,
        conversationId,
        requests: new Set(),
        finished: false,
        resolve: (conversation) => {
          clearTimeout(timeoutId);
          activeExports.delete(tabId);
          resolve(conversation);
        },
      });
    });
    try {
      await chrome.debugger.sendCommand(target, "Page.reload", { ignoreCache: true });
      return {
        conversation: await completeConversation(target, sourceUrl, await conversationPromise),
        exportSource: "chromium-debugger-network",
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } finally {
    activeExports.delete(tabId);
    await chrome.debugger.detach(target).catch(() => {});
  }
};

const runDebuggerExport = async ({ tabId, format, title, sourceUrl }) => {
  const { conversation, exportSource } = await captureConversation(tabId, sourceUrl);
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
            exportSource,
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

const sendExportResult = async (tabId, result) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: "chatgpt-toolkit-debugger-export-result",
        ...result,
      });
      return;
    } catch (error) {
      if (attempt < 9) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
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
    .then((result) => sendExportResult(sender.tab.id, { ok: true, ...result }))
    .catch((error) => sendExportResult(sender.tab.id, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
  return false;
});
