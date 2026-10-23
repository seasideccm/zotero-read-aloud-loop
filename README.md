# Read Aloud Loop

**English** | [简体中文](./README.zh-CN.md)

Adds a "loop current sentence" toggle to the **Read Aloud** feature of the Zotero reader (PDF / EPUB).

When enabled, the current sentence is replayed automatically after it finishes. Clicking "previous sentence" or "next sentence" moves the loop target to the newly selected sentence, which then keeps looping. Useful for close reading, shadowing, and language learning.

## Features

- Adds a loop toggle to the Read Aloud popup without changing the layout of the existing button row
- The toggle is a small badge at the bottom-right corner of the play/pause button:
  - Gray: loop off
  - Blue: loop on
- Works with both local (system TTS) and remote (cloud TTS) voices
- After skipping to the previous or next sentence, the new sentence is looped
- Loop state is preserved across pause/resume, voice changes, and speed changes
- Turning loop off right after a sentence ends advances to the next sentence normally instead of stalling

## Installation

1. Open Zotero → Settings → Plugins
2. Click the gear icon in the top-right corner → **Install Plugin From File**
3. Select:

   ```
   dist/read-aloud-loop.xpi
   ```

4. Restart Zotero after installation (recommended)
5. Open a PDF or EPUB and click the speaker button in the toolbar to open the Read Aloud popup

If the Read Aloud popup was already open before installation, close and reopen it so the plugin can inject into the reader again.

## Usage

1. Open the Read Aloud popup and start playback
2. Click the **loop badge at the bottom-right corner of the play/pause button**
   - The badge turns blue when looping is enabled
   - Click it again to disable looping
3. The current sentence is replayed after it finishes
4. While looping, previous/next sentence, pause, speed, and voice controls continue to work normally

## Project Structure

```
.
├── manifest.json              # Plugin manifest
├── bootstrap.js               # Zotero plugin entry point
├── content/
│   ├── plugin.js              # Main process: event registration, reader lookup, injection and cleanup
│   ├── inject.js              # Inside the reader iframe: badge UI and loop control
│   └── icon.svg               # Plugin icon
├── dist/
│   └── read-aloud-loop.xpi    # Installable package
├── README.md                  # English README
└── README.zh-CN.md            # Chinese README
```

## How It Works

### 1. Injecting into the reader iframe

`content/plugin.js` listens for reader rendering via `Zotero.Reader.registerEventListener('renderToolbar', ...)` and loads `content/inject.js` into the reader iframe through `reader._iframeWindow`.

For readers that are already open, the plugin iterates over `Zotero.Reader._readers` during initialization. If a reader has not finished initializing, it retries on a timer.

### 2. The loop badge

Inside the iframe, `inject.js`:

- Locates `.read-aloud-popup` and the middle group of playback controls
- Reads the position of the play/pause button (or the buffering spinner that replaces it)
- Positions the badge at the button's bottom-right corner using absolute positioning

Because the badge uses `position: absolute`, it does not take up space in the button row and cannot cause horizontal overflow in the popup.

The badge is validated every 250 ms and is re-added automatically if a React re-render removes it.

### 3. Looping playback

- Obtains the read-aloud manager via `window._reader._readAloudManager`
- Intercepts `manager._createController` so the loop hook is reapplied whenever a controller is recreated
- Wraps the controller's `_handleSegmentEnd`:
  - Loop off: runs the original logic and advances to the next sentence
  - Loop on: does not advance; after a short delay, calls `_speak()` to replay the current segment
- Before replaying with a remote voice, clears `_indexAtPause` so playback restarts from the beginning of the segment rather than from the pause offset

`_handleSegmentEnd` is the shared end-of-segment callback for both the local `speechSynthesis` controller and the remote audio controller, so both voice engines are supported.

## Development and Packaging

After modifying files under `content/`, run the following from the project root:

```bash
rm -f dist/read-aloud-loop.xpi
zip -r dist/read-aloud-loop.xpi manifest.json bootstrap.js content
```

Then reinstall `dist/read-aloud-loop.xpi` in Zotero.

When changing the version number, update `version` in `manifest.json` as well.

## Compatibility

- Target: Zotero 11 (PDF / EPUB reader)
- `manifest.json` declares `strict_min_version: 7.0` and `strict_max_version: *`
- Relies on the following reader internals:
  - `_readAloudManager`
  - `_createController`
  - `_handleSegmentEnd`
  - `_speak`
  - `_indexAtPause`

These members exist in the current Zotero 11 source tree and build output. If a future Zotero version renames them, the plugin will need to be updated accordingly.

## Troubleshooting

### "This plugin may not be compatible with this version of Zotero" during installation

Check `manifest.json`:

- `applications.zotero.update_url` is present
- `strict_min_version` is not higher than the installed Zotero version
- `strict_max_version` is `*`

### The loop badge does not appear in the Read Aloud popup

- Close and reopen the Read Aloud popup
- Make sure the plugin is enabled
- Check the Zotero debug log for messages containing `Read Aloud Loop`

### The badge is slightly misaligned

The badge position is calculated from the play button in real time. After the popup opens or switches between playing and buffering, it realigns within 250 ms.

## Known Limitations

- The loop unit is the read-aloud engine's "segment"; local and remote voices typically segment by sentence
- The badge follows the native `tabIndex=-1` interaction style of the Read Aloud popup and is not part of the Tab focus order

## Uninstallation

Zotero → Settings → Plugins → find **Read Aloud Loop** → Remove.
