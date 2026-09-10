const DB_NAME = 'SyncPilotNativeDB';
const STORE_NAME = 'handles';
const SUPPORTED_ORIGINS = new Set([
  'https://gemini.google.com',
  'https://chatgpt.com',
  'https://claude.ai',
  'https://chat.deepseek.com',
  'https://kimi.ai',
  'https://www.kimi.ai',
  'https://qwen.ai',
  'https://chat.qwen.ai',
  'https://doubao.com',
  'https://www.doubao.com',
  'https://grok.com'
]);
const MAX_FILES_PER_SYNC = 100;
const MAX_DIFF_BYTES = 200000;

let writeQueue = Promise.resolve();

function getDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getDirHandle() {
  const db = await getDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get('workdir');
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); resolve(null); };
  });
}

async function getWorkspaceStatus() {
  const rootHandle = await getDirHandle();
  if (!rootHandle) {
    return { state: 'NO_HANDLE' };
  }

  try {
    const permission = await rootHandle.queryPermission({ mode: 'readwrite' });
    return { state: permission === 'granted' ? 'GRANTED' : 'NEED_AUTH', name: rootHandle.name };
  } catch (err) {
    return { state: 'NEED_AUTH', name: rootHandle.name };
  }
}

function isSupportedContentScript(sender) {
  try {
    return SUPPORTED_ORIGINS.has(new URL(sender.tab?.url).origin);
  } catch (_) {
    return false;
  }
}

function enqueueWrite(operation) {
  const queuedOperation = writeQueue.then(operation, operation);
  writeQueue = queuedOperation.catch(() => {});
  return queuedOperation;
}

function validateRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new TypeError('INVALID_PATH');
  }

  if (Array.from(relativePath).some(char => char.charCodeAt(0) < 32)) {
    throw new TypeError('INVALID_PATH');
  }

  const normalizedPath = relativePath.replaceAll('\\', '/');
  const parts = normalizedPath.split('/');
  const firstCharCode = normalizedPath.charCodeAt(0);
  const hasDrivePrefix = normalizedPath.length > 1 &&
    normalizedPath[1] === ':' &&
    ((firstCharCode >= 65 && firstCharCode <= 90) || (firstCharCode >= 97 && firstCharCode <= 122));

  if (
    normalizedPath.startsWith('/') ||
    hasDrivePrefix ||
    parts.some(part => !part || part === '.' || part === '..')
  ) {
    throw new TypeError('INVALID_PATH');
  }

  return parts;
}

async function writeFileContent(fileHandle, content) {
  let writable = null;
  try {
    writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  } catch (err) {
    if (writable) {
      await writable.abort().catch(() => {});
    }
    throw err;
  }
}

function isTransientWriteError(err) {
  return ['InvalidStateError', 'NoModificationAllowedError', 'OperationError', 'AbortError'].includes(err?.name);
}

async function writeContentToDisk(relativePath, content) {
  const parts = validateRelativePath(relativePath);
  const fileName = parts.pop();
  let lastError;

  // Reacquire handles for each retry. A FileSystemFileHandle can become stale
  // after an external editor replaces the file or a previous writable closes.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const freshRootHandle = await getDirHandle();
      if (!freshRootHandle) {
        const missingHandleError = new DOMException('Workspace handle is unavailable', 'NotAllowedError');
        throw missingHandleError;
      }
      let currentDir = freshRootHandle;
      for (const dirName of parts) {
        currentDir = await currentDir.getDirectoryHandle(dirName, { create: true });
      }

      try {
        const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
        await writeFileContent(fileHandle, content);
        return;
      } catch (err) {
        // If direct overwrite fails with InvalidStateError or transient error,
        // it means Chromium's cached handle state or Windows swap-rename conflict
        // occurred on the existing file. Remove the old entry first, then recreate
        // a clean file to allow atomic swap commit without collision.
        if (isTransientWriteError(err) || err?.name === 'InvalidStateError') {
          try {
            await currentDir.removeEntry(fileName);
          } catch (_) {
            // Ignore if file couldn't be removed or didn't exist
          }
          const freshFileHandle = await currentDir.getFileHandle(fileName, { create: true });
          await writeFileContent(freshFileHandle, content);
          return;
        }
        throw err;
      }
    } catch (err) {
      lastError = err;
      if (!isTransientWriteError(err) || attempt === 4) throw err;
      await new Promise(resolve => setTimeout(resolve, 200 * (2 ** attempt)));
    }
  }

  throw lastError;
}

