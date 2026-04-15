let sessionFilter = 'all';
let sessionSearch = '';
let modelFilter = 'all';
let dateRange = '7d';
let expandedSessionKey = null;
let _msgPollEntry = null;

function refreshExpandedMessages(key) {
  const s = sessions.find(x => x.key === key);
  if (!s) return;
  const el = document.getElementById('expanded-msgs-' + CSS.escape(key));
  if (!el) { expandedSessionKey = null; return; }
  authFetch(API_BASE + '/api/session-messages?id=' + encodeURIComponent(s.sessionId || s.key))
    .then(r => r.json())
    .then(msgs => {
      if (!document.getElementById('expanded-msgs-' + CSS.escape(key))) return;
      const last10 = msgs.slice(-10);
      renderSessionMessages(el, last10, { emptyText: 'No messages', compact: true });
    }).catch(() => {});
}

function startMsgPoll(key) {
  stopMsgPoll();
  _msgPollEntry = visibleInterval(() => refreshExpandedMessages(key), 5000);
}
function stopMsgPoll() {
  clearVisibleInterval(_msgPollEntry);
  _msgPollEntry = null;
}

function getFilteredSessions() {
  let filtered = [...sessions];
  const now = Date.now();

  if (dateRange === 'today') {
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    filtered = filtered.filter(s => s.updatedAt >= todayStart.getTime());
  } else if (dateRange === '7d') {
    filtered = filtered.filter(s => now - s.updatedAt < 7 * 86400000);
  } else if (dateRange === '30d') {
    filtered = filtered.filter(s => now - s.updatedAt < 30 * 86400000);
  }

  if (sessionFilter === 'running') {
    filtered = filtered.filter(s => now - s.updatedAt < 300000 && !s.aborted);
  } else if (sessionFilter === 'complete') {
    filtered = filtered.filter(s => now - s.updatedAt >= 300000 && !s.aborted);
  } else if (sessionFilter === 'aborted') {
    filtered = filtered.filter(s => s.aborted);
  } else if (sessionFilter === 'subagent') {
    filtered = filtered.filter(s => s.key.includes('subagent'));
  } else if (sessionFilter === 'cron') {
    filtered = filtered.filter(s => s.key.includes('cron'));
  } else if (sessionFilter === 'group') {
    filtered = filtered.filter(s => s.kind === 'group' || s.key.includes('group'));
  }

  if (modelFilter !== 'all') {
    filtered = filtered.filter(s => {
      const m = s.model.toLowerCase();
      if (modelFilter === 'opus-4-6') return m.includes('opus');
      if (modelFilter === 'sonnet') return m.includes('sonnet');
      if (modelFilter === 'gemini') return m.includes('gemini');
      return true;
    });
  }

  if (sessionSearch) {
    filtered = filtered.filter(s =>
      s.label.toLowerCase().includes(sessionSearch) ||
      s.key.toLowerCase().includes(sessionSearch) ||
      s.model.toLowerCase().includes(sessionSearch)
    );
  }

  return filtered;
}

function getModelColor(model) {
  const m = model.toLowerCase();
  if (m.includes('opus-4-6') || m.includes('opus-4')) return 'var(--accent)';
  if (m.includes('opus-4-5')) return 'var(--purple)';
  if (m.includes('sonnet')) return 'var(--cyan)';
  if (m.includes('gemini')) return 'var(--yellow)';
  return 'var(--text-muted)';
}

function updateSessionsStats(filtered) {
  const totalTokens = filtered.reduce((sum, s) => sum + (s.totalTokens || 0), 0);
  const totalCost = filtered.reduce((sum, s) => sum + (s.cost || 0), 0);
  document.getElementById('statsSessionCount').textContent = filtered.length;
  document.getElementById('statsTotalTokens').textContent = totalTokens >= 1000000 ? (totalTokens / 1000000).toFixed(1) + 'M' : totalTokens >= 1000 ? (totalTokens / 1000).toFixed(0) + 'k' : totalTokens;
  document.getElementById('statsTotalCost').textContent = '$' + totalCost.toFixed(2);
}

