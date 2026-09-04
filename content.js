
(() => {
  let currentLang = 'zh';

  const I18N = {
    zh: {
      btnBatchFilesReady: '个待落盘',
      btnBatchSave: '⚡ 本地直存本轮文件',
      btnBatchSaving: '⏳ 正在落盘',
      btnBatchSaved: '🎉 全部',
      btnBatchSavedSuffix: '个文件已写入硬盘！',
      btnDirectSync: '⚡ 直传',
      btnDirectSaved: '已直接写入',
      btnDirectSaving: '落盘中...',
      errNoHandle: '请先授权',
      errWriteFailed: '写入失败',
      reloadTip: '检测到插件重新加载，请按 F5 刷新当前网页以连接最新插件！',
      timeoutTip: '重新授权'
    },
    en: {
      btnBatchFilesReady: 'file(s) ready',
      btnBatchSave: '⚡ Direct Save Turn Files',
      btnBatchSaving: '⏳ Saving',
      btnBatchSaved: '🎉 All',
      btnBatchSavedSuffix: 'files written to disk!',
      btnDirectSync: '⚡ Sync',
      btnDirectSaved: 'Saved to Disk',
      btnDirectSaving: 'Saving...',
      errNoHandle: 'Authorize first',
      errWriteFailed: 'Write failed',
      reloadTip: 'Extension updated. Please press F5 to refresh page!',
      timeoutTip: 'Re-authorize'
    }
  };

  chrome.storage.local.get(['syncLang'], (res) => {
    if (res.syncLang) currentLang = res.syncLang;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.syncLang) {
      currentLang = changes.syncLang.newValue;
      updateBatchBarState();
    }
  });

  // 核心清洁工具：提取代码文本并彻底排除所有插入的 UI 按钮与首行 filepath
  function extractCleanCode(block) {
    // 克隆节点避免修改界面，并移除内部所有插件注入的元素
    const clone = block.cloneNode(true);
    clone.querySelectorAll('.syncpilot-btn, #syncpilot-batch-bar').forEach(el => el.remove());

    // 优先取内部 code 标签文本，否则取容器纯文本
    const targetEl = clone.querySelector('code') || clone;
    let text = targetEl.innerText || targetEl.textContent || '';

    // 严密剔除首行 // filepath: ... 及前后的多余换行符
    text = text.replace(/^\s*\/\/\s*filepath:[^\r\n]*[\r\n]*/i, '');
    return text;
  }

  // 提取文件路径
  function extractFilepath(block) {
    const rawText = block.innerText || block.textContent || '';
    const match = rawText.match(/\/\/\s*filepath:\s*([^\r\n]+)/i);
    return match ? match[1].trim() : null;
  }

  let batchBar = null;

  function createBatchBar() {
    if (batchBar) return;
    batchBar = document.createElement('div');
    batchBar.id = 'syncpilot-batch-bar';
    batchBar.style.cssText = [
      'position: fixed',
      'bottom: 24px',
      'right: 28px',
      'z-index: 999999',
      'display: none',
      'align-items: center',
      'gap: 12px',
      'padding: 8px 16px',
      'background: #1e293b',
      'border: 1px solid #38bdf8',
      'border-radius: 30px',
      'box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 12px rgba(56, 189, 248, 0.3)',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'font-size: 13px',
      'color: #f8fafc',
      'transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
    ].join(';');

    batchBar.innerHTML = `
      <span id="syncpilot-batch-count" style="color: #38bdf8; font-weight: bold;">0 ${I18N[currentLang].btnBatchFilesReady}</span>
      <button id="syncpilot-batch-btn" style="
        background: #2563eb;
        color: #fff;
        border: none;
        padding: 6px 14px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: background 0.2s;
      ">${I18N[currentLang].btnBatchSave}</button>
    `;

    document.body.appendChild(batchBar);

    const btn = batchBar.querySelector('#syncpilot-batch-btn');
    btn.onmouseenter = () => btn.style.background = '#1d4ed8';
    btn.onmouseleave = () => btn.style.background = '#2563eb';
    btn.onclick = handleBatchSync;
  }

  function getLatestTurnCodeBlocks() {
    const turnSelectors = [
      'message-content', 
      '[data-message-author-role="model"]', 
      '[data-message-author-role="assistant"]',
      '.model-response-text',
      '.response-container',
      'article'
    ];

    let latestTurn = null;
    for (const sel of turnSelectors) {
      const turns = document.querySelectorAll(sel);
      if (turns.length > 0) {
        latestTurn = turns[turns.length - 1];
        break;
      }
    }

    const searchRoot = latestTurn || document.body;
    const allBlocks = searchRoot.querySelectorAll('code-block, pre, .code-block, [class*="code-block"]');
    const fileMap = new Map();

    allBlocks.forEach(block => {
      if (block.parentElement && block.parentElement.closest('code-block, pre, .code-block')) return;

      const filepath = extractFilepath(block);
      if (!filepath) return;

      const cleanCode = extractCleanCode(block);
      const triggerBtn = block.querySelector('.syncpilot-btn');

      fileMap.set(filepath, { filepath, cleanCode, triggerBtn });
    });

    return Array.from(fileMap.values());
  }

  async function handleBatchSync() {
    const dict = I18N[currentLang];
    const btn = batchBar.querySelector('#syncpilot-batch-btn');
    const blocks = getLatestTurnCodeBlocks();
    if (blocks.length === 0) return;

    if (!chrome?.runtime?.sendMessage) {
      alert(dict.reloadTip);
      return;
    }

    btn.disabled = true;
    btn.innerText = `${dict.btnBatchSaving} ${blocks.length}...`;

    const files = blocks.map(b => ({ path: b.filepath, content: b.cleanCode }));

    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        btn.disabled = false;
        btn.innerText = `❌ ${dict.timeoutTip}`;
        btn.style.background = '#dc2626';
      }
    }, 8000);

    chrome.runtime.sendMessage({ action: 'WRITE_FILES', files }, (res) => {
      finished = true;
      clearTimeout(timer);

      if (res && res.success) {
        btn.innerText = `${dict.btnBatchSaved} ${blocks.length} ${dict.btnBatchSavedSuffix}`;
        btn.style.background = '#16a34a';

        blocks.forEach(b => {
          if (b.triggerBtn) {
            b.triggerBtn.innerHTML = `✅ <span>${dict.btnDirectSaved}</span>`;
            b.triggerBtn.style.background = '#16a34a';
          }
        });
      } else {
        const msg = (res && (res.error === 'NO_HANDLE' || res.error === 'NEED_AUTH')) ? `❌ ${dict.errNoHandle}` : `❌ ${dict.errWriteFailed}`;
        btn.innerText = msg;
        btn.style.background = '#dc2626';
      }

      setTimeout(() => {
        btn.disabled = false;
        btn.innerText = dict.btnBatchSave;
        btn.style.background = '#2563eb';
        updateBatchBarState();
      }, 2500);
    });
  }

  function updateBatchBarState() {
    createBatchBar();
    const dict = I18N[currentLang];
    const blocks = getLatestTurnCodeBlocks();
    const countEl = batchBar.querySelector('#syncpilot-batch-count');
    const btn = batchBar.querySelector('#syncpilot-batch-btn');

    btn.innerText = dict.btnBatchSave;

    if (blocks.length > 0) {
      batchBar.style.display = 'flex';
      countEl.innerText = `${blocks.length} ${dict.btnBatchFilesReady}`;
    } else {
      batchBar.style.display = 'none';
    }
  }

  function injectSyncButtons() {
    const dict = I18N[currentLang];
    const codeElements = document.querySelectorAll('code-block, pre, .code-block, [class*="code-block"]');

    codeElements.forEach(block => {
      if (block.parentElement && block.parentElement.closest('code-block, pre, .code-block')) return;
      if (block.dataset.syncPilotInjected || block.querySelector('.syncpilot-btn')) return;

      const filepath = extractFilepath(block);
      if (!filepath) return;

      block.dataset.syncPilotInjected = 'true';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'syncpilot-btn';
      btn.innerHTML = `⚡ <span>${dict.btnDirectSync} ${filepath}</span>`;
      btn.style.cssText = [
        'position: absolute',
        'top: 8px',
        'right: 80px',
        'z-index: 99999',
        'padding: 4px 10px',
        'font-size: 12px',
        'font-weight: 600',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        'color: #ffffff',
        'background: #2563eb',
        'border: 1px solid rgba(255, 255, 255, 0.2)',
        'border-radius: 6px',
        'cursor: pointer',
        'box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3)',
        'transition: all 0.2s ease',
        'line-height: normal'
      ].join(';');

      btn.onclick = async (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (!chrome?.runtime?.sendMessage) {
          alert(dict.reloadTip);
          return;
        }

        // 提取绝对纯净的代码文本，已排除按钮文字与 filepath 行
        const cleanCode = extractCleanCode(block);

        btn.disabled = true;
        btn.innerHTML = `⏳ <span>${dict.btnDirectSaving}</span>`;
        btn.style.background = '#64748b';

        let finished = false;
        const timer = setTimeout(() => {
          if (!finished) {
            btn.disabled = false;
            btn.innerHTML = `❌ <span>${dict.timeoutTip}</span>`;
            btn.style.background = '#dc2626';
          }
        }, 8000);

        chrome.runtime.sendMessage({
          action: 'WRITE_FILES',
          files: [{ path: filepath, content: cleanCode }]
        }, (res) => {
          finished = true;
          clearTimeout(timer);

          if (res && res.success) {
            btn.innerHTML = `✅ <span>${dict.btnDirectSaved}</span>`;
            btn.style.background = '#16a34a';
          } else {
            const errLabel = (res && (res.error === 'NO_HANDLE' || res.error === 'NEED_AUTH')) ? dict.errNoHandle : dict.errWriteFailed;
            btn.innerHTML = `❌ <span>${errLabel}</span>`;
            btn.style.background = '#dc2626';
          }

          setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = `⚡ <span>${dict.btnDirectSync} ${filepath}</span>`;
            btn.style.background = '#2563eb';
          }, 2500);
        });
      };

      const computedPos = window.getComputedStyle(block).position;
      if (computedPos === 'static') {
        block.style.position = 'relative';
      }

      const header = block.querySelector('.header, [class*="header"], [class*="toolbar"]');
      if (header) {
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        btn.style.position = 'static';
        btn.style.marginRight = '8px';
        header.insertBefore(btn, header.firstChild);
      } else {
        block.appendChild(btn);
      }
    });

    updateBatchBarState();
  }

  injectSyncButtons();
  setInterval(injectSyncButtons, 800);
})();