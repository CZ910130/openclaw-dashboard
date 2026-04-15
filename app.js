let sessions = [];
let costs = {};
let usage = {};
let systemStats = {};
let feedPaused = true;
let liveEventSource = null;
let liveFeedReconnectTimer = null;
let sortBy = 'updated';
let sortDir = 'desc';
let selectedSessions = new Set();
let notificationsEnabled = false;

function activatePage(page) {
  if ((page === 'sys-security' || page === 'security' || page === 'config-editor') && !sysSecAuthed) {
    showReauthModal(page);
    return false;
  }
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const navItem = document.querySelector(`[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById(page);
  if (pageEl) pageEl.classList.add('active');

  if (page !== 'feed' && liveEventSource) {
    liveEventSource.close();
    liveEventSource = null;
  }
  if (page === 'memory') fetchMemoryFiles();
  if (page === 'files') fetchKeyFiles();
  return true;
}

function bindChipFilter(selector, onSelect) {
  document.querySelectorAll(selector).forEach(chip => {
    if (chip.dataset.bound === 'true') return;
    chip.dataset.bound = 'true';
    chip.addEventListener('click', () => {
      document.querySelectorAll(selector).forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      onSelect(chip);
    });
  });
}

function initAppUi() {
  const mq = window.matchMedia('(max-width: 900px)');
  if (mq.matches) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('open');
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    if (item.dataset.boundNav === 'true') return;
    item.dataset.boundNav = 'true';
    item.addEventListener('click', () => activatePage(item.dataset.page));
  });

  document.querySelectorAll('.view-all-link').forEach(link => {
    if (link.dataset.boundViewAll === 'true') return;
    link.dataset.boundViewAll = 'true';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      activatePage(link.dataset.page);
    });
  });

  bindChipFilter('#statusFilters .chip', chip => {
    sessionFilter = chip.dataset.filter;
    updateSessions();
  });
  bindChipFilter('#modelFilters .chip', chip => {
    modelFilter = chip.dataset.model;
    updateSessions();
  });
  bindChipFilter('#dateFilters .chip', chip => {
    dateRange = chip.dataset.range;
    updateSessions();
  });

  const sessionSearchInput = document.getElementById('sessionSearch');
  if (sessionSearchInput && sessionSearchInput.dataset.boundSearch !== 'true') {
    sessionSearchInput.dataset.boundSearch = 'true';
    sessionSearchInput.addEventListener('input', (e) => {
      sessionSearch = e.target.value.toLowerCase();
      updateSessions();
    });
  }

  document.querySelectorAll('.table-header .sortable').forEach(header => {
    if (header.dataset.boundSort === 'true') return;
    header.dataset.boundSort = 'true';
    header.addEventListener('click', () => {
      const newSort = header.dataset.sort;
      if (sortBy === newSort) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortBy = newSort;
        sortDir = 'desc';
      }
      updateSessions();
    });
  });

  const pauseBtn = document.getElementById('pauseBtn');
  if (pauseBtn && pauseBtn.dataset.boundPause !== 'true') {
    pauseBtn.dataset.boundPause = 'true';
    pauseBtn.addEventListener('click', toggleFeedPause);
  }
}

async function fetchData() {
  try {
    // Fast path: load sessions, costs, system first
    const [sessRes, costsRes, sysRes] = await Promise.all([
      authFetch(API_BASE + '/api/sessions'),
      authFetch(API_BASE + '/api/costs'),
      authFetch(API_BASE + '/api/system')
    ]);
    
    sessions = await sessRes.json();
    costs = await costsRes.json();
    systemStats = await sysRes.json();

    hideSkeletons();
    updateDashboard();
    
    // Then load usage async (slower endpoint)
    authFetch(API_BASE + '/api/usage').then(r => r.json()).then(u => {
      usage = u;
      try { updateDashboard(); } catch {}
    }).catch(() => {});
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

function animateValue(elem, end) {
  const start = parseFloat(elem.textContent.replace(/[^0-9.-]/g, '')) || 0;
  const duration = 600;
  const range = end - start;
  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const value = start + range * progress;
    
    if (elem.dataset.format === 'currency') {
      elem.textContent = '$' + value.toFixed(2);
    } else if (elem.dataset.format === 'percent') {
      elem.textContent = Math.round(value) + '%';
    } else {
      elem.textContent = Math.round(value).toLocaleString();
    }
    
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

function updateRadialGauge(circleId, percent) {
  const circle = document.getElementById(circleId);
  const circumference = 326.73;
  const offset = circumference - (percent / 100) * circumference;
  circle.style.strokeDashoffset = offset;
  
  if (percent < 50) {
    circle.style.stroke = 'var(--green)';
  } else if (percent < 80) {
    circle.style.stroke = 'var(--yellow)';
  } else {
    circle.style.stroke = 'var(--red)';
  }
}

function updateDashboard() {
  try { updateOverview(); } catch(e) { console.error('Overview error:', e); }
  try { updateSessions(); } catch(e) { console.error('Sessions error:', e); }
  try { updateLimits(); } catch(e) { console.error('Limits error:', e); }
  try { updateCosts(); } catch(e) { console.error('Costs error:', e); }
  try { updateStatusBar(); } catch(e) { console.error('StatusBar error:', e); }
}

function updateOverview() {
  const running = sessions.filter(s => {
    const age = Date.now() - s.updatedAt;
    return age < 300000 && !s.aborted;
  }).length;
  
  animateValue(document.getElementById('runningAgents'), running);
  document.getElementById('totalSessions').textContent = sessions.length;
  document.getElementById('activeSessions').textContent = running;
  
  const todayEl = document.getElementById('todaySpend');
  todayEl.dataset.format = 'currency';
  animateValue(todayEl, costs.today || 0);
  
  const opusLimitsKey = Object.keys((usage.fiveHour && usage.fiveHour.perModel) || {}).find(k => k.includes('opus')) || '';
  // Overview usage card: delegate to provider-specific updater
  try {
    if (_currentProvider === 'claude') updateOverviewClaude();

    const cu = _cachedClaudeUsage;
    const sPct = (cu && cu.session) ? cu.session.percent : 0;
    if (sPct >= 80 && !window._usageNotified) {
      sendNotification('High Usage Warning', `Claude session usage at ${sPct}%`);
      window._usageNotified = true;
    } else if (sPct < 70) {
      window._usageNotified = false;
    }
  } catch {}
  
  if (systemStats.cpu) {
    const cpuPct = systemStats.cpu.usage || 0;
    document.getElementById('systemCpu').textContent = cpuPct + '%';
    updateRadialGauge('cpuCircle', cpuPct);
    
    const ramPct = (systemStats.memory && systemStats.memory.percent) || 0;
    document.getElementById('systemRam').textContent = ramPct + '%';
    updateRadialGauge('ramCircle', ramPct);
    const ramDetail = document.getElementById('systemRamDetail');
    if (ramDetail && systemStats.memory) {
      ramDetail.textContent = `${systemStats.memory.usedGB} / ${systemStats.memory.totalGB} GB`;
    }
    
    const temp = systemStats.cpu.temp;
    if (temp !== null && temp !== undefined) {
      const tempPct = Math.min((temp / 90) * 100, 100);
      document.getElementById('systemTemp').textContent = temp.toFixed(0) + '°';
      updateRadialGauge('tempCircle', tempPct);
    } else {
      document.getElementById('systemTemp').textContent = 'N/A';
      updateRadialGauge('tempCircle', 0);
    }
    
    const uptime = systemStats.uptime || 0;
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const uptimeStr = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h` : `${Math.floor(uptime / 60)}m`;
    document.getElementById('systemUptime').textContent = uptimeStr;
    
    if (systemStats.loadAvg) {
      document.getElementById('systemLoad').textContent = 
        `Load: ${systemStats.loadAvg['1m']} ${systemStats.loadAvg['5m']} ${systemStats.loadAvg['15m']}`;
    }
    
    if (systemStats.disk) {
      const diskPct = systemStats.disk.percent || 0;
      document.getElementById('systemDisk').textContent = diskPct + '%';
      updateRadialGauge('diskCircle', diskPct);
      const diskDetail = document.getElementById('systemDiskDetail');
      if (diskDetail) diskDetail.textContent = `${systemStats.disk.used} / ${systemStats.disk.total}`;
    }
    if (systemStats.diskHistory) renderDiskSparkline(systemStats.diskHistory);
    
    const crashes = systemStats.crashCount || 0;
    const crashesToday = systemStats.crashesToday || 0;
    const crashEl = document.getElementById('systemCrashes');
    const crashTodayEl = document.getElementById('systemCrashesToday');
    crashEl.textContent = crashes;
    crashEl.classList.toggle('status-bad', crashes > 0);
    crashEl.classList.toggle('status-good', crashes === 0);
    crashTodayEl.textContent = crashesToday;
    crashTodayEl.classList.toggle('status-bad', crashesToday > 0);
    crashTodayEl.classList.toggle('status-good', crashesToday === 0);
  }
  
  const seen = new Set();
  const recent = sessions
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(s => {
      const dedup = s.label;
      if (seen.has(dedup)) return false;
      seen.add(dedup);
      return true;
    })
    .slice(0, 8);
  
  const recentActivityEl = document.getElementById('recentActivity');
  if (!recent.length) {
    setEmptyState(recentActivityEl, 'No recent activity', '📭');
  } else {
    recentActivityEl.innerHTML = '';
    recent.forEach(s => {
      const age = Date.now() - s.updatedAt;
      const ago = age < 60000 ? 'just now' :
                  age < 3600000 ? Math.round(age / 60000) + 'm ago' :
                  age < 86400000 ? Math.round(age / 3600000) + 'h ago' :
                  Math.round(age / 86400000) + 'd ago';
      const isActive = age < 300000 && !s.aborted;
      const typeClass = s.key.includes('subagent') ? 'sub' :
                        s.key.includes('cron') ? 'cron' :
                        s.kind === 'group' ? 'group' : 'main';
      const badgeText = typeClass;
      const tokens = s.totalTokens || 0;
      const tokStr = tokens >= 1000 ? (tokens / 1000).toFixed(0) + 'k' : String(tokens);
      const costStr = s.cost > 0 ? '$' + s.cost.toFixed(2) : '';
      const dur = s.createdAt ? Date.now() - s.createdAt : 0;
      const durStr = dur > 86400000 ? Math.floor(dur / 86400000) + 'd' :
                     dur > 3600000 ? Math.floor(dur / 3600000) + 'h' :
                     dur > 60000 ? Math.floor(dur / 60000) + 'm' : '';

      const item = document.createElement('div');
      item.className = `activity-item type-${typeClass} ${isActive ? 'running' : ''}`.trim();
      item.onclick = () => openSessionDetail(s.key);

      const dot = document.createElement('div');
      dot.className = `activity-dot ${isActive ? 'running' : ''}`.trim();
      item.appendChild(dot);

      const content = document.createElement('div');
      content.className = 'activity-content';

      const header = document.createElement('div');
      header.className = 'activity-header';
      const name = document.createElement('span');
      name.className = 'activity-name';
      name.textContent = s.label;
      const badge = document.createElement('span');
      badge.className = `badge ${badgeText}`;
      badge.textContent = badgeText;
      const time = document.createElement('span');
      time.className = 'activity-time';
      time.textContent = ago;
      header.appendChild(name);
      header.appendChild(badge);
      header.appendChild(time);
      content.appendChild(header);

      if (s.lastMessage) {
        const snippet = document.createElement('div');
        snippet.className = 'activity-snippet';
        snippet.textContent = s.lastMessage;
        content.appendChild(snippet);
      }

      const meta = document.createElement('div');
      meta.className = 'activity-meta';
      [s.model.split('/').pop(), tokStr + ' tok', costStr, durStr ? '⏱ ' + durStr : ''].filter(Boolean).forEach(val => {
        const span = document.createElement('span');
        span.textContent = val;
        meta.appendChild(span);
      });
      content.appendChild(meta);

      item.appendChild(content);
      recentActivityEl.appendChild(item);
    });
  }
  
  const perDay = costs.perDay || {};
  const days = Object.keys(perDay).sort().slice(-7);
  const maxSpend = Math.max(...days.map(d => perDay[d] || 0), 0.01);
  
  const chartHeight = 120;
  const chartHtml = days.map(day => {
    const amount = perDay[day] || 0;
    const h = Math.max(4, (amount / maxSpend) * chartHeight);
    const date = new Date(day);
    const label = date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    
    return `
      <div class="bar-item">
        <div class="bar-value">$${amount.toFixed(2)}</div>
        <div class="bar" style="height: ${h}px"></div>
        <div class="bar-label">${label}</div>
      </div>
    `;
  }).join('');
  
  const dailySpendChartEl = document.getElementById('dailySpendChart');
  if (chartHtml) dailySpendChartEl.innerHTML = chartHtml;
  else setEmptyState(dailySpendChartEl, 'No data');

  const summaryEl = document.getElementById('dailySpendSummary');
  if (summaryEl) {
    summaryEl.innerHTML = '';
    if (days.length > 0) {
      const vals = days.map(d => perDay[d] || 0);
      const total = vals.reduce((a, b) => a + b, 0);
      const avg = total / vals.length;
      const maxDay = days[vals.indexOf(Math.max(...vals))];
      const maxVal = Math.max(...vals);
      [
        ['7-Day Total', '$' + total.toFixed(2), 'var(--accent)', '18px', null, true],
        ['Daily Avg', '$' + avg.toFixed(2), 'var(--green)', '18px', null, true],
        ['Peak Day', new Date(maxDay).toLocaleDateString('en',{month:'short',day:'numeric'}), 'var(--text-primary)', '14px', '$' + maxVal.toFixed(2), false]
      ].forEach(([label, value, color, size, sub, mono]) => {
        summaryEl.appendChild(createLabeledValue(label, value, {
          valueColor: color,
          valueSize: size,
          valueWeight: size === '18px' ? '700' : '600',
          subText: sub,
          mono
        }));
      });
    }
  }
}

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
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';

    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'width:100px;flex-shrink:0;font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--text-secondary);';
    labelEl.textContent = s.label;

    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'flex:1;height:14px;background:var(--bg-primary);border-radius:4px;position:relative;overflow:hidden;';

    const bar = document.createElement('div');
    bar.style.cssText = `position:absolute;left:${leftPct}%;width:${widthPct}%;height:100%;background:${color};border-radius:4px;opacity:0.8;`;

    barWrap.appendChild(bar);
    row.appendChild(labelEl);
    row.appendChild(barWrap);
    timelineEl.appendChild(row);
  });

  const ticksWrap = document.createElement('div');
  ticksWrap.style.cssText = 'position:relative;height:18px;margin-left:108px;';
  for (let i = 0; i <= tickCount; i++) {
    const t = start + (rangeMs / tickCount) * i;
    const d = new Date(t);
    const label = dateRange === 'today' ? d.toLocaleTimeString('en', {hour:'2-digit',minute:'2-digit'}) : d.toLocaleDateString('en', {month:'short',day:'numeric'});
    const tick = document.createElement('div');
    tick.style.cssText = `position:absolute;left:${(i / tickCount) * 100}%;bottom:0;transform:translateX(-50%);font-size:9px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;white-space:nowrap;`;
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

    const labelCell = appendCell({ style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', onClick: expandClick });
    const strong = document.createElement('strong');
    strong.textContent = s.label;
    labelCell.appendChild(strong);
    if (isActive) {
      const live = document.createElement('span');
      live.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:1px 5px;background:rgba(16,185,129,0.15);color:var(--green);border-radius:4px;font-size:9px;font-weight:600;vertical-align:middle;margin-left:6px;';
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

let _cachedClaudeUsage = null;
let _cachedOpenAIUsage = null;
let _cachedOpenCodeGoUsage = null;
let _usageAutoEntry = null;

function _setClaudeUsageBars(data) {
  _setUsageBar('cuSession', data && data.session, '% used');
  _setUsageBar('cuWeekly', data && data.weekly_all, '% used');
  _setUsageBar('cuSonnet', data && data.weekly_sonnet, '% used');
}

function _setUsageBar(prefix, data, defaultLabelTemplate) {
  if (!data) return;
  const bar = document.getElementById(prefix + 'Bar');
  const pct = document.getElementById(prefix + 'Pct');
  const label = document.getElementById(prefix + 'Label');
  const reset = document.getElementById(prefix + 'Reset');
  if (bar) { bar.style.width = data.percent + '%'; bar.style.background = getProgressColor(data.percent); }
  if (pct) pct.textContent = data.percent + '%';
  if (label) label.textContent = data.label || (defaultLabelTemplate === '% used' ? (data.percent + '% used') : (data.percent + '% used'));
  if (reset) reset.textContent = data.detail || (data.resets ? 'Resets ' + data.resets : '');
}

function resolveUsageProvider(provider) {
  if (provider === 'glm') return 'openai';
  if (provider === 'kimi' || provider === 'minimax') return 'opencode-go';
  return provider;
}

const PROVIDER_USAGE_CONFIG = {
  claude: {
    endpoint: 'claude',
    cacheName: 'Claude',
    sourceHint: 'Source: provider API',
    modelStorageKey: 'claudeModel',
    models: [
      { value: 'session', label: '5h Session' },
      { value: 'weekly_all', label: 'Weekly (All)' },
      { value: 'weekly_sonnet', label: 'Weekly (Sonnet)' }
    ],
    button: { id: 'provBtnClaude', activeBg: 'var(--accent)' },
    fetchIntervalMs: 60000,
    scrape: {
      btnIds: ['scrapeBtn', 'overviewScrapeBtn'],
      busyTexts: ['⏳ Refreshing...', '⏳'],
      idleTexts: ['⟳ Refresh', '⟳'],
      success: 'Usage data refreshed',
      failure: 'Failed to refresh usage data',
      pollAttempts: 12,
      pollDelayMs: 2000
    },
    applyData(data) {
      _setClaudeUsageBars(data);
    },
    selectOverviewData(data, model) {
      const keyMap = { session: 'session', weekly_all: 'weekly_all', weekly_sonnet: 'weekly_sonnet' };
      return data ? data[keyMap[model] || 'session'] : null;
    }
  },
  openai: {
    endpoint: 'openai',
    cacheName: 'OpenAI',
    sourceHint: 'Source: local sessions',
    modelStorageKey: 'openaiModel',
    models: [{ value: 'session', label: 'Last 24h' }],
    button: { id: 'provBtnOpenAI', activeBg: '#10a37f' },
    fetchIntervalMs: 60000,
    scrapedAtId: 'openaiUsageScrapedAt',
    scrapeBtnId: 'openaiScrapeBtn',
    scrapeSuccess: 'ChatGPT usage refreshed',
    scrapeFailure: 'Failed to refresh ChatGPT usage',
    applyData(data) {
      _setUsageBar('openaiSession', data && data.session);
    },
    selectOverviewData(data) {
      return data && data.session;
    }
  },
  'opencode-go': {
    endpoint: 'opencode-go',
    cacheName: 'OpenCodeGo',
    sourceHint: 'Source: local sessions',
    modelStorageKey: 'opencodeGoModel',
    models: [{ value: 'session', label: 'Last 24h' }],
    button: { id: 'provBtnOpenCodeGo', activeBg: '#4285f4' },
    fetchIntervalMs: 60000,
    scrapedAtId: 'opencodeGoUsageScrapedAt',
    scrapeBtnId: 'opencodeGoScrapeBtn',
    scrapeSuccess: 'OpenCode-Go usage refreshed',
    scrapeFailure: 'Failed to refresh OpenCode-Go usage',
    applyData(data) {
      _setUsageBar('opencodeGoSession', data && data.session);
    },
    selectOverviewData(data) {
      return data && data.session;
    }
  }
};

const PROVIDER_USAGE_CACHE = {
  claude: () => _cachedClaudeUsage,
  openai: () => _cachedOpenAIUsage,
  'opencode-go': () => _cachedOpenCodeGoUsage
};

function _getProviderUsageCache(provider) {
  const canonical = resolveUsageProvider(provider);
  return PROVIDER_USAGE_CACHE[canonical] ? PROVIDER_USAGE_CACHE[canonical]() : null;
}

function _setProviderUsageCache(provider, value) {
  const canonical = resolveUsageProvider(provider);
  if (canonical === 'claude') _cachedClaudeUsage = value;
  else if (canonical === 'openai') _cachedOpenAIUsage = value;
  else if (canonical === 'opencode-go') _cachedOpenCodeGoUsage = value;
}

async function fetchProviderUsage(provider) {
  const canonical = resolveUsageProvider(provider);
  const cfg = PROVIDER_USAGE_CONFIG[canonical];
  if (!cfg) return;
  try {
    const r = await authFetch(API_BASE + '/api/' + cfg.endpoint + '-usage');
    const d = await r.json();
    if (d.error) return;
    _setProviderUsageCache(canonical, d);
    if (typeof cfg.applyData === 'function') cfg.applyData(d);
    const tsId = cfg.scrapedAtId || 'claudeUsageScrapedAt';
    const ts = document.getElementById(tsId);
    if (ts && d.scraped_at) {
      const ago = Math.round((Date.now() - new Date(d.scraped_at).getTime()) / 60000);
      ts.textContent = ago < 1 ? 'Just now' : ago + 'm ago';
    }
  } catch {}
}

async function scrapeProviderUsage(provider) {
  const canonical = resolveUsageProvider(provider);
  const cfg = PROVIDER_USAGE_CONFIG[canonical];
  if (!cfg) return;
  const label = document.getElementById('usageAutoLabel');
  const btnIds = cfg.scrape && cfg.scrape.btnIds ? cfg.scrape.btnIds : [cfg.scrapeBtnId];
  const buttons = btnIds.map(id => document.getElementById(id)).filter(Boolean);
  const origTexts = buttons.map(btn => btn.textContent);
  buttons.forEach((btn, idx) => {
    btn.textContent = (cfg.scrape && cfg.scrape.busyTexts && cfg.scrape.busyTexts[idx]) || '⏳ Refreshing...';
    btn.disabled = true;
  });
  if (label && _usageAutoEntry) label.textContent = '⏳...';
  try {
    await authFetch(API_BASE + '/api/' + cfg.endpoint + '-usage-scrape', { method: 'POST' });
    const oldTs = ((_getProviderUsageCache(canonical) || {}).scraped_at) || '';
    const attempts = (cfg.scrape && cfg.scrape.pollAttempts) || 5;
    const delayMs = (cfg.scrape && cfg.scrape.pollDelayMs) || 1200;
    for (let i = 0; i < attempts; i++) {
      await new Promise(r => setTimeout(r, delayMs));
      await fetchProviderUsage(canonical);
      const current = _getProviderUsageCache(canonical);
      if (current && current.scraped_at && current.scraped_at !== oldTs) break;
    }
    showToast((cfg.scrape && cfg.scrape.success) || cfg.scrapeSuccess || 'Usage refreshed', 'success');
    if (typeof updateDashboard === 'function') updateDashboard();
  } catch (e) {
    showToast((cfg.scrape && cfg.scrape.failure) || cfg.scrapeFailure || 'Failed to refresh usage', 'danger');
  } finally {
    buttons.forEach((btn, idx) => {
      btn.textContent = (cfg.scrape && cfg.scrape.idleTexts && cfg.scrape.idleTexts[idx]) || origTexts[idx] || '⟳ Refresh';
      btn.disabled = false;
    });
    if (label && _usageAutoEntry) label.textContent = 'Auto ✓';
  }
}

async function fetchClaudeUsage() { return fetchProviderUsage('claude'); }
async function fetchOpenAIUsage() { return fetchProviderUsage('openai'); }
async function fetchOpenCodeGoUsage() { return fetchProviderUsage('opencode-go'); }
async function scrapeClaudeUsage() { return scrapeProviderUsage('claude'); }
async function scrapeOpenAIUsage() { return scrapeProviderUsage('openai'); }
async function scrapeOpenCodeGoUsage() { return scrapeProviderUsage('opencode-go'); }

function toggleUsageAutoRefresh(on, init) {
  if (!init) localStorage.setItem('usageAutoRefresh', on ? '1' : '0');
  const track = document.getElementById('usageToggleTrack');
  const thumb = document.getElementById('usageToggleThumb');
  const label = document.getElementById('usageAutoLabel');
  if (on) {
    track.style.background = 'var(--green)';
    thumb.style.left = '18px';
    label.textContent = 'Auto ✓';
    label.style.color = 'var(--green)';
    scrapeCurrentProvider();
    _usageAutoEntry = visibleInterval(scrapeCurrentProvider, 120000);
  } else {
    track.style.background = 'var(--bg-tertiary)';
    thumb.style.left = '2px';
    label.textContent = 'Auto';
    label.style.color = 'var(--text-muted)';
    clearVisibleInterval(_usageAutoEntry);
    _usageAutoEntry = null;
  }
}

let _currentProvider = resolveUsageProvider(localStorage.getItem('usageProvider') || 'claude');
let _currentModel = localStorage.getItem('usageModel') || 'session';

function _getProviderModelOptions() {
  const cfg = PROVIDER_USAGE_CONFIG[_currentProvider] || PROVIDER_USAGE_CONFIG.claude;
  return cfg.models || [];
}

function _populateModelSelect() {
  const sel = document.getElementById('modelSelect');
  if (!sel) return;
  const opts = _getProviderModelOptions();
  sel.innerHTML = '';
  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  });
  if (opts.some(o => o.value === _currentModel)) {
    sel.value = _currentModel;
  } else if (opts.length) {
    _currentModel = opts[0].value;
    sel.value = _currentModel;
  }
}

function _setOverviewBar(pct, label, sourceHint) {
  pct = parseFloat(pct) || 0;
  const pctEl = document.getElementById('ovSessionPct');
  const barEl = document.getElementById('overviewSessionBar');
  const labelEl = document.getElementById('overviewUsageLabel');
  const warnEl = document.getElementById('overviewUsageWarn');
  const sourceEl = document.getElementById('usageSourceHint');
  if (pctEl) pctEl.textContent = pct + '%';
  if (barEl) { barEl.style.width = Math.min(pct, 100) + '%'; barEl.style.background = pct < 50 ? 'var(--green)' : pct < 80 ? '#f59e0b' : '#ef4444'; }
  if (labelEl) labelEl.textContent = String(label || '');
  if (warnEl) warnEl.style.display = pct >= 80 ? '' : 'none';
  if (sourceEl) sourceEl.textContent = sourceHint || 'Source: provider/local';
}

function updateOverviewForProvider(provider) {
  const canonical = resolveUsageProvider(provider || _currentProvider);
  const cfg = PROVIDER_USAGE_CONFIG[canonical];
  if (!cfg) return;
  _populateModelSelect();
  const data = cfg.selectOverviewData(_getProviderUsageCache(canonical), _currentModel);
  if (!data) return;
  _setOverviewBar(data.percent, data.label || data.detail || (data.resets ? 'Resets ' + data.resets : ''), cfg.sourceHint);
}

function updateOverviewClaude() { return updateOverviewForProvider('claude'); }
function updateOverviewOpenAI() { return updateOverviewForProvider('openai'); }
function updateOverviewOpenCodeGo() { return updateOverviewForProvider('opencode-go'); }

function switchModel(val) {
  _currentModel = val;
  const cfg = PROVIDER_USAGE_CONFIG[_currentProvider] || PROVIDER_USAGE_CONFIG.claude;
  localStorage.setItem(cfg.modelStorageKey || 'usageModel', val);
  updateOverviewForProvider(_currentProvider);
}

function switchProvider(prov) {
  _currentProvider = resolveUsageProvider(prov);
  localStorage.setItem('usageProvider', _currentProvider);
  Object.values(PROVIDER_USAGE_CONFIG).forEach(cfg => {
    const btn = cfg.button && document.getElementById(cfg.button.id);
    if (btn) {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text-muted)';
    }
  });
  const activeCfg = PROVIDER_USAGE_CONFIG[_currentProvider] || PROVIDER_USAGE_CONFIG.claude;
  const activeBtn = activeCfg.button && document.getElementById(activeCfg.button.id);
  if (activeBtn) {
    activeBtn.style.background = activeCfg.button.activeBg;
    activeBtn.style.color = '#fff';
  }
  _currentModel = localStorage.getItem(activeCfg.modelStorageKey) || ((activeCfg.models && activeCfg.models[0] && activeCfg.models[0].value) || 'session');
  updateOverviewForProvider(_currentProvider);
  if (_usageAutoEntry) {
    clearVisibleInterval(_usageAutoEntry);
    _usageAutoEntry = visibleInterval(scrapeCurrentProvider, 120000);
  }
}

function scrapeCurrentProvider() {
  return scrapeProviderUsage(_currentProvider);
}

Object.keys(PROVIDER_USAGE_CONFIG).forEach(provider => {
  fetchProviderUsage(provider);
  visibleInterval(() => fetchProviderUsage(provider), PROVIDER_USAGE_CONFIG[provider].fetchIntervalMs || 60000);
});
switchProvider(_currentProvider);

function getProgressColor(pct) {
  if (pct < 50) return 'linear-gradient(90deg, #10b981, #34d399)';
  if (pct < 80) return 'linear-gradient(90deg, #f59e0b, #fbbf24)';
  return 'linear-gradient(90deg, #ef4444, #f87171)';
}

function formatMs(ms) {
  if (!ms || ms <= 0) return '--';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

function updateLimits() {
  const limits = usage.estimatedLimits || { opus: 88000, sonnet: 220000 };
  const models = (usage.fiveHour && usage.fiveHour.perModel) || {};

  const opusKey = Object.keys(models).find(k => k.includes('opus')) || '';
  const sonnetKey = Object.keys(models).find(k => k.includes('sonnet')) || '';
  const opusData = opusKey ? models[opusKey] : { output: 0, input: 0, cost: 0, calls: 0 };
  const sonnetData = sonnetKey ? models[sonnetKey] : { output: 0, input: 0, cost: 0, calls: 0 };

  const opusPct = Math.min(Math.round((opusData.output / limits.opus) * 100), 100);
  const sonnetPct = Math.min(Math.round((sonnetData.output / limits.sonnet) * 100), 100);

  const opusEl = document.getElementById('opusUsageLimits');
  opusEl.dataset.format = 'percent';
  animateValue(opusEl, opusPct);

  document.getElementById('opusProgressBar').style.width = opusPct + '%';
  document.getElementById('opusProgressBar').style.background = getProgressColor(opusPct);
  document.getElementById('opusProgressPct').textContent = opusPct + '%';
  document.getElementById('opusTokenLabel').textContent = (opusData.output / 1000).toFixed(1) + 'k / ' + (limits.opus / 1000) + 'k';

  if (opusPct >= 80) {
    document.getElementById('opusProgressBar').style.animation = 'pulse 2s ease-in-out infinite';
  } else {
    document.getElementById('opusProgressBar').style.animation = 'none';
  }

  document.getElementById('sonnetProgressBar').style.width = sonnetPct + '%';
  document.getElementById('sonnetProgressBar').style.background = getProgressColor(sonnetPct);
  document.getElementById('sonnetProgressPct').textContent = sonnetPct + '%';
  document.getElementById('sonnetTokenLabel').textContent = (sonnetData.output / 1000).toFixed(1) + 'k / ' + (limits.sonnet / 1000) + 'k';

  const totalCalls = Object.values(models).reduce((sum, m) => sum + (m.calls || 0), 0);
  animateValue(document.getElementById('totalCalls'), totalCalls);

  const windowCost = Object.values(models).reduce((sum, m) => sum + (m.cost || 0), 0);
  const costEl = document.getElementById('windowCost');
  costEl.dataset.format = 'currency';
  animateValue(costEl, windowCost);

  const burnRate = usage.burnRate || { tokensPerMinute: 0, costPerMinute: 0 };
  document.getElementById('burnRateDisplay').textContent = burnRate.tokensPerMinute > 0 ? burnRate.tokensPerMinute.toFixed(0) : '--';
  document.getElementById('costPerMinValue').textContent = '$' + burnRate.costPerMinute.toFixed(4);

  const predictions = usage.predictions || { timeToLimit: null, safe: true };
  const ttlEl = document.getElementById('timeToLimitValue');
  const ttlSub = document.getElementById('timeToLimitSub');
  if (predictions.safe || !predictions.timeToLimit) {
    ttlEl.textContent = '✅ Safe';
    ttlEl.style.color = 'var(--green)';
    ttlSub.textContent = 'Low usage rate';
  } else {
    ttlEl.textContent = formatMs(predictions.timeToLimit);
    ttlEl.style.color = predictions.timeToLimit < 1800000 ? 'var(--red)' : 'var(--yellow)';
    ttlSub.textContent = 'At current burn rate';
    if (predictions.timeToLimit < 1800000) {
      document.getElementById('timeToLimitCard').style.boxShadow = '0 0 20px rgba(239,68,68,0.3)';
    }
  }

  const resetIn = (usage.fiveHour && usage.fiveHour.windowResetIn) || 0;
  document.getElementById('windowResetValue').textContent = resetIn > 0 ? formatMs(resetIn) : 'No window';
  document.getElementById('windowResetSub').textContent = (usage.fiveHour && usage.fiveHour.windowStart) ? 'Since ' + new Date(usage.fiveHour.windowStart).toLocaleTimeString('en', {hour:'2-digit',minute:'2-digit'}) : '';

  const windowBreakdownEl = document.getElementById('windowBreakdown');
  const modelEntries = Object.entries(models).sort(function(a, b) { return b[1].output - a[1].output; });
  if (!modelEntries.length) {
    setEmptyState(windowBreakdownEl, 'No data');
  } else {
    windowBreakdownEl.innerHTML = '';
    modelEntries.forEach(function(entry) {
      var model = entry[0], data = entry[1];
      var shortModel = model.split('/').pop();
      var calc = (usage.fiveHour && usage.fiveHour.perModelCost && usage.fiveHour.perModelCost[model]) || {};
      var inputCost = calc.inputCost || 0;
      var outputCost = calc.outputCost || 0;
      var cacheReadCost = calc.cacheReadCost || 0;
      var cacheWriteCost = calc.cacheWriteCost || 0;
      var totalModelCost = calc.totalCost || (inputCost + outputCost + cacheReadCost + cacheWriteCost);
      var cacheCost = cacheReadCost + cacheWriteCost;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border);';
      const top = document.createElement('div');
      top.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:6px;';
      const left = document.createElement('span');
      left.className = 'mono';
      left.style.cssText = 'font-size:14px;font-weight:600;';
      left.textContent = shortModel;
      const right = document.createElement('span');
      right.className = 'mono';
      right.style.cssText = 'font-size:14px;font-weight:600;color:var(--accent);';
      right.textContent = '$' + totalModelCost.toFixed(4);
      top.appendChild(left);
      top.appendChild(right);
      const meta = document.createElement('div');
      meta.style.cssText = "display:flex;gap:16px;font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;";
      [
        data.calls + ' calls',
        (data.input/1000).toFixed(0) + 'k in ($' + inputCost.toFixed(4) + ')',
        (data.output/1000).toFixed(0) + 'k out ($' + outputCost.toFixed(4) + ')'
      ].concat(cacheCost > 0 ? ['cache ($' + cacheCost.toFixed(4) + ')'] : []).forEach(text => {
        const span = document.createElement('span');
        span.textContent = text;
        meta.appendChild(span);
      });
      wrap.appendChild(top);
      wrap.appendChild(meta);
      windowBreakdownEl.appendChild(wrap);
    });
  }

  const recentCalls = (usage.fiveHour && usage.fiveHour.recentCalls) || [];
  const recentCallsEl = document.getElementById('recentCalls');
  if (!recentCalls.length) {
    setEmptyState(recentCallsEl, 'No recent calls');
  } else {
    recentCallsEl.innerHTML = '';
    recentCalls.slice(0, 15).forEach(call => {
      const shortModel = call.model.split('/').pop();
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;';
      const left = document.createElement('div');
      const model = document.createElement('div');
      model.className = 'mono';
      model.style.fontWeight = '600';
      model.textContent = shortModel;
      const agoEl = document.createElement('div');
      agoEl.style.cssText = 'color:var(--text-muted);font-size:11px;';
      agoEl.textContent = call.ago;
      left.appendChild(model);
      left.appendChild(agoEl);
      const right = document.createElement('div');
      right.style.textAlign = 'right';
      const out = document.createElement('div');
      out.className = 'mono';
      out.textContent = call.output.toLocaleString() + ' out';
      const cost = document.createElement('div');
      cost.style.cssText = 'color:var(--text-muted);font-size:11px;';
      cost.textContent = '$' + call.cost.toFixed(4);
      right.appendChild(out);
      right.appendChild(cost);
      row.appendChild(left);
      row.appendChild(right);
      recentCallsEl.appendChild(row);
    });
  }
  
  // Model usage donut chart
  try {
    const donutEl = document.getElementById('modelUsageDonut');
    if (donutEl && costs.perModel) {
      const modelData = Object.entries(costs.perModel).map(([m, cost]) => {
        const shortModel = m.split('/').pop();
        let color = 'var(--text-muted)';
        if (shortModel.includes('opus')) color = '#a855f7';  // Purple
        else if (shortModel.includes('sonnet')) color = '#3b82f6';  // Blue
        else if (shortModel.includes('gemini')) color = '#10b981';  // Green
        else if (shortModel.includes('glm')) color = '#f59e0b';  // Amber/Orange
        else if (shortModel.includes('kimi') || shortModel.includes('k2p5')) color = '#ef4444';  // Red
        else if (shortModel.includes('minimax') || shortModel.includes('m2.5') || shortModel.includes('opencode') || shortModel.includes('mimo')) color = '#8b5cf6';  // Violet
        return { model: shortModel, cost, color };
      }).filter(d => d.cost > 0).sort((a, b) => b.cost - a.cost);
      
      if (modelData.length === 0) {
        setEmptyState(donutEl, 'No data');
      } else {
        const total = modelData.reduce((s, d) => s + d.cost, 0);
        const size = 200, r = 70, strokeW = 40;
        donutEl.innerHTML = '';

        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:32px;align-items:center;';
        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

        const bgCircle = document.createElementNS(svgNs, 'circle');
        bgCircle.setAttribute('cx', String(size / 2));
        bgCircle.setAttribute('cy', String(size / 2));
        bgCircle.setAttribute('r', String(r));
        bgCircle.setAttribute('fill', 'var(--bg-primary)');
        svg.appendChild(bgCircle);

        let currentAngle = 0;
        modelData.forEach(d => {
          const pct = d.cost / total;
          let shape;
          if (pct >= 0.999) {
            shape = document.createElementNS(svgNs, 'circle');
            shape.setAttribute('cx', String(size / 2));
            shape.setAttribute('cy', String(size / 2));
            shape.setAttribute('r', String(r));
            shape.setAttribute('fill', d.color);
          } else {
            const angle = pct * 360;
            const largeArc = angle > 180 ? 1 : 0;
            const startX = size / 2 + r * Math.cos((currentAngle - 90) * Math.PI / 180);
            const startY = size / 2 + r * Math.sin((currentAngle - 90) * Math.PI / 180);
            const endX = size / 2 + r * Math.cos((currentAngle + angle - 90) * Math.PI / 180);
            const endY = size / 2 + r * Math.sin((currentAngle + angle - 90) * Math.PI / 180);
            currentAngle += angle;
            shape = document.createElementNS(svgNs, 'path');
            shape.setAttribute('d', `M ${size/2},${size/2} L ${startX},${startY} A ${r},${r} 0 ${largeArc},1 ${endX},${endY} Z`);
            shape.setAttribute('fill', d.color);
          }
          shape.setAttribute('opacity', '0.8');
          const title = document.createElementNS(svgNs, 'title');
          title.textContent = `${d.model}: ${pct >= 0.999 ? '100' : (pct * 100).toFixed(1)}%`;
          shape.appendChild(title);
          svg.appendChild(shape);
        });

        const innerCircle = document.createElementNS(svgNs, 'circle');
        innerCircle.setAttribute('cx', String(size / 2));
        innerCircle.setAttribute('cy', String(size / 2));
        innerCircle.setAttribute('r', String(r - strokeW / 2));
        innerCircle.setAttribute('fill', 'var(--bg-card)');
        svg.appendChild(innerCircle);
        wrap.appendChild(svg);

        const legend = document.createElement('div');
        legend.style.flex = '1';
        modelData.forEach(d => {
          const pct = ((d.cost / total) * 100).toFixed(1);
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
          const swatch = document.createElement('div');
          swatch.style.cssText = `width:16px;height:16px;background:${d.color};border-radius:3px;opacity:0.8;`;
          const name = document.createElement('span');
          name.style.cssText = 'font-size:13px;flex:1;';
          name.textContent = d.model;
          const pctEl = document.createElement('span');
          pctEl.style.cssText = "font-size:13px;font-weight:600;font-family:'JetBrains Mono',monospace;";
          pctEl.textContent = pct + '%';
          row.appendChild(swatch);
          row.appendChild(name);
          row.appendChild(pctEl);
          legend.appendChild(row);
        });
        wrap.appendChild(legend);
        donutEl.appendChild(wrap);
      }
    }
  } catch (e) {
    console.error('Donut chart error:', e);
  }
}

function updateCosts() {
  const todayEl = document.getElementById('costToday');
  todayEl.dataset.format = 'currency';
  animateValue(todayEl, costs.today || 0);
  
  const weekEl = document.getElementById('costWeek');
  weekEl.dataset.format = 'currency';
  animateValue(weekEl, costs.week || 0);
  
  const totalEl = document.getElementById('costTotal');
  totalEl.dataset.format = 'currency';
  animateValue(totalEl, costs.total || 0);
  
  const perDay = costs.perDay || {};
  const dayCount = Object.keys(perDay).length || 1;
  const avgEl = document.getElementById('costAvg');
  avgEl.dataset.format = 'currency';
  animateValue(avgEl, (costs.total || 0) / dayCount);
  
  const days = Object.keys(perDay).sort().slice(-14);
  const maxSpend = Math.max(...days.map(d => perDay[d] || 0), 0.01);
  
  // Render SVG line chart
  try {
    const chartEl = document.getElementById('costTrendChart');
    if (chartEl && days.length > 0) {
      const w = 800, h = 220;
      const pad = window.innerWidth <= 768 ? 40 : 70;
      const vals = days.map(d => perDay[d] || 0);
      const minVal = 0;
      const maxVal = Math.max(...vals, 0.01);
      const range = maxVal - minVal || 1;
      const count = vals.length;
      // Fix division by zero for single point
      const xStep = count > 1 ? (w - pad * 2) / (count - 1) : 0;
      
      const points = vals.map((v, i) => {
        const x = count > 1 ? pad + i * xStep : w / 2;
        const y = h - pad - ((v - minVal) / range) * (h - pad * 2);
        return `${x},${y}`;
      }).join(' ');
      
      // Color gradient based on spend level (green -> yellow -> red)
      const getDotColor = (v) => {
        const ratio = v / maxVal;
        if (ratio < 0.3) return '#10b981'; // green
        if (ratio < 0.6) return '#f59e0b'; // yellow  
        return '#ef4444'; // red
      };
      
      const dots = vals.map((v, i) => {
        const x = count > 1 ? pad + i * xStep : w / 2;
        const y = h - pad - ((v - minVal) / range) * (h - pad * 2);
        const date = new Date(days[i]);
        const label = date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
        const color = getDotColor(v);
        return `<circle cx="${x}" cy="${y}" r="6" fill="${color}" stroke="var(--bg-card)" stroke-width="2" style="cursor:pointer;filter:drop-shadow(0 0 4px ${color}40);"><title>${label}: $${v.toFixed(2)}</title></circle>`;
      }).join('');
      
      // Show all labels for small datasets, sparse for larger
      const labelInterval = count <= 7 ? 1 : Math.ceil(count / 7);
      const xLabels = days.map((d, i) => {
        if (i % labelInterval !== 0 && i !== count - 1) return '';
        const x = count > 1 ? pad + i * xStep : w / 2;
        const date = new Date(d);
        const label = date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
        return `<text x="${x}" y="${h - 15}" fill="var(--text-secondary)" font-size="11" text-anchor="middle" font-family="JetBrains Mono, monospace">${label}</text>`;
      }).join('');
      
      const yTicks = [0, maxVal / 2, maxVal].map((val, i) => {
        const y = h - pad - (i / 2) * (h - pad * 2);
        const formattedVal = val >= 1 ? '$' + val.toFixed(2) : val >= 0.1 ? '$' + val.toFixed(2) : '$' + val.toFixed(3);
        return `<text x="${pad - 10}" y="${y + 4}" fill="var(--text-secondary)" font-size="11" text-anchor="end" font-family="JetBrains Mono, monospace">${formattedVal}</text>
          <line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="4,4" opacity="0.5"/>`;
      }).join('');
      
      // Only draw line if more than 1 point
      const lineSvg = count > 1 ? `<polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>` : '';
      
      chartEl.innerHTML = '';
      const svgNs = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNs, 'svg');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', String(h));
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('style', 'max-width:100%;height:auto;');
      svg.innerHTML = `${yTicks}${lineSvg}${dots}${xLabels}`;
      chartEl.appendChild(svg);
    }
  } catch (e) {
    console.error('Cost chart error:', e);
  }
  
  const costByModelEl = document.getElementById('costByModel');
  const perModelEntries = Object.entries(costs.perModel || {}).sort((a, b) => b[1] - a[1]);
  if (!perModelEntries.length) {
    setEmptyState(costByModelEl, 'No data');
  } else {
    costByModelEl.innerHTML = '';
    perModelEntries.forEach(([model, cost]) => {
      const shortModel = model.split('/').pop();
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border);';
      const left = document.createElement('span');
      left.className = 'mono';
      left.textContent = shortModel;
      const right = document.createElement('span');
      right.className = 'mono';
      right.style.fontWeight = '700';
      right.textContent = '$' + cost.toFixed(2);
      row.appendChild(left);
      row.appendChild(right);
      costByModelEl.appendChild(row);
    });
  }

  const topSessionsEl = document.getElementById('topSessions');
  const perSessionEntries = Object.entries(costs.perSession || {})
    .map(([sid, v]) => [sid, typeof v === 'object' ? v : { cost: v, label: sid.substring(0, 12) }])
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 10);
  if (!perSessionEntries.length) {
    setEmptyState(topSessionsEl, 'No data');
  } else {
    topSessionsEl.innerHTML = '';
    perSessionEntries.forEach(([, v]) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border);';
      const left = document.createElement('span');
      left.textContent = v.label;
      const right = document.createElement('span');
      right.className = 'mono';
      right.style.fontWeight = '700';
      right.textContent = '$' + v.cost.toFixed(2);
      row.appendChild(left);
      row.appendChild(right);
      topSessionsEl.appendChild(row);
    });
  }
}