async function getFilePreview(rootHandle, relativePath, content) {
  const parts = validateRelativePath(relativePath);
  const fileName = parts.pop();
  let currentDir = rootHandle;

  try {
    for (const dirName of parts) {
      currentDir = await currentDir.getDirectoryHandle(dirName);
    }

    const fileHandle = await currentDir.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    return {
      path: relativePath,
      exists: true,
      oldContent: file.size <= MAX_DIFF_BYTES ? await file.text() : '',
      newContent: content.length <= MAX_DIFF_BYTES ? content : content.slice(0, MAX_DIFF_BYTES),
      truncated: file.size > MAX_DIFF_BYTES || content.length > MAX_DIFF_BYTES
    };
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return { path: relativePath, exists: false };
    }
    throw err;
  }
}

async function recordSyncHistory(writtenPaths, failedFiles) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['syncHistory'], (res) => {
      let history = res.syncHistory || [];
      const now = new Date();
      const batchId = crypto.randomUUID();
      const timeStr = [
        now.getFullYear(),
        (now.getMonth() + 1).toString().padStart(2, '0'),
        now.getDate().toString().padStart(2, '0')
      ].join('-') + ` ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

      history.unshift({
        batchId,
        time: timeStr,
        writtenPaths,
        failedFiles
      });

      history = history.slice(0, 30);
      chrome.storage.local.set({ syncHistory: history }, () => resolve());
    });
  });
}

async function writeFiles(files) {
  const workspaceStatus = await getWorkspaceStatus();
  if (workspaceStatus.state !== 'GRANTED') {
    return { success: false, error: workspaceStatus.state };
  }

  const writtenPaths = [];
  const failedFiles = [];

  for (const file of files) {
    try {
      await writeContentToDisk(file.path, file.content);
      writtenPaths.push(file.path);
    } catch (err) {
      const error = err?.name || 'WRITE_ERROR';
      failedFiles.push({
        path: file.path,
        error,
        message: typeof err?.message === 'string' ? err.message : ''
      });
    }
  }

  await recordSyncHistory(writtenPaths, failedFiles);
  const permissionFailure = failedFiles.length > 0 &&
    failedFiles.every(file => file.error === 'NotAllowedError' || file.error === 'SecurityError');
  // When every file fails with InvalidStateError the workspace handle has
  // become permanently stale (Chrome FSAA internal state mismatch). Re-
  // authorizing the same directory issues a fresh handle and breaks the cycle.
  const staleHandle = failedFiles.length > 0 &&
    writtenPaths.length === 0 &&
    failedFiles.every(file => file.error === 'InvalidStateError');
  return {
    success: failedFiles.length === 0,
    count: writtenPaths.length,
    writtenPaths,
    failedFiles,
    error: failedFiles.length > 0
      ? (permissionFailure || staleHandle)
        ? 'NEED_AUTH'
        : (writtenPaths.length > 0 ? 'PARTIAL_WRITE' : 'WRITE_ERROR')
      : null
  };
}

async function previewFiles(files) {
  const workspaceStatus = await getWorkspaceStatus();
  if (workspaceStatus.state !== 'GRANTED') {
    return { success: false, error: workspaceStatus.state };
  }

  const rootHandle = await getDirHandle();
  if (!rootHandle) {
    return { success: false, error: 'NEED_AUTH' };
  }
  return { success: true, files: await Promise.all(files.map(file => getFilePreview(rootHandle, file.path, file.content))) };
}

function validateWriteRequest(request, sender) {
  if (!isSupportedContentScript(sender)) return 'INVALID_SENDER';
  if (!Array.isArray(request.files) || request.files.length === 0) return 'INVALID_FILES';
  if (request.files.length > MAX_FILES_PER_SYNC) return 'TOO_MANY_FILES';

  for (const file of request.files) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') return 'INVALID_FILES';
    validateRelativePath(file.path);
  }

  return null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_WORKSPACE_STATUS') {
    getWorkspaceStatus()
      .then(status => sendResponse({ success: true, ...status }))
      .catch(() => sendResponse({ success: false, state: 'NO_HANDLE' }));
    return true;
  }

  if (request.action === 'OPEN_WORKSPACE_SETUP') {
    chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'WRITE_FILES') {
    (async () => {
      try {
        const error = validateWriteRequest(request, sender);
        if (error) {
          sendResponse({ success: false, error });
          return;
        }

        sendResponse(await enqueueWrite(() => writeFiles(request.files)));
      } catch (err) {
        console.error('[SyncPilot] Disk write error:', err);
        sendResponse({ success: false, error: err.name || err.message });
      }
    })();
    return true;
  }

  if (request.action === 'PREVIEW_FILES') {
    (async () => {
      try {
        const error = validateWriteRequest(request, sender);
        if (error) {
          sendResponse({ success: false, error });
          return;
        }

        sendResponse(await enqueueWrite(() => previewFiles(request.files)));
      } catch (err) {
        sendResponse({ success: false, error: err.name || err.message });
      }
    })();
    return true;
  }
});
