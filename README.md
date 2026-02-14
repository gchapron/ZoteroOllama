# ZoteroOllama

**Chat with your PDFs using local LLMs powered by [Ollama](https://ollama.com/).**

ZoteroOllama is a plugin for [Zotero 7](https://www.zotero.org/) that lets you have a conversation with the PDF documents in your library. Select a reference, open the chat window, and ask questions about the paper — summaries, key findings, methodology details, or anything else. Everything runs locally on your machine through Ollama, so your data never leaves your computer.

## Features

- **Chat with any PDF** in your Zotero library using a local LLM
- **Streaming responses** — answers appear token-by-token as the model generates them
- **Rendered Markdown** — responses display formatted headings, bold, italic, code blocks, tables, lists, blockquotes, and links
- **Multi-turn conversation** — ask follow-up questions with full context preserved
- **Dynamic context window** — automatically expands Ollama's `num_ctx` to fit larger PDFs, with clear warnings when documents are very large
- **Save to Zotero notes** — click the note icon on any answer to save it as a child note ("Ollama notes") under the reference item
- **Copy text** — select and copy any part of an answer with Cmd/Ctrl+C
- **Automatic PDF text extraction** using Zotero's built-in full-text index
- **Paper metadata included** — title, authors, year, and DOI are sent alongside the text for richer answers
- **Configurable** — choose your model, adjust the context window, customize the system prompt
- **Privacy-first** — all processing happens locally via Ollama, nothing is sent to external servers
- **Keyboard shortcuts** — Cmd/Ctrl+Shift+G to open, Cmd/Ctrl+W to close

## Requirements

- **Zotero 7** (version 7.0 or later)
- **[Ollama](https://ollama.com/)** installed and running locally (default: `http://localhost:11434`)
- At least one model pulled in Ollama (e.g., `ollama pull llama3.2`)

## Installation

### From .xpi file

1. Download the latest `.xpi` from the [Releases](https://github.com/gchapron/ZoteroOllama/releases) page
2. In Zotero, go to **Tools > Add-ons**
3. Click the gear icon and select **Install Add-on From File...**
4. Select the downloaded `.xpi` file
5. Restart Zotero

### From source (development)

1. Clone this repository
2. Find your Zotero profile directory: go to **Edit > Settings > Advanced > Files and Folders > Show Data Directory**, then navigate up one level to the profile folder
3. In the `extensions/` subdirectory, create a text file named `zotero-ollama@example.com`
4. Write the absolute path to this repository's root folder as the file's only content (e.g., `/Users/you/src/ZoteroOllama`)
5. Restart Zotero (use `/Applications/Zotero.app/Contents/MacOS/zotero -purgecaches` on macOS to clear script caches during development)

## Usage

### Getting started

1. Make sure Ollama is running (`ollama serve` or the Ollama app)
2. Select an item in your Zotero library that has a PDF attachment
3. Open the chat window using one of these methods:
   - Press **Cmd+Shift+G** (macOS) or **Ctrl+Shift+G** (Windows/Linux)
   - Right-click the item and select **Chat with PDF (Ollama)**
4. Type your question in the input area and press **Enter**
5. The response streams in real-time from your local Ollama model

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| **Cmd/Ctrl+Shift+G** | Open chat window for selected item |
| **Enter** | Send message |
| **Shift+Enter** | Insert newline without sending |
| **Cmd/Ctrl+C** | Copy selected text from answers |
| **Cmd/Ctrl+W** | Close chat window |

### Saving answers to Zotero notes

Each assistant answer has a small note icon (📝) in the bottom-right corner. Click it to save the answer to a Zotero note:

- The note is created as a child of the reference item (alongside the PDF), titled **"Ollama notes"**
- If the note already exists, new answers are appended with a timestamp separator
- If it doesn't exist, a new note is created automatically
- A brief checkmark (✅) confirms the save

This makes it easy to build up a collection of useful excerpts and analyses directly within your Zotero library.

### Example questions

- "Summarize this paper in 3 bullet points"
- "What methodology did the authors use?"
- "What are the main findings and their implications?"
- "Are there any limitations mentioned in the study?"
- "Explain the statistical analysis used in section 3"
- "Compare the results in Table 2 with the claims in the discussion"
- "How does this paper relate to [topic]?"

### Tips

- Click **Stop** to cancel a running generation mid-stream
- Click **Clear** to reset the conversation history (the PDF context remains loaded)
- The PDF must be indexed by Zotero for text extraction to work. If it fails, right-click the item in Zotero and select **Reindex Item**

## Context window management

ZoteroOllama intelligently manages Ollama's context window (`num_ctx`) so that as much of the PDF as possible is available to the model:

1. **PDF fits in configured context** — no change, uses your configured context window size (default: 32,768 tokens)
2. **PDF needs more room** — the context window is automatically expanded up to 131K tokens, with a notification:
   - Up to 65K: quiet info message
   - Above 65K: warning that answers may be slower
3. **PDF exceeds 131K tokens** — the text is truncated to fit, with a warning showing what percentage of the document was kept

The chat window header always shows the effective context size (marked `(auto)` if expanded) and the estimated PDF size in tokens.

> **Note:** Larger context windows use more VRAM/RAM and increase response time. If answers are too slow, consider using a smaller model or reducing the context window in settings. Ollama's default `num_ctx` is only 2048–4096 tokens — ZoteroOllama overrides this per-request to accommodate academic papers.

## Configuration

Go to **Zotero > Settings** (macOS) or **Edit > Settings** (Windows/Linux), then click the **ZoteroOllama** tab.

| Setting | Default | Description |
|---------|---------|-------------|
| **Ollama URL** | `http://localhost:11434` | Address of your Ollama server. Change if Ollama runs on a different host or port |
| **Model** | `gpt-oss:20b` | The Ollama model to use. Must be already pulled (`ollama pull <model>`) |
| **Context Window Size** | `32768` | Minimum token context window. Automatically expanded if the PDF requires more |
| **System Prompt** | *(research assistant)* | Instructions sent to the model with every request. Customize to change the assistant's behavior |
| **Max PDF Text Length** | `100000` | Maximum characters of PDF text to extract from Zotero's index |

### Choosing a model

The model you choose affects both quality and speed. Some recommendations:

| Model | Size | Max Context | Notes |
|-------|------|-------------|-------|
| `llama3.2` | 3B | 128k | Fast, good for most documents |
| `llama3.1` | 8B | 128k | Better quality, slower |
| `mistral` | 7B | 32k | Good general-purpose alternative |
| `qwen2.5` | 7B | 128k | Strong multilingual support |
| `gemma3` | 12B | 128k | High quality, needs more RAM |

Pull a model with `ollama pull <model>` before using it. You can list available models with `ollama list`.

## How it works

1. When triggered, the plugin finds the first PDF attachment of the selected Zotero item
2. It reads the full text from Zotero's built-in full-text index (`attachment.attachmentText`). If the PDF isn't indexed yet, it attempts to trigger indexing automatically
3. The chat dialog estimates the token count and adjusts the context window to fit the entire document when possible
4. The extracted text, along with paper metadata (title, authors, year, DOI), is packaged into a system message
5. Your question is sent to the Ollama `/api/chat` endpoint as a user message, with the full PDF context and conversation history
6. The response is streamed back token-by-token via Ollama's NDJSON streaming format, rendered as Markdown in real time
7. For follow-up questions, the complete conversation history is sent each time, maintaining context across the entire chat session

## Architecture

The plugin is built as a plain JavaScript Zotero 7 bootstrap plugin — no TypeScript, no build tools, no dependencies.

```
ZoteroOllama/
├── manifest.json              # Plugin metadata (Zotero 7 WebExtension-style)
├── bootstrap.js               # Plugin lifecycle (startup, shutdown, window hooks)
├── prefs.js                   # Default preference values
├── zotero-ollama.js           # Core logic: keyboard shortcut, context menu, PDF extraction
├── ollama.js                  # Ollama HTTP client with streaming support
├── chrome/content/
│   ├── chat-dialog.xhtml      # Chat window structure
│   ├── chat-dialog.js         # Chat controller: conversation, streaming, Markdown
│   │                          #   rendering, context analysis, note saving
│   └── chat-dialog.css        # Chat window styles
├── content/
│   └── preferences.xhtml      # Preferences pane
├── locale/en-US/
│   └── zotero-ollama.ftl      # Localization strings
└── build.sh                   # Packages files into .xpi
```

## Building

```bash
chmod +x build.sh
./build.sh
```

This creates a `zotero-ollama-<version>.xpi` file ready for installation.

## Troubleshooting

**"Cannot connect to Ollama"**
Make sure Ollama is running. Start it with `ollama serve` or launch the Ollama application.

**"No PDF attachment found"**
The selected item must have a PDF file attached (not just a link). Check that the PDF is visible in the item's attachment list.

**"Could not extract text from PDF"**
The PDF may not be indexed yet. Right-click the item in Zotero and select **Reindex Item**. Image-only PDFs without OCR text cannot be extracted.

**Chat window doesn't open**
Verify the plugin is enabled in **Tools > Add-ons**. Try restarting Zotero with `-purgecaches` to clear script caches.

**Responses are slow**
Large context windows require more VRAM and increase inference time. Try reducing the context window size in settings, or switch to a smaller model. Check the chat header to see the effective context size — if it shows `(auto)`, the window was expanded to fit a large PDF.

**"PDF text too large for the maximum context window"**
The PDF exceeds 131K tokens (~460K characters). The text is automatically truncated to fit. Answers about content near the end of the document may be unreliable. Consider using a model with a larger native context window.

**Copy doesn't work**
Make sure you're using **Cmd+C** (macOS) or **Ctrl+C** (Windows/Linux) after selecting text in the chat window. The plugin handles clipboard operations explicitly for the chrome-privileged dialog.

## License

MIT
