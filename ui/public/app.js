/**
 * mini-redis Web UI - Main Application
 *
 * Single-page application that connects to the proxy server
 * via WebSocket and communicates with mini-redis.
 */

(function () {
  'use strict';

  // ============================================================
  // Redis Commands Reference (for autocomplete)
  // ============================================================
  const REDIS_COMMANDS = [
    { cmd: 'PING', args: '', desc: 'Test connection' },
    { cmd: 'ECHO', args: '<message>', desc: 'Echo a message' },
    { cmd: 'QUIT', args: '', desc: 'Close connection' },
    { cmd: 'SET', args: '<key> <value>', desc: 'Set a key-value pair' },
    { cmd: 'GET', args: '<key>', desc: 'Get value by key' },
    { cmd: 'DEL', args: '<key> [key...]', desc: 'Delete key(s)' },
    { cmd: 'EXISTS', args: '<key> [key...]', desc: 'Check if key exists' },
    { cmd: 'EXPIRE', args: '<key> <seconds>', desc: 'Set key TTL' },
    { cmd: 'TTL', args: '<key>', desc: 'Get key TTL' },
    { cmd: 'KEYS', args: '<pattern>', desc: 'Find keys by pattern' },
    { cmd: 'TYPE', args: '<key>', desc: 'Get key type' },
    { cmd: 'RENAME', args: '<key> <newkey>', desc: 'Rename a key' },
    { cmd: 'APPEND', args: '<key> <value>', desc: 'Append to string' },
    { cmd: 'STRLEN', args: '<key>', desc: 'Get string length' },
    { cmd: 'INCR', args: '<key>', desc: 'Increment by 1' },
    { cmd: 'INCRBY', args: '<key> <amount>', desc: 'Increment by amount' },
    { cmd: 'DECR', args: '<key>', desc: 'Decrement by 1' },
    { cmd: 'DECRBY', args: '<key> <amount>', desc: 'Decrement by amount' },
    { cmd: 'GETSET', args: '<key> <value>', desc: 'Set and return old value' },
    { cmd: 'LPUSH', args: '<key> <val> [val...]', desc: 'Prepend to list' },
    { cmd: 'RPUSH', args: '<key> <val> [val...]', desc: 'Append to list' },
    { cmd: 'LPOP', args: '<key>', desc: 'Remove and get first element' },
    { cmd: 'RPOP', args: '<key>', desc: 'Remove and get last element' },
    { cmd: 'LLEN', args: '<key>', desc: 'Get list length' },
    { cmd: 'LRANGE', args: '<key> <start> <stop>', desc: 'Get range of list' },
    { cmd: 'LINDEX', args: '<key> <index>', desc: 'Get element by index' },
    { cmd: 'SADD', args: '<key> <mem> [mem...]', desc: 'Add to set' },
    { cmd: 'SREM', args: '<key> <mem> [mem...]', desc: 'Remove from set' },
    { cmd: 'SMEMBERS', args: '<key>', desc: 'Get all set members' },
    { cmd: 'SISMEMBER', args: '<key> <member>', desc: 'Check set membership' },
    { cmd: 'SCARD', args: '<key>', desc: 'Get set cardinality' },
    { cmd: 'HSET', args: '<key> <field> <val>', desc: 'Set hash field' },
    { cmd: 'HGET', args: '<key> <field>', desc: 'Get hash field' },
    { cmd: 'HGETALL', args: '<key>', desc: 'Get all hash fields' },
    { cmd: 'HDEL', args: '<key> <field> [field...]', desc: 'Delete hash fields' },
    { cmd: 'HEXISTS', args: '<key> <field>', desc: 'Check hash field' },
    { cmd: 'HLEN', args: '<key>', desc: 'Get hash field count' },
    { cmd: 'HKEYS', args: '<key>', desc: 'Get all hash keys' },
    { cmd: 'HVALS', args: '<key>', desc: 'Get all hash values' },
    { cmd: 'ZADD', args: '<key> <score> <member>', desc: 'Add to sorted set' },
    { cmd: 'ZREM', args: '<key> <member>', desc: 'Remove from sorted set' },
    { cmd: 'ZRANGE', args: '<key> <start> <stop>', desc: 'Get sorted set range' },
    { cmd: 'ZCARD', args: '<key>', desc: 'Get sorted set size' },
    { cmd: 'SELECT', args: '<index>', desc: 'Select database' },
    { cmd: 'FLUSHDB', args: '', desc: 'Flush current database' },
    { cmd: 'FLUSHALL', args: '', desc: 'Flush all databases' },
    { cmd: 'DBSIZE', args: '', desc: 'Get database size' },
    { cmd: 'INFO', args: '', desc: 'Get server info' },
    { cmd: 'CONFIG', args: 'GET|SET <param>', desc: 'Get/set config' },
    { cmd: 'SLAVEOF', args: '<host> <port>', desc: 'Set replication' },
    { cmd: 'SAVE', args: '', desc: 'Save dataset to disk' },
    { cmd: 'BGSAVE', args: '', desc: 'Save in background' },
    { cmd: 'LASTSAVE', args: '', desc: 'Get last save timestamp' },
    { cmd: 'CLIENT', args: 'LIST|SETNAME|GETNAME', desc: 'Client management' },
    { cmd: 'SLOWLOG', args: 'GET|LEN|RESET', desc: 'Slow log' },
    { cmd: 'TIME', args: '', desc: 'Get server time' },
  ];

  // ============================================================
  // Application State
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
  };

  // ============================================================
  // DOM References
  // ============================================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    // Sidebar
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

    // Info
    infoContent: $('#info-content'),
    refreshInfoBtn: $('#refresh-info-btn'),

    // Monitor
    monitorOutput: $('#monitor-output'),
    monitorToggleBtn: $('#monitor-toggle-btn'),
    clearMonitorBtn: $('#clear-monitor-btn'),

    // Panels
    panels: $$('.panel'),
  };

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
    };

    state.ws.onclose = () => {
      state.connected = false;
      updateConnectionStatus(false);
      addConsoleLine('Disconnected from server', 'resp-info');
      // Auto-reconnect after 3s
      if (!state.reconnecting) {
        state.reconnecting = true;
        updateConnectionStatus(false, true);
        setTimeout(connectWS, 3000);
      }
    };

    state.ws.onerror = () => {
      if (!state.connected) {
        updateConnectionStatus(false);
      }
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
        break;

      case 'disconnected':
        state.connected = false;
        updateConnectionStatus(false);
        addConsoleLine(`Disconnected: ${msg.reason}`, 'resp-info');
        break;

      case 'response':
        handleRedisResponse(msg);
        break;

      case 'sent':
        // Command was sent - already echoed in console
        break;

      case 'error':
        addConsoleLine(`[Error] ${msg.message}`, 'resp-err');
        break;
    }
  }

  function sendWS(data) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(data));
      return true;
    }
    addConsoleLine('[Error] Not connected to server', 'resp-err');
    return false;
  }

  // ============================================================
  // Connection Status UI
  // ============================================================
  function updateConnectionStatus(online, reconnecting) {
    if (reconnecting) {
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
  function addConsoleLine(text, className, rawValue) {
    const line = document.createElement('div');
    line.className = `console-line ${className || ''}`;
    if (rawValue && typeof rawValue === 'object') {
      line.textContent = text;
    } else {
      line.innerHTML = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    dom.consoleOutput.appendChild(line);
    dom.consoleOutput.scrollTop = dom.consoleOutput.scrollHeight;
    return line;
  }

  function handleRedisResponse(msg) {
    if (state.currentPanel === 'monitor' && state.monitorActive) {
      const time = new Date().toLocaleTimeString();
      const line = document.createElement('div');
      line.className = 'monitor-line';
      line.innerHTML = `<span class="time">[${time}]</span> <span class="cmd-text">${escapeHtml(msg.formatted)}</span>`;
      dom.monitorOutput.appendChild(line);
      dom.monitorOutput.scrollTop = dom.monitorOutput.scrollHeight;
    }

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
          const prefix = `${i + 1}) `;
          const val = formatDisplayValue(raw[i]);
          addConsoleLine(prefix + val, 'resp-ok');
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

    // Add to history
    state.commandHistory.push(cmdText);
    if (state.commandHistory.length > 500) {
      state.commandHistory.shift();
    }
    state.historyIndex = state.commandHistory.length;

    // Echo command
    addConsoleLine(cmdText, 'cmd');

    // Send via WS
    sendWS({ type: 'command', command: cmdText });
  }

  // ============================================================
  // Command Input & Autocomplete
  // ============================================================
  function getCommandSuggestions(partial) {
    if (!partial) return [];
    const upper = partial.toUpperCase();
    return REDIS_COMMANDS.filter(c => c.cmd.startsWith(upper)).slice(0, 8);
  }

  function showAutocomplete(suggestions) {
    if (!suggestions || suggestions.length === 0) {
      dom.autocompleteBox.classList.add('hidden');
      return;
    }

    dom.autocompleteBox.innerHTML = suggestions.map((s, i) =>
      `<div class="autocomplete-item ${i === 0 ? 'selected' : ''}" data-cmd="${s.cmd}">${
        s.cmd
      } <span class="cmd-desc">${escapeHtml(s.args)} — ${escapeHtml(s.desc)}</span></div>`
    ).join('');
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
    if (!state.connected) return;

    addConsoleLine(`KEYS ${pattern}`, 'cmd');
    sendWS({ type: 'command', command: `KEYS ${pattern}` });

    // Also load key types
    // We'll use the response handler approach
  }

  function renderKeys(keys) {
    dom.keysList.innerHTML = '';
    state.keysCache = keys || [];

    if (!keys || keys.length === 0) {
      dom.keysList.innerHTML = '<div class="empty-state"><p>No keys found</p></div>';
      return;
    }

    // Get types for each key
    keys.forEach((key, index) => {
      const item = document.createElement('div');
      // We don't know the type yet, let's query type for each
      item.className = 'key-item';
      item.dataset.key = key;
      item.innerHTML = `
        <div class="key-icon type-unknown">?</div>
        <span class="key-name">${escapeHtml(key)}</span>
        <span class="key-ttl">...</span>
      `;
      item.addEventListener('click', () => selectKey(key, item));
      dom.keysList.appendChild(item);

      // Deferred type loading
      setTimeout(() => queryKeyInfo(key, item), index * 50);
    });
  }

  function queryKeyInfo(key, itemEl) {
    if (!state.connected) return;

    // We can't use WS properly for this because responses are serial
    // Instead we'll use an indirect approach - store callbacks
    // For simplicity, let's use a staging approach
    const stagingId = 'staging_' + Date.now() + '_' + Math.random();
    window.__keyStaging = window.__keyStaging || {};
    window.__keyStaging[stagingId] = { key, itemEl, stage: 'type' };

    // Replace sendWS temporarily
    sendWS({ type: 'command', command: `TYPE ${key}` });
    // The response will be handled by the key staging system
  }

  // Override response handling to capture key info queries
  const _origHandle = handleRedisResponse;
  handleRedisResponse = function(msg) {
    // Check if this is a staged response
    if (window.__keyStaging) {
      const keys = Object.keys(window.__keyStaging);
      if (keys.length > 0) {
        const stagingId = keys[0];
        const stage = window.__keyStaging[stagingId];
        delete window.__keyStaging[stagingId];

        if (stage.stage === 'type') {
          const keyType = msg.raw && typeof msg.raw === 'string' ? msg.raw.toLowerCase() : 'string';
          const icon = stage.itemEl.querySelector('.key-icon');
          icon.className = `key-icon type-${keyType}`;
          icon.textContent = keyType[0]?.toUpperCase() || '?';

          // Now queue the TTL query
          const ttlId = 'staging_ttl_' + Date.now();
          window.__keyStaging[ttlId] = { key: stage.key, itemEl: stage.itemEl, stage: 'ttl' };
          sendWS({ type: 'command', command: `TTL ${stage.key}` });
          return;
        }

        if (stage.stage === 'ttl') {
          const ttl = msg.raw;
          const ttlEl = stage.itemEl.querySelector('.key-ttl');
          if (ttl === -1 || ttl === null) {
            ttlEl.textContent = '∞';
          } else if (ttl === -2) {
            ttlEl.textContent = 'del';
          } else {
            ttlEl.textContent = `${ttl}s`;
          }
          return;
        }
      }
    }

    // Default: pass to original handler
    _origHandle.call(this, msg);
  };

  function selectKey(key, itemEl) {
    // Remove selection from others
    dom.keysList.querySelectorAll('.key-item.selected').forEach(el => el.classList.remove('selected'));
    if (itemEl) itemEl.classList.add('selected');

    dom.detailKeyName.textContent = key;
    dom.keyDetail.classList.remove('hidden');

    // Get type
    sendWS({ type: 'command', command: `TYPE ${key}` });
    // Get value based on type - handle in response
    window.__detailQuery = { key, stage: 'type' };
  }

  // Override response for detail too
  handleRedisResponse = (function(orig) {
    return function(msg) {
      if (window.__detailQuery) {
        const q = window.__detailQuery;
        if (q.stage === 'type') {
          const type = msg.raw && typeof msg.raw === 'string' ? msg.raw.toLowerCase() : 'string';
          dom.detailKeyType.textContent = type.toUpperCase();
          dom.detailKeyType.className = `key-type-badge ${type}`;

          // Query value based on type
          q.stage = 'value';
          if (type === 'string') {
            sendWS({ type: 'command', command: `GET ${q.key}` });
          } else if (type === 'list') {
            sendWS({ type: 'command', command: `LRANGE ${q.key} 0 -1` });
          } else if (type === 'set') {
            sendWS({ type: 'command', command: `SMEMBERS ${q.key}` });
          } else if (type === 'hash') {
            sendWS({ type: 'command', command: `HGETALL ${q.key}` });
          } else if (type === 'zset') {
            sendWS({ type: 'command', command: `ZRANGE ${q.key} 0 -1 WITHSCORES` });
          } else {
            dom.detailValue.textContent = '(unknown type)';
            delete window.__detailQuery;
          }
          return;
        }
        if (q.stage === 'value') {
          dom.detailValue.textContent = formatDisplayValue(msg.raw);
          delete window.__detailQuery;
          return;
        }
      }

      orig.call(this, msg);
    };
  })(handleRedisResponse || _origHandle);

  // Also handle staging in the new wrapper
  (function() {
    const _handleResp = handleRedisResponse;

    // We need to add staging interceptor wrapped around the original
    const actualHandler = handleRedisResponse;
    handleRedisResponse = function(msg) {
      // Staging interceptor
      if (window.__keyStaging) {
        const keys = Object.keys(window.__keyStaging);
        if (keys.length > 0) {
          const stagingId = keys[0];
          const stage = window.__keyStaging[stagingId];
          delete window.__keyStaging[stagingId];

          if (stage.stage === 'type') {
            const keyType = msg.raw && typeof msg.raw === 'string' ? msg.raw.toLowerCase() : 'string';
            const icon = stage.itemEl.querySelector('.key-icon');
            icon.className = `key-icon type-${keyType}`;
            icon.textContent = keyType[0]?.toUpperCase() || '?';
            const ttlId = 'staging_ttl_' + Date.now() + '_' + Math.random();
            window.__keyStaging[ttlId] = { key: stage.key, itemEl: stage.itemEl, stage: 'ttl' };
            sendWS({ type: 'command', command: `TTL ${stage.key}` });
            return;
          }

          if (stage.stage === 'ttl') {
            const ttl = msg.raw;
            const ttlEl = stage.itemEl.querySelector('.key-ttl');
            if (ttl === -1 || ttl === null) {
              ttlEl.textContent = '∞';
            } else if (ttl === -2) {
              ttlEl.textContent = 'del';
            } else {
              ttlEl.textContent = `${ttl}s`;
            }
            return;
          }
        }
      }

      actualHandler(msg);
    };
  })();

  // ============================================================
  // Info Panel
  // ============================================================
  function loadInfo() {
    if (!state.connected) return;
    addConsoleLine('INFO', 'cmd');
    sendWS({ type: 'command', command: 'INFO' });
  }

  // ============================================================
  // Monitor
  // ============================================================
  function toggleMonitor() {
    state.monitorActive = !state.monitorActive;
    dom.monitorToggleBtn.textContent = state.monitorActive ? 'Stop Monitor' : 'Start Monitor';
    dom.monitorToggleBtn.className = state.monitorActive ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-primary';

    if (state.monitorActive) {
      addConsoleLine('Monitor started — all commands will be shown', 'resp-info');
      // In real Redis you'd use MONITOR command, but for this UI we just show all traffic
    } else {
      addConsoleLine('Monitor stopped', 'resp-info');
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

  function getSelectedKeyType() {
    return dom.keyTypeFilter.value;
  }

  // ============================================================
  // Event Handlers
  // ============================================================

  // --- Navigation ---
  dom.navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      dom.navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      dom.panels.forEach(p => p.classList.remove('active'));
      const target = document.getElementById(`panel-${panel}`);
      if (target) target.classList.add('active');
      state.currentPanel = panel;
    });
  });

  // --- Send Command ---
  dom.sendBtn.addEventListener('click', () => {
    executeCommand(dom.commandInput.value);
    dom.commandInput.value = '';
    hideAutocomplete();
  });

  dom.commandInput.addEventListener('keydown', (e) => {
    const input = dom.commandInput;
    const suggestions = getCommandSuggestions(input.value.split(' ')[0]);

    if (e.key === 'Enter') {
      e.preventDefault();
      // Check if autocomplete is open
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
        if (selected) {
          applyAutocomplete(selected.dataset.cmd);
        }
      }
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!dom.autocompleteBox.classList.contains('hidden')) {
        const items = dom.autocompleteBox.querySelectorAll('.autocomplete-item');
        const selected = dom.autocompleteBox.querySelector('.selected');
        let idx = -1;
        items.forEach((item, i) => { if (item === selected) idx = i; });
        if (idx > 0) {
          items[idx].classList.remove('selected');
          items[idx - 1].classList.add('selected');
        }
        return;
      }
      if (state.historyIndex > 0) {
        state.historyIndex--;
        input.value = state.commandHistory[state.historyIndex];
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!dom.autocompleteBox.classList.contains('hidden')) {
        const items = dom.autocompleteBox.querySelectorAll('.autocomplete-item');
        const selected = dom.autocompleteBox.querySelector('.selected');
        let idx = -1;
        items.forEach((item, i) => { if (item === selected) idx = i; });
        if (idx < items.length - 1) {
          items[idx].classList.remove('selected');
          items[idx + 1].classList.add('selected');
        }
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

  dom.commandInput.addEventListener('input', () => {
    const val = dom.commandInput.value;
    const firstWord = val.split(' ')[0];
    const suggestions = getCommandSuggestions(firstWord);
    showAutocomplete(suggestions);
  });

  // Click outside autocomplete
  document.addEventListener('click', (e) => {
    if (!dom.autocompleteBox.contains(e.target) && e.target !== dom.commandInput) {
      hideAutocomplete();
    }
  });

  // Autocomplete item click
  dom.autocompleteBox.addEventListener('click', (e) => {
    const item = e.target.closest('.autocomplete-item');
    if (item) {
      applyAutocomplete(item.dataset.cmd);
    }
  });

  // --- Clear Console ---
  dom.clearConsoleBtn.addEventListener('click', () => {
    dom.consoleOutput.innerHTML = '';
  });

  // --- Reconnect ---
  dom.reconnectBtn.addEventListener('click', () => {
    if (state.ws) {
      state.ws.close();
    }
    addConsoleLine('Reconnecting...', 'resp-info');
    setTimeout(connectWS, 500);
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
    dom.monitorOutput.innerHTML = '<div class="empty-state"><p>Monitor cleared</p></div>';
  });

  // --- Delete Key ---
  dom.detailDeleteBtn.addEventListener('click', () => {
    const key = dom.detailKeyName.textContent;
    if (key && confirm(`Delete key "${key}"?`)) {
      addConsoleLine(`DEL ${key}`, 'cmd');
      sendWS({ type: 'command', command: `DEL ${key}` });
      dom.keyDetail.classList.add('hidden');
      loadKeys(dom.keySearch.value || '*');
    }
  });

  // ============================================================
  // Initialize
  // ============================================================
  function init() {
    // Initialize connection info
    dom.redisTarget.textContent = 'loading...';

    // Fetch server status
    fetch('/api/status')
      .then(r => r.json())
      .then(data => {
        dom.redisTarget.textContent = data.redisTarget;
      })
      .catch(() => {
        dom.redisTarget.textContent = 'unknown';
      });

    // Connect WebSocket
    connectWS();

    // Focus input
    dom.commandInput.focus();
  }

  init();
})();
