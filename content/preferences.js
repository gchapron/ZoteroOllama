/* global Zotero, document, window */

// Assign to window explicitly so that the onload="ZoteroOllamaPrefs.init()"
// attribute in the XHTML can resolve the name. In Zotero 8, preference pane
// scripts run in their own Cu.Sandbox scope, so a plain `var` declaration
// is not visible to inline event handlers (which resolve against `window`).
// This is backward-compatible with Zotero 7.
window.ZoteroOllamaPrefs = {
	DEFAULT_MODEL: "gpt-oss:20b",

	/**
	 * Called from the onload attribute on the root <vbox>.
	 * At this point the DOM is fully inserted and the preference system
	 * has already activated preference= bindings (including a built-in
	 * MutationObserver on the <menulist> that will auto-select the
	 * matching menuitem when we append them).
	 */
	init() {
		Zotero.debug("ZoteroOllama prefs: init() called");
		this.populateModelMenu();
	},

	async populateModelMenu() {
		let menulist = document.getElementById("pref-model-menu");
		let popup = menulist.menupopup;
		let statusEl = document.getElementById("pref-model-status");

		let baseUrl =
			Zotero.Prefs.get("extensions.zotero-ollama.ollamaUrl", true) ||
			"http://localhost:11434";

		Zotero.debug("ZoteroOllama prefs: fetching models from " + baseUrl);

		try {
			let response = await fetch(baseUrl + "/api/tags", {
				method: "GET",
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) {
				throw new Error("HTTP " + response.status);
			}
			let data = await response.json();
			let models = data.models || [];

			Zotero.debug("ZoteroOllama prefs: got " + models.length + " models");

			// Clear the popup
			popup.replaceChildren();

			if (models.length === 0) {
				let item = document.createXULElement("menuitem");
				item.label = "No models found";
				item.value = "";
				popup.append(item);
				if (statusEl) {
					statusEl.textContent =
						"No models installed. Run: ollama pull <model>";
				}
				return;
			}

			// Sort alphabetically
			models.sort(function (a, b) {
				return a.name.localeCompare(b.name);
			});

			// Add a menuitem for each model.
			// The preference system's built-in MutationObserver on the
			// menulist will auto-select the item whose value matches the
			// saved preference.
			for (let m of models) {
				let sizeGB = m.size
					? "  (" + (m.size / 1e9).toFixed(1) + " GB)"
					: "";
				let item = document.createXULElement("menuitem");
				item.label = m.name + sizeGB;
				item.value = m.name;
				popup.append(item);
			}

			if (statusEl) {
				statusEl.textContent =
					models.length +
					" model" +
					(models.length !== 1 ? "s" : "") +
					" available";
			}

			Zotero.debug(
				"ZoteroOllama prefs: populated " +
					models.length +
					" models, menulist.value=" +
					menulist.value
			);
		} catch (e) {
			Zotero.debug("ZoteroOllama prefs: error fetching models: " + e);

			// On error, add the saved model as the only option so
			// the preference value is preserved
			popup.replaceChildren();
			let saved =
				Zotero.Prefs.get("extensions.zotero-ollama.model", true) ||
				this.DEFAULT_MODEL;
			let item = document.createXULElement("menuitem");
			item.label = saved;
			item.value = saved;
			popup.append(item);

			if (statusEl) {
				statusEl.textContent =
					"Could not connect to Ollama at " + baseUrl;
			}
		}
	},
};
