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
    if (currentUsageProvider === 'claude') updateOverviewClaude();

    const cu = cachedClaudeUsageData;
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
      item.addEventListener('click', () => openSessionDetail(s.key));

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
        <div class="bar-label">${escapeHtml(label)}</div>
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

let cachedClaudeUsageData = null;
let cachedOpenAIUsageData = null;
let cachedOpenCodeGoUsageData = null;
let usageAutoRefreshEntry = null;

function setClaudeUsageBars(data) {
  setUsageBar('cuSession', data && data.session, '% used');
  setUsageBar('cuWeekly', data && data.weekly_all, '% used');
  setUsageBar('cuSonnet', data && data.weekly_sonnet, '% used');
}

function setUsageBar(prefix, data, defaultLabelTemplate) {
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
      setClaudeUsageBars(data);
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
      setUsageBar('openaiSession', data && data.session);
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
      setUsageBar('opencodeGoSession', data && data.session);
    },
    selectOverviewData(data) {
      return data && data.session;
    }
  }
};

const PROVIDER_USAGE_CACHE = {
  claude: () => cachedClaudeUsageData,
  openai: () => cachedOpenAIUsageData,
  'opencode-go': () => cachedOpenCodeGoUsageData
};

function getProviderUsageCache(provider) {
  const canonical = resolveUsageProvider(provider);
  return PROVIDER_USAGE_CACHE[canonical] ? PROVIDER_USAGE_CACHE[canonical]() : null;
}

function setProviderUsageCache(provider, value) {
  const canonical = resolveUsageProvider(provider);
  if (canonical === 'claude') cachedClaudeUsageData = value;
  else if (canonical === 'openai') cachedOpenAIUsageData = value;
  else if (canonical === 'opencode-go') cachedOpenCodeGoUsageData = value;
}

async function fetchProviderUsage(provider) {
  const canonical = resolveUsageProvider(provider);
  const cfg = PROVIDER_USAGE_CONFIG[canonical];
  if (!cfg) return;
  try {
    const r = await authFetch(API_BASE + '/api/' + cfg.endpoint + '-usage');
    const d = await r.json();
    if (d.error) return;
    setProviderUsageCache(canonical, d);
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
  if (label && usageAutoRefreshEntry) label.textContent = '⏳...';
  try {
    await authFetch(API_BASE + '/api/' + cfg.endpoint + '-usage-scrape', { method: 'POST' });
    const oldTs = ((getProviderUsageCache(canonical) || {}).scraped_at) || '';
    const attempts = (cfg.scrape && cfg.scrape.pollAttempts) || 5;
    const delayMs = (cfg.scrape && cfg.scrape.pollDelayMs) || 1200;
    for (let i = 0; i < attempts; i++) {
      await new Promise(r => setTimeout(r, delayMs));
      await fetchProviderUsage(canonical);
      const current = getProviderUsageCache(canonical);
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
    if (label && usageAutoRefreshEntry) label.textContent = 'Auto ✓';
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
    usageAutoRefreshEntry = visibleInterval(scrapeCurrentProvider, 120000);
  } else {
    track.style.background = 'var(--bg-tertiary)';
    thumb.style.left = '2px';
    label.textContent = 'Auto';
    label.style.color = 'var(--text-muted)';
    clearVisibleInterval(usageAutoRefreshEntry);
    usageAutoRefreshEntry = null;
  }
}

let currentUsageProvider = resolveUsageProvider(localStorage.getItem('usageProvider') || 'claude');
let currentUsageModel = localStorage.getItem('usageModel') || 'session';

function getProviderModelOptions() {
  const cfg = PROVIDER_USAGE_CONFIG[currentUsageProvider] || PROVIDER_USAGE_CONFIG.claude;
  return cfg.models || [];
}

function populateModelSelect() {
  const sel = document.getElementById('modelSelect');
  if (!sel) return;
  const opts = getProviderModelOptions();
  sel.innerHTML = '';
  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  });
  if (opts.some(o => o.value === currentUsageModel)) {
    sel.value = currentUsageModel;
  } else if (opts.length) {
    currentUsageModel = opts[0].value;
    sel.value = currentUsageModel;
  }
}

function setOverviewBar(pct, label, sourceHint) {
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
  const canonical = resolveUsageProvider(provider || currentUsageProvider);
  const cfg = PROVIDER_USAGE_CONFIG[canonical];
  if (!cfg) return;
  populateModelSelect();
  const data = cfg.selectOverviewData(getProviderUsageCache(canonical), currentUsageModel);
  if (!data) return;
  setOverviewBar(data.percent, data.label || data.detail || (data.resets ? 'Resets ' + data.resets : ''), cfg.sourceHint);
}

function updateOverviewClaude() { return updateOverviewForProvider('claude'); }
function updateOverviewOpenAI() { return updateOverviewForProvider('openai'); }
function updateOverviewOpenCodeGo() { return updateOverviewForProvider('opencode-go'); }

function switchModel(val) {
  currentUsageModel = val;
  const cfg = PROVIDER_USAGE_CONFIG[currentUsageProvider] || PROVIDER_USAGE_CONFIG.claude;
  localStorage.setItem(cfg.modelStorageKey || 'usageModel', val);
  updateOverviewForProvider(currentUsageProvider);
}

