const DB_NAME = 'SyncPilotNativeDB';
const STORE_NAME = 'handles';

const isEn = (chrome.i18n.getUILanguage() || '').toLowerCase().startsWith('en');

function t(key, defaultVal) {
  return chrome.i18n.getMessage(key) || defaultVal;
}

function getDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function setDirHandle(handle) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, 'workdir');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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

document.addEventListener('DOMContentLoaded', async () => {
  const display = document.getElementById('folderDisplay');
  const btn = document.getElementById('authBtn');
  const msg = document.getElementById('msg');

  if (isEn) {
    document.getElementById('tTitle').innerText = '⚡ SyncPilot Workspace Authorization';
    document.getElementById('tDesc').innerText = 'Please select your local workspace folder and grant write permissions in this independent tab.';
    btn.innerText = '📂 Select Local Folder & Authorize';
  }

  if (typeof window.showDirectoryPicker !== 'function') {
    btn.disabled = true;
    msg.style.color = '#ef4444';
    msg.innerText = isEn
      ? '❌ This browser does not support local workspace authorization. Please use a current version of Chrome or Edge.'
      : '❌ 当前浏览器不支持本地工作区授权，请使用最新版 Chrome 或 Edge。';
    return;
  }

  const currentHandle = await getDirHandle();
  if (currentHandle) {
    display.innerText = (isEn ? '📁 Currently Bound: ' : '📁 当前已绑定: ') + currentHandle.name;
  }

  btn.onclick = async () => {
    btn.disabled = true;
    msg.style.color = '#38bdf8';
    msg.innerText = isEn ? 'Opening file dialog...' : '正在唤起文件夹选择窗口...';

    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const perm = await dirHandle.requestPermission({ mode: 'readwrite' });

      if (perm !== 'granted') {
        msg.style.color = '#ef4444';
        msg.innerText = isEn ? '❌ Write permission was not granted' : '❌ 未授予读写权限，无法自动落盘';
        btn.disabled = false;
        return;
      }

      await setDirHandle(dirHandle);
      display.innerText = (isEn ? '📁 Bound: ' : '📁 已绑定: ') + dirHandle.name;
      msg.style.color = '#4ade80';
      msg.innerText = isEn ? '🎉 Authorized successfully! You can close this tab now.' : '🎉 授权成功！您可以直接关闭当前页面回到 Gemini。';

      setTimeout(() => {
        window.close();
      }, 2500);
    } catch (err) {
      btn.disabled = false;
      if (err.name !== 'AbortError') {
        msg.style.color = '#ef4444';
        msg.innerText = (isEn ? '❌ Authorization Error: ' : '❌ 授权异常: ') + err.message;
      } else {
        msg.innerText = '';
      }
    }
  };
});
