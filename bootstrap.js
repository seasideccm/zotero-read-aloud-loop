/* global Zotero, Services, Components */

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
	await Zotero.initializationPromise;

	if (!rootURI) {
		rootURI = resourceURI.spec;
	}
	if (!rootURI.endsWith("/")) {
		rootURI += "/";
	}

	var aomStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
		.getService(Components.interfaces.amIAddonManagerStartup);
	var manifestURI = Services.io.newURI(rootURI + "manifest.json");
	chromeHandle = aomStartup.registerChrome(manifestURI, [
		["content", "read-aloud-loop", rootURI + "content/"],
	]);

	Services.scriptloader.loadSubScript(rootURI + "content/plugin.js");
	Zotero.ReadAloudLoop.init({ id, version, rootURI });
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
	if (reason === APP_SHUTDOWN) {
		return;
	}
	Zotero.ReadAloudLoop?.uninit();
	if (chromeHandle) {
		chromeHandle.destruct();
		chromeHandle = null;
	}
}

function uninstall(data, reason) {}

function onMainWindowLoad({ window }, reason) {
	Zotero.ReadAloudLoop?.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }, reason) {
	Zotero.ReadAloudLoop?.onMainWindowUnload(window);
}
