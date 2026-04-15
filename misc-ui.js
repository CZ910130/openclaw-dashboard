window.loadMemoryFile = async function(name) {
  try {
    name = decodeURIComponent(name);
    const titleEl = document.getElementById('memoryFileTitle');
    const contentEl = document.getElementById('memoryFileContent');
    titleEl.textContent = name;
    setViewerMessage(contentEl, 'Loading...');
    const res = await authFetch(API_BASE + '/api/memory-file?path=' + encodeURIComponent(name));
    const content = await res.text();
    renderSimpleMarkdown(contentEl, content);
  } catch (e) {
    setViewerMessage(document.getElementById('memoryFileContent'), 'Failed to load file', 'var(--red)');
  }
};

// Files page
let keyFiles = [];
let currentKeyFile = null;
let keyFileEditing = false;
let _currentKeyFileRaw = '';

window.fetchKeyFiles = async function fetchKeyFiles() {
  try {
    const res = await authFetch(API_BASE + '/api/key-files');
    keyFiles = await res.json();
    renderKeyFilesList();
  } catch {}
}

function renderKeyFilesList() {
  const el = document.getElementById('keyFilesList');
  if (!el) return;
  const now = Date.now();
  if (!keyFiles.length) {
    setEmptyState(el, 'No files found');
    return;
  }
  el.innerHTML = '';
  keyFiles.forEach(f => {
    const age = now - f.modified;
    const ago = age < 60000 ? 'just now' : age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
    const sizeKb = (f.size / 1024).toFixed(1);
    const icon = f.name.startsWith('skills/') ? '🎯' : f.name.endsWith('.service') ? '⚙️' : f.name.endsWith('.json') ? '🔧' : '📄';
    const isSelected = f.name === currentKeyFile;
    const item = document.createElement('div');
    item.className = 'file-list-item';
    if (isSelected) item.classList.add('file-list-item-selected');
    item.onmouseover = () => { item.classList.add('file-list-item-hover'); };
    item.onmouseout = () => { item.classList.remove('file-list-item-hover'); };
    item.onclick = () => window.loadKeyFile(encodeURIComponent(f.name));

    const header = document.createElement('div');
    header.className = 'file-list-item-header';

    const iconEl = document.createElement('span');
    iconEl.className = 'file-list-item-icon';
    iconEl.textContent = icon;

    const nameEl = document.createElement('span');
    nameEl.className = 'file-list-item-name';
    nameEl.textContent = f.name;

    const metaEl = document.createElement('div');
    metaEl.className = 'file-list-item-meta';
    metaEl.textContent = `${sizeKb} KB · ${ago}`;

    header.appendChild(iconEl);
    header.appendChild(nameEl);
    item.appendChild(header);
    item.appendChild(metaEl);
    el.appendChild(item);
  });
}

window.loadKeyFile = async function(name) {
  name = decodeURIComponent(name);
  currentKeyFile = name;
  keyFileEditing = false;
  const titleEl = document.getElementById('keyFileTitle');
  const contentEl = document.getElementById('keyFileContent');
  const editorEl = document.getElementById('keyFileEditor');
  const editBtn = document.getElementById('keyFileEditBtn');
  const saveBtn = document.getElementById('keyFileSaveBtn');
  const cancelBtn = document.getElementById('keyFileCancelBtn');

  titleEl.textContent = name;
  setViewerMessage(contentEl, 'Loading...');
  setHiddenState(contentEl, false);
  setHiddenState(editorEl, true);
  setHiddenState(editBtn, false);
  setHiddenState(saveBtn, true);
  setHiddenState(cancelBtn, true);

  renderKeyFilesList();

  try {
    const res = await authFetch(API_BASE + '/api/key-file?path=' + encodeURIComponent(name));
    if (!res.ok) { setViewerMessage(contentEl, 'Failed to load: ' + res.status, 'var(--red)'); return; }
    const content = await res.text();
    _currentKeyFileRaw = content;

    if (name.endsWith('.md')) {
      renderSimpleMarkdown(contentEl, content);
    } else {
      contentEl.innerHTML = '';
      const pre = document.createElement('pre');
      pre.style.cssText = 'white-space:pre-wrap;word-wrap:break-word;';
      pre.textContent = content;
      contentEl.appendChild(pre);
    }
  } catch (e) {
    setViewerMessage(contentEl, 'Failed to load file', 'var(--red)');
  }
};