function renderTimeline(filtered) {
  const now = Date.now();
  const rangeMs = dateRange === 'today' ? 86400000 : dateRange === '7d' ? 7 * 86400000 : dateRange === '30d' ? 30 * 86400000 : 30 * 86400000;
  const start = now - rangeMs;
  const seen = new Set();
  const items = filtered.filter(s => s.updatedAt > start).sort((a, b) => b.updatedAt - a.updatedAt).filter(s => { if (seen.has(s.label)) return false; seen.add(s.label); return true; }).slice(0, 12);
  const timelineEl = document.getElementById('timelineCanvas');
  if (!items.length) {
    setEmptyState(timelineEl, 'No sessions in range');
    return;
  }

  const colors = { main: 'var(--accent)', sub: 'var(--cyan)', cron: 'var(--yellow)', group: 'var(--blue)' };
  const isMobile = window.innerWidth <= 768;
  const tickCount = dateRange === 'today' ? 6 : (isMobile ? 3 : 7);
  timelineEl.innerHTML = '';

  items.forEach(s => {
    const typeClass = s.key.includes('subagent') ? 'sub' : s.key.includes('cron') ? 'cron' : s.kind === 'group' ? 'group' : 'main';
    const color = colors[typeClass] || 'var(--accent)';
    const created = Math.max(s.createdAt || s.updatedAt, start);
    const leftPct = Math.max(((created - start) / rangeMs) * 100, 0);
    const rightPct = Math.min(((s.updatedAt - start) / rangeMs) * 100, 100);
    const widthPct = Math.max(rightPct - leftPct, 1);
    const row = document.createElement('div');
    row.className = 'timeline-row';

    const labelEl = document.createElement('div');
    labelEl.className = 'timeline-label';
    labelEl.textContent = s.label;

    const barWrap = document.createElement('div');
    barWrap.className = 'timeline-bar-wrap';

    const bar = document.createElement('div');
    bar.className = 'timeline-bar';
    bar.style.left = `${leftPct}%`;
    bar.style.width = `${widthPct}%`;
    bar.style.background = color;

    barWrap.appendChild(bar);
    row.appendChild(labelEl);
    row.appendChild(barWrap);
    timelineEl.appendChild(row);
  });

  const ticksWrap = document.createElement('div');
  ticksWrap.className = 'timeline-ticks';
  for (let i = 0; i <= tickCount; i++) {
    const t = start + (rangeMs / tickCount) * i;
    const d = new Date(t);
    const label = dateRange === 'today' ? d.toLocaleTimeString('en', {hour:'2-digit',minute:'2-digit'}) : d.toLocaleDateString('en', {month:'short',day:'numeric'});
    const tick = document.createElement('div');
    tick.className = 'timeline-tick';
    tick.style.left = `${(i / tickCount) * 100}%`;
    tick.textContent = label;
    ticksWrap.appendChild(tick);
  }
  timelineEl.appendChild(ticksWrap);
}

function toggleSessionExpand(key, e) {
  if (e) e.stopPropagation();
  const existing = document.getElementById('expanded-' + CSS.escape(key));
  if (existing) {
    existing.remove();
    expandedSessionKey = null;
    stopMsgPoll();
    return;
  }
  const prev = document.querySelector('.session-expanded');
  if (prev) prev.remove();
  expandedSessionKey = key;

  const s = sessions.find(x => x.key === key);
  if (!s) return;
  const row = document.querySelector(`[data-session-key="${CSS.escape(key)}"]`);
  if (!row) return;

  const age = Date.now() - s.updatedAt;
  const ago = age < 60000 ? 'just now' : age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
  const createdAgo = s.createdAt ? new Date(s.createdAt).toLocaleString() : '--';
  const modelColor = getModelColor(s.model);

  const detail = document.createElement('div');
  detail.id = 'expanded-' + key;
  detail.className = 'session-expanded session-detail-panel';

  const grid = document.createElement('div');
  grid.className = 'session-detail-grid';
  [
    ['Session Key', s.key, 'mono', '11px', null],
    ['Model', s.model.split('/').pop(), 'mono', '12px', modelColor],
    ['Tokens', (s.totalTokens||0).toLocaleString(), 'mono', '12px', null],
    ['Cost', '$' + (s.cost||0).toFixed(2), 'mono', '12px', null],
    ['Channel', s.channel || '--', '', '12px', null],
    ['Created', createdAgo, '', '12px', null],
    ['Last Active', ago, '', '12px', null]
  ].forEach(([label, value, cls, fontSize, color]) => {
    grid.appendChild(createLabeledValue(label, value, {
      valueClass: cls,
      valueSize: fontSize,
      valueColor: color,
      valueBreakAll: label === 'Session Key'
    }));
  });

  const header = document.createElement('div');
  header.className = 'session-detail-header';
  const title = document.createElement('span');
  title.className = 'session-detail-title';
  title.textContent = 'Recent Messages';
  const fullBtn = document.createElement('button');
  fullBtn.textContent = 'Full View';
  fullBtn.className = 'session-detail-action';
  fullBtn.onclick = () => openSessionDetail(s.key);
  header.appendChild(title);
  header.appendChild(fullBtn);

  const msgs = document.createElement('div');
  msgs.id = 'expanded-msgs-' + CSS.escape(key);
  msgs.className = 'session-message-list';
  renderSessionMessages(msgs, [], { loadingText: 'Loading...' });

  detail.appendChild(grid);
  detail.appendChild(header);
  detail.appendChild(msgs);
  row.after(detail);

  refreshExpandedMessages(key);
  startMsgPoll(key);
}