function updateStatusBar() {
  if (systemStats.uptime) {
    const uptime = systemStats.uptime;
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const uptimeStr = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h` : `${Math.floor(uptime / 60)}m`;
    document.getElementById('statusUptime').textContent = uptimeStr;
  }
  
  const mainSession = sessions.find(s => s.key.includes('main:main'));
  if (mainSession) {
    document.getElementById('statusModel').textContent = mainSession.model.split('/').pop();
  }
  
  if (sessions.length > 0) {
    const latest = sessions.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b);
    const age = Date.now() - latest.updatedAt;
    const ago = age < 60000 ? 'just now' :
                age < 3600000 ? Math.round(age / 60000) + 'm ago' :
                age < 86400000 ? Math.round(age / 3600000) + 'h ago' :
                Math.round(age / 86400000) + 'd ago';
    document.getElementById('statusLastActivity').textContent = ago;
  }
}

const _feedSessions = new Set();

function getSessionColor(name) {
  const colors = ['#6366f1','#ec4899','#10b981','#f59e0b','#8b5cf6','#06b6d4','#ef4444','#84cc16','#f97316','#14b8a6'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function applyFeedFilter() {
  const sf = document.getElementById('feedSessionFilter').value;
  const rf = document.getElementById('feedRoleFilter').value;
  document.querySelectorAll('.feed-item').forEach(el => {
    const matchSession = sf === 'all' || el.dataset.session === sf;
    const matchRole = rf === 'all' || el.dataset.role === rf;
    let matchSearch = true;
    if (feedSearchTerm) {
      const content = el.querySelector('.feed-content');
      if (content) {
        const text = content.getAttribute('data-original') || content.textContent;
        if (!content.getAttribute('data-original')) {
          content.setAttribute('data-original', text);
        }
        matchSearch = text.toLowerCase().includes(feedSearchTerm);
        if (matchSearch && feedSearchTerm) {
          content.innerHTML = highlightText(text, feedSearchTerm);
        } else {
          content.textContent = text;
        }
      }
    }
    el.classList.toggle('ui-hidden', !(matchSession && matchRole && matchSearch));
  });
}

function connectLiveFeed() {
  if (liveEventSource) return;
  if (liveFeedReconnectTimer) {
    clearTimeout(liveFeedReconnectTimer);
    liveFeedReconnectTimer = null;
  }
  
  // Populate session filter from known sessions
  const sel = document.getElementById('feedSessionFilter');
  if (sel && sessions.length) {
    const current = sel.value;
    const seen = new Set();
    sel.innerHTML = '';

    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'All Sessions';
    sel.appendChild(allOpt);

    sessions.forEach(s => {
      const label = s.label || s.key.split(':').slice(2).join(':') || s.key;
      if (seen.has(label)) return;
      seen.add(label);
      const opt = document.createElement('option');
      opt.value = label;
      opt.textContent = label;
      sel.appendChild(opt);
    });
    sel.value = current || 'all';
  }

  liveEventSource = new EventSource(API_BASE + '/api/live');
  
  liveEventSource.onmessage = (event) => {
    if (feedPaused) return;
    
    try {
      const data = JSON.parse(event.data);
      if (data.status === 'connected') {
        const feed = document.getElementById('feedStream');
        if (feed.querySelector('[data-placeholder]')) feed.innerHTML = '';
        return;
      }
      
      const feed = document.getElementById('feedStream');
      const ph = feed.querySelector('[data-placeholder]');
      if (ph) ph.remove();
      const roleClass = data.role || 'assistant';
      const roleLabel = (data.role || 'assistant').toUpperCase();
      const sessionName = data.session || 'unknown';
      const sessionColor = getSessionColor(sessionName);
      
      // Add to session filter if new
      if (!_feedSessions.has(sessionName)) {
        _feedSessions.add(sessionName);
        const sel = document.getElementById('feedSessionFilter');
        if (sel && ![...sel.options].find(o => o.value === sessionName)) {
          sel.add(new Option(sessionName, sessionName));
        }
      }
      
      const sfEl = document.getElementById('feedSessionFilter');
      const rfEl = document.getElementById('feedRoleFilter');
      const sf = sfEl ? sfEl.value : 'all';
      const rf = rfEl ? rfEl.value : 'all';
      const visible = (sf === 'all' || sf === sessionName) && (rf === 'all' || rf === roleClass);

      const time = new Date(data.timestamp).toLocaleTimeString('en', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
      
      const item = document.createElement('div');
      item.className = `feed-item role-${roleClass}`;
      item.dataset.session = sessionName;
      item.dataset.role = roleClass;
      item.classList.toggle('ui-hidden', !visible);

      const header = document.createElement('div');
      header.className = 'feed-header-line';
      const left = document.createElement('div');
      left.style.cssText = 'display:flex;align-items:center;gap:8px;';
      const sessionTag = document.createElement('span');
      sessionTag.style.cssText = `background:${sessionColor};color:#fff;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:600;letter-spacing:0.02em;`;
      sessionTag.textContent = sessionName;
      const roleTag = document.createElement('span');
      roleTag.className = `feed-role ${roleClass}`;
      roleTag.textContent = roleLabel;
      left.appendChild(sessionTag);
      left.appendChild(roleTag);
      const timeTag = document.createElement('span');
      timeTag.className = 'feed-time';
      timeTag.textContent = time;
      header.appendChild(left);
      header.appendChild(timeTag);

      const content = document.createElement('div');
      content.className = 'feed-content';
      content.textContent = data.content || '';

      item.appendChild(header);
      item.appendChild(content);
      feed.insertBefore(item, feed.firstChild);
      
      const items = feed.querySelectorAll('.feed-item');
      if (items.length > 200) {
        items[items.length - 1].remove();
      }
      
      // Check for sub-agent completion notification
      if (data.session && data.session.toLowerCase().includes('sub') && data.role === 'assistant' && data.content && data.content.toLowerCase().includes('complet')) {
        sendNotification('Sub-agent Complete', `${data.session} finished a task`);
      }
    } catch (e) {
      console.error('Feed parse error:', e);
    }
  };
  
  liveEventSource.onerror = () => {
    console.error('Live feed disconnected');
    liveEventSource.close();
    liveEventSource = null;
    if (!liveFeedReconnectTimer) {
      liveFeedReconnectTimer = setTimeout(() => {
        liveFeedReconnectTimer = null;
        connectLiveFeed();
      }, 5000);
    }
  };
}