window.editKeyFile = function() {
  if (!currentKeyFile) return;
  keyFileEditing = true;
  const contentEl = document.getElementById('keyFileContent');
  const editorEl = document.getElementById('keyFileEditor');
  const editBtn = document.getElementById('keyFileEditBtn');
  const saveBtn = document.getElementById('keyFileSaveBtn');
  const cancelBtn = document.getElementById('keyFileCancelBtn');

  editorEl.value = _currentKeyFileRaw;
  setHiddenState(contentEl, true);
  setHiddenState(editorEl, false);
  setHiddenState(editBtn, true);
  setHiddenState(saveBtn, false);
  setHiddenState(cancelBtn, false);
  editorEl.focus();
};

window.cancelEditKeyFile = function() {
  keyFileEditing = false;
  const contentEl = document.getElementById('keyFileContent');
  const editorEl = document.getElementById('keyFileEditor');
  const editBtn = document.getElementById('keyFileEditBtn');
  const saveBtn = document.getElementById('keyFileSaveBtn');
  const cancelBtn = document.getElementById('keyFileCancelBtn');

  setHiddenState(contentEl, false);
  setHiddenState(editorEl, true);
  setHiddenState(editBtn, false);
  setHiddenState(saveBtn, true);
  setHiddenState(cancelBtn, true);
};

window.saveKeyFile = async function() {
  if (!currentKeyFile) return;
  const editorEl = document.getElementById('keyFileEditor');
  const saveBtn = document.getElementById('keyFileSaveBtn');
  const content = editorEl.value;

  saveBtn.textContent = 'Saving…';
  saveBtn.disabled = true;

  try {
    const res = await authFetch(API_BASE + '/api/key-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentKeyFile, content })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');

    saveBtn.textContent = 'Saved!';
    setTimeout(() => {
      saveBtn.textContent = 'Save';
      saveBtn.disabled = false;
    }, 1200);
    window.cancelEditKeyFile();
    await window.loadKeyFile(currentKeyFile);
  } catch (e) {
    saveBtn.textContent = 'Save';
    saveBtn.disabled = false;
    const contentEl = document.getElementById('keyFileContent');
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'color:var(--red);font-size:12px;margin-top:8px;';
    errDiv.textContent = 'Error: ' + e.message;
    contentEl.parentNode.appendChild(errDiv);
    setTimeout(() => errDiv.remove(), 4000);
  }
};

function formatTimeAgo(ms, future) {
  if (ms < 60000) return (future ? 'in ' : '') + 'less than a minute';
  if (ms < 3600000) return (future ? 'in ' : '') + Math.round(ms/60000) + 'm';
  if (ms < 86400000) return (future ? 'in ' : '') + Math.round(ms/3600000) + 'h';
  return (future ? 'in ' : '') + Math.round(ms/86400000) + 'd';
}

function handleGlobalShortcutKeydown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  const pages = ['overview', 'sessions', 'costs', 'limits', 'feed'];
  if (e.key >= '1' && e.key <= '5') {
    const idx = parseInt(e.key) - 1;
    if (pages[idx]) activatePage(pages[idx]);
  } else if (e.key === ' ' && document.querySelector('.page.active')?.id === 'feed') {
    e.preventDefault();
    toggleFeedPause();
  } else if (e.key === 'Escape') {
    closeSessionModal();
    toggleShortcuts(false);
  } else if (e.key === '/') {
    e.preventDefault();
    const activePage = document.querySelector('.page.active')?.id;
    if (activePage === 'sessions') {
      document.getElementById('sessionSearch')?.focus();
    } else if (activePage === 'feed') {
      document.getElementById('feedSearchInput')?.focus();
    }
  } else if (e.key === '?') {
    e.preventDefault();
    toggleShortcuts();
  }
}

