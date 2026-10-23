/* global Zotero, Services, Components */

var { Cu } = Components;

Zotero.ReadAloudLoop = {
	id: null,
	version: null,
	rootURI: null,
	_readers: new Set(),
	_managers: new WeakMap(),
	_retryTimers: new WeakMap(),
	_retryReaders: new Set(),
	_renderToolbarHandler: null,

	init({ id, version, rootURI }) {
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;

		this._renderToolbarHandler = event => this._attachReader(event.reader);
		Zotero.Reader.registerEventListener("renderToolbar", this._renderToolbarHandler, id);

		for (let reader of Zotero.Reader._readers || []) {
			this._attachReader(reader);
		}

		Zotero.debug("Read Aloud Loop: initialized");
	},

	uninit() {
		if (this._renderToolbarHandler) {
			Zotero.Reader.unregisterEventListener("renderToolbar", this._renderToolbarHandler);
			this._renderToolbarHandler = null;
		}
		for (let reader of [...this._readers]) {
			this._detachReader(reader);
		}
		for (let reader of [...this._retryReaders]) {
			this._clearRetryTimer(reader);
		}
		this._readers.clear();
		this._retryReaders.clear();
		delete Zotero.ReadAloudLoop;
	},

	onMainWindowLoad() {},

	onMainWindowUnload() {},

	_onRenderToolbar(event) {
		this._attachReader(event.reader);
	},

	_raw(obj) {
		if (!obj) {
			return obj;
		}
		try {
			return Cu.waiveXrays(obj);
		}
		catch {
			return obj.wrappedJSObject || obj;
		}
	},

	_getIframeWindow(reader) {
		let iframeWindow;
		try {
			iframeWindow = reader?._iframeWindow;
		}
		catch {
			return null;
		}
		if (!iframeWindow) {
			return null;
		}
		try {
			return iframeWindow.wrappedJSObject || this._raw(iframeWindow);
		}
		catch {
			return this._raw(iframeWindow);
		}
	},

	_getManager(reader) {
		try {
			let win = this._getIframeWindow(reader);
			if (win?._reader?._readAloudManager) {
				return win._reader._readAloudManager;
			}
			let internal = this._raw(reader?._internalReader);
			return internal?._readAloudManager || null;
		}
		catch {
			return null;
		}
	},

	_getLocale() {
		return Zotero.locale || Services.locale?.requestedLocale || "en-US";
	},

	_attachReader(reader) {
		if (!reader) {
			return;
		}
		if (this._readers.has(reader)) {
			return;
		}

		let win = this._getIframeWindow(reader);
		let manager = this._getManager(reader);
		let hasBody = false;
		try {
			hasBody = !!win?.document?.body;
		}
		catch {
			hasBody = false;
		}
		if (!hasBody || !manager) {
			this._scheduleRetry(reader);
			return;
		}

		try {
			if (!win.__ReadAloudLoop) {
				Services.scriptloader.loadSubScript(this.rootURI + "content/inject.js", win);
			}
			if (!win.__ReadAloudLoop) {
				Zotero.logError(new Error("Read Aloud Loop: failed to inject into reader iframe"));
				this._scheduleRetry(reader);
				return;
			}

			win.__ReadAloudLoop.attach({ locale: this._getLocale() }, manager);
			// Keep a reference to the manager for detaching, since the reader
			// may have been reset by the time the plugin shuts down.
			this._managers.set(reader, manager);
			this._readers.add(reader);
			this._clearRetryTimer(reader);
		}
		catch (e) {
			Zotero.logError(e);
			this._scheduleRetry(reader);
		}
	},

	_scheduleRetry(reader) {
		if (this._retryTimers.has(reader)) {
			return;
		}
		this._retryReaders.add(reader);
		let attempts = 0;
		let timer = setInterval(() => {
			if (this._readers.has(reader)) {
				this._clearRetryTimer(reader);
				return;
			}
			attempts++;
			if (attempts > 40) {
				this._clearRetryTimer(reader);
				return;
			}
			let ready = false;
			try {
				ready = !!this._getIframeWindow(reader)?.document?.body;
			}
			catch {
				ready = false;
			}
			if (ready && this._getManager(reader)) {
				this._clearRetryTimer(reader);
				this._attachReader(reader);
			}
		}, 250);
		this._retryTimers.set(reader, timer);
	},

	_clearRetryTimer(reader) {
		let timer = this._retryTimers.get(reader);
		if (timer !== undefined) {
			clearInterval(timer);
			this._retryTimers.delete(reader);
		}
		this._retryReaders.delete(reader);
	},

	_detachReader(reader) {
		let win = this._getIframeWindow(reader);
		let manager = this._managers.get(reader) || this._getManager(reader);
		try {
			win?.__ReadAloudLoop?.detach(manager);
		}
		catch {
			// Reader already closed
		}
		this._managers.delete(reader);
		this._readers.delete(reader);
	},
};
