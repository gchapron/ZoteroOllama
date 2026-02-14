# ZoteroOllama

**Chat with your PDFs using local LLMs powered by [Ollama](https://ollama.com/).**

ZoteroOllama is a plugin for [Zotero 7](https://www.zotero.org/) that lets you have a conversation with the PDF documents in your library. Select a reference, open the chat window, and ask questions about the paper — summaries, key findings, methodology details, or anything else. Everything runs locally on your machine through Ollama, so your data never leaves your computer.

## Features

- **Chat with any PDF** in your Zotero library using a local LLM
- **Streaming responses** — answers appear token-by-token as the model generates them
- **Multi-turn conversation** — ask follow-up questions with full context preserved
- **Automatic PDF text extraction** using Zotero's built-in full-text index
- **Paper metadata included** — title, authors, year, and DOI are sent alongside the text for richer answers
- **Configurable** — choose your model, adjust the context window, customize the system prompt
- **Privacy-first** — all processing happens locally via Ollama, nothing is sent to external servers
- **Keyboard shortcut and context menu** — quick access however you prefer

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

### Example questions

- "Summarize this paper in 3 bullet points"
- "What methodology did the authors use?"
- "What are the main findings and their implications?"
- "Are there any limitations mentioned in the study?"
- "Explain the statistical analysis used in section 3"
- "How does this paper relate to [topic]?"

### Tips

- Press **Shift+Enter** to insert a new line without sending
- Click **Stop** to cancel a running generation mid-stream
- Click **Clear** to reset the conversation history (the PDF context remains loaded)
- The PDF must be indexed by Zotero for text extraction to work. If it fails, right-click the item in Zotero and select **Reindex Item**
- For large PDFs that exceed the max text length, the text is truncated with a warning — you can increase the limit in settings

## Configuration

Go to **Zotero > Settings** (macOS) or **Edit > Settings** (Windows/Linux), then click the **ZoteroOllama** tab.

| Setting | Default | Description |
|---------|---------|-------------|
| **Ollama URL** | `http://localhost:11434` | Address of your Ollama server. Change this if Ollama runs on a different host or port |
| **Model** | `gpt-oss:20b` | The Ollama model to use. Must be already pulled (`ollama pull <model>`) |
| **Context Window Size** | `32768` | Token context window (`num_ctx`) sent to Ollama. Increase for longer papers, decrease if you run out of memory |
| **System Prompt** | *(research assistant)* | Instructions sent to the model with every request. Customize to change the assistant's behavior |
| **Max PDF Text Length** | `100000` | Maximum characters of PDF text to include. Longer documents are truncated from the end with a warning |

### Choosing a model

The model you choose affects both quality and speed. Some recommendations:

| Model | Size | Context | Notes |
|-------|------|---------|-------|
| `llama3.2` | 3B | 128k | Fast, good for most documents |
| `llama3.1` | 8B | 128k | Better quality, slower |
| `mistral` | 7B | 32k | Good general-purpose alternative |
| `qwen2.5` | 7B | 128k | Strong multilingual support |

Pull a model with `ollama pull <model>` before using it.

## How it works

1. When triggered, the plugin finds the first PDF attachment of the selected Zotero item
2. It reads the full text from Zotero's built-in full-text index (`attachment.attachmentText`). If the PDF isn't indexed yet, it attempts to trigger indexing automatically
3. The extracted text, along with paper metadata (title, authors, year, DOI), is packaged into a system message
4. Your question is sent to the Ollama `/api/chat` endpoint as a user message, with the full PDF context and conversation history
5. The response is streamed back token-by-token via Ollama's NDJSON streaming format and displayed in real time
6. For follow-up questions, the complete conversation history is sent each time, maintaining context across the entire chat session

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
│   ├── chat-dialog.js         # Chat window controller (conversation state, streaming UI)
│   └── chat-dialog.css        # Chat window styles
├── content/
│   └── preferences.xhtml      # Preferences pane
├── locale/en-US/
│   └── zotero-ollama.ftl      # Localization strings
├── icons/
│   ├── icon.png               # Plugin icon (48x48)
│   └── icon.svg               # Plugin icon (vector)
└── build.sh                   # Packages files into .xpi
```

## Building

```bash
chmod +x build.sh
./build.sh
```

This creates a `zotero-ollama-<version>.xpi` file ready for installation.

## Troubleshooting

**"Cannot connect to Ollama"** — Make sure Ollama is running. Start it with `ollama serve` or launch the Ollama application.

**"No PDF attachment found"** — The selected item must have a PDF file attached (not just a link). Check that the PDF is visible in the item's attachment list.

**"Could not extract text from PDF"** — The PDF may not be indexed yet. Right-click the item in Zotero and select **Reindex Item**. Image-only PDFs without OCR cannot be extracted.

**Chat window doesn't open** — Verify the plugin is enabled in **Tools > Add-ons**. Try restarting Zotero with `-purgecaches` to clear script caches.

**Responses are slow or cut off** — Try reducing the Context Window Size in settings, or switch to a smaller model. Large context windows require more VRAM.

## License

MIT