document.getElementById('pauseBtn').addEventListener('click', function() {
  if (!liveEventSource) {
    this.textContent = '⏳ Loading...';
    this.disabled = true;
    const feed = document.getElementById('feedStream');
    feed.innerHTML = '<div data-placeholder style="text-align:center;padding:24px;color:var(--text-muted);">Connecting to live stream...</div>';
    feedPaused = false;
    connectLiveFeed();
    setTimeout(() => { this.textContent = '⏸ Pause'; this.disabled = false; }, 1500);
  } else {
    feedPaused = !feedPaused;
    if (feedPaused) {
      liveEventSource.close();
      liveEventSource = null;
      this.textContent = '▶ Start';
    } else {
      this.textContent = '⏳ Loading...';
      this.disabled = true;
      connectLiveFeed();
      setTimeout(() => { this.textContent = '⏸ Pause'; this.disabled = false; }, 1500);
    }
  }
});

let healthHistory = [];

async function fetchHealthHistory() {
  try {
    const res = await authFetch(API_BASE + '/api/health-history');
    healthHistory = await res.json();
    renderHealthSparklines();
  } catch {}
}

function renderHealthSparklines() {
  if (!healthHistory || healthHistory.length < 2) return;
  
  const renderSparkline = (containerId, dataKey, color) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    const w = 120, h = 30;
    const vals = healthHistory.map(p => p[dataKey] || 0);
    const min = Math.max(Math.min(...vals) - 5, 0);
    const max = Math.min(Math.max(...vals) + 5, 100);
    const range = max - min || 1;
    const points = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    }).join(' ');
    el.innerHTML = '';
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const polyline = document.createElementNS(svgNs, 'polyline');
    polyline.setAttribute('points', points);
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', color);
    polyline.setAttribute('stroke-width', '1.5');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(polyline);
    el.appendChild(svg);
  };
  
  renderSparkline('cpuSparkline', 'cpu', 'var(--green)');
  renderSparkline('ramSparkline', 'ram', 'var(--blue)');
  renderSparkline('tempSparkline', 'temp', 'var(--yellow)');
  renderSparkline('diskSparkline', 'disk', 'var(--purple)');
}

