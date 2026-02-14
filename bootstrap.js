/* eslint-disable no-unused-vars */
var ZoteroOllama;
var OllamaClient;
var chromeHandle;

function log(msg) {
	Zotero.debug("ZoteroOllama: " + msg);
}

function install() {
	log("Installed");
}

async function startup({ id, version, rootURI }) {
	log("Starting v" + version);

	// Register chrome:// URLs so window.openDialog can find our XHTML files
	var aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"]
		.getService(Ci.amIAddonManagerStartup);
	var manifestURI = Services.io.newURI(rootURI + "manifest.json");
	chromeHandle = aomStartup.registerChrome(manifestURI, [
		["content", "zotero-ollama", "chrome/content/"],
	]);

	Services.scriptloader.loadSubScript(rootURI + "ollama.js");
	Services.scriptloader.loadSubScript(rootURI + "zotero-ollama.js");

	ZoteroOllama.init({ id, version, rootURI });
	ZoteroOllama.addToAllWindows();

	Zotero.PreferencePanes.register({
		pluginID: id,
		src: rootURI + "content/preferences.xhtml",
		scripts: [rootURI + "content/preferences.js"],
		label: "ZoteroOllama",
	});
}

function onMainWindowLoad({ window }) {
	ZoteroOllama.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	ZoteroOllama.removeFromWindow(window);
}

function shutdown() {
	log("Shutting down");
	ZoteroOllama.removeFromAllWindows();
	ZoteroOllama = undefined;
	OllamaClient = undefined;
	if (chromeHandle) {
		chromeHandle.destruct();
		chromeHandle = null;
	}
}

function uninstall() {
	log("Uninstalled");
}
