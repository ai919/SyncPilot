const DB_NAME = 'SyncPilotNativeDB';
const STORE_NAME = 'handles';

const I18N = {
  zh: {
    title: 'SyncPilot 本地直存',
    badge: '纯前端模式',
    noFolder: '未绑定目标文件夹',
    boundPrefix: '已绑定: ',
    btnPick: '📂 选择并授权工作区目录',
    btnCopyPrompt: '📋 复制 AI 输出规范提示词',
    btnPromptCopied: '✅ 规范提示词已复制！',
    historyTitle: '最近文件同步记录',
    clearHistory: '清空记录',
    emptyHistory: '暂无同步记录',
    langNext: 'EN',
    prompt: `在后续生成代码时，请严格遵循以下规则：
1. 每一个独立文件的代码块，第一行必须使用单行注释标明相对于项目根目录的完整路径：
   // filepath: path/to/filename.ext
2. 即使是 HTML、CSS、JSON 或其他语言，首行也必须统一使用 "// filepath: ..." 作为唯一标识。
3. 请提供完整的生产级可用代码，不要省略或截断。`
  },
  en: {
    title: 'SyncPilot Native Sync',
    badge: 'Client-Only',
    noFolder: 'No workspace linked',
    boundPrefix: 'Bound: ',
    btnPick: '📂 Select & Authorize Workspace',
    btnCopyPrompt: '📋 Copy AI Spec Prompt',
    btnPromptCopied: '✅ Spec Prompt Copied!',
    historyTitle: 'Recent Sync History',
    clearHistory: 'Clear Records',
    emptyHistory: 'No sync records yet',
    langNext: '中',
    prompt: `When generating code, please strictly follow these rules:
1. For every individual file code block, the very first line MUST be a single-line comment stating the relative path from the project root:
   // filepath: path/to/filename.ext
2. Even for languages like HTML, CSS, or JSON, you MUST use "// filepath: ..." as the exact prefix on the first line.
3. Provide complete, production-ready code without placeholders or truncations.`
  }
};

let currentLang = 'zh';
let currentBoundDirName = null;

function renderUI() {
  const dict = I18N[currentLang];
  document.getElementById('txtTitle').innerText = dict.title;
  document.getElementById('txtBadge').innerText = dict.badge;
  document.getElementById('langToggleBtn').innerText = dict.langNext;
  document.getElementById('pickBtn').innerText = dict.btnPick;
  document.getElementById('copyPromptBtn').innerText = dict.btnCopyPrompt;
  document.getElementById('txtHistoryTitle').innerText = dict.historyTitle;
  document.getElementById('clearHistoryBtn').innerText = dict.clearHistory;

  const folderLabel = document.getElementById('folderLabel');
  if (currentBoundDirName) {
    folderLabel.innerHTML = `${dict.boundPrefix}<strong class="folder-name">${currentBoundDirName}</strong>`;
  } else {
    folderLabel.innerText = dict.noFolder;
  }
}

function renderHistory() {
  const listEl = document.getElementById('historyList');
  try {
    chrome.storage.local.get(['syncHistory'], (res) => {
      const history = (res && res.syncHistory) || [];
      if (history.length === 0) {
        listEl.innerHTML = `<div class="empty-state">${I18N[currentLang].emptyHistory}</div>`;
        return;
      }
      listEl.innerHTML = history.map(item => `
        <div class="history-item">
          <span class="history-path" title="${item.path}">${item.path}</span>
          <span class="history-time">${item.time}</span>
        </div>
      `).join('');
    });
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state">${I18N[currentLang].emptyHistory}</div>`;
  }
}

function getDirHandle() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(STORE_NAME, 'readonly');
        const getReq = tx.objectStore(STORE_NAME).get('workdir');
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

// 确保 DOM 准备完毕立即同步挂载事件，绝不阻塞在 await 之后
document.addEventListener('DOMContentLoaded', () => {
  const langBtn = document.getElementById('langToggleBtn');
  const pickBtn = document.getElementById('pickBtn');
  const copyBtn = document.getElementById('copyPromptBtn');
  const clearBtn = document.getElementById('clearHistoryBtn');
  const statusEl = document.getElementById('status');

  // 1. 语言切换按钮
  langBtn.onclick = (e) => {
    e.preventDefault();
    currentLang = currentLang === 'zh' ? 'en' : 'zh';
    renderUI();
    renderHistory();
    try {
      chrome.storage.local.set({ syncLang: currentLang });
    } catch (_) {}
  };

  // 2. 选择目录按钮（打开独立 setup.html）
  pickBtn.onclick = (e) => {
    e.preventDefault();
    const setupUrl = chrome.runtime.getURL('setup.html');
    chrome.tabs.create({ url: setupUrl });
  };

  // 3. 复制规范提示词
  copyBtn.onclick = async (e) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(I18N[currentLang].prompt);
      copyBtn.innerText = I18N[currentLang].btnPromptCopied;
      copyBtn.style.background = '#16a34a';
      copyBtn.style.color = '#ffffff';

      setTimeout(() => {
        copyBtn.innerText = I18N[currentLang].btnCopyPrompt;
        copyBtn.style.background = '#1e293b';
        copyBtn.style.color = '#cbd5e1';
      }, 2000);
    } catch (err) {
      statusEl.innerText = '❌ Copy Failed';
    }
  };

  // 4. 清空记录
  clearBtn.onclick = (e) => {
    e.preventDefault();
    try {
      chrome.storage.local.set({ syncHistory: [] }, () => {
        renderHistory();
      });
    } catch (_) {}
  };

  // 5. 异步恢复语言偏好与工作区信息（即使失败也不影响上述事件点击）
  try {
    chrome.storage.local.get(['syncLang'], (res) => {
      if (res && res.syncLang) {
        currentLang = res.syncLang;
      } else if (navigator.language.toLowerCase().startsWith('en')) {
        currentLang = 'en';
      }
      renderUI();
      renderHistory();
    });
  } catch (_) {
    renderUI();
    renderHistory();
  }

  getDirHandle().then((handle) => {
    if (handle && handle.name) {
      currentBoundDirName = handle.name;
      renderUI();
    }
  });
});