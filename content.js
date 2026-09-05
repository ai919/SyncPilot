
(() => {
  let currentLang = 'zh';

  const I18N = {
    zh: {
      btnBatchFilesReady: '个待落盘',
      btnBatchSave: '⚡ 本地直存本轮文件',
      btnBatchSaving: '⏳ 正在落盘',
      btnCheckingFiles: '⏳ 检查本地文件',
      btnBatchSaved: '🎉 全部',
      btnBatchSavedSuffix: '个文件已写入硬盘！',
      btnDirectSync: '⚡ 直传',
      btnDirectSaved: '已直接写入',
      btnDirectSaving: '落盘中...',
      errNoHandle: '请先授权',
      errWriteFailed: '写入失败',
      errInvalidInput: '文件路径无效',
      errTooManyFiles: '文件数量过多',
      reauthorize: '重新绑定目录',
      refreshPage: '刷新页面',
      overwriteTitle: '发现本地同名文件',
      overwriteDesc: '请确认以下文件覆盖后再写入。',
      overwriteConfirm: '确认覆盖并写入',
      overwriteCancel: '取消',
      oldContent: '本地文件',
      newContent: '即将写入',
      truncatedDiff: '内容超过 200KB，未加载完整差异预览。',
      errPartialWrite: '{written} 个文件已写入，{failed} 个失败',
      historyWritten: '已写入',
      historyFailed: '失败',
      reloadTip: '检测到插件重新加载，请按 F5 刷新当前网页以连接最新插件！',
      timeoutTip: '重新授权'
    },
    en: {
      btnBatchFilesReady: 'file(s) ready',
      btnBatchSave: '⚡ Direct Save Turn Files',
      btnBatchSaving: '⏳ Saving',
      btnCheckingFiles: '⏳ Checking local files',
      btnBatchSaved: '🎉 All',
      btnBatchSavedSuffix: 'files written to disk!',
      btnDirectSync: '⚡ Sync',
      btnDirectSaved: 'Saved to Disk',
      btnDirectSaving: 'Saving...',
      errNoHandle: 'Authorize first',
      errWriteFailed: 'Write failed',
      errInvalidInput: 'Invalid file path',
      errTooManyFiles: 'Too many files',
      reauthorize: 'Rebind workspace',
      refreshPage: 'Refresh page',
      overwriteTitle: 'Existing local files found',
      overwriteDesc: 'Confirm the following overwrites before saving.',
      overwriteConfirm: 'Confirm overwrite and save',
      overwriteCancel: 'Cancel',
      oldContent: 'Local file',
      newContent: 'New content',
      truncatedDiff: 'The content exceeds 200KB, so a full diff preview is unavailable.',
      errPartialWrite: '{written} file(s) written, {failed} failed',
      historyWritten: 'Written',
      historyFailed: 'Failed',
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

  function isModelOutput(block) {
    const authoredMessage = block.closest('[data-message-author-role]');
    if (!authoredMessage) return true;

    const authorRole = authoredMessage.getAttribute('data-message-author-role');
    return authorRole === 'model' || authorRole === 'assistant';
  }

  let batchBar = null;
  let batchFailure = null;

  function getBatchSignature(blocks) {
    return blocks.map(block => `${block.filepath}\u0000${block.cleanCode}`).join('\u0001');
  }

  function openWorkspaceSetup() {
    chrome.runtime.sendMessage({ action: 'OPEN_WORKSPACE_SETUP' });
  }

  function isAuthorizationError(error) {
    return error === 'NO_HANDLE' || error === 'NEED_AUTH' || error === 'TIMEOUT';
  }

  function isExtensionUnavailableError(error) {
    return error === 'EXTENSION_UNAVAILABLE';
  }

  function getWriteErrorLabel(dict, error) {
    if (error === 'INVALID_PATH' || error === 'INVALID_FILES') return dict.errInvalidInput;
    if (error === 'TOO_MANY_FILES') return dict.errTooManyFiles;
    return dict.errWriteFailed;
  }

  function formatPartialWrite(dict, writtenCount, failedCount) {
    return dict.errPartialWrite
      .replace('{written}', writtenCount)
      .replace('{failed}', failedCount);
  }

  function setButtonText(button, icon, label) {
    button.textContent = `${icon} ${label}`;
  }

  function sendMessage(request) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(request, response => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: 'EXTENSION_UNAVAILABLE' });
          return;
        }
        resolve(response || { success: false, error: 'WRITE_ERROR' });
      });
    });
  }

  function showOverwriteDialog(conflicts, dict) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:1000000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(2,6,23,.72);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
      const dialog = document.createElement('div');
      dialog.style.cssText = 'width:min(920px,100%);max-height:calc(100vh - 48px);overflow:auto;background:#0f172a;border:1px solid #475569;border-radius:8px;color:#f8fafc;box-shadow:0 20px 50px rgba(0,0,0,.55);padding:20px;';
      const title = document.createElement('h2');
      title.textContent = dict.overwriteTitle;
      title.style.cssText = 'margin:0 0 8px;font-size:18px;';
      const description = document.createElement('p');
      description.textContent = dict.overwriteDesc;
      description.style.cssText = 'margin:0 0 16px;color:#cbd5e1;font-size:13px;';
      dialog.append(title, description);

      conflicts.forEach(file => {
        const details = document.createElement('details');
        details.open = conflicts.length === 1;
        details.style.cssText = 'margin:8px 0;border:1px solid #334155;border-radius:6px;padding:8px;';
        const summary = document.createElement('summary');
        summary.textContent = file.path;
        summary.style.cssText = 'cursor:pointer;color:#38bdf8;font-family:monospace;font-size:12px;';
        details.appendChild(summary);
        const diff = document.createElement('div');
        diff.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;';
        [
          [dict.oldContent, file.truncated ? dict.truncatedDiff : file.oldContent],
          [dict.newContent, file.newContent]
        ].forEach(([label, content]) => {
          const section = document.createElement('section');
          const heading = document.createElement('strong');
          heading.textContent = label;
          heading.style.cssText = 'display:block;margin-bottom:5px;font-size:11px;color:#94a3b8;';
          const code = document.createElement('pre');
          code.textContent = content;
          code.style.cssText = 'margin:0;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#020617;border:1px solid #334155;padding:8px;font-size:11px;line-height:1.45;';
          section.append(heading, code);
          diff.appendChild(section);
        });
        details.appendChild(diff);
        dialog.appendChild(details);
      });

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:16px;';
      const cancel = document.createElement('button');
      cancel.textContent = dict.overwriteCancel;
      const confirm = document.createElement('button');
      confirm.textContent = dict.overwriteConfirm;
      [cancel, confirm].forEach(button => button.style.cssText = 'border:0;border-radius:6px;padding:9px 12px;font-size:12px;font-weight:600;cursor:pointer;');
      cancel.style.background = '#334155';
      cancel.style.color = '#f8fafc';
      confirm.style.background = '#dc2626';
      confirm.style.color = '#fff';
      const close = confirmed => {
        overlay.remove();
        resolve(confirmed);
      };
      cancel.onclick = () => close(false);
      confirm.onclick = () => close(true);
      actions.append(cancel, confirm);
      dialog.appendChild(actions);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
    });
  }

  async function confirmFilesBeforeWrite(files, dict) {
    const preview = await sendMessage({ action: 'PREVIEW_FILES', files });
    if (!preview.success) return preview;

    const conflicts = preview.files.filter(file => file.exists);
    if (conflicts.length === 0 || await showOverwriteDialog(conflicts, dict)) {
      return { success: true };
    }
    return { success: false, error: 'CANCELLED' };
  }

  function createBatchBar() {
    if (batchBar && batchBar.isConnected) return;

    batchBar = null;
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
    const codeBlockSelector = 'code-block, pre, .code-block, [class*="code-block"]';
    const allPageBlocks = Array.from(document.querySelectorAll(codeBlockSelector));
    const latestBlock = allPageBlocks.reverse().find(block => {
      if (block.parentElement && block.parentElement.closest(codeBlockSelector)) return false;
      return isModelOutput(block) && Boolean(extractFilepath(block));
    });
    const latestTurn = latestBlock?.closest(turnSelectors.join(','));
    const searchRoot = latestTurn || document.body;
    const allBlocks = searchRoot.querySelectorAll(codeBlockSelector);
    const fileMap = new Map();

    allBlocks.forEach(block => {
      if (block.parentElement && block.parentElement.closest('code-block, pre, .code-block')) return;
      if (!isModelOutput(block)) return;

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
    const signature = getBatchSignature(blocks);

    if (!chrome?.runtime?.sendMessage) {
      alert(dict.reloadTip);
      return;
    }

    btn.disabled = true;
    btn.innerText = `${dict.btnCheckingFiles} ${blocks.length}...`;

    const files = blocks.map(b => ({ path: b.filepath, content: b.cleanCode }));
    const preview = await confirmFilesBeforeWrite(files, dict);
    if (!preview.success) {
      if (preview.error === 'CANCELLED') {
        btn.disabled = false;
        updateBatchBarState();
        return;
      }

      batchFailure = { signature, error: preview.error };
      updateBatchBarState();
      return;
    }

    btn.innerText = `${dict.btnBatchSaving} ${blocks.length}...`;

    let finished = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (!finished) {
        timedOut = true;
        finished = true;
        batchFailure = { signature, error: 'TIMEOUT' };
        updateBatchBarState();
      }
    }, 8000);

    chrome.runtime.sendMessage({ action: 'WRITE_FILES', files }, (res) => {
      if (timedOut) return;

      finished = true;
      clearTimeout(timer);

      if (chrome.runtime.lastError) {
        batchFailure = { signature, error: 'EXTENSION_UNAVAILABLE' };
        updateBatchBarState();
        return;
      }

      if (res && res.success) {
        btn.innerText = `${dict.btnBatchSaved} ${blocks.length} ${dict.btnBatchSavedSuffix}`;
        btn.style.background = '#16a34a';

        blocks.forEach(b => {
          if (b.triggerBtn) {
            setButtonText(b.triggerBtn, '✅', dict.btnDirectSaved);
            b.triggerBtn.style.background = '#16a34a';
          }
        });
      } else {
        batchFailure = {
          signature,
          error: res && res.error,
          writtenCount: (res && res.writtenPaths && res.writtenPaths.length) || 0,
          failedCount: (res && res.failedFiles && res.failedFiles.length) || blocks.length,
          writtenPaths: (res && res.writtenPaths) || [],
          failedFiles: (res && res.failedFiles) || []
        };
        updateBatchBarState();
        return;
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
    const signature = getBatchSignature(blocks);

    if (batchFailure && batchFailure.signature !== signature) {
      batchFailure = null;
    }

    if (blocks.length > 0) {
      batchBar.style.display = 'flex';
      countEl.innerText = `${blocks.length} ${dict.btnBatchFilesReady}`;

      if (batchFailure) {
        const needsAuthorization = isAuthorizationError(batchFailure.error);
        const needsRefresh = isExtensionUnavailableError(batchFailure.error);
        btn.disabled = false;
        btn.innerText = needsAuthorization
          ? `❌ ${dict.reauthorize}`
          : needsRefresh
            ? `❌ ${dict.refreshPage}`
          : batchFailure.error === 'PARTIAL_WRITE'
            ? `❌ ${formatPartialWrite(dict, batchFailure.writtenCount, batchFailure.failedCount)}`
            : `❌ ${getWriteErrorLabel(dict, batchFailure.error)}`;
        btn.style.background = '#dc2626';
        btn.title = batchFailure.error === 'PARTIAL_WRITE'
          ? `${dict.historyWritten}:\n${batchFailure.writtenPaths.join('\n')}\n\n${dict.historyFailed}:\n${batchFailure.failedFiles.map(file => file.path).join('\n')}`
          : '';
        btn.onclick = needsAuthorization
          ? openWorkspaceSetup
          : needsRefresh
            ? () => window.location.reload()
            : null;
      } else {
        btn.disabled = false;
        btn.innerText = dict.btnBatchSave;
        btn.style.background = '#2563eb';
        btn.title = '';
        btn.onclick = handleBatchSync;
      }
    } else {
      batchBar.style.display = 'none';
    }
  }

  function injectSyncButtons() {
    const dict = I18N[currentLang];
    const codeElements = document.querySelectorAll('code-block, pre, .code-block, [class*="code-block"]');

    codeElements.forEach(block => {
      if (block.parentElement && block.parentElement.closest('code-block, pre, .code-block')) return;
      if (!isModelOutput(block)) return;
      if (block.dataset.syncPilotInjected || block.querySelector('.syncpilot-btn')) return;

      const filepath = extractFilepath(block);
      if (!filepath) return;

      block.dataset.syncPilotInjected = 'true';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'syncpilot-btn';
      setButtonText(btn, '⚡', `${dict.btnDirectSync} ${filepath}`);
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

        if (btn.dataset.syncPilotNeedsRefresh === 'true') {
          window.location.reload();
          return;
        }

        if (btn.dataset.syncPilotNeedsAuth === 'true') {
          delete btn.dataset.syncPilotNeedsAuth;
          setButtonText(btn, '⚡', `${dict.btnDirectSync} ${filepath}`);
          btn.style.background = '#2563eb';
          openWorkspaceSetup();
          return;
        }

        if (!chrome?.runtime?.sendMessage) {
          alert(dict.reloadTip);
          return;
        }

        // 提取绝对纯净的代码文本，已排除按钮文字与 filepath 行
        const cleanCode = extractCleanCode(block);

        btn.disabled = true;
        setButtonText(btn, '⏳', dict.btnCheckingFiles);
        btn.style.background = '#64748b';

        const preview = await confirmFilesBeforeWrite([{ path: filepath, content: cleanCode }], dict);
        if (!preview.success) {
          btn.disabled = false;
          if (preview.error === 'CANCELLED') {
            setButtonText(btn, '⚡', `${dict.btnDirectSync} ${filepath}`);
            btn.style.background = '#2563eb';
          } else if (isAuthorizationError(preview.error)) {
            setButtonText(btn, '❌', dict.reauthorize);
            btn.style.background = '#dc2626';
            btn.dataset.syncPilotNeedsAuth = 'true';
          } else if (isExtensionUnavailableError(preview.error)) {
            setButtonText(btn, '❌', dict.refreshPage);
            btn.style.background = '#dc2626';
            btn.dataset.syncPilotNeedsRefresh = 'true';
          } else {
            setButtonText(btn, '❌', getWriteErrorLabel(dict, preview.error));
            btn.style.background = '#dc2626';
          }
          return;
        }

        setButtonText(btn, '⏳', dict.btnDirectSaving);

        let finished = false;
        let timedOut = false;
        const timer = setTimeout(() => {
          if (!finished) {
            timedOut = true;
            finished = true;
            btn.disabled = false;
            setButtonText(btn, '❌', dict.reauthorize);
            btn.style.background = '#dc2626';
            btn.dataset.syncPilotNeedsAuth = 'true';
          }
        }, 8000);

        chrome.runtime.sendMessage({
          action: 'WRITE_FILES',
          files: [{ path: filepath, content: cleanCode }]
        }, (res) => {
          if (timedOut) return;

          finished = true;
          clearTimeout(timer);

          if (chrome.runtime.lastError) {
            btn.disabled = false;
            setButtonText(btn, '❌', dict.refreshPage);
            btn.style.background = '#dc2626';
            btn.dataset.syncPilotNeedsRefresh = 'true';
            return;
          }

          if (res && res.success) {
            setButtonText(btn, '✅', dict.btnDirectSaved);
            btn.style.background = '#16a34a';
          } else {
            const needsAuthorization = res && isAuthorizationError(res.error);
            const errLabel = needsAuthorization ? dict.reauthorize : getWriteErrorLabel(dict, res && res.error);
            setButtonText(btn, '❌', errLabel);
            btn.style.background = '#dc2626';

            if (needsAuthorization) {
              btn.disabled = false;
              btn.dataset.syncPilotNeedsAuth = 'true';
              return;
            }
          }

          setTimeout(() => {
            btn.disabled = false;
            setButtonText(btn, '⚡', `${dict.btnDirectSync} ${filepath}`);
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

  let syncUiTimer = null;

  function scheduleSyncUi() {
    clearTimeout(syncUiTimer);
    syncUiTimer = setTimeout(() => {
      syncUiTimer = null;
      injectSyncButtons();
    }, 250);
  }

  const pageObserver = new MutationObserver(records => {
    const hasPageChange = records.some(record => {
      const target = record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target;
      return !target?.closest?.('#syncpilot-batch-bar, .syncpilot-btn');
    });

    if (hasPageChange) {
      scheduleSyncUi();
    }
  });
  pageObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  scheduleSyncUi();
})();
