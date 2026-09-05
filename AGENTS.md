# SyncPilot Agent Guide

## Product And Scope

SyncPilot is a Manifest V3 Chrome/Edge extension that saves AI-generated code blocks to a user-authorized local workspace through the File System Access API. It has no daemon, server, telemetry, or external write API.

Supported sites: Gemini, ChatGPT, Claude, DeepSeek, Kimi, Qwen, Doubao, and Grok. A code block must start with `// filepath: relative/path.ext`.

Do not add automatic publishing, media upload, Cron jobs, remote sync, or additional AI sites without an explicit request.

## Architecture

- `manifest.json`: MV3 configuration and supported site matches.
- `content.js`: detects model code blocks, injects single/batch controls, previews overwrite conflicts, and renders in-page feedback.
- `background.js`: owns File System Access handles, validates message origin and paths, serializes writes, previews existing files, and records batch history.
- `setup.html` / `setup.js`: independent workspace authorization page. Keep directory picker calls in a user gesture.
- `popup.html` / `popup.js`: workspace health, language selection, prompt copy, and history.
- `tests/background-path-validation.test.js`: Node built-in regression tests for background pure helpers.

## Safety Invariants

- Only allow relative paths; reject absolute paths, drive prefixes, empty segments, `.`/`..`, and control characters.
- Only accepted content-script origins may request preview/write operations.
- Write operations must remain serialized through `enqueueWrite`.
- Existing files require an in-page preview and explicit confirmation. New files save directly.
- Render paths and history with `textContent`, never untrusted `innerHTML`.
- Preserve the 200KB preview cap and the 100-files-per-sync cap unless requirements change.

## Working Rules

- Prefer minimal patches and retain the current plain JavaScript style.
- Do not change "direct save overwrites after confirmation" into a different workflow without approval.
- When changing supported sites, update both `manifest.json` and `SUPPORTED_ORIGINS` in `background.js`, then add a regression case.
- Keep UI strings in both `zh` and `en` dictionaries.
- Treat DOM selectors as adapters: test every newly supported site in a real logged-in browser session before declaring its injection behavior verified.

## Verification

Run after JavaScript or manifest changes:

```powershell
node --test tests/background-path-validation.test.js
node --check background.js
node --check content.js
node --check popup.js
node --check setup.js
```

Reload the extension at `chrome://extensions`, then refresh the target AI page. Test directory authorization, a new-file save, an overwrite cancellation, overwrite confirmation, and a permission-expiry recovery.
