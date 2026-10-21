# ChatGPT Conversation Export

<p align="center">
  <a href="./README.md"><img alt="中文" src="https://img.shields.io/badge/语言-中文-blue"></a>
  <a href="./README.en.md"><img alt="English" src="https://img.shields.io/badge/Language-English-lightgrey"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-green"></a>
</p>

ChatGPT Conversation Export 是一个面向 **Chrome 与 Microsoft Edge** 的 ChatGPT 会话导出扩展。它通过 Chromium 内置的 `chrome.debugger` API 在当前 ChatGPT 标签页读取会话数据，将当前对话导出为 Markdown 或 JSON。

扩展的核心目标是避免依赖虚拟化 DOM 和页面滚动。即使长会话只在页面中渲染部分消息，导出仍可保留完整的用户消息、助手回复、代码块、Mermaid 源码和 LaTeX 公式。

> 导出期间会临时附加 Chromium 调试器，完成后自动断开。扩展优先从当前页面读取会话接口；接口不可用时才刷新会话并捕获网络响应。

![ChatGPT Toolkit 使用界面](./image/readme/toolkit-overview.png)

## ✨ 功能特点

- 完整导出当前 ChatGPT 会话，包括分页加载的历史消息，不依赖页面滚动。
- 支持 Markdown 和 JSON 两种导出格式。
- 文件名自动使用 `对话名称-YYMM.md` 或 `对话名称-YYMM.json`。
- 保留助手原始 Markdown 内容。
- 保留 fenced code block、Mermaid 源码和 LaTeX 公式。
- 支持当前会话消息搜索、文本高亮和上一条/下一条跳转。
- 工具栏默认收起为右下角 `GPT` 悬浮按钮。
- 自动跟随 ChatGPT 明暗主题。
- 支持 Chrome 和 Microsoft Edge。

<p align="center">
  <img src="./image/readme/toolkit-panel.png" alt="ChatGPT Toolkit 工具栏" width="308">
</p>

## 🧩 使用环境

- Chromium Manifest V3
- Google Chrome
- Microsoft Edge
- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

当前完整导出方案依赖 Chromium 的 `chrome.debugger` API，因此不支持 Firefox。

## 📦 安装方法

### Chrome

1. 打开 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目根目录。
5. 接受扩展权限。

![Chrome 扩展安装界面](./image/readme/chrome-installation.png)

<p align="center">
  <img src="./image/readme/extension-details.png" alt="已安装的 ChatGPT Toolkit" width="433">
</p>

### Microsoft Edge

1. 打开 `edge://extensions/`。
2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本项目根目录。
5. 接受扩展权限。

Chrome 和 Edge 均基于 Chromium，因此安装方式和完整导出原理一致。

## 🔐 浏览器权限与调用方式

扩展声明以下高权限：

- `debugger`：临时读取当前 ChatGPT 标签页自身的会话网络响应。
- `downloads`：下载生成的 Markdown 或 JSON 文件。
- `tabs`：在页面刷新后发送导出结果状态。

权限不会在浏览器启动后持续调用。只有用户主动点击 `Export` 时，后台 Service Worker 才会对**当前 ChatGPT 标签页**执行以下流程：

```text
点击 Export
  -> chrome.runtime.sendMessage 通知后台 Service Worker
  -> chrome.debugger.attach 临时附加当前 ChatGPT 标签页
  -> 从当前页面读取会话接口及历史分页
  -> 必要时刷新并捕获会话网络响应
  -> chrome.downloads.download 保存导出文件
  -> chrome.debugger.detach 自动断开
```

扩展不会读取其他标签页的网络响应，也不会持续保持调试器连接。成功、失败或超时后都会尝试自动断开。导出期间浏览器可能显示“调试器已附加”提示，这是 Chromium 对 `chrome.debugger` API 的正常安全提示。

## 🚀 使用方法

1. 打开需要导出的 ChatGPT 会话。
2. 点击右下角 `GPT` 悬浮按钮展开工具栏。
3. 选择 `Markdown` 或 `JSON`。
4. 点击 `Export`。
5. 导出完成后文件自动下载；仅在接口读取失败时刷新当前会话一次。

