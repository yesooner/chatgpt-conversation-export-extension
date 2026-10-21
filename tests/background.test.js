const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const backgroundSource = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

const loadBackground = (overrides = {}) => {
  const listeners = {};
  const downloads = [];
  const commands = [];
  const downloadListeners = new Set();
  const chrome = {
    debugger: {
      attach: async () => {},
      detach: async () => {},
      onEvent: { addListener: (listener) => { listeners.debugger = listener; } },
      sendCommand: async (target, method, params) => {
        commands.push({ target, method, params });
        return overrides.sendCommand?.(target, method, params) || {};
      },
    },
    downloads: {
      download: async (options) => { downloads.push(options); return 1; },
      onChanged: {
        addListener: (listener) => downloadListeners.add(listener),
        removeListener: (listener) => downloadListeners.delete(listener),
      },
      search: async () => [{ id: 1, state: overrides.downloadState || "complete", error: overrides.downloadError }],
    },
    runtime: { onMessage: { addListener: (listener) => { listeners.message = listener; } } },
    tabs: { sendMessage: async () => {} },
  };
  const context = { chrome, URL, TextDecoder, TextEncoder, Uint8Array, atob, btoa, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(
    `${backgroundSource}\nthis.api = { parseJsonCandidates, buildMessages, completeConversation, captureConversation, runDebuggerExport };`,
    context,
  );
  return { api: context.api, listeners, downloads, commands };
};

const legacyConversation = {
  title: "Legacy",
  current_node: "assistant",
  mapping: {
    user: { parent: null, message: { author: { role: "user" }, content: { parts: ["Question"] } } },
    assistant: { parent: "user", message: { author: { role: "assistant" }, content: { parts: ["Answer"] } } },
  },
};

const currentConversation = {
  title: "Current",
  conversation_id: "abc-123",
  messages: [
    { id: "2", author: { role: "user" }, content: { parts: ["Question"] } },
    { id: "3", author: { role: "assistant" }, content: { parts: ["Answer"] } },
  ],
  page_info: { start_cursor: "2", has_previous_page: false },
};

test("recognizes legacy and ordered conversation responses", () => {
  const { api } = loadBackground();
  for (const conversation of [legacyConversation, currentConversation]) {
    const parsed = api.parseJsonCandidates(JSON.stringify(conversation));
    assert.ok(parsed);
    assert.deepEqual(Array.from(api.buildMessages(parsed), ({ role, text }) => ({ role, text })), [
      { role: "user", text: "Question" },
      { role: "assistant", text: "Answer" },
    ]);
  }
});

test("fetches all older pages and preserves message order", async () => {
  const first = {
    ...currentConversation,
    page_info: { start_cursor: "2", has_previous_page: true },
  };
  const older = {
    ...currentConversation,
    messages: [{ id: "1", author: { role: "user" }, content: { parts: ["First"] } }, first.messages[0]],
    page_info: { start_cursor: "1", has_previous_page: false, has_next_page: true },
  };
  const { api, commands } = loadBackground({
    sendCommand: (_target, method) => method === "Runtime.evaluate"
      ? { result: { value: JSON.stringify(older) } }
      : {},
  });
  const complete = await api.completeConversation({ tabId: 1 }, "https://chatgpt.com/c/abc-123", first);
  assert.deepEqual(Array.from(complete.messages, (message) => message.id), ["1", "2", "3"]);
  assert.equal(complete.page_info.has_previous_page, false);
  const evaluation = commands.find((command) => command.method === "Runtime.evaluate");
  assert.match(evaluation.params.expression, /before=2/);
  assert.match(evaluation.params.expression, /num_turns=100/);
});

test("refuses an incomplete page instead of downloading a partial transcript", async () => {
  const { api } = loadBackground({
    sendCommand: () => ({ result: { value: JSON.stringify({ messages: [], page_info: {}, conversation_id: "abc-123" }) } }),
  });
  await assert.rejects(
    api.completeConversation(
      { tabId: 1 },
      "https://chatgpt.com/c/abc-123",
      { ...currentConversation, page_info: { start_cursor: "2", has_previous_page: true } },
    ),
    /no messages/,
  );
});

test("rejects the home page before attaching the debugger", async () => {
  const { api, commands } = loadBackground();
  await assert.rejects(api.captureConversation(1, "https://chatgpt.com/"), /Open a ChatGPT conversation/);
  assert.equal(commands.length, 0);
});

test("downloads Markdown after capturing an ordered response", async () => {
  let emit;
  const { api, listeners, downloads } = loadBackground({
    sendCommand: async (_target, method) => {
      if (method === "Page.reload") {
        queueMicrotask(() => {
          listeners.debugger(
            { tabId: 1 },
            "Network.responseReceived",
            { requestId: "r1", response: { url: "https://chatgpt.com/backend-api/conversations/abc-123", mimeType: "application/json" } },
          );
          listeners.debugger({ tabId: 1 }, "Network.loadingFinished", { requestId: "r1" });
        });
      }
      if (method === "Network.getResponseBody") {
        return { body: JSON.stringify(currentConversation), base64Encoded: false };
      }
      return {};
    },
  });
  emit = await api.runDebuggerExport({
    tabId: 1,
    format: "md",
    title: "Fallback",
    sourceUrl: "https://chatgpt.com/c/abc-123",
  });
  assert.equal(emit.count, 2);
  assert.equal(downloads.length, 1);
  assert.match(downloads[0].filename, /^Current-\d{4}\.md$/);
  const markdown = Buffer.from(downloads[0].url.split(",")[1], "base64").toString("utf8");
  assert.match(markdown, /## 1\. User\n\nQuestion/);
  assert.match(markdown, /## 2\. Assistant\n\nAnswer/);
});

test("exports directly from the browser API without reloading", async () => {
  const { api, downloads, commands } = loadBackground({
    sendCommand: async (_target, method) => method === "Runtime.evaluate"
      ? { result: { value: JSON.stringify(currentConversation) } }
      : {},
  });
  await api.runDebuggerExport({
    tabId: 1,
    format: "json",
    title: "Fallback",
    sourceUrl: "https://chatgpt.com/c/abc-123",
  });
  assert.equal(commands.some((command) => command.method === "Page.reload"), false);
  const json = JSON.parse(Buffer.from(downloads[0].url.split(",")[1], "base64").toString("utf8"));
  assert.equal(json.exportSource, "chatgpt-browser-api");
  assert.equal(json.messageCount, 2);
});

test("reports a download that Chrome interrupts after accepting it", async () => {
  const { api } = loadBackground({
    downloadState: "interrupted",
    downloadError: "FILE_TOO_LARGE",
    sendCommand: async (_target, method) => method === "Runtime.evaluate"
      ? { result: { value: JSON.stringify(currentConversation) } }
      : {},
  });
  await assert.rejects(
    api.runDebuggerExport({
      tabId: 1,
      format: "md",
      title: "Current",
      sourceUrl: "https://chatgpt.com/c/abc-123",
    }),
    /Download interrupted: FILE_TOO_LARGE/,
  );
});
