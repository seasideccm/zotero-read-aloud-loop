/* global window, WeakMap */

/**
 * Runs inside the Zotero reader iframe.
 *
 * Adds a loop button to the Read Aloud popup and makes the active read-aloud
 * controller repeat the current segment instead of advancing, for both the
 * local speechSynthesis controller and the remote (audio buffer) controller.
 */
var ReadAloudLoopInjected = (function () {
	"use strict";

	var BADGE_CLASS = "read-aloud-loop-badge";
	var STYLE_ID = "read-aloud-loop-style";
	var BADGE_SIZE = 16;
	var states = new WeakMap();
	var doc = window.document;

	function log(message) {
		try {
			console.log("[Read Aloud Loop] " + message);
		}
		catch {
			// Ignore
		}
	}

	function ensureStyle() {
		if (doc.getElementById(STYLE_ID)) {
			return;
		}
		var style = doc.createElement("style");
		style.id = STYLE_ID;
		style.textContent = [
			".read-aloud-loop-badge {",
			"  position: absolute;",
			"  box-sizing: border-box;",
			"  width: 16px;",
			"  height: 16px;",
			"  display: flex;",
			"  align-items: center;",
			"  justify-content: center;",
			"  border-radius: 50%;",
			"  background: var(--material-toolbar, #fff);",
			"  color: var(--fill-secondary);",
			"  box-shadow: 0 0 0 1px var(--fill-quinary, rgba(0, 0, 0, 0.18)), 0 1px 2px rgba(0, 0, 0, 0.2);",
			"  cursor: pointer;",
			"  z-index: 30;",
			"}",
			".read-aloud-loop-badge:hover { background: var(--fill-quinary, #eee); }",
			".read-aloud-loop-badge.active {",
			"  color: var(--accent-blue);",
			"  box-shadow: 0 0 0 1.5px var(--accent-blue), 0 1px 2px rgba(0, 0, 0, 0.2);",
			"}",
			".read-aloud-loop-badge svg { width: 12px; height: 12px; display: block; pointer-events: none; }",
		].join("\n");
		(doc.head || doc.documentElement).appendChild(style);
	}

	function isZh(locale) {
		return /^zh/i.test(locale || "");
	}

	function getTitle(state) {
		if (isZh(state.locale)) {
			return state.enabled
				? "循环播放：开（再次点击关闭）"
				: "循环播放当前句子";
		}
		return state.enabled
			? "Loop current sentence: on (click to turn off)"
			: "Loop current sentence";
	}

	var LOOP_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"'
		+ ' fill="none" stroke="currentColor" stroke-width="2"'
		+ ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
		+ '<path d="M3.6 7.4A6.6 6.6 0 0 1 15.4 5.2L16.9 7"/>'
		+ '<path d="M17 2.9v4.3h-4.3"/>'
		+ '<path d="M16.4 12.6A6.6 6.6 0 0 1 4.6 14.8L3.1 13"/>'
		+ '<path d="M3 17.1v-4.3h4.3"/>'
		+ "</svg>";

	function createBadge(state) {
		var badge = doc.createElement("span");
		badge.className = BADGE_CLASS;
		badge.setAttribute("role", "button");
		badge.setAttribute("tabindex", "-1");
		badge.setAttribute("aria-pressed", "false");
		badge.innerHTML = LOOP_ICON;
		badge.addEventListener("click", function (event) {
			event.preventDefault();
			event.stopPropagation();
			setEnabled(state, !state.enabled);
		});
		// Keep a click on the badge from also toggling the native play button.
		badge.addEventListener("pointerdown", function (event) {
			event.stopPropagation();
		});
		return badge;
	}

	function updateBadge(state) {
		var badge = state.badge;
		if (!badge) {
			return;
		}
		if (badge.classList.contains("active") !== state.enabled) {
			badge.classList.toggle("active", state.enabled);
		}
		var pressed = state.enabled ? "true" : "false";
		if (badge.getAttribute("aria-pressed") !== pressed) {
			badge.setAttribute("aria-pressed", pressed);
		}
		var title = getTitle(state);
		if (badge.title !== title) {
			badge.title = title;
		}
		if (badge.getAttribute("aria-label") !== title) {
			badge.setAttribute("aria-label", title);
		}
	}

	function setEnabled(state, enabled) {
		state.enabled = !!enabled;
		if (!state.enabled) {
			// If the current segment has already ended while loop was on, the
			// normal "advance to the next segment" logic was skipped. Let it
			// run now so turning loop off doesn't stall playback.
			var pending = state.pendingAdvance;
			cancelRestart(state);
			state.pendingAdvance = null;
			if (pending
					&& !pending.controller._destroyed
					&& state.manager._controller === pending.controller
					&& !pending.controller.paused) {
				try {
					pending.original.call(pending.controller, pending.segment, pending.index);
				}
				catch (e) {
					log("Failed to advance after disabling loop: " + e);
				}
			}
		}
		else {
			decorateController(state, state.manager, state.manager._controller);
		}
		updateBadge(state);
	}

	function cancelRestart(state) {
		if (state.restartTimer !== null) {
			window.clearTimeout(state.restartTimer);
			state.restartTimer = null;
		}
	}

	function findPlaybackReference(group) {
		for (var i = 0; i < group.children.length; i++) {
			var child = group.children[i];
			if (!child.classList) {
				continue;
			}
			if (child.classList.contains("loading-spinner")) {
				return child;
			}
			if (child.tagName === "BUTTON"
					&& child.classList.contains("toolbar-button")
					&& !child.classList.contains("skip")) {
				return child;
			}
		}
		return null;
	}

	function ensureBadge(state) {
		if (state.destroyed) {
			return;
		}
		ensureStyle();
		var popup = doc.querySelector(".read-aloud-popup");
		if (!popup) {
			return;
		}
		var row = popup.querySelector(".row.buttons");
		if (!row) {
			return;
		}
		var groups = [];
		for (var i = 0; i < row.children.length; i++) {
			var child = row.children[i];
			if (child.classList && child.classList.contains("group")) {
				groups.push(child);
			}
		}
		// Middle group (skip back / play / skip ahead)
		var group = groups[1] || groups[0];
		if (!group) {
			return;
		}
		// Track the play/pause button, or the buffering spinner that replaces
		// it, so the badge stays anchored during buffering.
		var reference = findPlaybackReference(group);
		if (!reference) {
			return;
		}

		if (!state.badge) {
			state.badge = createBadge(state);
		}
		var badge = state.badge;
		if (badge.parentNode !== popup) {
			popup.appendChild(badge);
		}

		// The popup is position: fixed, so absolute offsets are relative to it.
		var popupRect = popup.getBoundingClientRect();
		var refRect = reference.getBoundingClientRect();
		if (popupRect.width && refRect.width) {
			var left = Math.round(refRect.right - popupRect.left - BADGE_SIZE + 3);
			var top = Math.round(refRect.bottom - popupRect.top - BADGE_SIZE + 3);
			if (state.badgeLeft !== left) {
				badge.style.left = left + "px";
				state.badgeLeft = left;
			}
			if (state.badgeTop !== top) {
				badge.style.top = top + "px";
				state.badgeTop = top;
			}
		}

		updateBadge(state);
	}

	/**
	 * Repeat `segment` when it finishes instead of letting the controller
	 * advance to the next one. Works for BrowserReadAloudController (utterance
	 * `onend`) and RemoteReadAloudController (AudioBufferSourceNode `onended`),
	 * because both call this base method at the end of a segment.
	 */
	function decorateController(state, manager, controller) {
		if (!controller || controller.__readAloudLoopPatched) {
			return;
		}

		var originalHandleSegmentEnd = controller._handleSegmentEnd;
		if (typeof originalHandleSegmentEnd !== "function") {
			return;
		}

		controller._handleSegmentEnd = function (segment, index) {
			if (state.destroyed || !state.enabled || this._destroyed || this.paused) {
				return originalHandleSegmentEnd.call(this, segment, index);
			}

			// Keep the current segment alive and replay it after a short delay.
			// If the user skips to another sentence in the meantime, the
			// controller's position no longer matches `index` and the pending
			// restart is ignored.
			cancelRestart(state);
			var controllerRef = this;
			var loopIndex = typeof index === "number" ? index : this._position;
			state.pendingAdvance = {
				controller: controllerRef,
				segment,
				index: loopIndex,
				original: originalHandleSegmentEnd,
			};
			state.restartTimer = window.setTimeout(function () {
				state.restartTimer = null;
				state.pendingAdvance = null;
				if (state.destroyed || !state.enabled) {
					return;
				}
				if (controllerRef._destroyed || controllerRef.paused) {
					return;
				}
				if (manager._controller !== controllerRef) {
					return;
				}
				if (controllerRef._position !== loopIndex) {
					return;
				}
				try {
					// RemoteReadAloudController keeps the segment index at which
					// playback was paused. A loop should always restart from the
					// beginning of the segment, not from that stale resume offset.
					controllerRef._indexAtPause = null;
					controllerRef._speak();
				}
				catch (e) {
					log("Failed to restart segment: " + e);
				}
			}, 30);
		};
		controller.__readAloudLoopPatched = true;
		controller.__readAloudLoopOriginalEnd = originalHandleSegmentEnd;
	}

	function patchManager(state) {
		var manager = state.manager;
		var originalCreateController = manager._createController;
		if (typeof originalCreateController !== "function") {
			log("Read Aloud manager API not found; loop disabled");
			return;
		}
		state.originalCreateController = originalCreateController;

		manager._createController = function () {
			var result = originalCreateController.apply(this, arguments);
			try {
				// A new controller is created on activation, voice/segment
				// changes, repositioning, etc. Re-apply the loop hook every time.
				decorateController(state, this, this._controller);
			}
			catch (e) {
				log("Failed to hook controller: " + e);
			}
			return result;
		};

		decorateController(state, manager, manager._controller);
	}

	function unpatchManager(state) {
		var manager = state.manager;
		if (state.originalCreateController) {
			try {
				manager._createController = state.originalCreateController;
			}
			catch {
				// Ignore
			}
		}
		// Restore the current controller as well, in case the plugin is
		// disabled while a reader is still open.
		var controller = manager._controller;
		if (controller && controller.__readAloudLoopPatched && controller.__readAloudLoopOriginalEnd) {
			try {
				controller._handleSegmentEnd = controller.__readAloudLoopOriginalEnd;
				delete controller.__readAloudLoopPatched;
				delete controller.__readAloudLoopOriginalEnd;
			}
			catch {
				// Ignore
			}
		}
	}

	function resolveManager() {
		try {
			// `window._reader` is set by index.zotero.js when the reader is
			// created, so the manager can be resolved without passing objects
			// across the chrome/content compartment boundary.
			return (window._reader && window._reader._readAloudManager) || null;
		}
		catch {
			return null;
		}
	}

	function attach(options, fallbackManager) {
		var manager = resolveManager() || fallbackManager;
		if (!manager) {
			return null;
		}

		manager = manager.wrappedJSObject || manager;

		var existing = states.get(manager);
		if (existing && !existing.destroyed) {
			existing.locale = (options && options.locale) || existing.locale;
			existing.ensure();
			return existing;
		}

		var state = {
			manager,
			locale: (options && options.locale) || "",
			enabled: false,
			badge: null,
			badgeLeft: null,
			badgeTop: null,
			timer: null,
			restartTimer: null,
			originalCreateController: null,
			destroyed: false,
		};

		state.ensure = function () {
			ensureBadge(state);
		};

		states.set(manager, state);
		patchManager(state);

		state.timer = window.setInterval(function () {
			ensureBadge(state);
		}, 250);

		ensureBadge(state);
		return state;
	}

	function detach(fallbackManager) {
		var manager = resolveManager() || fallbackManager;
		if (!manager) {
			return;
		}
		manager = manager.wrappedJSObject || manager;
		var state = states.get(manager);
		if (!state) {
			return;
		}
		state.destroyed = true;
		cancelRestart(state);
		state.pendingAdvance = null;
		if (state.timer !== null) {
			window.clearInterval(state.timer);
			state.timer = null;
		}
		unpatchManager(state);
		if (state.badge) {
			try {
				state.badge.remove();
			}
			catch {
				// Ignore
			}
			state.badge = null;
		}
		states.delete(manager);
	}

	return {
		attach,
		detach,
		setEnabled: function (enabled) {
			var manager = resolveManager();
			manager = manager && (manager.wrappedJSObject || manager);
			var state = manager && states.get(manager);
			if (state) {
				setEnabled(state, enabled);
			}
		},
	};
})();

window.__ReadAloudLoop = ReadAloudLoopInjected;