async function fetchNewData() {
  try {
    const [cronsRes, gitRes, svcRes, memRes, tokRes, rtRes] = await Promise.all([
      authFetch(API_BASE + '/api/crons'),
      authFetch(API_BASE + '/api/git'),
      authFetch(API_BASE + '/api/services'),
      authFetch(API_BASE + '/api/memory'),
      authFetch(API_BASE + '/api/tokens-today'),
      authFetch(API_BASE + '/api/response-time')
    ]);
    const crons = await cronsRes.json();
    const git = await gitRes.json();
    const services = await svcRes.json();
    const memFiles = await memRes.json();
    const tokens = await tokRes.json();
    const rt = await rtRes.json();

    const servicesStatusEl = document.getElementById('servicesStatus');
    if (!services.length) {
      setEmptyState(servicesStatusEl, 'No services');
    } else {
      servicesStatusEl.innerHTML = '';
      services.forEach((s, i) => {
        const isLast = i === services.length - 1;
        const status = s.active === null ? 'N/A' : (s.active ? 'Running' : 'Stopped');
        const dotColor = s.active === null ? 'var(--text-muted)' : (s.active ? 'var(--green)' : 'var(--red)');
        const textColor = s.active === null ? 'var(--text-muted)' : (s.active ? 'var(--green)' : 'var(--red)');
        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:${isLast ? 'none' : '1px solid var(--border)'};`;
        const dot = document.createElement('span');
        dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${dotColor};flex-shrink:0;`;
        const name = document.createElement('span');
        name.style.cssText = 'font-weight:600;font-size:14px;';
        name.textContent = s.name;
        const statusEl = document.createElement('span');
        statusEl.style.cssText = `margin-left:auto;font-size:12px;color:${textColor};`;
        statusEl.textContent = status;
        row.appendChild(dot);
        row.appendChild(name);
        row.appendChild(statusEl);
        servicesStatusEl.appendChild(row);
      });
    }

    const now = Date.now();
    const cronJobsEl = document.getElementById('cronJobs');
    if (!crons.length) {
      setEmptyState(cronJobsEl, 'No cron jobs');
    } else {
      cronJobsEl.innerHTML = '';
      crons.forEach(c => {
        const statusIcon = c.lastStatus === 'ok' ? '✅' : c.lastStatus === 'unknown' ? '⚪' : '❌';
        const nextAgo = c.nextRunAt > now ? formatTimeAgo(c.nextRunAt - now, true) : '--';
        const toggleColor = c.enabled ? 'var(--green)' : 'var(--text-muted)';
        const toggleBg = c.enabled ? 'rgba(16,185,129,0.2)' : 'var(--bg-tertiary)';
        const row = document.createElement('div');
        row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--border);';
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;';
        const name = document.createElement('span');
        name.style.cssText = 'font-weight:600;font-size:13px;flex:1;';
        name.textContent = `${statusIcon} ${c.name}`;
        header.appendChild(name);
        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = c.enabled ? 'ON' : 'OFF';
        toggleBtn.style.cssText = `padding:2px 8px;background:${toggleBg};color:${toggleColor};border:1px solid var(--border);border-radius:4px;font-size:10px;font-weight:600;cursor:pointer;margin-right:4px;`;
        toggleBtn.onclick = () => window.toggleCronJob(c.id);
        const runBtn = document.createElement('button');
        runBtn.textContent = '▶';
        runBtn.style.cssText = 'padding:2px 8px;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;font-size:10px;cursor:pointer;';
        runBtn.onclick = () => window.runCronJob(c.id);
        header.appendChild(toggleBtn);
        header.appendChild(runBtn);
        const schedule = document.createElement('span');
        schedule.className = 'mono';
        schedule.style.cssText = 'font-size:11px;color:var(--text-muted);';
        schedule.textContent = c.schedule;
        const meta = document.createElement('div');
        meta.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:4px;';
        meta.textContent = `Next: ${c.enabled ? nextAgo : 'disabled'} · Last: ${c.lastDuration ? (c.lastDuration / 1000).toFixed(0) + 's' : '--'}`;
        row.appendChild(header);
        row.appendChild(schedule);
        row.appendChild(meta);
        cronJobsEl.appendChild(row);
      });
    }

// Cron management
window.toggleCronJob = async function(id) {
  try {
    const res = await authFetch(API_BASE + `/api/cron/${id}/toggle`, { method: 'POST' });
    if (!res.ok) {
      const body = await res.text();
      showToast('Cron toggle failed: ' + res.status + ' ' + body, 'error');
      return;
    }
    await fetchNewData();
  } catch (e) {
    showToast('Cron toggle error: ' + e.message, 'error');
  }
};

window.runCronJob = async function(id) {
  showToast('Triggering cron job...', 'info');
  try {
    const res = await authFetch(API_BASE + `/api/cron/${id}/run`, { method: 'POST' });
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      const detail = payload?.error || payload?.detail || `${res.status}`;
      showToast('Cron run failed: ' + detail, 'error');
      return;
    }

    if (payload?.success && payload?.reason === 'already-running') {
      showToast('Cron job is already running ⏳', 'info');
      return;
    }

    showToast('Cron job triggered ✅', 'success');
    sendNotification('Cron Job Started', `Running cron job ${id.substring(0, 8)}...`);
    setTimeout(fetchNewData, 3000);
  } catch (e) {
    showToast('Cron run error: ' + e.message, 'error');
  }
};

    const gitActivityEl = document.getElementById('gitActivity');
    if (!git.length) {
      setEmptyState(gitActivityEl, 'No recent commits');
    } else {
      gitActivityEl.innerHTML = '';
      git.forEach(c => {
        const age = now - c.timestamp;
        const ago = age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;';
        const hash = document.createElement('span');
        hash.className = 'mono';
        hash.style.cssText = 'color:var(--accent);flex-shrink:0;';
        hash.textContent = c.hash;
        const msg = document.createElement('span');
        msg.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        msg.textContent = c.message;
        const repo = document.createElement('span');
        repo.style.cssText = 'flex-shrink:0;color:var(--text-muted);';
        repo.textContent = c.repo;
        const agoEl = document.createElement('span');
        agoEl.style.cssText = 'flex-shrink:0;color:var(--text-muted);';
        agoEl.textContent = ago;
        row.appendChild(hash);
        row.appendChild(msg);
        row.appendChild(repo);
        row.appendChild(agoEl);
        gitActivityEl.appendChild(row);
      });
    }

    const memLimit = 5;
    const memoryFilesEl = document.getElementById('memoryFiles');
    if (!memFiles.length) {
      setEmptyState(memoryFilesEl, 'No files');
    } else {
      memoryFilesEl.innerHTML = '';
      memFiles.forEach((f, idx) => {
        const age = now - f.modified;
        const ago = age < 60000 ? 'just now' : age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
        const row = document.createElement('div');
        row.className = 'mem-file-item';
        if (idx >= memLimit) row.classList.add('ui-hidden');
        row.style.cssText = 'display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border);';

        const nameEl = document.createElement('span');
        nameEl.className = 'mono';
        nameEl.style.fontSize = '13px';
        nameEl.textContent = `📄 ${f.name}`;

        const agoEl = document.createElement('span');
        agoEl.style.cssText = 'font-size:12px;color:var(--text-muted);';
        agoEl.textContent = ago;

        row.appendChild(nameEl);
        row.appendChild(agoEl);
        memoryFilesEl.appendChild(row);
      });
      if (memFiles.length > memLimit) {
        const more = document.createElement('div');
        more.id = 'memShowMore';
        more.className = 'mem-show-more';
        more.textContent = `Show all (${memFiles.length} files) ↓`;
        more.onclick = function() {
          document.querySelectorAll('.mem-file-item').forEach(e => e.classList.remove('ui-hidden'));
          this.classList.add('ui-hidden');
        };
        memoryFilesEl.appendChild(more);
      }
    }

    const inK = (tokens.totalInput / 1000).toFixed(0) + 'k';
    const outK = (tokens.totalOutput / 1000).toFixed(0) + 'k';
    document.getElementById('todayTokensOut').textContent = inK + ' in / ' + outK + ' out';

    const tokenBreakdownEl = document.getElementById('tokenBreakdown');
    const perModelEntries = Object.entries(tokens.perModel || {});
    if (!perModelEntries.length) {
      setEmptyState(tokenBreakdownEl, 'No token data');
    } else {
      tokenBreakdownEl.innerHTML = '';
      const maxTok = Math.max(...Object.values(tokens.perModel).map(m => m.input + m.output), 1);
      perModelEntries
        .sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output))
        .forEach(([model, d]) => {
          const total = d.input + d.output;
          const pct = (total / maxTok) * 100;
          const wrap = document.createElement('div');
          wrap.style.marginBottom = '12px';

          const header = document.createElement('div');
          header.className = 'token-breakdown-header';

          const modelEl = document.createElement('span');
          modelEl.className = 'mono';
          modelEl.textContent = model;

          const totalsEl = document.createElement('span');
          totalsEl.className = 'mono';
          totalsEl.style.color = 'var(--text-muted)';
          totalsEl.textContent = `${(d.input/1000).toFixed(0)}k in / ${(d.output/1000).toFixed(0)}k out`;

          const barBg = document.createElement('div');
          barBg.className = 'token-breakdown-bar';

          const barFill = document.createElement('div');
          barFill.className = 'token-breakdown-bar-fill';
          barFill.style.width = `${pct}%`;

          header.appendChild(modelEl);
          header.appendChild(totalsEl);
          barBg.appendChild(barFill);
          wrap.appendChild(header);
          wrap.appendChild(barBg);
          tokenBreakdownEl.appendChild(wrap);
        });
    }

    const modelColors = {'claude-opus-4-6':'var(--accent)','claude-opus-4-5':'var(--purple)','claude-sonnet-4-5':'var(--cyan)','gemini-3-pro-preview':'var(--yellow)','gemini-2.5-flash':'var(--green)'};
    const uniqueSessions = [];
    const seenLabels = new Set();
    sessions.sort((a,b) => b.updatedAt - a.updatedAt).forEach(s => {
      if (!seenLabels.has(s.label)) { seenLabels.add(s.label); uniqueSessions.push(s); }
    });
    const sessionModelsEl = document.getElementById('sessionModels');
    if (!uniqueSessions.length) {
      setEmptyState(sessionModelsEl, 'No sessions');
    } else {
      sessionModelsEl.innerHTML = '';
      uniqueSessions.forEach(s => {
        const shortModel = s.model.split('/').pop();
        const color = modelColors[shortModel] || 'var(--text-muted)';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);';

        const labelEl = document.createElement('span');
        labelEl.style.cssText = 'font-weight:500;font-size:13px;';
        labelEl.textContent = s.label;

        const modelEl = document.createElement('span');
        modelEl.className = 'mono';
        modelEl.style.cssText = `font-size:11px;color:${color};background:${color}18;padding:2px 8px;border-radius:4px;`;
        modelEl.textContent = shortModel;

        row.appendChild(labelEl);
        row.appendChild(modelEl);
        sessionModelsEl.appendChild(row);
      });
    }

    const rtVal = rt.avgSeconds;
    document.getElementById('avgResponseTime').textContent = rtVal > 0 ? rtVal + 's' : '--';
  } catch (e) { console.error('New data fetch error:', e); }
}

