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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
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
    writable = await fileHandle.createWritable({ keepExistingData: false });
    await writable.write(content);
    await writable.close();
  } catch (err) {
    if (writable) {
      await writable.abort().catch(() => {});
    }
    throw err;
  }
}

async function writeContentToDisk(rootHandle, relativePath, content) {
  const parts = validateRelativePath(relativePath);
  const fileName = parts.pop();
  let currentDir = rootHandle;

  for (const dirName of parts) {
    currentDir = await currentDir.getDirectoryHandle(dirName, { create: true });
  }

  // 安全写入：解决 Windows 静态服务器可能存在的文件句柄短暂独占
  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
  
  try {
    await writeFileContent(fileHandle, content);
  } catch (err) {
    await new Promise(r => setTimeout(r, 100));
    await writeFileContent(fileHandle, content);
  }
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

  const rootHandle = await getDirHandle();
  const writtenPaths = [];
  const failedFiles = [];

  for (const file of files) {
    try {
      await writeContentToDisk(rootHandle, file.path, file.content);
      writtenPaths.push(file.path);
    } catch (err) {
      failedFiles.push({ path: file.path, error: err.name || 'WRITE_ERROR' });
    }
  }

  await recordSyncHistory(writtenPaths, failedFiles);
  return {
    success: failedFiles.length === 0,
    count: writtenPaths.length,
    writtenPaths,
    failedFiles,
    error: failedFiles.length > 0 ? (writtenPaths.length > 0 ? 'PARTIAL_WRITE' : 'WRITE_ERROR') : null
  };
}

async function previewFiles(files) {
  const workspaceStatus = await getWorkspaceStatus();
  if (workspaceStatus.state !== 'GRANTED') {
    return { success: false, error: workspaceStatus.state };
  }

  const rootHandle = await getDirHandle();
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