导出过程不滚动页面。请在地址包含 `/c/` 的具体会话页面使用导出按钮。

## 📝 输出文件命名

导出文件默认使用：

```text
对话名称-YYMM.md
对话名称-YYMM.json
```

例如，标题为 `python`、导出时间为 2026 年 6 月时，文件名为 `python-2606.md`。

命名时优先读取完整会话响应中的 `conversation.title`；若无法取得，则使用当前 ChatGPT 页面标题。文件名中的 Windows 非法字符会自动替换，避免下载失败。

## 📄 导出内容

### Markdown

Markdown 文件按会话顺序保存消息：

```markdown
# ChatGPT Conversation

- Exported: 2026-06-04T00:00:00.000Z
- Source: https://chatgpt.com/c/...
- Messages: 126

## 1. User

用户消息

## 2. Assistant

助手回复
```

助手原始回复中的 Mermaid 和 LaTeX 会保留为 Markdown 源码，例如：

````markdown
```mermaid
flowchart LR
  A --> B
```

行内公式：$E = mc^2$

单行公式：

$$
E = mc^2
$$
````

### JSON

JSON 文件包含导出元数据和完整消息数组：

```json
{
  "exportedAt": "2026-06-04T00:00:00.000Z",
  "url": "https://chatgpt.com/c/...",
  "exportSource": "chromium-debugger-network",
  "messageCount": 126,
  "messages": [
    {
      "index": 1,
      "role": "user",
      "text": "..."
    }
  ]
}
```

## 🔎 搜索功能

- 在当前已渲染消息中搜索文本。
- 高亮匹配内容。
- 使用 `Prev` 和 `Next` 在结果之间跳转。

搜索功能依赖当前页面已渲染的消息；完整导出不受此限制。

## ⚙️ 工作原理

```text
用户点击 Export
  -> 后台 Service Worker 附加 chrome.debugger
  -> 读取当前会话接口并逐页获取历史消息
  -> 必要时刷新并捕获会话网络响应
  -> 沿当前会话分支整理 User / Assistant / System 消息
  -> 生成 Markdown 或 JSON
  -> 下载文件并自动断开调试器
```

## ⚠️ 已知限制

- ChatGPT 私有网络响应结构发生变化时，完整导出解析可能需要同步更新。
- 导出只在具体会话页面可用；主页会提示先打开会话。
- 浏览器会在导出期间显示调试器附加提示。
- 若其他 DevTools 或调试器已附加当前标签页，导出可能失败。
- 当前导出当前选中的会话分支，不同时导出所有历史分叉。
- 搜索仅覆盖当前页面已渲染内容。
- 当前完整导出不支持 Firefox。

## 🗂️ 项目结构

```text
background.js          Chromium debugger 网络捕获与文件下载
contentScript.js       页面初始化与状态消息
core/                  全局状态与英文界面文本
features/export.js     导出入口与旧 DOM 后备工具
features/search.js     当前页面消息搜索
ui/                    工具栏、悬浮按钮与主题同步
utils/                 DOM、格式提取与轻量状态工具
image/                 扩展图标
manifest.json          Manifest V3 配置
styles.css             工具栏与搜索界面样式
```

## 📌 版本说明

### 当前版本：v2.0.4

- 兼容旧版 `mapping` 与新版分页 `messages` 会话格式。
- 优先从浏览器页面直接读取会话数据，失败时回退到 debugger 网络捕获。
- 在非会话页面提示错误，并在导出结束后显示结果。
- 等待浏览器确认文件下载完成，下载中断时显示原因。
- 支持 Markdown 与 JSON。
- 使用会话标题生成文件名。
- 支持 Chrome 与 Microsoft Edge。
- 保留原始 Mermaid、LaTeX 和代码块。
- 保留当前页面消息搜索功能。

## 📜 许可证

本项目采用 [MIT License](./LICENSE)。