function switchProvider(prov) {
  currentUsageProvider = resolveUsageProvider(prov);
  localStorage.setItem('usageProvider', currentUsageProvider);
  Object.values(PROVIDER_USAGE_CONFIG).forEach(cfg => {
    const btn = cfg.button && document.getElementById(cfg.button.id);
    if (btn) {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text-muted)';
    }
  });
  const activeCfg = PROVIDER_USAGE_CONFIG[currentUsageProvider] || PROVIDER_USAGE_CONFIG.claude;
  const activeBtn = activeCfg.button && document.getElementById(activeCfg.button.id);
  if (activeBtn) {
    activeBtn.style.background = activeCfg.button.activeBg;
    activeBtn.style.color = '#fff';
  }
  currentUsageModel = localStorage.getItem(activeCfg.modelStorageKey) || ((activeCfg.models && activeCfg.models[0] && activeCfg.models[0].value) || 'session');
  updateOverviewForProvider(currentUsageProvider);
  if (usageAutoRefreshEntry) {
    clearVisibleInterval(usageAutoRefreshEntry);
    usageAutoRefreshEntry = visibleInterval(scrapeCurrentProvider, 120000);
  }
}

function scrapeCurrentProvider() {
  return scrapeProviderUsage(currentUsageProvider);
}

Object.keys(PROVIDER_USAGE_CONFIG).forEach(provider => {
  fetchProviderUsage(provider);
  visibleInterval(() => fetchProviderUsage(provider), PROVIDER_USAGE_CONFIG[provider].fetchIntervalMs || 60000);
});
switchProvider(currentUsageProvider);

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
      wrap.className = 'usage-breakdown-item';
      const top = document.createElement('div');
      top.className = 'usage-breakdown-top';
      const left = document.createElement('span');
      left.className = 'mono usage-breakdown-model';
      left.textContent = shortModel;
      const right = document.createElement('span');
      right.className = 'mono usage-breakdown-cost';
      right.textContent = '$' + totalModelCost.toFixed(4);
      top.appendChild(left);
      top.appendChild(right);
      const meta = document.createElement('div');
      meta.className = 'usage-breakdown-meta';
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
      row.className = 'recent-call-row';
      const left = document.createElement('div');
      const model = document.createElement('div');
      model.className = 'mono recent-call-model';
      model.textContent = shortModel;
      const agoEl = document.createElement('div');
      agoEl.className = 'recent-call-ago';
      agoEl.textContent = call.ago;
      left.appendChild(model);
      left.appendChild(agoEl);
      const right = document.createElement('div');
      right.className = 'recent-call-right';
      const out = document.createElement('div');
      out.className = 'mono';
      out.textContent = call.output.toLocaleString() + ' out';
      const cost = document.createElement('div');
      cost.className = 'recent-call-cost';
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
        wrap.className = 'donut-layout';
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
        legend.className = 'donut-legend';
        modelData.forEach(d => {
          const pct = ((d.cost / total) * 100).toFixed(1);
          const row = document.createElement('div');
          row.className = 'donut-legend-row';
          const swatch = document.createElement('div');
          swatch.className = 'donut-legend-swatch';
          swatch.style.background = d.color;
          const name = document.createElement('span');
          name.className = 'donut-legend-name';
          name.textContent = d.model;
          const pctEl = document.createElement('span');
          pctEl.className = 'donut-legend-pct';
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
        return `<circle cx="${x}" cy="${y}" r="6" fill="${color}" stroke="var(--bg-card)" stroke-width="2" style="cursor:pointer;filter:drop-shadow(0 0 4px ${color}40);"><title>${escapeHtml(label)}: $${v.toFixed(2)}</title></circle>`;
      }).join('');
      
      // Show all labels for small datasets, sparse for larger
      const labelInterval = count <= 7 ? 1 : Math.ceil(count / 7);
      const xLabels = days.map((d, i) => {
        if (i % labelInterval !== 0 && i !== count - 1) return '';
        const x = count > 1 ? pad + i * xStep : w / 2;
        const date = new Date(d);
        const label = date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
        return `<text x="${x}" y="${h - 15}" fill="var(--text-secondary)" font-size="11" text-anchor="middle" font-family="JetBrains Mono, monospace">${escapeHtml(label)}</text>`;
      }).join('');
      
      const yTicks = [0, maxVal / 2, maxVal].map((val, i) => {
        const y = h - pad - (i / 2) * (h - pad * 2);
        const formattedVal = val >= 1 ? '$' + val.toFixed(2) : val >= 0.1 ? '$' + val.toFixed(2) : '$' + val.toFixed(3);
        return `<text x="${pad - 10}" y="${y + 4}" fill="var(--text-secondary)" font-size="11" text-anchor="end" font-family="JetBrains Mono, monospace">${escapeHtml(formattedVal)}</text>
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
      row.className = 'cost-list-row';
      const left = document.createElement('span');
      left.className = 'mono';
      left.textContent = shortModel;
      const right = document.createElement('span');
      right.className = 'mono cost-list-value';
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
      row.className = 'cost-list-row';
      const left = document.createElement('span');
      left.textContent = v.label;
      const right = document.createElement('span');
      right.className = 'mono cost-list-value';
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