function toggleShortcuts(force) {
  const overlay = document.getElementById('shortcutsOverlay');
  if (force === false) {
    overlay.classList.remove('active');
  } else {
    overlay.classList.toggle('active');
  }
}

// Browser notifications
if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
  notificationsEnabled = true;
}

function sendNotification(title, body) {
  if (notificationsEnabled && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '✨' });
    } catch {}
  }
}

// Feed search
let feedSearchTerm = '';
function bindFeedSearchInput() {
  const feedSearchInputEl = document.getElementById('feedSearchInput');
  if (feedSearchInputEl && feedSearchInputEl.dataset.boundFeedSearch !== 'true') {
    feedSearchInputEl.dataset.boundFeedSearch = 'true';
    feedSearchInputEl.addEventListener('input', (e) => {
      feedSearchTerm = e.target.value.toLowerCase();
      applyFeedFilter();
    });
  }
}

function clearFeedSearch() {
  document.getElementById('feedSearchInput').value = '';
  feedSearchTerm = '';
  applyFeedFilter();
}

function highlightText(text, term) {
  if (!term) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(term);
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.substring(0, idx)) + '<span class="search-highlight">' + escapeHtml(text.substring(idx, idx + term.length)) + '</span>' + escapeHtml(text.substring(idx + term.length));
}

// Session comparison
let compareMode = false;
function toggleSessionCompare(key, checked) {
  if (checked) {
    selectedSessions.add(key);
  } else {
    selectedSessions.delete(key);
  }
  
  const btn = document.getElementById('compareBtn');
  if (selectedSessions.size === 2) {
    if (!btn) {
      const b = document.createElement('button');
      b.id = 'compareBtn';
      b.className = 'compare-btn';
      b.textContent = 'Compare Sessions';
      b.onclick = showComparison;
      document.body.appendChild(b);
    }
  } else if (btn) {
    btn.remove();
  }
}

function showComparison() {
  const keys = Array.from(selectedSessions);
  const s1 = sessions.find(s => s.key === keys[0]);
  const s2 = sessions.find(s => s.key === keys[1]);
  if (!s1 || !s2) return;

  const maxTokens = Math.max(s1.totalTokens || 0, s2.totalTokens || 0, 1);
  const maxCost = Math.max(s1.cost || 0, s2.cost || 0, 0.0001);

  const modal = document.getElementById('sessionModal');
  const modalStats = modal.querySelector('#modalStats');
  const modalMessages = modal.querySelector('#modalMessages');
  modal.querySelector('#modalTitle').textContent = 'Session Comparison';
  modal.querySelector('#modalKey').textContent = '';
  modalStats.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'compare-grid';
  [
    { s: s1, color: 'var(--accent)', costColor: 'var(--green)' },
    { s: s2, color: 'var(--purple)', costColor: 'var(--cyan)' }
  ].forEach(({ s, color, costColor }) => {
    const col = document.createElement('div');
    const title = document.createElement('h3');
    title.className = 'compare-title';
    title.style.color = color;
    title.textContent = s.label;
    col.appendChild(title);

    const info = document.createElement('div');
    info.className = 'compare-info';
    [
      ['Model', s.model.split('/').pop()],
      ['Tokens', (s.totalTokens||0).toLocaleString()],
      ['Cost', '$' + (s.cost||0).toFixed(2)]
    ].forEach(([label, value]) => {
      const row = document.createElement('div');
      const labelEl = document.createElement('span');
      labelEl.className = 'compare-label';
      labelEl.textContent = label + ': ';
      const valueEl = document.createElement('span');
      valueEl.className = 'mono';
      valueEl.textContent = value;
      row.appendChild(labelEl);
      row.appendChild(valueEl);
      info.appendChild(row);
    });

    const bars = document.createElement('div');
    bars.className = 'compare-bars';
    [
      ['Tokens', Math.round(((s.totalTokens||0)/maxTokens)*100), color],
      ['Cost', Math.round(((s.cost||0)/maxCost)*100), costColor]
    ].forEach(([label, pct, fill], idx) => {
      const labelEl = document.createElement('div');
      labelEl.className = 'compare-bar-label';
      if (idx) labelEl.classList.add('compare-bar-label-spaced');
      labelEl.textContent = label;
      const outer = document.createElement('div');
      outer.className = 'compare-bar-track';
      const inner = document.createElement('div');
      inner.className = 'compare-bar-fill';
      inner.style.width = `${pct}%`;
      inner.style.background = fill;
      outer.appendChild(inner);
      bars.appendChild(labelEl);
      bars.appendChild(outer);
    });
    info.appendChild(bars);
    col.appendChild(info);
    wrapper.appendChild(col);
  });
  modalStats.appendChild(wrapper);
  modalMessages.innerHTML = '';
  modalMessages.appendChild(createMutedNote('Comparison complete', 'compare-complete-note'));
  setOpenState(modal, true, SESSION_MODAL_OPEN_CLASS);
}

