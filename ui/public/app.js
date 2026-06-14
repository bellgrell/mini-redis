/**
 * mini-redis Web UI - Enhanced Application
 *
 * Features:
 *  - Redis Console with autocomplete
 *  - Key Browser with type icons
 *  - Server Info panel
 *  - Live Monitor
 *  - Command Reference (Cheat Sheet)
 *  - Keyboard shortcuts
 *  - Toast notifications
 *  - Copy-to-clipboard
 */

(function () {
  'use strict';

  // ============================================================
  // Data
  // ============================================================
  const COMMAND_GROUPS = {
    connection:   { label: 'Connection',   icon: '🔗' },
    strings:      { label: 'Strings',      icon: '📝' },
    lists:        { label: 'Lists',        icon: '📋' },
    sets:         { label: 'Sets',         icon: '🎯' },
    hashes:       { label: 'Hashes',       icon: '🗂️' },
    'sorted-sets':{ label: 'Sorted Sets',  icon: '🏆' },
    generic:      { label: 'Generic',      icon: '🔧' },
    server:       { label: 'Server',       icon: '⚙️' },
  };

  // ============================================================
  // State
  // ============================================================
  const state = {
    connected: false,
    reconnecting: false,
    ws: null,
    commandHistory: [],
    historyIndex: -1,
    currentPanel: 'console',
    keysCache: [],
    monitorActive: false,
    monitorCount: 0,
    commandCount: 0,
    commands: [],
  };

  // ============================================================
  // DOM References
  // ============================================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const dom = {
    statusIndicator: $('#status-indicator'),
    statusText: $('#status-text'),
    redisTarget: $('#redis-target'),
    reconnectBtn: $('#reconnect-btn'),
    navBtns: $$('.nav-btn'),

    // Console
    consoleOutput: $('#console-output'),
    commandInput: $('#command-input'),
    sendBtn: $('#send-btn'),
    clearConsoleBtn: $('#clear-console-btn'),
    autocompleteBox: $('#autocomplete-box'),
    consoleInfo: $('#console-info'),
    cmdCount: $('#cmd-count'),

    // Key Browser
    keysList: $('#keys-list'),
    keySearch: $('#key-search'),
    keyTypeFilter: $('#key-type-filter'),
    refreshKeysBtn: $('#refresh-keys-btn'),
    keyDetail: $('#key-detail'),
    detailKeyName: $('#detail-key-name'),
    detailKeyType: $('#detail-key-type'),
    detailValue: $('#detail-value'),
    detailDeleteBtn: $('#detail-delete-btn'),
    detailCopyBtn: $('#detail-copy-btn'),
    detailTtl: $('#detail-ttl-value'),
    keyCount: $('#key-count'),

    // Info
    infoContent: $('#info-content'),
    refreshInfoBtn: $('#refresh-info-btn'),

    // Monitor
    monitorOutput: $('#monitor-output'),
    monitorToggleBtn: $('#monitor-toggle-btn'),
    clearMonitorBtn: $('#clear-monitor-btn'),
    monitorStatusBadge: $('#monitor-status-badge'),
    monitorCmdCount: $('#monitor-cmd-count'),

    // Cheat Sheet
    cheatsheetContent: $('#cheatsheet-content'),
    cheatsheetSearch: $('#cheatsheet-search'),
    cheatsheetGroupFilter: $('#cheatsheet-group-filter'),

    // Toast
    toastContainer: $('#toast-container'),

    panels: $$('.panel'),
  };

  // ============================================================
  // Toast Notifications
  // ============================================================
  function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 3000;

    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
    `;
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ============================================================
  // WebSocket Connection
  // ============================================================
  function connectWS() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}`;

    state.ws = new WebSocket(url);

    state.ws.onopen = () => {
      state.connected = true;
      state.reconnecting = false;
      updateConnectionStatus(true);
      addConsoleLine('Connected to mini-redis server', 'resp-info');
      updateConsoleInfo('Connected — Type a command and press Enter');
    };

    state.ws.onclose = () => {
      state.connected = false;
      updateConnectionStatus(false);
      addConsoleLine('Disconnected from server', 'resp-info');
      updateConsoleInfo('Disconnected — Attempting to reconnect...');
      if (!state.reconnecting) {
        state.reconnecting = true;
        setTimeout(() => {
          addConsoleLine('Reconnecting...', 'resp-info');
          connectWS();
        }, 3000);
      }
    };

    state.ws.onerror = () => {
      if (!state.connected) updateConnectionStatus(false);
    };

    state.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWSMessage(msg);
      } catch (err) {
        console.error('Failed to parse WS message:', err);
      }
    };
  }

  function handleWSMessage(msg) {
    switch (msg.type) {
      case 'connected':
        state.connected = true;
        state.reconnecting = false;
        updateConnectionStatus(true);
        addConsoleLine(`Connected to Redis at ${msg.host}:${msg.port}`, 'resp-info');
        updateConsoleInfo('Connected — Type a command and press Enter');
        break;

      case 'disconnected':
        state.connected = false;
        updateConnectionStatus(false);
        addConsoleLine(`Disconnected: ${msg.reason}`, 'resp-info');
        updateConsoleInfo('Disconnected');
        break;

      case 'response':
        handleRedisResponse(msg);
        break;

      case 'sent':
        if (state.monitorActive) {
          addMonitorLine(msg.raw);
        }
        break;

      case 'error':
        addConsoleLine(`⚠️ ${msg.message}`, 'resp-err');
        updateConsoleInfo(msg.message);
        break;
    }
  }

  function sendWS(data) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(data));
      return true;
    }
    addConsoleLine('⚠️ Not connected to server', 'resp-err');
    return false;
  }

  // ============================================================
  // Connection Status UI
  // ============================================================
  function updateConnectionStatus(online) {
    if (state.reconnecting) {
      dom.statusIndicator.className = 'status-dot reconnecting';
      dom.statusText.textContent = 'Reconnecting...';
    } else if (online) {
      dom.statusIndicator.className = 'status-dot online';
      dom.statusText.textContent = 'Connected';
    } else {
      dom.statusIndicator.className = 'status-dot offline';
      dom.statusText.textContent = 'Disconnected';
    }
  }

  // ============================================================
  // Console
  // ============================================================
  function updateConsoleInfo(text) {
    dom.consoleInfo.textContent = text;
  }

  function addConsoleLine(text, className) {
    const line = document.createElement('div');
    line.className = `console-line ${className || ''}`;
    line.innerHTML = escapeHtml(text);
    dom.consoleOutput.appendChild(line);
    dom.consoleOutput.scrollTop = dom.consoleOutput.scrollHeight;
    return line;
  }

  function handleRedisResponse(msg) {
    const raw = msg.raw;
    if (raw === null) {
      addConsoleLine('(nil)', 'resp-nil');
    } else if (raw && typeof raw === 'object' && raw.error) {
      addConsoleLine(raw.error, 'resp-err');
    } else if (Array.isArray(raw)) {
      if (raw.length === 0) {
        addConsoleLine('(empty array)', 'resp-nil');
      } else {
        for (let i = 0; i < raw.length; i++) {
          const val = formatDisplayValue(raw[i]);
          addConsoleLine(`  ${i + 1}) ${val}`, 'resp-ok');
        }
      }
    } else if (typeof raw === 'number') {
      addConsoleLine(`(integer) ${raw}`, 'resp-ok');
    } else {
      addConsoleLine(formatDisplayValue(raw), 'resp-ok');
    }
  }

  function formatDisplayValue(val) {
    if (val === null || val === undefined) return '(nil)';
    if (typeof val === 'object' && val.error) return `(error) ${val.error}`;
    return String(val);
  }

  function executeCommand(cmdText) {
    cmdText = cmdText.trim();
    if (!cmdText) return;

    state.commandHistory.push(cmdText);
    if (state.commandHistory.length > 500) state.commandHistory.shift();
    state.historyIndex = state.commandHistory.length;

    addConsoleLine(cmdText, 'cmd');
    state.commandCount++;
    dom.cmdCount.textContent = `${state.commandCount} commands`;

    sendWS({ type: 'command', command: cmdText });
  }

  // ============================================================
  // Monitor
  // ============================================================
  function addMonitorLine(cmd) {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = 'monitor-line';
    line.innerHTML = `<span class="time">[${time}]</span> <span class="cmd-text">${escapeHtml(cmd)}</span>`;
    dom.monitorOutput.appendChild(line);
    dom.monitorOutput.scrollTop = dom.monitorOutput.scrollHeight;

    state.monitorCount++;
    dom.monitorCmdCount.textContent = `${state.monitorCount} commands`;
  }

  function toggleMonitor() {
    state.monitorActive = !state.monitorActive;
    dom.monitorToggleBtn.textContent = state.monitorActive ? '⏹️ Stop Monitor' : '▶️ Start Monitor';
    dom.monitorToggleBtn.className = state.monitorActive ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-primary';
    dom.monitorStatusBadge.textContent = state.monitorActive ? 'Active' : 'Inactive';

    if (state.monitorActive) {
      addConsoleLine('Monitor started — capturing all commands', 'resp-info');
      dom.monitorOutput.innerHTML = '';
      state.monitorCount = 0;
      dom.monitorCmdCount.textContent = '0 commands';
    } else {
      addConsoleLine('Monitor stopped', 'resp-info');
    }
  }

  // ============================================================
  // Command Input & Autocomplete
  // ============================================================
  function getCommandSuggestions(partial) {
    if (!partial) return [];
    const upper = partial.toUpperCase();
    const exact = state.commands.filter(c => c.cmd.toUpperCase() === upper);
    const starts = state.commands.filter(c => c.cmd.toUpperCase().startsWith(upper) && c.cmd.toUpperCase() !== upper);
    return [...exact, ...starts].slice(0, 8);
  }

  function showAutocomplete(suggestions) {
    if (!suggestions || suggestions.length === 0) {
      dom.autocompleteBox.classList.add('hidden');
      return;
    }

    dom.autocompleteBox.innerHTML = suggestions.map((s, i) => {
      const groupInfo = COMMAND_GROUPS[s.group] || { label: s.group };
      return `<div class="autocomplete-item ${i === 0 ? 'selected' : ''}" data-cmd="${s.cmd}">
        <span class="cmd-name">${s.cmd}</span>
        <span class="cmd-args">${escapeHtml(s.args)}</span>
        <span class="cmd-group-badge">${groupInfo.label}</span>
        <span class="cmd-desc">${escapeHtml(s.desc)}</span>
      </div>`;
    }).join('');
    dom.autocompleteBox.classList.remove('hidden');
  }

  function hideAutocomplete() {
    dom.autocompleteBox.classList.add('hidden');
  }

  function applyAutocomplete(cmd) {
    dom.commandInput.value = cmd + ' ';
    hideAutocomplete();
    dom.commandInput.focus();
  }

  // ============================================================
  // Key Browser
  // ============================================================
  function loadKeys(pattern) {
    pattern = pattern || '*';
    if (!state.connected) {
      showToast('Not connected to Redis', 'error');
      return;
    }
    addConsoleLine(`KEYS ${pattern}`, 'cmd');
    sendWS({ type: 'command', command: `KEYS ${pattern}` });
  }

  function renderKeys(keys) {
    dom.keysList.innerHTML = '';
    state.keysCache = keys || [];

    if (!keys || keys.length === 0) {
      dom.keysList.innerHTML = '<div class="empty-state"><p>No keys found</p></div>';
      dom.keyCount.textContent = '0 keys';
      return;
    }

    dom.keyCount.textContent = `${keys.length} keys`;

    keys.forEach((key, index) => {
      const item = document.createElement('div');
      item.className = 'key-item';
      item.dataset.key = key;
      item.innerHTML = `
        <div class="key-icon type-unknown">?</div>
        <span class="key-name">${escapeHtml(key)}</span>
        <span class="key-ttl">...</span>
      `;
      item.addEventListener('click', () => selectKey(key, item));
      dom.keysList.appendChild(item);

      // Load type and TTL asynchronously
      setTimeout(() => queryKeyInfo(key, item), index * 30);
    });
  }

  function queryKeyInfo(key, itemEl) {
    if (!state.connected) return;

    // Get key type
    state._staging = state._staging || { queue: [] };
    state._staging.queue.push({ key, itemEl, stage: 'type' });
    sendWS({ type: 'command', command: `TYPE ${key}` });
  }

  function selectKey(key, itemEl) {
    dom.keysList.querySelectorAll('.key-item.selected').forEach(el => el.classList.remove('selected'));
    if (itemEl) itemEl.classList.add('selected');

    dom.detailKeyName.textContent = key;
    dom.keyDetail.classList.remove('hidden');
    dom.detailValue.textContent = 'Loading...';

    state._detailQuery = { key, stage: 'type' };
    sendWS({ type: 'command', command: `TYPE ${key}` });
  }

  // ============================================================
  // Info Panel
  // ============================================================
  function loadInfo() {
    if (!state.connected) {
      showToast('Not connected to Redis', 'error');
      return;
    }
    addConsoleLine('INFO', 'cmd');
    sendWS({ type: 'command', command: 'INFO' });
  }

  // ============================================================
  // Cheat Sheet
  // ============================================================
  function renderCheatSheet(commands) {
    if (!commands || commands.length === 0) {
      dom.cheatsheetContent.innerHTML = '<div class="empty-state"><p>No commands loaded</p></div>';
      return;
    }

    const filter = dom.cheatsheetGroupFilter.value;
    const search = dom.cheatsheetSearch.value.toLowerCase().trim();

    let filtered = commands;
    if (filter) {
      filtered = filtered.filter(c => c.group === filter);
    }
    if (search) {
      filtered = filtered.filter(c =>
        c.cmd.toLowerCase().includes(search) ||
        c.desc.toLowerCase().includes(search) ||
        (c.group && c.group.toLowerCase().includes(search))
      );
    }

    // Group by command group
    const grouped = {};
    filtered.forEach(c => {
      const group = c.group || 'other';
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push(c);
    });

    let html = '';
    const groupOrder = ['connection', 'generic', 'strings', 'lists', 'sets', 'hashes', 'sorted-sets', 'server'];
    const shownGroups = Object.keys(grouped).sort((a, b) => groupOrder.indexOf(a) - groupOrder.indexOf(b));

    for (const groupName of shownGroups) {
      const groupCmds = grouped[groupName];
      const groupInfo = COMMAND_GROUPS[groupName] || { label: groupName, icon: '📦' };

      html += `<div class="cheatsheet-group">
        <div class="cheatsheet-group-title">${groupInfo.icon} ${groupInfo.label} <span class="group-count">${groupCmds.length} commands</span></div>`;

      groupCmds.forEach(c => {
        const syntax = c.syntax || `${c.cmd} ${c.args}`;
        html += `<div class="cheatsheet-card">
          <span class="cmd-badge">${c.cmd}</span>
          <div class="cmd-info">
            <div class="cmd-syntax">${escapeHtml(syntax).replace(/&lt;([^&]+)&gt;/g, '<span class="arg">≤$1≥</span>')}</div>
            <div class="cmd-desc">${escapeHtml(c.desc)}</div>
            ${c.example ? `<span class="cmd-example">${escapeHtml(c.example)}</span>` : ''}
          </div>
        </div>`;
      });

      html += '</div>';
    }

    dom.cheatsheetContent.innerHTML = html || '<div class="empty-state"><p>No commands match the current filter</p></div>';
  }

  // ============================================================
  // Keyboard Shortcuts
  // ============================================================
  function setupKeyboardShortcuts() {
    const panelMap = { '1': 'console', '2': 'browser', '3': 'info', '4': 'monitor', '5': 'cheatsheet' };

    document.addEventListener('keydown', (e) => {
      // Ctrl+1-5 = switch panels
      if (e.ctrlKey && panelMap[e.key]) {
        e.preventDefault();
        switchPanel(panelMap[e.key]);
      }

      // Ctrl+L = clear console
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        if (state.currentPanel === 'console') {
          dom.consoleOutput.innerHTML = '';
        }
      }

      // Escape = close key detail / autocomplete
      if (e.key === 'Escape') {
        if (!dom.keyDetail.classList.contains('hidden') && state.currentPanel === 'browser') {
          dom.keyDetail.classList.add('hidden');
        }
        hideAutocomplete();
      }
    });
  }

  // ============================================================
  // Panel Navigation
  // ============================================================
  function switchPanel(panelName) {
    dom.navBtns.forEach(b => b.classList.remove('active'));
    dom.panels.forEach(p => p.classList.remove('active'));

    const targetNav = dom.navBtns.find(b => b.dataset.panel === panelName);
    if (targetNav) targetNav.classList.add('active');

    const targetPanel = document.getElementById(`panel-${panelName}`);
    if (targetPanel) targetPanel.classList.add('active');

    state.currentPanel = panelName;

    // Focus input when switching to console
    if (panelName === 'console') {
      dom.commandInput.focus();
    }
  }

  // ============================================================
  // Utilities
  // ============================================================
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard', 'success', 1500);
      }).catch(() => {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Copied to clipboard', 'success', 1500);
    } catch (e) {
      showToast('Failed to copy', 'error');
    }
    document.body.removeChild(ta);
  }

  // ============================================================
  // Response Interceptors (key staging + detail queries)
  // ============================================================

  // Override the onmessage-level handler to intercept type/ttl queries
  const _origHandle = handleWSMessage;
  handleWSMessage = function(msg) {
    if (msg.type === 'response') {
      // Key staging: resolve queued TYPE queries
      if (state._staging && state._staging.queue && state._staging.queue.length > 0) {
        const item = state._staging.queue.shift();
        if (item.stage === 'type') {
          const keyType = msg.raw && typeof msg.raw === 'string' ? msg.raw.toLowerCase() : 'string';
          const icon = item.itemEl.querySelector('.key-icon');
          icon.className = `key-icon type-${keyType}`;
          icon.textContent = keyType[0]?.toUpperCase() || '?';

          // Queue TTL query
          state._staging.queue.push({ key: item.key, itemEl: item.itemEl, stage: 'ttl' });
          sendWS({ type: 'command', command: `TTL ${item.key}` });
          return;
        }
        if (item.stage === 'ttl') {
          const ttl = msg.raw;
          const ttlEl = item.itemEl.querySelector('.key-ttl');
          if (ttl === -1 || ttl === null) ttlEl.textContent = '∞';
          else if (ttl === -2) ttlEl.textContent = 'del';
          else ttlEl.textContent = `${ttl}s`;
          return;
        }
      }

      // Detail query: resolve selected key info
      if (state._detailQuery) {
        const q = state._detailQuery;
        if (q.stage === 'type') {
          const type = msg.raw && typeof msg.raw === 'string' ? msg.raw.toLowerCase() : 'string';
          dom.detailKeyType.textContent = type.toUpperCase();
          dom.detailKeyType.className = `key-type-badge ${type}`;

          q.stage = 'value';
          q.type = type;

          // Query TTL + value
          state._queryTtl = true;
          sendWS({ type: 'command', command: `TTL ${q.key}` });

          if (type === 'string') sendWS({ type: 'command', command: `GET ${q.key}` });
          else if (type === 'list') sendWS({ type: 'command', command: `LRANGE ${q.key} 0 -1` });
          else if (type === 'set') sendWS({ type: 'command', command: `SMEMBERS ${q.key}` });
          else if (type === 'hash') sendWS({ type: 'command', command: `HGETALL ${q.key}` });
          else if (type === 'zset') sendWS({ type: 'command', command: `ZRANGE ${q.key} 0 -1 WITHSCORES` });
          else {
            dom.detailValue.textContent = '(unknown type)';
            delete state._detailQuery;
          }
          return;
        }
        if (q.stage === 'value') {
          dom.detailValue.textContent = formatDisplayValue(msg.raw);
          delete state._detailQuery;
          return;
        }
      }

      // Detail TTL query
      if (state._queryTtl) {
        const ttl = msg.raw;
        dom.detailTtl.textContent = (ttl === -1 || ttl === null) ? '∞' : (ttl === -2 ? 'Deleted' : `${ttl}s`);
        delete state._queryTtl;
        return;
      }
    }

    _origHandle(msg);
  };

  // ============================================================
  // Event Handlers
  // ============================================================

  // --- Navigation ---
  dom.navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switchPanel(btn.dataset.panel);
    });
  });

  // --- Footer License / Reconnect buttons ---
  dom.reconnectBtn.addEventListener('click', () => {
    if (state.ws) state.ws.close();
    addConsoleLine('Reconnecting...', 'resp-info');
    setTimeout(connectWS, 500);
  });

  // --- Console ---
  dom.sendBtn.addEventListener('click', () => {
    executeCommand(dom.commandInput.value);
    dom.commandInput.value = '';
    hideAutocomplete();
    dom.commandInput.focus();
  });

  dom.commandInput.addEventListener('keydown', (e) => {
    const input = dom.commandInput;
    const firstWord = input.value.split(' ')[0];
    const suggestions = getCommandSuggestions(firstWord);

    if (e.key === 'Enter') {
      e.preventDefault();
      if (!dom.autocompleteBox.classList.contains('hidden')) {
        const selected = dom.autocompleteBox.querySelector('.selected');
        if (selected) {
          applyAutocomplete(selected.dataset.cmd);
          return;
        }
      }
      executeCommand(input.value);
      input.value = '';
      hideAutocomplete();
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (!dom.autocompleteBox.classList.contains('hidden')) {
        const selected = dom.autocompleteBox.querySelector('.selected');
        if (selected) applyAutocomplete(selected.dataset.cmd);
      }
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!dom.autocompleteBox.classList.contains('hidden')) {
        cycleAutocomplete(-1);
        return;
      }
      if (state.historyIndex > 0) {
        state.historyIndex--;
        input.value = state.commandHistory[state.historyIndex];
        // Move cursor to end
        setTimeout(() => { input.selectionStart = input.selectionEnd = input.value.length; }, 0);
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!dom.autocompleteBox.classList.contains('hidden')) {
        cycleAutocomplete(1);
        return;
      }
      if (state.historyIndex < state.commandHistory.length - 1) {
        state.historyIndex++;
        input.value = state.commandHistory[state.historyIndex];
      } else {
        state.historyIndex = state.commandHistory.length;
        input.value = '';
      }
    }

    if (e.key === 'Escape') {
      hideAutocomplete();
    }
  });

  function cycleAutocomplete(dir) {
    const items = dom.autocompleteBox.querySelectorAll('.autocomplete-item');
    const selected = dom.autocompleteBox.querySelector('.selected');
    let idx = -1;
    items.forEach((item, i) => { if (item === selected) idx = i; });
    const next = idx + dir;
    if (next >= 0 && next < items.length) {
      if (selected) selected.classList.remove('selected');
      items[next].classList.add('selected');
      items[next].scrollIntoView({ block: 'nearest' });
    }
  }

  dom.commandInput.addEventListener('input', () => {
    const val = dom.commandInput.value;
    const firstWord = val.split(' ')[0];
    const suggestions = getCommandSuggestions(firstWord);
    showAutocomplete(suggestions);
  });

  dom.commandInput.addEventListener('blur', () => {
    setTimeout(hideAutocomplete, 200);
  });

  // Autocomplete item click
  dom.autocompleteBox.addEventListener('click', (e) => {
    const item = e.target.closest('.autocomplete-item');
    if (item) applyAutocomplete(item.dataset.cmd);
  });

  // Click outside autocomplete
  document.addEventListener('click', (e) => {
    if (!dom.autocompleteBox.contains(e.target) && e.target !== dom.commandInput) {
      hideAutocomplete();
    }
  });

  // --- Clear Console ---
  dom.clearConsoleBtn.addEventListener('click', () => {
    dom.consoleOutput.innerHTML = '';
    state.commandCount = 0;
    dom.cmdCount.textContent = '0 commands';
  });

  // --- Key Browser ---
  dom.refreshKeysBtn.addEventListener('click', () => {
    loadKeys(dom.keySearch.value || '*');
  });

  dom.keySearch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      loadKeys(dom.keySearch.value || '*');
    }
  });

  // --- Info ---
  dom.refreshInfoBtn.addEventListener('click', loadInfo);

  // --- Monitor ---
  dom.monitorToggleBtn.addEventListener('click', toggleMonitor);
  dom.clearMonitorBtn.addEventListener('click', () => {
    dom.monitorOutput.innerHTML = '';
    state.monitorCount = 0;
    dom.monitorCmdCount.textContent = '0 commands';
  });

  // --- Delete Key ---
  dom.detailDeleteBtn.addEventListener('click', () => {
    const key = dom.detailKeyName.textContent;
    if (key && confirm(`⚠️ Delete key "${key}"? This cannot be undone.`)) {
      addConsoleLine(`DEL ${key}`, 'cmd');
      sendWS({ type: 'command', command: `DEL ${key}` });
      dom.keyDetail.classList.add('hidden');
      loadKeys(dom.keySearch.value || '*');
      showToast(`Deleted key: ${key}`, 'success');
    }
  });

  // --- Copy Key Value ---
  dom.detailCopyBtn.addEventListener('click', () => {
    const value = dom.detailValue.textContent;
    if (value && value !== 'Loading...') {
      copyToClipboard(value);
    }
  });

  // --- Cheat Sheet ---
  dom.cheatsheetSearch.addEventListener('input', () => {
    renderCheatSheet(state.commands);
  });

  dom.cheatsheetGroupFilter.addEventListener('change', () => {
    renderCheatSheet(state.commands);
  });

  // ============================================================
  // Initialize
  // ============================================================
  function init() {
    // Initialize connection info
    dom.redisTarget.textContent = 'loading...';

    // Fetch server status and commands
    fetch('/api/status')
      .then(r => r.json())
      .then(data => {
        dom.redisTarget.textContent = data.redisTarget;
      })
      .catch(() => {
        dom.redisTarget.textContent = 'unknown';
      });

    // Load command reference
    fetch('/api/commands')
      .then(r => r.json())
      .then(commands => {
        state.commands = commands;
        renderCheatSheet(commands);
      })
      .catch(() => {
        // Fallback to built-in commands
        state.commands = [
          { cmd: 'PING', args: '', desc: 'Test connection', group: 'connection', syntax: 'PING', example: 'PING' },
          { cmd: 'SET', args: '<key> <value>', desc: 'Set a key-value pair', group: 'strings', syntax: 'SET <key> <value>', example: 'SET mykey Hello' },
          { cmd: 'GET', args: '<key>', desc: 'Get value by key', group: 'strings', syntax: 'GET <key>', example: 'GET mykey' },
          { cmd: 'DEL', args: '<key> [key...]', desc: 'Delete key(s)', group: 'generic', syntax: 'DEL <key> [key ...]', example: 'DEL mykey' },
          { cmd: 'KEYS', args: '<pattern>', desc: 'Find keys by pattern', group: 'generic', syntax: 'KEYS <pattern>', example: 'KEYS *' },
          { cmd: 'INFO', args: '', desc: 'Get server info', group: 'server', syntax: 'INFO', example: 'INFO' },
          { cmd: 'DBSIZE', args: '', desc: 'Get number of keys', group: 'server', syntax: 'DBSIZE', example: 'DBSIZE' },
          { cmd: 'TYPE', args: '<key>', desc: 'Get key type', group: 'generic', syntax: 'TYPE <key>', example: 'TYPE mykey' },
          { cmd: 'TTL', args: '<key>', desc: 'Get key TTL', group: 'generic', syntax: 'TTL <key>', example: 'TTL mykey' },
          { cmd: 'EXISTS', args: '<key>', desc: 'Check if key exists', group: 'generic', syntax: 'EXISTS <key>', example: 'EXISTS mykey' },
          { cmd: 'INCR', args: '<key>', desc: 'Increment by 1', group: 'strings', syntax: 'INCR <key>', example: 'INCR counter' },
          { cmd: 'FLUSHDB', args: '', desc: 'Flush current database', group: 'server', syntax: 'FLUSHDB', example: 'FLUSHDB' },
        ];
        renderCheatSheet(state.commands);
        showToast('Could not load full command reference', 'error');
      });

    // Connect WebSocket
    connectWS();

    // Setup keyboard shortcuts
    setupKeyboardShortcuts();

    // Focus input
    dom.commandInput.focus();
  }

  init();
})();
