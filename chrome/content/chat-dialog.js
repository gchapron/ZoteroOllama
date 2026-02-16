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
	userContextWindowSize: 32768, // the original value from preferences
	systemPrompt: "",
	itemId: null,
	_contextWarnings: [], // populated by _analyzeAndAdjustContext

	// DOM references
	dom: {},

	// Quick prompts: short label shown in the bubble, full question pasted into input
	quickPrompts: [
		{
			label: "Summarize",
			key: "s",
			question: "Provide a concise summary covering research question, methodology, key findings, and conclusions",
		},
		{
			label: "Take-home",
			key: "t",
			question: "Provide the take-home messages as a bulleted list with explanations",
		},
		{
			label: "Methods",
			key: "m",
			question: "Explain concisely the methodology: approach, data, analytical methods",
		},
		{
			label: "Key findings",
			key: "k",
			question: "List concisely the key findings and results",
		},
		{
			label: "Limitations",
			key: "l",
			question: "What are the study limitations (author-stated and identified)?",
		},
		{
			label: "Future research",
			key: "f",
			question: "What are the suggested future research directions and open questions?",
		},
		{
			label: "Critical review",
			key: "c",
			question: "Provide a strengths and weaknesses assessment of design, analysis, and conclusions",
		},
		{
			label: "ELI5",
			key: "e",
			question: "Provide a plain-language explanation for non-specialists",
		},
		{
			label: "GitHub",
			key: "g",
			question: "Is the paper associated with a GitHub repository?",
		},
	],

	// Reference to OllamaClient from opener
	_ollamaClient: null,

	init() {
		// Retrieve data passed from the opener
		const data = window.arguments[0];
		this.pdfText = data.pdfText;
		this.metadata = data.metadata;
		this.itemId = data.itemId;
		this.model = data.model;
		this.ollamaUrl = data.ollamaUrl;
		this.contextWindowSize = data.contextWindowSize;
		this.userContextWindowSize = data.contextWindowSize;
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

		// Enable Cmd/Ctrl+W to close the chat window
		document.addEventListener("keydown", (event) => {
			let modKey = event.metaKey || event.ctrlKey;
			if (modKey && event.key === "w") {
				event.preventDefault();
				window.close();
				return;
			}
		});

		// Enable Cmd/Ctrl+C copy in the chat window
		document.addEventListener("keydown", (event) => {
			let modKey = event.metaKey || event.ctrlKey;
			if (modKey && event.key === "c") {
				let selection = window.getSelection();
				if (selection && selection.toString().length > 0) {
					event.preventDefault();
					let text = selection.toString();
					// Use clipboard API
					if (navigator.clipboard && navigator.clipboard.writeText) {
						navigator.clipboard.writeText(text);
					} else {
						// Fallback: use a temporary textarea
						let temp = document.createElementNS(
							"http://www.w3.org/1999/xhtml",
							"textarea"
						);
						temp.value = text;
						temp.style.position = "fixed";
						temp.style.left = "-9999px";
						document.documentElement.appendChild(temp);
						temp.select();
						document.execCommand("copy");
						temp.remove();
					}
				}
			}
		});

		// Quick prompt keyboard shortcuts: Cmd/Ctrl+<key> sends the prompt
		document.addEventListener("keydown", (event) => {
			let modKey = event.metaKey || event.ctrlKey;
			if (!modKey || this.isGenerating) return;

			// Don't override Cmd+C when text is selected (copy)
			let key = event.key.toLowerCase();
			if (key === "c") {
				let sel = window.getSelection();
				if (sel && sel.toString().length > 0) return;
			}

			for (let prompt of this.quickPrompts) {
				if (prompt.key === key) {
					event.preventDefault();
					this.dom.input.value = prompt.question;
					this.sendMessage();
					return;
				}
			}
		});

		// Analyze context window vs PDF size, adjust/truncate if needed
		// (this may truncate this.pdfText and updates the header)
		this._analyzeAndAdjustContext();

		// Add welcome message (after analysis, since pdfText may have been truncated)
		// Warnings from _analyzeAndAdjustContext are queued and shown after this
		this._addWelcomeAndWarnings();

		// Build quick prompt bubbles
		this._buildQuickPrompts();

		// Focus input
		this.dom.input.focus();

		// Resolve OllamaClient and check connection
		this._resolveOllamaClient();
		this.checkOllamaConnection();
	},

	/**
	 * Build the quick prompt bubbles bar.
	 * Each bubble shows a short label; clicking it pastes the full question
	 * into the input area and focuses it, ready to send.
	 */
	_buildQuickPrompts() {
		let container = document.getElementById("chat-quick-prompts");
		if (!container) return;

		let isMac = navigator.platform.indexOf("Mac") !== -1;
		let modLabel = isMac ? "\u2318" : "Ctrl+";

		for (let prompt of this.quickPrompts) {
			let bubble = document.createElementNS(
				"http://www.w3.org/1999/xhtml",
				"button"
			);
			bubble.className = "quick-prompt-bubble";
			bubble.textContent = prompt.label;
			bubble.title = prompt.question +
				" (" + modLabel + prompt.key.toUpperCase() + ")";
			bubble.addEventListener("click", () => {
				this.dom.input.value = prompt.question;
				this.dom.input.focus();
				// Place cursor at end
				this.dom.input.setSelectionRange(
					prompt.question.length,
					prompt.question.length
				);
			});
			container.appendChild(bubble);
		}

		// Hint text showing keyboard shortcut convention
		let hint = document.createElementNS(
			"http://www.w3.org/1999/xhtml",
			"span"
		);
		hint.className = "quick-prompt-hint";
		hint.textContent = isMac
			? "\u2318 + first letter to send"
			: "Ctrl + first letter to send";
		container.appendChild(hint);
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
							let chunk;
							try {
								chunk = JSON.parse(line);
							} catch (e) {
								continue; // skip unparseable lines
							}
							if (chunk.message && chunk.message.content) {
								fullResponse += chunk.message.content;
								if (onToken)
									onToken(chunk.message.content);
							}
							if (chunk.done) {
								if (onDone) onDone(fullResponse);
								return fullResponse;
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

	// ── Token estimation & context window ────────────────────────────

	/**
	 * Estimate the number of tokens in a string.
	 * Rough heuristic: ~1 token per 4 characters for English text.
	 * This is intentionally conservative (overestimates tokens) to avoid
	 * silently exceeding the context window.
	 */
	_estimateTokens(text) {
		if (!text) return 0;
		return Math.ceil(text.length / 3.5);
	},

	/**
	 * Analyze whether the PDF text fits in the context window and
	 * dynamically adjust if needed. Called during init().
	 *
	 * Context budget:
	 *   contextWindow = systemTokens + pdfTokens + conversationTokens + responseTokens
	 *
	 * We reserve ~2048 tokens for conversation + response headroom.
	 */
	_analyzeAndAdjustContext() {
		let MAX_CONTEXT = 131072; // hard cap for context window
		let RESPONSE_RESERVE = 2048; // tokens reserved for conversation + response

		// Estimate tokens for the fixed content (system prompt + metadata)
		let systemContent =
			this.systemPrompt +
			"\n\n--- PAPER METADATA ---\n" +
			this.metadata;
		let systemTokens = this._estimateTokens(systemContent);
		let originalPdfLength = this.pdfText.length;
		let pdfTokens = this._estimateTokens(this.pdfText);
		let totalNeeded = systemTokens + pdfTokens + RESPONSE_RESERVE;

		let contextAdjusted = false;

		if (totalNeeded <= this.userContextWindowSize) {
			// Everything fits in the user's configured context window
			this.contextWindowSize = this.userContextWindowSize;
		} else if (totalNeeded <= MAX_CONTEXT) {
			// Expand context window to fit the full PDF
			this.contextWindowSize = totalNeeded;
			contextAdjusted = true;
		} else {
			// PDF is too large even for the max context window
			// Truncate the PDF text to what fits within 131K
			this.contextWindowSize = MAX_CONTEXT;
			contextAdjusted = true;
			let fittableTokens = MAX_CONTEXT - systemTokens - RESPONSE_RESERVE;
			let fittableChars = Math.floor(fittableTokens * 3.5);
			if (fittableChars < this.pdfText.length) {
				this.pdfText = this.pdfText.substring(0, fittableChars);
			}
		}

		// Recalculate after possible truncation
		pdfTokens = this._estimateTokens(this.pdfText);
		let truncated = this.pdfText.length < originalPdfLength;

		// Update header with effective context size
		let contextLabel = this.contextWindowSize.toLocaleString();
		if (contextAdjusted) {
			contextLabel += " (auto)";
		}
		this.dom.modelInfo.textContent =
			"Model: " +
			this.model +
			"  |  Context: " +
			contextLabel +
			"  |  PDF: ~" +
			pdfTokens.toLocaleString() +
			" tokens";

		// Queue appropriate warnings (shown later by _addWelcomeAndWarnings)
		this._contextWarnings = [];
		if (truncated) {
			let pctKept = Math.round(
				(this.pdfText.length / originalPdfLength) * 100
			);
			this._contextWarnings.push(
				"\u26A0\uFE0F PDF text too large for the maximum context window (" +
					MAX_CONTEXT.toLocaleString() +
					" tokens). " +
					"Text truncated to " +
					this.pdfText.length.toLocaleString() +
					" chars (~" +
					pctKept +
					"% of original). " +
					"Answers about later sections may be unreliable."
			);
		} else if (this.contextWindowSize > 65536) {
			this._contextWarnings.push(
				"\u26A0\uFE0F Context window expanded to " +
					this.contextWindowSize.toLocaleString() +
					" tokens to fit the full PDF. " +
					"Answers may be slower due to the large context."
			);
		} else if (contextAdjusted) {
			this._contextWarnings.push(
				"\u2139\uFE0F Context window adjusted from " +
					this.userContextWindowSize.toLocaleString() +
					" to " +
					this.contextWindowSize.toLocaleString() +
					" tokens to fit the full PDF text."
			);
		}
	},

	/**
	 * Show the welcome message followed by any context warnings.
	 */
	_addWelcomeAndWarnings() {
		this._addSystemInfoToUI(
			"PDF loaded (" +
				this.pdfText.length.toLocaleString() +
				" chars, ~" +
				this._estimateTokens(this.pdfText).toLocaleString() +
				" tokens). Ask a question about this paper."
		);
		for (let w of this._contextWarnings) {
			this._addSystemInfoToUI(w);
		}
	},

	// ── Markdown rendering ────────────────────────────────────────────

	/**
	 * Convert markdown text to safe HTML.
	 * Supports: headings, bold, italic, inline code, code blocks,
	 * unordered/ordered lists, blockquotes, horizontal rules, links,
	 * and paragraphs.
	 */
	_renderMarkdown(text) {
		// Strip HTML tags the LLM may insert (e.g. <br>, <b>, <i>).
		// Process line by line: on table rows (containing |), replace
		// <br> with a space to preserve the row; elsewhere use newline.
		text = text.split("\n").map(function (line) {
			if (/\|/.test(line)) {
				line = line.replace(/<br\s*\/?>/gi, " ");
			} else {
				line = line.replace(/<br\s*\/?>/gi, "\n");
			}
			line = line.replace(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi, "");
			return line;
		}).join("\n");

		// Escape HTML entities
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
				result.push("<hr/>");
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

	// ── Note saving ──────────────────────────────────────────────────

	/**
	 * Add a note icon button at the bottom-right of an assistant message bubble.
	 * Clicking it saves the markdown text to an "Ollama notes" child note.
	 */
	_addNoteIcon(msgDiv, markdownText) {
		let wrapper = document.createElementNS(
			"http://www.w3.org/1999/xhtml",
			"div"
		);
		wrapper.className = "note-icon-wrapper";

		let btn = document.createElementNS(
			"http://www.w3.org/1999/xhtml",
			"button"
		);
		btn.className = "note-icon-btn";
		btn.title = "Save to Zotero note";
		// Use a simple note/document icon (Unicode)
		btn.textContent = "\uD83D\uDCDD"; // memo/note emoji
		btn.addEventListener("click", (event) => {
			event.stopPropagation();
			this._saveToNote(markdownText, btn);
		});

		wrapper.appendChild(btn);
		msgDiv.appendChild(wrapper);
	},

	/**
	 * Save text to the "Ollama notes" child note of the current item.
	 * Creates the note if it doesn't exist, appends if it does.
	 */
	async _saveToNote(markdownText, btn) {
		try {
			// Access Zotero through the opener window
			let Zotero;
			try {
				Zotero = window.opener && window.opener.Zotero;
			} catch (e) {
				// fallback
			}
			if (!Zotero) {
				// Try Components approach for chrome-privileged windows
				try {
					let { default: Zotero_ } =
						ChromeUtils.importESModule(
							"chrome://zotero/content/zotero.mjs"
						);
					Zotero = Zotero_;
				} catch (e) {
					// ignore
				}
			}
			if (!Zotero) {
				alert("Could not access Zotero API to save note.");
				return;
			}

			let parentItem = Zotero.Items.get(this.itemId);
			if (!parentItem) {
				alert("Could not find the parent item.");
				return;
			}

			// Look for an existing "Ollama notes" child note
			let noteIDs = parentItem.getNotes();
			let existingNote = null;
			for (let noteID of noteIDs) {
				let noteItem = Zotero.Items.get(noteID);
				if (noteItem) {
					let noteTitle = noteItem.getNoteTitle();
					if (noteTitle === "Ollama notes") {
						existingNote = noteItem;
						break;
					}
				}
			}

			// Format the text to add — use HTML since Zotero notes are HTML
			let timestamp = new Date().toLocaleString();
			let htmlContent =
				"<hr/><p><strong>[" +
				timestamp +
				"]</strong></p>\n" +
				this._markdownToNoteHtml(markdownText);

			if (existingNote) {
				// Append to existing note
				let currentContent = existingNote.getNote();
				existingNote.setNote(currentContent + "\n" + htmlContent);
				await existingNote.saveTx();
			} else {
				// Create new child note
				let newNote = new Zotero.Item("note");
				newNote.parentID = parentItem.id;
				newNote.setNote(
					"<h1>Ollama notes</h1>\n" + htmlContent
				);
				await newNote.saveTx();
			}

			// Visual feedback — briefly change icon
			let originalText = btn.textContent;
			btn.textContent = "\u2705"; // check mark
			btn.classList.add("saved");
			setTimeout(() => {
				btn.textContent = originalText;
				btn.classList.remove("saved");
			}, 2000);
		} catch (error) {
			alert("Error saving note: " + error.message);
		}
	},

	/**
	 * Convert markdown text to simple HTML suitable for Zotero notes.
	 * Zotero notes use HTML, so we convert markdown to basic HTML.
	 */
	_markdownToNoteHtml(text) {
		// Reuse the markdown renderer but produce cleaner output for notes
		let html = this._renderMarkdown(text);
		// The rendered markdown already escapes HTML entities and produces
		// clean HTML — we just need to ensure it's suitable for Zotero notes
		return html;
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
					// Render markdown live as tokens arrive
					try {
						assistantDiv.innerHTML = this._renderMarkdown(fullResponse);
					} catch (e) {
						// Fallback to plain text if XHTML parse fails
						assistantDiv.style.whiteSpace = "pre-wrap";
						assistantDiv.textContent = fullResponse;
					}
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
		} finally {
			// Always reset state, even if an error occurred mid-stream
			if (thinkingSpan.parentNode) {
				thinkingSpan.remove();
			}
			this._setGenerating(false);
			this.currentAbortController = null;
		}

		// Finalize: ensure final render is clean markdown
		if (fullResponse) {
			assistantDiv.style.whiteSpace = "";
			try {
				assistantDiv.innerHTML = this._renderMarkdown(fullResponse);
			} catch (renderErr) {
				try { Zotero.debug("ZoteroOllama: markdown render error: " + renderErr); } catch (e) { /* ignore */ }
				assistantDiv.style.whiteSpace = "pre-wrap";
				assistantDiv.textContent = fullResponse;
			}
			this._addNoteIcon(assistantDiv, fullResponse);
			this.messages.push({ role: "assistant", content: fullResponse });
		} else if (!this.dom.statusBar.textContent) {
			assistantDiv.textContent = "(No response generated)";
		} else {
			// Error was shown in status bar, remove the empty bubble
			assistantDiv.remove();
		}

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
