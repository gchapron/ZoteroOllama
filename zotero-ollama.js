/* eslint-disable no-unused-vars */
/* global Zotero, OllamaClient, Services */

var ZoteroOllama = {
	id: null,
	version: null,
	rootURI: null,

	// Per-window cleanup tracking
	_windowListeners: new Map(),

	log(msg) {
		Zotero.debug("ZoteroOllama: " + msg);
	},

	init({ id, version, rootURI }) {
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this.log("Initialized v" + version);
	},

	// ── Window management ─────────────────────────────────────────────

	addToAllWindows() {
		let windows = Zotero.getMainWindows();
		for (let win of windows) {
			if (!win.ZoteroPane) continue;
			this.addToWindow(win);
		}
	},

	removeFromAllWindows() {
		let windows = Zotero.getMainWindows();
		for (let win of windows) {
			if (!win.ZoteroPane) continue;
			this.removeFromWindow(win);
		}
	},

	addToWindow(window) {
		let doc = window.document;

		// Keyboard shortcut (Cmd+Shift+G / Ctrl+Shift+G)
		let keydownHandler = (event) => {
			let modKey = Zotero.isMac ? event.metaKey : event.ctrlKey;
			if (modKey && event.shiftKey && event.code === "KeyG") {
				event.preventDefault();
				event.stopPropagation();
				this.openChatForSelectedItem(window);
			}
		};
		doc.addEventListener("keydown", keydownHandler, true);

		let listeners = { keydownHandler };

		// Context menu item
		let menuPopup = doc.getElementById("zotero-itemmenu");
		if (menuPopup) {
			let menuItem = doc.createXULElement("menuitem");
			menuItem.id = "zotero-ollama-chat-menuitem";
			menuItem.setAttribute("label", "Chat with PDF (Ollama)");
			menuItem.addEventListener("command", () => {
				this.openChatForSelectedItem(window);
			});
			menuPopup.appendChild(menuItem);

			let popupShowHandler = () => this._onMenuShowing(doc, window);
			menuPopup.addEventListener("popupshowing", popupShowHandler);

			listeners.popupShowHandler = popupShowHandler;
			listeners.menuPopup = menuPopup;
		} else {
			this.log("Could not find zotero-itemmenu");
		}

		this._windowListeners.set(window, listeners);
		this.log("Added to window");
	},

	removeFromWindow(window) {
		let listeners = this._windowListeners.get(window);
		if (!listeners) return;

		// Remove keyboard listener
		window.document.removeEventListener(
			"keydown",
			listeners.keydownHandler,
			true
		);

		// Remove context menu listener and element
		if (listeners.menuPopup && listeners.popupShowHandler) {
			listeners.menuPopup.removeEventListener(
				"popupshowing",
				listeners.popupShowHandler
			);
		}

		let doc = window.document;
		let menuItem = doc.getElementById("zotero-ollama-chat-menuitem");
		if (menuItem) menuItem.remove();

		this._windowListeners.delete(window);
		this.log("Removed from window");
	},

	// ── Context menu ──────────────────────────────────────────────────

	_onMenuShowing(doc, window) {
		let menuItem = doc.getElementById("zotero-ollama-chat-menuitem");
		if (!menuItem) return;

		let items = window.ZoteroPane.getSelectedItems();
		let show = items.length === 1 && items[0].isRegularItem();
		menuItem.hidden = !show;
	},

	// ── PDF Text Extraction ───────────────────────────────────────────

	async extractPdfText(item) {
		if (!item.isRegularItem()) {
			throw new Error("Selected item is not a regular item.");
		}

		let attachmentIDs = item.getAttachments();
		if (!attachmentIDs || attachmentIDs.length === 0) {
			throw new Error("No attachments found for this item.");
		}

		// Find the first PDF attachment
		for (let id of attachmentIDs) {
			let attachment = Zotero.Items.get(id);
			if (attachment.attachmentContentType === "application/pdf") {
				// Try getting indexed text first
				let text = await attachment.attachmentText;
				if (text && text.trim().length > 0) {
					return text;
				}

				// Text is empty — try to trigger indexing
				this.log("PDF not indexed, attempting indexing...");
				await Zotero.Fulltext.indexItems([id]);

				// Retry after indexing
				text = await attachment.attachmentText;
				if (text && text.trim().length > 0) {
					return text;
				}

				throw new Error(
					"Could not extract text from PDF. The PDF may not be properly indexed. " +
						"Try right-clicking the item and selecting 'Reindex Item'."
				);
			}
		}

		throw new Error("No PDF attachment found for this item.");
	},

	// ── Open Chat Dialog ──────────────────────────────────────────────

	async openChatForSelectedItem(window) {
		let items = window.ZoteroPane.getSelectedItems();

		if (items.length !== 1) {
			window.alert("ZoteroOllama: Please select exactly one item.");
			return;
		}

		let item = items[0];
		if (!item.isRegularItem()) {
			window.alert(
				"ZoteroOllama: Please select a regular item (not an attachment or note)."
			);
			return;
		}

		// Extract PDF text
		let pdfText;
		try {
			pdfText = await this.extractPdfText(item);
		} catch (error) {
			window.alert("ZoteroOllama: " + error.message);
			return;
		}

		// Build item metadata string
		let title = item.getField("title") || "Untitled";
		let creators = item
			.getCreators()
			.map((c) => (c.firstName ? c.firstName + " " : "") + c.lastName)
			.join(", ");
		let year = item.getField("year") || item.getField("date") || "";
		let doi = item.getField("DOI") || "";

		let metadata = "Title: " + title;
		if (creators) metadata += "\nAuthors: " + creators;
		if (year) metadata += "\nYear: " + year;
		if (doi) metadata += "\nDOI: " + doi;

		// Prepare data for the dialog
		let dialogData = {
			pdfText: pdfText,
			metadata: metadata,
			itemTitle: title,
			itemId: item.id,
			rootURI: this.rootURI,
			model:
				Zotero.Prefs.get("extensions.zotero-ollama.model", true) ||
				"gpt-oss:20b",
			ollamaUrl:
				Zotero.Prefs.get(
					"extensions.zotero-ollama.ollamaUrl",
					true
				) || "http://localhost:11434",
			contextWindowSize:
				Zotero.Prefs.get(
					"extensions.zotero-ollama.contextWindowSize",
					true
				) || 32768,
			systemPrompt:
				Zotero.Prefs.get(
					"extensions.zotero-ollama.systemPrompt",
					true
				) ||
				"You are a helpful research assistant. Answer questions about the provided PDF document accurately and concisely.",
		};

		// Open non-modal, resizable dialog
		window.openDialog(
			"chrome://zotero-ollama/content/chat-dialog.xhtml",
			"zotero-ollama-chat-" + item.id,
			"chrome,centerscreen,resizable=yes,dialog=no",
			dialogData
		);
	},
};
