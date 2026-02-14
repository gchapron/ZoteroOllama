/* global OllamaClient */
/* exported ChatDialog */

var ChatDialog = {
  // State
  pdfText: "",
  metadata: "",
  messages: [], // Array of {role: "user"|"assistant", content: string}
  isGenerating: false,
  currentAbortController: null,

  // Config
  model: "",
  ollamaUrl: "",
  contextWindowSize: 32768,
  systemPrompt: "",

  // DOM references
  dom: {},

  // Reference to OllamaClient from opener
  _ollamaClient: null,

  init() {
    // Retrieve data passed from the opener
    const data = window.arguments[0];
    this.pdfText = data.pdfText;
    this.metadata = data.metadata;
    this.model = data.model;
    this.ollamaUrl = data.ollamaUrl;
    this.contextWindowSize = data.contextWindowSize;
    this.systemPrompt = data.systemPrompt;

    // Cache DOM references
    this.dom.title = document.getElementById("chat-title");
    this.dom.modelInfo = document.getElementById("chat-model-info");
    this.dom.statusBar = document.getElementById("chat-status-bar");
    this.dom.messages = document.getElementById("chat-messages");
    this.dom.input = document.getElementById("chat-input");
    this.dom.sendBtn = document.getElementById("chat-send-btn");
    this.dom.stopBtn = document.getElementById("chat-stop-btn");
    this.dom.clearBtn = document.getElementById("chat-clear-btn");

    // Set header
    this.dom.title.textContent = data.itemTitle || "Chat";
    window.document.title = "ZoteroOllama - " + (data.itemTitle || "Chat");
    this.dom.modelInfo.textContent =
      "Model: " + this.model + "  |  Context: " + this.contextWindowSize;

    // Show truncation warning
    if (data.truncated) {
      this.showStatus(
        "PDF text was truncated to " +
          data.pdfText.length.toLocaleString() +
          " characters. Some content at the end may be missing.",
        "warning"
      );
    }

    // Wire up event handlers
    this.dom.sendBtn.addEventListener("click", () => this.sendMessage());
    this.dom.stopBtn.addEventListener("click", () => this.stopGeneration());
    this.dom.clearBtn.addEventListener("click", () => this.clearChat());

    // Enter to send, Shift+Enter for newline
    this.dom.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.sendMessage();
      }
    });

    // Add welcome message
    this._addSystemInfoToUI(
      'PDF loaded (' +
        data.pdfText.length.toLocaleString() +
        " chars). Ask a question about this paper."
    );

    // Focus input
    this.dom.input.focus();

    // Resolve OllamaClient and check connection
    this._resolveOllamaClient();
    this.checkOllamaConnection();
  },

  _resolveOllamaClient() {
    // Try to access OllamaClient from the opener window scope
    try {
      if (window.opener && window.opener.OllamaClient) {
        this._ollamaClient = window.opener.OllamaClient;
        return;
      }
    } catch (e) {
      // Cross-origin or sandbox restriction
    }

    // Fallback: define a minimal client inline using fetch
    // This handles cases where the opener's scope is not accessible
    const baseUrl = this.ollamaUrl;
    this._ollamaClient = {
      getBaseUrl() {
        return baseUrl;
      },
      async isAvailable() {
        try {
          const response = await fetch(baseUrl + "/api/tags", {
            method: "GET",
            signal: AbortSignal.timeout(5000),
          });
          return response.ok;
        } catch (e) {
          return false;
        }
      },
      async chat({
        model,
        messages,
        numCtx,
        onToken,
        onDone,
        onError,
        abortController,
      }) {
        const url = baseUrl + "/api/chat";
        const body = {
          model: model,
          messages: messages,
          stream: true,
          options: { num_ctx: numCtx },
        };
        let fullResponse = "";
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: abortController ? abortController.signal : undefined,
          });
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              "Ollama error (" + response.status + "): " + errorText
            );
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const chunk = JSON.parse(line);
                if (chunk.message && chunk.message.content) {
                  fullResponse += chunk.message.content;
                  if (onToken) onToken(chunk.message.content);
                }
                if (chunk.done) {
                  if (onDone) onDone(fullResponse);
                  return fullResponse;
                }
              } catch (e) {
                /* skip unparseable lines */
              }
            }
          }
          if (buffer.trim()) {
            try {
              const chunk = JSON.parse(buffer);
              if (chunk.message && chunk.message.content) {
                fullResponse += chunk.message.content;
                if (onToken) onToken(chunk.message.content);
              }
            } catch (e) {
              /* ignore */
            }
          }
          if (onDone) onDone(fullResponse);
          return fullResponse;
        } catch (error) {
          if (error.name === "AbortError") {
            if (onDone) onDone(fullResponse);
            return fullResponse;
          }
          if (onError) onError(error);
          throw error;
        }
      },
    };
  },

  async checkOllamaConnection() {
    if (!this._ollamaClient) {
      this.showStatus("Error: Could not initialize Ollama client.", "error");
      return;
    }

    const available = await this._ollamaClient.isAvailable();
    if (!available) {
      this.showStatus(
        "Cannot connect to Ollama at " +
          this.ollamaUrl +
          ". Make sure Ollama is running.",
        "error"
      );
    }
  },

  // ---- Status bar ----

  showStatus(message, type) {
    this.dom.statusBar.textContent = message;
    this.dom.statusBar.className = type === "error" ? "error" : "";
  },

  hideStatus() {
    this.dom.statusBar.className = "hidden";
  },

  // ---- UI helpers ----

  _addSystemInfoToUI(text) {
    const msgDiv = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div"
    );
    msgDiv.className = "chat-message system-info";
    msgDiv.textContent = text;
    this.dom.messages.appendChild(msgDiv);
  },

  _addMessageToUI(role, content) {
    const msgDiv = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div"
    );
    msgDiv.className = "chat-message " + role;
    msgDiv.textContent = content;
    this.dom.messages.appendChild(msgDiv);
    this._scrollToBottom();
    return msgDiv;
  },

  _scrollToBottom() {
    this.dom.messages.scrollTop = this.dom.messages.scrollHeight;
  },

  _setGenerating(generating) {
    this.isGenerating = generating;
    this.dom.sendBtn.disabled = generating;
    this.dom.stopBtn.disabled = !generating;
    this.dom.input.disabled = generating;
  },

  // ---- Chat actions ----

  async sendMessage() {
    if (this.isGenerating) return;

    const userText = this.dom.input.value.trim();
    if (!userText) return;

    // Clear input
    this.dom.input.value = "";

    // Add user message to conversation and UI
    this.messages.push({ role: "user", content: userText });
    this._addMessageToUI("user", userText);

    // Build Ollama messages with system context
    const systemContent =
      this.systemPrompt +
      "\n\n--- PAPER METADATA ---\n" +
      this.metadata +
      "\n\n--- FULL PDF TEXT ---\n" +
      this.pdfText;

    const ollamaMessages = [
      { role: "system", content: systemContent },
      ...this.messages,
    ];

    // Create assistant message bubble with streaming indicator
    const assistantDiv = this._addMessageToUI("assistant", "");
    const thinkingSpan = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span"
    );
    thinkingSpan.className = "thinking-indicator";
    thinkingSpan.textContent = "\u2588"; // block cursor
    assistantDiv.appendChild(thinkingSpan);

    // Set generating state
    this._setGenerating(true);
    this.currentAbortController = new AbortController();
    this.hideStatus();

    let fullResponse = "";

    try {
      await this._ollamaClient.chat({
        model: this.model,
        messages: ollamaMessages,
        numCtx: this.contextWindowSize,
        abortController: this.currentAbortController,
        onToken: (token) => {
          fullResponse += token;
          // Remove thinking indicator on first token
          if (thinkingSpan.parentNode) {
            thinkingSpan.remove();
          }
          assistantDiv.textContent = fullResponse;
          this._scrollToBottom();
        },
        onDone: (text) => {
          fullResponse = text;
        },
        onError: (error) => {
          this.showStatus("Error: " + error.message, "error");
        },
      });
    } catch (error) {
      if (error.name !== "AbortError") {
        this.showStatus("Error: " + error.message, "error");
      }
    }

    // Remove thinking indicator if still present
    if (thinkingSpan.parentNode) {
      thinkingSpan.remove();
    }

    // Finalize
    if (fullResponse) {
      assistantDiv.textContent = fullResponse;
      this.messages.push({ role: "assistant", content: fullResponse });
    } else if (!this.dom.statusBar.textContent) {
      assistantDiv.textContent = "(No response generated)";
    } else {
      // Error was shown in status bar, remove the empty bubble
      assistantDiv.remove();
    }

    // Reset state
    this._setGenerating(false);
    this.currentAbortController = null;
    this.dom.input.focus();
  },

  stopGeneration() {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }
  },

  clearChat() {
    this.messages = [];
    while (this.dom.messages.firstChild) {
      this.dom.messages.removeChild(this.dom.messages.firstChild);
    }
    this.hideStatus();
    this._addSystemInfoToUI(
      "Chat cleared. PDF context is still loaded. Ask a new question."
    );
    this.dom.input.focus();
  },
};
