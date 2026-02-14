/* global Zotero */
/* exported OllamaClient */

// eslint-disable-next-line no-redeclare
var OllamaClient = {
  /**
   * Get the configured Ollama base URL.
   * @returns {string}
   */
  getBaseUrl() {
    return (
      Zotero.Prefs.get("extensions.zotero-ollama.ollamaUrl", true) ||
      "http://localhost:11434"
    );
  },

  /**
   * Check if Ollama server is reachable.
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      const response = await fetch(this.getBaseUrl() + "/api/tags", {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch (e) {
      return false;
    }
  },

  /**
   * List available models from the Ollama server.
   * @returns {Promise<Array<{name: string, size: number, details: Object}>>}
   */
  async listModels() {
    const response = await fetch(this.getBaseUrl() + "/api/tags", {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error("Failed to fetch models: " + response.statusText);
    }
    const data = await response.json();
    return data.models || [];
  },

  /**
   * Send a chat request with streaming.
   *
   * @param {Object} options
   * @param {string} options.model - Model name
   * @param {Array<{role: string, content: string}>} options.messages - Message history
   * @param {number} options.numCtx - Context window size in tokens
   * @param {function} [options.onToken] - Callback for each streamed token: (tokenText) => void
   * @param {function} [options.onDone] - Callback when generation completes: (fullResponse) => void
   * @param {function} [options.onError] - Callback on error: (error) => void
   * @param {AbortController} [options.abortController] - Controller to cancel the request
   * @returns {Promise<string>} Full response text
   */
  async chat({
    model,
    messages,
    numCtx,
    onToken,
    onDone,
    onError,
    abortController,
  }) {
    const url = this.getBaseUrl() + "/api/chat";
    const body = {
      model: model,
      messages: messages,
      stream: true,
      options: {
        num_ctx: numCtx,
      },
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
        // Keep the last potentially incomplete line in the buffer
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
          } catch (parseError) {
            Zotero.debug(
              "ZoteroOllama: Failed to parse chunk: " + line,
              2
            );
          }
        }
      }

      // Handle any remaining buffer content
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer);
          if (chunk.message && chunk.message.content) {
            fullResponse += chunk.message.content;
            if (onToken) onToken(chunk.message.content);
          }
        } catch (e) {
          // Ignore trailing incomplete data
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
