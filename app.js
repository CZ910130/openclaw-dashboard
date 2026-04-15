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
      left.className = 'feed-header-left';
      const sessionTag = document.createElement('span');
      sessionTag.className = 'feed-session-tag';
      sessionTag.style.background = sessionColor;
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

function toggleFeedPause() {
  const button = document.getElementById('pauseBtn');
  if (!button) return;
  if (!liveEventSource) {
    button.textContent = '⏳ Loading...';
    button.disabled = true;
    const feed = document.getElementById('feedStream');
    feed.innerHTML = '<div data-placeholder class="feed-connecting-placeholder">Connecting to live stream...</div>';
    feedPaused = false;
    connectLiveFeed();
    setTimeout(() => { button.textContent = '⏸ Pause'; button.disabled = false; }, 1500);
    return;
  }

  feedPaused = !feedPaused;
  if (feedPaused) {
    liveEventSource.close();
    liveEventSource = null;
    button.textContent = '▶ Start';
  } else {
    button.textContent = '⏳ Loading...';
    button.disabled = true;
    connectLiveFeed();
    setTimeout(() => { button.textContent = '⏸ Pause'; button.disabled = false; }, 1500);
  }
}

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