function appendInlineFormatted(parent, text) {
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  const str = String(text || '');
  let m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) parent.appendChild(document.createTextNode(str.slice(last, m.index)));
    const token = m[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.style.cssText = 'color:var(--text-primary);font-weight:700;';
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      const code = document.createElement('code');
      code.className = 'inline-code-token';
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    }
    last = m.index + token.length;
  }
  if (last < str.length) parent.appendChild(document.createTextNode(str.slice(last)));
}

function renderSimpleMarkdown(target, content) {
  target.innerHTML = '';
  String(content || '').split('\n').forEach(line => {
    if (!line.trim()) {
      target.appendChild(document.createElement('br'));
      return;
    }
    const block = document.createElement('div');
    if (line.startsWith('### ')) {
      block.className = 'markdown-heading markdown-heading-h3';
      appendInlineFormatted(block, line.slice(4));
    } else if (line.startsWith('## ')) {
      block.className = 'markdown-heading markdown-heading-h2';
      appendInlineFormatted(block, line.slice(3));
    } else if (line.startsWith('# ')) {
      block.className = 'markdown-heading markdown-heading-h1';
      appendInlineFormatted(block, line.slice(2));
    } else {
      appendInlineFormatted(block, line);
    }
    target.appendChild(block);
  });
}

function setViewerMessage(target, message, color = 'var(--text-muted)') {
  target.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'viewer-message';
  div.style.color = color;
  div.textContent = message;
  target.appendChild(div);
}

