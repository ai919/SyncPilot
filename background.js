// filepath: background.js
const DB_NAME = 'SyncPilotNativeDB';
const STORE_NAME = 'handles';

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

async function writeContentToDisk(rootHandle, relativePath, content) {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const fileName = parts.pop();
  let currentDir = rootHandle;

  for (const dirName of parts) {
    currentDir = await currentDir.getDirectoryHandle(dirName, { create: true });
  }

  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function recordSyncHistory(filePaths) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['syncHistory'], (res) => {
      let history = res.syncHistory || [];
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

      filePaths.forEach(fp => {
        history.unshift({ path: fp, time: timeStr });
      });

      history = history.slice(0, 30);
      chrome.storage.local.set({ syncHistory: history }, () => resolve());
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'WRITE_FILES') {
    (async () => {
      try {
        const rootHandle = await getDirHandle();
        if (!rootHandle) {
          sendResponse({ success: false, error: 'NO_HANDLE' });
          return;
        }

        const perm = await rootHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          sendResponse({ success: false, error: 'NEED_AUTH' });
          return;
        }

        const writtenPaths = [];
        for (const file of request.files) {
          await writeContentToDisk(rootHandle, file.path, file.content);
          writtenPaths.push(file.path);
        }

        await recordSyncHistory(writtenPaths);
        sendResponse({ success: true, count: request.files.length });
      } catch (err) {
        console.error('[SyncPilot] Disk write error:', err);
        sendResponse({ success: false, error: err.message || 'WRITE_ERROR' });
      }
    })();
    return true; // 保持异步通信通道开启
  }
});