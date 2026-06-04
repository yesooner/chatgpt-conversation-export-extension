# ChatGPT Conversation Export

<p align="center">
  <a href="./README.md"><img alt="中文" src="https://img.shields.io/badge/语言-中文-lightgrey"></a>
  <a href="./README.en.md"><img alt="English" src="https://img.shields.io/badge/Language-English-blue"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-green"></a>
</p>

ChatGPT Conversation Export is a **Chrome and Microsoft Edge** extension that exports complete ChatGPT conversations as Markdown or JSON. It uses Chromium's built-in `chrome.debugger` API to capture the conversation data loaded by ChatGPT itself.

The extension avoids relying on virtualized DOM content or page scrolling. Long conversations can be exported with complete user messages, assistant responses, fenced code blocks, Mermaid source, and LaTeX formulas even when only part of the conversation is rendered on screen.

> A full export reloads the current ChatGPT conversation once and temporarily attaches the Chromium debugger. The debugger is detached automatically when the export completes.

## Features

- Export complete ChatGPT conversations without scrolling the page.
- Export as Markdown or JSON.
- Name files as `conversation-title-YYMM.md` or `conversation-title-YYMM.json`.
- Preserve original assistant Markdown.
- Preserve fenced code blocks, Mermaid source, and LaTeX formulas.
- Search rendered messages with highlighting and previous/next navigation.
- Start minimized as a draggable `GPT` button in the bottom-right corner.
- Follow ChatGPT light and dark themes.
- Support Google Chrome and Microsoft Edge.

![Extension Icon](./image/icon-source-cropped.png)

## Supported Environment

- Chromium Manifest V3
- Google Chrome
- Microsoft Edge
- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

The full-export implementation requires Chromium's `chrome.debugger` API and does not support Firefox.

## Installation

### Chrome

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select this project directory.
5. Approve the requested permissions.

### Microsoft Edge

1. Open `edge://extensions/`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select this project directory.
5. Approve the requested permissions.

## Permissions

The extension requests the following elevated permissions:

- `debugger`: temporarily read the current ChatGPT tab's own conversation network response.
- `downloads`: download generated Markdown or JSON files.
- `tabs`: report export results after the conversation reloads.

The browser may show a debugger-attached notice during export. This is Chromium's normal security notice for the `chrome.debugger` API. The extension attaches only after the user clicks Export and detaches after success, failure, or timeout.

## Usage

1. Open the ChatGPT conversation to export.
2. Click the bottom-right `GPT` button to expand the toolkit.
3. Select `Markdown` or `JSON`.
4. Click `Export`.
5. The conversation reloads once and the generated file downloads automatically.

The export no longer scrolls the page. Switching to another tab does not interrupt network capture.

## Exported Content

### Markdown

Messages are written in conversation order:

```markdown
# ChatGPT Conversation

- Exported: 2026-06-04T00:00:00.000Z
- Source: https://chatgpt.com/c/...
- Messages: 126

## 1. User

User message

## 2. Assistant

Assistant response
```

Original Mermaid and LaTeX source is preserved:

````markdown
```mermaid
flowchart LR
  A --> B
```

Inline formula: $E = mc^2$

Display formula:

$$
E = mc^2
$$
````

### JSON

JSON exports include metadata and the complete message array:

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

## Search

- Search text in currently rendered messages.
- Highlight matching text.
- Navigate with `Prev` and `Next`.

Search covers currently rendered page content. Full export does not have this limitation.

## How It Works

```text
User clicks Export
  -> background service worker attaches chrome.debugger
  -> current ChatGPT conversation reloads
  -> extension captures and parses the complete conversation response
  -> current User / Assistant / System branch is ordered
  -> Markdown or JSON is generated
  -> file downloads and debugger detaches automatically
```

## Known Limitations

- ChatGPT private response format changes may require parser updates.
- The browser displays a debugger-attached notice during export.
- Export may fail if another debugger or DevTools session is already attached to the tab.
- Export follows the currently selected conversation branch rather than every historical branch.
- Search covers only currently rendered messages.
- Full export does not support Firefox.

## Project Structure

```text
background.js          Chromium debugger capture and file download
contentScript.js       Page initialization and result messages
core/                  Shared state and English UI strings
features/export.js     Export entry point and legacy DOM fallback tools
features/search.js     Rendered-message search
ui/                    Toolbar, floating button, and theme sync
utils/                 DOM, content extraction, and lightweight state tools
image/                 Extension icons
manifest.json          Manifest V3 configuration
styles.css             Toolbar and search styles
```

## Version

### Current version: v2.0.2

- Complete conversation export through Chromium debugger network responses.
- Markdown and JSON export.
- Conversation-title filenames.
- Chrome and Microsoft Edge support.
- Original Mermaid, LaTeX, and fenced code block preservation.
- Rendered-message search.

## License

This project is licensed under the [MIT License](./LICENSE).