function updateSessions() {
  const filtered = getFilteredSessions();
  updateSessionsStats(filtered);
  try { renderTimeline(filtered); } catch(e) { console.error('Timeline error:', e); }
  if (expandedSessionKey) {
    refreshExpandedMessages(expandedSessionKey);
    return;
  }

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    let aVal, bVal;
    if (sortBy === 'label') { aVal = a.label; bVal = b.label; }
    else if (sortBy === 'tokens') { aVal = a.totalTokens || 0; bVal = b.totalTokens || 0; }
    else if (sortBy === 'cost') { aVal = a.cost || 0; bVal = b.cost || 0; }
    else if (sortBy === 'updated') { aVal = a.updatedAt; bVal = b.updatedAt; }
    else { aVal = a.model; bVal = b.model; }
    return sortDir === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
  });

  const tbody = document.getElementById('sessionsTableBody');
  if (!sorted.length) {
    setEmptyState(tbody, 'No sessions found', '🔍');
    return;
  }
  tbody.innerHTML = '';

  sorted.forEach(s => {
    const age = Date.now() - s.updatedAt;
    const ago = age < 60000 ? 'just now' : age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
    const isActive = age < 300000 && !s.aborted;
    const statusClass = s.aborted ? 'aborted' : isActive ? 'running' : '';
    const statusDot = s.aborted ? '🔴' : isActive ? '🟢' : '⚪';
    const typeClass = s.key.includes('subagent') ? 'sub' : s.key.includes('cron') ? 'cron' : s.kind === 'group' ? 'group' : 'main';
    const shortModel = s.model.split('/').pop();
    const modelColor = getModelColor(s.model);
    const costStr = s.cost > 0 ? '$' + s.cost.toFixed(2) : '-';

    const row = document.createElement('div');
    row.className = `table-row ${statusClass}`.trim();
    row.dataset.sessionKey = s.key;

    const appendCell = (opts = {}) => {
      const cell = document.createElement('div');
      cell.className = `table-cell${opts.mono ? ' mono' : ''}`;
      if (opts.style) cell.style.cssText = opts.style;
      if (opts.onClick) cell.onclick = opts.onClick;
      if (opts.text != null) cell.textContent = opts.text;
      row.appendChild(cell);
      return cell;
    };

    const cbCell = appendCell();
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'session-checkbox';
    checkbox.checked = selectedSessions.has(s.key);
    checkbox.onchange = () => toggleSessionCompare(s.key, checkbox.checked);
    checkbox.onclick = (event) => event.stopPropagation();
    cbCell.appendChild(checkbox);

    const expandClick = (event) => toggleSessionExpand(s.key, event);
    appendCell({ text: statusDot, onClick: expandClick });

    const labelCell = appendCell({ onClick: expandClick });
    labelCell.classList.add('table-cell-truncate');
    const strong = document.createElement('strong');
    strong.textContent = s.label;
    labelCell.appendChild(strong);
    if (isActive) {
      const live = document.createElement('span');
      live.className = 'session-live-badge';
      live.textContent = '● LIVE';
      labelCell.appendChild(live);
    }

    const typeCell = appendCell({ onClick: expandClick });
    const badge = document.createElement('span');
    badge.className = `badge ${typeClass}`;
    badge.textContent = typeClass;
    typeCell.appendChild(badge);
    appendCell({ mono: true, style: `color:${modelColor};`, text: shortModel, onClick: expandClick });
    appendCell({ mono: true, text: (s.totalTokens||0).toLocaleString(), onClick: expandClick });
    appendCell({ mono: true, text: costStr, onClick: expandClick });
    appendCell({ style: "font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;", text: s.lastMessage || '', onClick: expandClick });
    appendCell({ text: ago, onClick: expandClick });

    tbody.appendChild(row);
  });
}