// Memory page
let memoryFiles = [];
async function fetchMemoryFiles() {
  try {
    const res = await authFetch(API_BASE + '/api/memory-files');
    memoryFiles = await res.json();
    renderMemoryFilesList();
  } catch {}
}

function renderMemoryFilesList() {
  const el = document.getElementById('memoryFilesList');
  if (!el) return;
  const now = Date.now();
  if (!memoryFiles.length) {
    setEmptyState(el, 'No memory files');
    return;
  }
  el.innerHTML = '';
  memoryFiles.forEach(f => {
    const age = now - f.modified;
    const ago = age < 60000 ? 'just now' : age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
    const sizeKb = (f.size / 1024).toFixed(1);
    const icon = f.name.includes('MEMORY') ? '🧠' : f.name.includes('HEARTBEAT') ? '💓' : '📄';
    const item = document.createElement('div');
    item.className = 'memory-file-item';
    item.onclick = () => window.loadMemoryFile(encodeURIComponent(f.name));

    const header = document.createElement('div');
    header.className = 'memory-file-header';

    const iconEl = document.createElement('span');
    iconEl.className = 'memory-file-icon';
    iconEl.textContent = icon;

    const nameEl = document.createElement('span');
    nameEl.className = 'memory-file-name';
    nameEl.textContent = f.name;

    const metaEl = document.createElement('div');
    metaEl.className = 'memory-file-meta';
    metaEl.textContent = `${sizeKb} KB · ${ago}`;

    header.appendChild(iconEl);
    header.appendChild(nameEl);
    item.appendChild(header);
    item.appendChild(metaEl);
    el.appendChild(item);
  });
}

