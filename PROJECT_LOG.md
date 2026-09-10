# Project Log

## 2026-09-09 - Overwrite Collision Fix (removeEntry Fallback)

### Root Cause of Overwrite Failure ("Flashing and Disappearing")

- **Chromium Atomic Swap Rename Conflict**: When overwriting an existing file, Chrome's `createWritable()` writes to a `.crswap` temporary file. On `close()`, Chrome attempts an atomic rename (`ReplaceFileW`/`MoveFileExW`) to replace the destination file.
- **Why it failed on Windows**: If the existing file was read during preview or was being monitored by VS Code / IDE file watchers, the target file's cached metadata desynchronized or held a lock. Chrome aborted the stream and deleted the `.crswap` file, producing the "flashes and disappears" symptom and `InvalidStateError`.

### Changes Applied

- Implemented an automatic `removeEntry` fallback in `writeContentToDisk`: when a direct overwrite fails with `InvalidStateError` or write conflict, SyncPilot explicitly removes the existing disk entry (`currentDir.removeEntry(fileName)`), acquires a clean file handle, and creates the file cleanly. This eliminates the replacement collision entirely while retaining standard atomic write safety.

### Verification

- Node syntax checks and test suite passed.

### Root Causes Identified

- **IDB connection leak**: `getDirHandle()` opened a new `IDBDatabase` on every call and never closed it. A 4-file batch with 5 retries each generated up to 22 open IDB connections. When the Service Worker was suspended and resumed, stale connections triggered `InvalidStateError`.
- **Dead `rootHandle` parameter**: `writeContentToDisk(rootHandle, ...)` ignored its first parameter and always called `getDirHandle()` internally; `writeFiles()` still called `getDirHandle()` an extra time to produce this unused argument.
- **Missing `AbortError` in transient-error list**: Aborting a writable and immediately retrying sometimes raised `AbortError`, which was not recognized as retryable and caused the attempt to be thrown as fatal.

### Changes Applied

- `getDirHandle()`: Close the `IDBDatabase` connection in both `onsuccess` and `onerror` callbacks.
- `writeContentToDisk`: Removed unused `rootHandle` parameter.
- `writeFiles`: Removed the redundant `getDirHandle()` call (and the dead `!rootHandle` guard); `writeContentToDisk` already reacquires a fresh handle on every retry.
- `isTransientWriteError`: Added `'AbortError'` to the recognized transient-error set.

### Verification

- `node --check` passes for all four JS files.
- `node --test tests/background-path-validation.test.js`: 4 passed.
- Browser-level verification still required.

## 2026-09-08 - Write Failure Investigation

### Symptoms

- Syncing multiple One-Line game files repeatedly failed; the UI showed `4 files failed` or `Rebind Workspace`.
- Affected relative paths included `games/one-line/js/engine.mjs`, `game.mjs`, `render.mjs`, `main.mjs`, and `index.html`.
- Popup history captured: `InvalidStateError: An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.`

### Findings

- The paths were valid workspace-relative paths; the reported absolute `G:\work\code\game\doin\...` paths were user context, not plugin input.
- `G:` is a local NTFS fixed volume and the target files are not read-only.
- The failure occurs when a File System Access handle observes a file or directory state change between preview and write, consistent with an editor, formatter, watcher, or another process modifying the same files concurrently.
- The previous 8-second content-script timeout also misclassified slow multi-file retries as authorization failures.

### Changes Applied

- Reacquire the persisted root directory and nested file handles for every retry.
- Retry transient state errors with bounded exponential backoff (up to five attempts).
- Use the default `createWritable()` mode for Chromium compatibility.
- Preserve per-file error names/messages in history and button tooltips.
- Increase single-file and batch timeouts to 15 and 30 seconds; `TIMEOUT` is no longer treated as reauthorization.
- Clear stale batch failure state when opening workspace reauthorization.

### Current Status

- Static checks and all four Node regression tests pass.
- Browser-level verification remains required. If `InvalidStateError` persists after pausing external file watchers and editors, capture the latest per-file tooltip and identify the process modifying the workspace.

## 2026-09-05 - Reliability, Safety, And Multi-AI Sync

### Completed

- Hardened workspace authorization and recovery: Popup reports real permission state; expired permissions provide a rebind action; unsupported browsers are blocked before opening the picker.
- Added safe write validation, trusted-origin checks, serialized disk writes, retry cleanup, 100-file batch limit, and path traversal/control-character rejection.
- Added write preflight and overwrite confirmation with local/new content preview. Large previews are capped at 200KB.
- Improved single and batch status handling for partial writes, timeouts, Service Worker reloads, and failed-file details.
- Reworked history into the latest 30 sync batches with complete timestamps, batch IDs, and success/failure details; legacy history entries remain readable.
- Replaced periodic full-page scanning with a debounced `MutationObserver`, restored the batch control after SPA re-renders, and restricted detection to model/assistant output.
- Switched untrusted path/history rendering to text-only DOM APIs.
- Added support and origin allowlisting for Gemini, ChatGPT, Claude, DeepSeek, Kimi, Qwen, Doubao, and Grok.
- Added Node regression tests for path validation, supported origins, and write queue serialization.

### Modified Files

- `manifest.json`
- `background.js`
- `content.js`
- `popup.html`, `popup.js`
- `setup.html`, `setup.js`
- `README.md`
- `tests/background-path-validation.test.js` (new)
- `AGENTS.md` (new)
- `PROJECT_LOG.md` (new)

### Implementation Notes

- `background.js` is the only disk-write owner. It stores the directory handle in IndexedDB, checks `readwrite` permission, previews conflicts, and queues write requests.
- `content.js` sends `PREVIEW_FILES` before `WRITE_FILES`. Only existing local files show the confirmation dialog; no-conflict files continue directly.
- The site list is duplicated deliberately: Manifest match patterns load the content script, while `SUPPORTED_ORIGINS` prevents untrusted pages from requesting writes.

### Verification

- `node --test tests/background-path-validation.test.js`: 4 passed.
- Syntax checks passed for `background.js`, `content.js`, `popup.js`, and `setup.js`.
- `manifest.json` parsed successfully after its existing filepath comment is excluded for JSON validation.

### Remaining Manual Checks

- Reload the unpacked extension and refresh each supported AI site. Logged-in DOM injection has not been manually verified for all eight sites.
- Verify overwrite preview/cancel/confirm using a disposable local workspace.
- Verify permission expiry and rebind after browser restart.

### Next Priority

Perform a real-browser compatibility pass across the eight supported AI sites and adjust only site-specific DOM adapters that fail.