function renderDiskSparkline(history) {
  if (!history || history.length < 2) return;
  const el = document.getElementById('diskSparkline');
  if (!el) return;
  const w = 120, h = 40;
  const vals = history.map(p => p.v);
  const min = Math.max(Math.min(...vals) - 2, 0);
  const max = Math.min(Math.max(...vals) + 2, 100);
  const range = max - min || 1;
  const points = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="var(--purple)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function openSessionDetail(key) {
  const s = sessions.find(x => x.key === key);
  if (!s) return;
  const modalTitle = document.getElementById('modalTitle');
  const modalKey = document.getElementById('modalKey');
  const modalStats = document.getElementById('modalStats');
  const modalMessages = document.getElementById('modalMessages');
  modalTitle.textContent = s.label;
  modalKey.textContent = s.key;
  const age = Date.now() - s.updatedAt;
  const ago = age < 60000 ? 'just now' : age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
  const isActive = age < 300000 && !s.aborted;
  modalStats.innerHTML = '';
  [
    ['Status', isActive ? '🟢 Active' : s.aborted ? '🔴 Aborted' : '⚪ Idle', isActive ? 'var(--green)' : 'var(--text-primary)', false],
    ['Model', s.model.split('/').pop(), null, true],
    ['Tokens', (s.totalTokens||0).toLocaleString(), null, true],
    ['Cost', '$' + (s.cost||0).toFixed(2), null, true],
    ['Last Active', ago, null, false],
    ['Channel', s.channel || '--', null, false]
  ].forEach(([label, value, color, mono]) => {
    modalStats.appendChild(createLabeledValue(label, value, {
      valueColor: color || '',
      valueWeight: color ? '600' : '',
      mono,
      compactLabel: true
    }));
  });
  renderSessionMessages(modalMessages, [], { loadingText: 'Loading...' });
  setOpenState('sessionModal', true, SESSION_MODAL_OPEN_CLASS);
  authFetch(API_BASE + '/api/session-messages?id=' + encodeURIComponent(s.sessionId || s.key))
    .then(r => r.json())
    .then(msgs => {
      renderSessionMessages(modalMessages, msgs, { emptyText: 'No messages found' });
    }).catch(() => {
      modalMessages.innerHTML = '';
      modalMessages.appendChild(createMutedNote('Failed to load'));
    });
}
function closeSessionModal() { setOpenState('sessionModal', false, SESSION_MODAL_OPEN_CLASS); }

