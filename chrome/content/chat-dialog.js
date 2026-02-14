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
		window.document.title =
			"ZoteroOllama - " + (data.itemTitle || "Chat");
		this.dom.modelInfo.textContent =
			"Model: " +
			this.model +
			"  |  Context: " +
			this.contextWindowSize;

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
		this.dom.stopBtn.addEventListener("click", () =>
			this.stopGeneration()
		);
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
			"PDF loaded (" +
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
						signal: abortController
							? abortController.signal
							: undefined,
					});
					if (!response.ok) {
						const errorText = await response.text();
						throw new Error(
							"Ollama error (" +
								response.status +
								"): " +
								errorText
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
									if (onToken)
										onToken(chunk.message.content);
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
			this.showStatus(
				"Error: Could not initialize Ollama client.",
				"error"
			);
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

	// ── Status bar ────────────────────────────────────────────────────

	showStatus(message, type) {
		this.dom.statusBar.textContent = message;
		this.dom.statusBar.className = type === "error" ? "error" : "";
	},

	hideStatus() {
		this.dom.statusBar.className = "hidden";
	},

	// ── Markdown rendering ────────────────────────────────────────────

	/**
	 * Convert markdown text to safe HTML.
	 * Supports: headings, bold, italic, inline code, code blocks,
	 * unordered/ordered lists, blockquotes, horizontal rules, links,
	 * and paragraphs.
	 */
	_renderMarkdown(text) {
		// Escape HTML entities first
		let html = text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");

		// Fenced code blocks (```...```)
		html = html.replace(
			/```(\w*)\n([\s\S]*?)```/g,
			function (match, lang, code) {
				return (
					'<pre class="md-code-block"><code>' +
					code.replace(/\n$/, "") +
					"</code></pre>"
				);
			}
		);

		// Split into lines for block-level processing
		let lines = html.split("\n");
		let result = [];
		let inList = false;
		let listType = "";
		let inBlockquote = false;

		for (let i = 0; i < lines.length; i++) {
			let line = lines[i];

			// Skip lines inside code blocks (already handled)
			if (line.indexOf("<pre") !== -1) {
				// Find the closing </pre> and pass through
				result.push(line);
				while (i < lines.length - 1 && lines[i].indexOf("</pre>") === -1) {
					i++;
					result.push(lines[i]);
				}
				continue;
			}

			// Headings
			let headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
			if (headingMatch) {
				if (inList) {
					result.push(listType === "ul" ? "</ul>" : "</ol>");
					inList = false;
				}
				let level = headingMatch[1].length;
				result.push(
					"<h" +
						level +
						' class="md-heading">' +
						this._renderInline(headingMatch[2]) +
						"</h" +
						level +
						">"
				);
				continue;
			}

			// Horizontal rule
			if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
				if (inList) {
					result.push(listType === "ul" ? "</ul>" : "</ol>");
					inList = false;
				}
				result.push("<hr>");
				continue;
			}

			// Table: detect a row starting with | or a line with | separators
			// and a separator line like |---|---| on the next line
			if (this._isTableRow(line)) {
				if (inList) {
					result.push(listType === "ul" ? "</ul>" : "</ol>");
					inList = false;
				}
				if (inBlockquote) {
					result.push("</blockquote>");
					inBlockquote = false;
				}
				// Collect all consecutive table rows
				let tableLines = [line];
				while (
					i + 1 < lines.length &&
					this._isTableRow(lines[i + 1])
				) {
					i++;
					tableLines.push(lines[i]);
				}
				result.push(this._renderTable(tableLines));
				continue;
			}

			// Unordered list items
			let ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
			if (ulMatch) {
				if (!inList || listType !== "ul") {
					if (inList)
						result.push(
							listType === "ul" ? "</ul>" : "</ol>"
						);
					result.push("<ul>");
					inList = true;
					listType = "ul";
				}
				result.push(
					"<li>" + this._renderInline(ulMatch[1]) + "</li>"
				);
				continue;
			}

			// Ordered list items
			let olMatch = line.match(/^[\s]*\d+[.)]\s+(.+)$/);
			if (olMatch) {
				if (!inList || listType !== "ol") {
					if (inList)
						result.push(
							listType === "ul" ? "</ul>" : "</ol>"
						);
					result.push("<ol>");
					inList = true;
					listType = "ol";
				}
				result.push(
					"<li>" + this._renderInline(olMatch[1]) + "</li>"
				);
				continue;
			}

			// Close list if current line is not a list item
			if (inList) {
				result.push(listType === "ul" ? "</ul>" : "</ol>");
				inList = false;
			}

			// Blockquote
			let bqMatch = line.match(/^&gt;\s?(.*)$/);
			if (bqMatch) {
				if (!inBlockquote) {
					result.push("<blockquote>");
					inBlockquote = true;
				}
				result.push(this._renderInline(bqMatch[1]));
				continue;
			}
			if (inBlockquote) {
				result.push("</blockquote>");
				inBlockquote = false;
			}

			// Empty line
			if (line.trim() === "") {
				result.push("");
				continue;
			}

			// Regular paragraph line
			result.push("<p>" + this._renderInline(line) + "</p>");
		}

		// Close any open list/blockquote
		if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");
		if (inBlockquote) result.push("</blockquote>");

		return result.join("\n");
	},

	/**
	 * Render inline markdown: bold, italic, inline code, links.
	 */
	_renderInline(text) {
		// Inline code (must be first to avoid processing markdown inside code)
		text = text.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

		// Bold + italic (***text*** or ___text___)
		text = text.replace(
			/\*\*\*(.+?)\*\*\*/g,
			"<strong><em>$1</em></strong>"
		);
		text = text.replace(
			/___(.+?)___/g,
			"<strong><em>$1</em></strong>"
		);

		// Bold (**text** or __text__)
		text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
		text = text.replace(/__(.+?)__/g, "<strong>$1</strong>");

		// Italic (*text* or _text_)
		text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
		text = text.replace(
			/(?<!\w)_(.+?)_(?!\w)/g,
			"<em>$1</em>"
		);

		// Links [text](url)
		text = text.replace(
			/\[([^\]]+)\]\(([^)]+)\)/g,
			'<a href="$2" class="md-link">$1</a>'
		);

		return text;
	},

	/**
	 * Check if a line looks like a markdown table row (contains |).
	 */
	_isTableRow(line) {
		let trimmed = line.trim();
		// Must contain at least one | that's not inside backticks
		// and have content on at least one side
		return /\|/.test(trimmed) && /\S/.test(trimmed.replace(/\|/g, ""));
	},

	/**
	 * Check if a line is a table separator (e.g. |---|---|).
	 */
	_isTableSeparator(line) {
		let trimmed = line.trim().replace(/^\||\|$/g, "");
		return /^[\s|:-]+$/.test(trimmed) && /---/.test(trimmed);
	},

	/**
	 * Parse table row cells from a line like "| a | b | c |".
	 */
	_parseTableCells(line) {
		let trimmed = line.trim();
		// Remove leading/trailing pipes
		if (trimmed.startsWith("|")) trimmed = trimmed.substring(1);
		if (trimmed.endsWith("|")) trimmed = trimmed.substring(0, trimmed.length - 1);
		return trimmed.split("|").map((cell) => cell.trim());
	},

	/**
	 * Render a group of table lines into an HTML table.
	 */
	_renderTable(tableLines) {
		if (tableLines.length === 0) return "";

		// Determine if second line is a separator (header row present)
		let hasHeader =
			tableLines.length >= 2 &&
			this._isTableSeparator(tableLines[1]);

		let html = '<table class="md-table">';

		if (hasHeader) {
			// First line is header
			let headerCells = this._parseTableCells(tableLines[0]);
			html += "<thead><tr>";
			for (let cell of headerCells) {
				html += "<th>" + this._renderInline(cell) + "</th>";
			}
			html += "</tr></thead>";

			// Remaining lines (skip separator at index 1)
			html += "<tbody>";
			for (let j = 2; j < tableLines.length; j++) {
				if (this._isTableSeparator(tableLines[j])) continue;
				let cells = this._parseTableCells(tableLines[j]);
				html += "<tr>";
				for (let cell of cells) {
					html += "<td>" + this._renderInline(cell) + "</td>";
				}
				html += "</tr>";
			}
			html += "</tbody>";
		} else {
			// No header — all rows are body
			html += "<tbody>";
			for (let j = 0; j < tableLines.length; j++) {
				if (this._isTableSeparator(tableLines[j])) continue;
				let cells = this._parseTableCells(tableLines[j]);
				html += "<tr>";
				for (let cell of cells) {
					html += "<td>" + this._renderInline(cell) + "</td>";
				}
				html += "</tr>";
			}
			html += "</tbody>";
		}

		html += "</table>";
		return html;
	},

	// ── UI helpers ────────────────────────────────────────────────────

	_addSystemInfoToUI(text) {
		let msgDiv = document.createElementNS(
			"http://www.w3.org/1999/xhtml",
			"div"
		);
		msgDiv.className = "chat-message system-info";
		msgDiv.textContent = text;
		this.dom.messages.appendChild(msgDiv);
	},

	_addMessageToUI(role, content) {
		let msgDiv = document.createElementNS(
			"http://www.w3.org/1999/xhtml",
			"div"
		);
		msgDiv.className = "chat-message " + role;
		if (role === "assistant" && content) {
			msgDiv.innerHTML = this._renderMarkdown(content);
		} else {
			msgDiv.textContent = content;
		}
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

	// ── Chat actions ──────────────────────────────────────────────────

	async sendMessage() {
		if (this.isGenerating) return;

		let userText = this.dom.input.value.trim();
		if (!userText) return;

		// Clear input
		this.dom.input.value = "";

		// Add user message to conversation and UI
		this.messages.push({ role: "user", content: userText });
		this._addMessageToUI("user", userText);

		// Build Ollama messages with system context
		let systemContent =
			this.systemPrompt +
			"\n\n--- PAPER METADATA ---\n" +
			this.metadata +
			"\n\n--- FULL PDF TEXT ---\n" +
			this.pdfText;

		let ollamaMessages = [
			{ role: "system", content: systemContent },
			...this.messages,
		];

		// Create assistant message bubble with streaming indicator
		let assistantDiv = this._addMessageToUI("assistant", "");
		let thinkingSpan = document.createElementNS(
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
					// Re-render the full markdown on each token
					assistantDiv.innerHTML =
						this._renderMarkdown(fullResponse);
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

		// Finalize with rendered markdown
		if (fullResponse) {
			assistantDiv.innerHTML = this._renderMarkdown(fullResponse);
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
