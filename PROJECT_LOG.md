# Project Log

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