// Toast notifications
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const icons = { success: '✅', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const iconEl = document.createElement('div');
  iconEl.className = 'toast-icon';
  iconEl.textContent = icons[type] || icons.info;

  const contentEl = document.createElement('div');
  contentEl.className = 'toast-content';
  const messageEl = document.createElement('div');
  messageEl.className = 'toast-message';
  messageEl.textContent = String(message || '');
  contentEl.appendChild(messageEl);

  toast.appendChild(iconEl);
  toast.appendChild(contentEl);
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Quick Actions
async function quickAction(action, evt) {
  const confirmMsg = {
    'restart-openclaw': 'Restart OpenClaw? This will interrupt running tasks.',
    'restart-dashboard': 'Restart Dashboard? Page will reload.',
    'restart-tailscale': 'Restart Tailscale? Network may drop briefly.',
    'update-openclaw': 'Update OpenClaw? This may take a minute.',
    'kill-tmux': 'Kill all tmux sessions? (including Claude persistent session)',
    'sys-update': 'Run apt update + upgrade? This may take several minutes.',
    'disk-cleanup': null,
    'restart-claude': null,
    'check-update': null,
    'clear-cache': null,
    'gc': null,
    'scrape-usage': null
  };
  
  if (confirmMsg[action] && !confirm(confirmMsg[action])) return;

  const loadingLabels = {
    'restart-openclaw': '🔄 Restarting...',
    'restart-dashboard': '🔄 Restarting...',
    'clear-cache': '🗑️ Clearing...',
    'restart-tailscale': '🌐 Restarting...',
    'update-openclaw': '⬆️ Updating...',
    'kill-tmux': '🧹 Killing...',
    'gc': '♻️ Running GC...',
    'check-update': '🔍 Checking...',
    'sys-update': '📦 Updating...',
    'disk-cleanup': '💾 Cleaning...',
    'restart-claude': '🤖 Restarting...'
  };

  const evtTarget = evt && evt.target ? evt.target : null;
  const triggerBtn = (evtTarget && typeof evtTarget.closest === 'function' ? evtTarget.closest('.qa-btn') : null) || evtTarget;
  const origText = triggerBtn && triggerBtn.textContent ? triggerBtn.textContent : '';
  if (triggerBtn) { triggerBtn.textContent = loadingLabels[action] || '⏳ Working...'; triggerBtn.disabled = true; triggerBtn.style.opacity = '0.6'; triggerBtn.style.pointerEvents = 'none'; }

  try {
    const res = await authFetch(`/api/action/${action}`, { method: 'POST' });
    const data = await res.json();
    
    if (data.success) {
      showToast(data.output || data.message || 'Action completed successfully', 'success');
      
      if (action === 'restart-dashboard') {
        setTimeout(() => location.reload(), 3000);
      } else if (action === 'clear-cache') {
        setTimeout(() => fetchData(), 500);
      }
    } else {
      showToast('Action failed: ' + (data.error || 'Unknown error'), 'warning');
    }
  } catch (e) {
    showToast('Action failed: ' + e.message, 'warning');
  } finally {
    if (triggerBtn) { triggerBtn.textContent = origText; triggerBtn.disabled = false; triggerBtn.style.opacity = '1'; triggerBtn.style.pointerEvents = ''; }
  }
}

// Tailscale Status
async function fetchTailscaleStatus() {
  try {
    const res = await authFetch(API_BASE + '/api/tailscale');
    const data = await res.json();

    const statusEl = document.getElementById('tailscaleStatus');
    if (!statusEl) return;

    if (data.error) {
      statusEl.innerHTML = '';
      const msg = document.createElement('div');
      msg.style.color = 'var(--text-muted)';
      msg.textContent = data.error;
      statusEl.appendChild(msg);
      return;
    }

    statusEl.innerHTML = '';
    const rows = [
      ['Status', data.online ? 'Online' : 'Offline', data.online ? 'var(--green)' : 'var(--red)', false],
      ['Device', data.hostname, null, true],
      ['Tailnet IP', data.ip, null, true],
      ['Connected Peers', String(data.peers), null, false]
    ];
    rows.forEach((row, idx) => {
      const el = document.createElement('div');
      el.className = 'tailscale-row';
      if (idx < rows.length - 1) el.classList.add('tailscale-row-bordered');
      const left = document.createElement('span');
      left.className = 'tailscale-label';
      left.textContent = row[0];
      const right = document.createElement('span');
      if (row[2]) {
        right.style.color = row[2];
        right.style.fontWeight = '600';
      }
      if (row[3]) {
        right.classList.add('mono', 'tailscale-value-mono');
      }
      right.textContent = row[1] || '--';
      el.appendChild(left);
      el.appendChild(right);
      statusEl.appendChild(el);
    });

    if (data.routes && data.routes.length > 0) {
      const wrap = document.createElement('div');
      wrap.className = 'tailscale-routes';
      const title = document.createElement('div');
      title.className = 'tailscale-routes-title';
      title.textContent = 'Active Routes';
      wrap.appendChild(title);
      data.routes.forEach(r => {
        const line = document.createElement('div');
        line.className = 'tailscale-route-line mono';
        line.textContent = r;
        wrap.appendChild(line);
      });
      statusEl.appendChild(wrap);
    }
  } catch (e) {
    const statusEl = document.getElementById('tailscaleStatus');
    if (statusEl) {
      statusEl.innerHTML = '';
      statusEl.appendChild(createMutedNote('Failed to load'));
    }
  }
}

// Lifetime Stats
async function fetchLifetimeStats() {
  try {
    const res = await authFetch(API_BASE + '/api/lifetime-stats');
    const data = await res.json();
    
    document.getElementById('ltTokens').textContent = data.totalTokens >= 1000000 ? (data.totalTokens / 1000000).toFixed(1) + 'M' : data.totalTokens >= 1000 ? (data.totalTokens / 1000).toFixed(0) + 'k' : data.totalTokens;
    document.getElementById('ltMessages').textContent = data.totalMessages.toLocaleString();
    document.getElementById('ltCost').textContent = '$' + data.totalCost.toFixed(2);
    document.getElementById('ltSessions').textContent = data.totalSessions;
    document.getElementById('ltDaysActive').textContent = data.daysActive;
    
    if (data.firstSessionDate) {
      const date = new Date(data.firstSessionDate);
      document.getElementById('ltFirstDate').textContent = date.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  } catch {}
}

// Activity Streak — GitHub-style contribution graph
function calculateStreak() {
  try {
    const perDay = costs.perDay || {};

    document.getElementById('currentStreak').textContent = costs.currentStreak || 0;
    document.getElementById('longestStreak').textContent = costs.longestStreak || 0;

    const calendarEl = document.getElementById('streakCalendar');
    if (!calendarEl) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 364 days (52 weeks), aligned to start on Sunday
    const startDay = new Date(today);
    startDay.setDate(startDay.getDate() - 363);
    startDay.setDate(startDay.getDate() - startDay.getDay());

    const dayCosts = [];
    const d = new Date(startDay);
    while (d <= today) {
      const key = d.toISOString().substring(0, 10);
      dayCosts.push({ date: key, cost: perDay[key] || 0 });
      d.setDate(d.getDate() + 1);
    }

    // Quartile thresholds from non-zero values
    const nonZero = dayCosts.map(x => x.cost).filter(c => c > 0).sort((a, b) => a - b);
    let q1 = 0, q2 = 0, q3 = 0;
    if (nonZero.length > 0) {
      q1 = nonZero[Math.floor(nonZero.length * 0.25)];
      q2 = nonZero[Math.floor(nonZero.length * 0.50)];
      q3 = nonZero[Math.floor(nonZero.length * 0.75)];
    }
    function getLevel(cost) {
      if (cost <= 0) return 0;
      if (cost <= q1) return 1;
      if (cost <= q2) return 2;
      if (cost <= q3) return 3;
      return 4;
    }

    // Group into weeks (columns)
    const weeks = [];
    for (let i = 0; i < dayCosts.length; i += 7) weeks.push(dayCosts.slice(i, i + 7));

    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

    // Build DOM instead of innerHTML for safety
    const frag = document.createDocumentFragment();

    // Dynamic cell size to fill card width
    const dayLabelWidth = 28;
    const gapPx = 3;
    const availWidth = calendarEl.parentElement.clientWidth - dayLabelWidth;
    const dynamicCell = Math.max(10, Math.min(14, Math.round((availWidth - (weeks.length - 1) * gapPx) / weeks.length)));
    const weekPx = dynamicCell + gapPx;

    // Month labels — positioned absolutely above the grid columns
    const monthRow = document.createElement('div');
    monthRow.className = 'contrib-months';
    let lastMonth = -1;
    for (let wi = 0; wi < weeks.length; wi++) {
      const firstDay = new Date(weeks[wi][0].date);
      const m = firstDay.getMonth();
      if (m !== lastMonth) {
        const ml = document.createElement('span');
        ml.className = 'contrib-month-label';
        ml.textContent = months[m];
        ml.style.left = (wi * weekPx) + 'px';
        monthRow.appendChild(ml);
        lastMonth = m;
      }
    }
    frag.appendChild(monthRow);

    // Grid container
    const grid = document.createElement('div');
    grid.className = 'contrib-grid';

    // Day labels column
    const dayCol = document.createElement('div');
    dayCol.className = 'contrib-days';
    for (const label of dayLabels) {
      const dl = document.createElement('div');
      dl.className = 'contrib-day-label';
      dl.textContent = label;
      dayCol.appendChild(dl);
    }
    grid.appendChild(dayCol);

    // Week columns
    for (const week of weeks) {
      const col = document.createElement('div');
      col.className = 'contrib-col';
      for (let row = 0; row < 7; row++) {
        const cell = document.createElement('div');
        cell.className = 'contrib-cell';
        cell.style.width = dynamicCell + 'px';
        cell.style.height = dynamicCell + 'px';
        if (row < week.length) {
          const entry = week[row];
          const isFuture = new Date(entry.date) > today;
          const level = isFuture ? -1 : getLevel(entry.cost);
          cell.classList.add('contrib-level-' + level);
          cell.title = entry.date + ': ' + (entry.cost > 0 ? '$' + entry.cost.toFixed(2) : 'No activity');
        } else {
          cell.classList.add('contrib-level--1');
        }
        col.appendChild(cell);
      }
      grid.appendChild(col);
    }
    frag.appendChild(grid);

    // Legend — render into header row beside streak stats
    const legendEl = document.getElementById('streakLegend');
    if (legendEl) {
      legendEl.innerHTML = '';
      const lessSpan = document.createElement('span');
      lessSpan.textContent = 'Less';
      legendEl.appendChild(lessSpan);
      for (let i = 0; i <= 4; i++) {
        const lc = document.createElement('div');
        lc.className = 'contrib-cell contrib-level-' + i;
        legendEl.appendChild(lc);
      }
      const moreSpan = document.createElement('span');
      moreSpan.textContent = 'More';
      legendEl.appendChild(moreSpan);
    }

    calendarEl.replaceChildren(frag);

    // Align legend right edge with grid right edge
    if (legendEl) {
      const headerDiv = legendEl.parentElement;
      const gridEl = calendarEl.querySelector('.contrib-grid');
      if (headerDiv && gridEl) {
        legendEl.style.right = (headerDiv.offsetWidth - gridEl.offsetWidth) + 'px';
      }
    }
  } catch (e) {
    console.error('Streak calculation error:', e);
  }
}

// Logs Viewer
let logAutoRefreshEntry = null;

async function fetchLogs() {
  const service = document.getElementById('logService').value;
  const lines = document.getElementById('logLines').value;
  const viewer = document.getElementById('logViewer');

  if (!viewer) return;
  viewer.innerHTML = '<div style="color:var(--text-muted);">Loading logs...</div>';

  try {
    const res = await authFetch(API_BASE + `/api/logs?service=${service}&lines=${lines}`);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const logs = await res.text();
    viewer.textContent = logs;
    viewer.scrollTop = viewer.scrollHeight;
  } catch (e) {
    viewer.innerHTML = '<div style="color:var(--red);">Failed to load logs: ' + escapeHtml(e.message) + '</div>';
  }
}

function toggleLogAutoRefresh(enabled) {
  clearVisibleInterval(logAutoRefreshEntry);
  logAutoRefreshEntry = null;

  if (enabled) {
    fetchLogs();
    logAutoRefreshEntry = visibleInterval(fetchLogs, 5000);
  }
}

// Update document title with usage percentage
function updatePageTitle() {
  try {
    const cu = cachedClaudeUsageData;
    if (cu && cu.session) {
      document.title = cu.session.percent + '% | Agent Dashboard';
    }
  } catch {}
}

// Add session duration to stats
const origUpdateSessionsStats = updateSessionsStats;
updateSessionsStats = function(filtered) {
  origUpdateSessionsStats(filtered);
  
  // Calculate average session duration
  try {
    const durations = filtered
      .filter(s => s.createdAt && s.updatedAt)
      .map(s => s.updatedAt - s.createdAt)
      .filter(d => d > 0 && d < 86400000 * 30);
    
    if (durations.length > 0) {
      const avgDur = durations.reduce((a, b) => a + b, 0) / durations.length;
      const hours = Math.floor(avgDur / 3600000);
      const mins = Math.floor((avgDur % 3600000) / 60000);
      
      const statsBar = document.getElementById('sessionsStatsBar');
      if (statsBar) {
        const avgDurEl = document.getElementById('statsAvgDuration');
        if (!avgDurEl) {
          const container = statsBar.querySelector('div[style*="display:flex"]');
          if (container) {
            const durDiv = document.createElement('div');
            durDiv.className = 'stats-duration';
            const label = document.createElement('span');
            label.className = 'stats-duration-label';
            label.textContent = 'Avg Duration';
            const value = document.createElement('span');
            value.className = 'mono stats-duration-value';
            value.id = 'statsAvgDuration';
            value.textContent = `${hours > 0 ? hours + 'h ' : ''}${mins}m`;
            durDiv.appendChild(label);
            durDiv.appendChild(value);
            container.appendChild(durDiv);
          }
        } else {
          avgDurEl.textContent = `${hours > 0 ? hours + 'h ' : ''}${mins}m`;
        }
      }
    }
  } catch {}
};

// Add duration to expanded session view
const origToggleSessionExpand = toggleSessionExpand;
toggleSessionExpand = function(key, e) {
  origToggleSessionExpand(key, e);
  
  try {
    const s = sessions.find(x => x.key === key);
    if (!s || !s.createdAt) return;
    
    const detail = document.getElementById('expanded-' + CSS.escape(key));
    if (!detail) return;
    
    const now = s.updatedAt || Date.now();
    const duration = now - s.createdAt;
    
    const days = Math.floor(duration / 86400000);
    const hours = Math.floor((duration % 86400000) / 3600000);
    const mins = Math.floor((duration % 3600000) / 60000);
    
    let durStr = '';
    if (days > 0) durStr = `${days}d ${hours}h`;
    else if (hours > 0) durStr = `${hours}h ${mins}m`;
    else durStr = `${mins}m`;
    
    const grid = detail.querySelector('div[style*="display:grid"]');
    if (grid && !document.getElementById('dur-' + CSS.escape(key))) {
      const durDiv = document.createElement('div');
      durDiv.id = 'dur-' + CSS.escape(key);
      const label = document.createElement('div');
      label.className = 'session-duration-label';
      label.textContent = 'Duration';
      const value = document.createElement('div');
      value.style.fontSize = '12px';
      value.textContent = durStr;
      durDiv.appendChild(label);
      durDiv.appendChild(value);
      grid.appendChild(durDiv);
    }
  } catch {}
};

function initMiscUi() {
  if (!document.body.dataset.boundMiscUi) {
    document.body.dataset.boundMiscUi = 'true';
    document.addEventListener('keydown', handleGlobalShortcutKeydown);
  }
  bindFeedSearchInput();
  fetchTailscaleStatus();
  fetchLifetimeStats();
  visibleInterval(fetchTailscaleStatus, 30000);
  visibleInterval(fetchLifetimeStats, 60000);
  visibleInterval(updatePageTitle, 5000);
  visibleInterval(() => { if (costs.perDay) calculateStreak(); }, 10000);
  setTimeout(() => {
    if (costs.perDay) calculateStreak();
    updatePageTitle();
  }, 2000);
}

