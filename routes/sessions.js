const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { toNum, normalizeProvider, normalizeModel } = require('../utils/helpers');
const { estimateMsgCost } = require('../utils/pricing');
const { sendJson } = require('../utils/http');

function isSessionFile(f) { return f.endsWith('.jsonl') || f.includes('.jsonl.reset.'); }
function extractSessionId(f) { return f.replace(/\.jsonl(?:\.reset\.\d+)?$/, ''); }

async function tailRead(filePath, bytes = 8192) {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.size === 0) return '';
    const readBytes = Math.min(bytes, stat.size);
    const buf = Buffer.alloc(readBytes);
    const fh = await fsp.open(filePath, 'r');
    try {
      await fh.read(buf, 0, readBytes, stat.size - readBytes);
    } finally {
      await fh.close();
    }
    const chunk = buf.toString('utf8');
    if (readBytes < stat.size) {
      const nl = chunk.indexOf('\n');
      return nl >= 0 ? chunk.slice(nl + 1) : chunk;
    }
    return chunk;
  } catch { return ''; }
}

async function getLastMessage(sessDir, sessionId) {
  try {
    const filePath = path.join(sessDir, sessionId + '.jsonl');
    const tail = await tailRead(filePath, 16384);
    if (!tail) return '';
    const lines = tail.split('\n').filter(l => l.trim());
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
      try {
        const d = JSON.parse(lines[i]);
        if (d.type !== 'message') continue;
        const msg = d.message;
        if (!msg) continue;
        const role = msg.role;
        if (role !== 'user' && role !== 'assistant') continue;
        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const b of msg.content) {
            if (b.type === 'text' && b.text) { text = b.text; break; }
          }
        }
        if (text) return text.replace(/\n/g, ' ').substring(0, 80);
      } catch {}
    }
    return '';
  } catch { return ''; }
}

let sessionCostCache = {};
let sessionCostCacheTime = 0;

function getSessionCost(sessDir, sessionId, MODEL_PRICING) {
  const now = Date.now();
  if (now - sessionCostCacheTime > 60000) {
    sessionCostCache = {};
    sessionCostCacheTime = now;
    try {
      const files = fs.readdirSync(sessDir).filter(f => isSessionFile(f));
      for (const file of files) {
        const sid = extractSessionId(file);
        let total = 0;
        const lines = fs.readFileSync(path.join(sessDir, file), 'utf8').split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const d = JSON.parse(line);
            if (d.type !== 'message') continue;
            const c = estimateMsgCost(d.message || {}, MODEL_PRICING);
            if (c > 0) total += c;
          } catch {}
        }
        if (total > 0) sessionCostCache[sid] = Math.round(total * 100) / 100;
      }
    } catch {}
  }
  return sessionCostCache[sessionId] || 0;
}

function resolveName(key, cronFile) {
  if (key.includes(':main:main')) return 'main';
  if (key.includes('teleg')) return 'telegram-group';
  if (key.includes('cron:')) {
    try {
      if (fs.existsSync(cronFile)) {
        const crons = JSON.parse(fs.readFileSync(cronFile, 'utf8'));
        const jobs = crons.jobs || [];
        const cronPart = key.split('cron:')[1] || '';
        const cronUuid = cronPart.split(':')[0];
        const job = jobs.find(j => j.id === cronUuid);
        if (job && job.name) return job.name;
      }
    } catch {}
    const cronPart = key.split('cron:')[1] || '';
    const cronUuid = cronPart.split(':')[0];
    return 'Cron: ' + cronUuid.substring(0, 8);
  }
  if (key.includes('subagent')) {
    const parts = key.split(':');
    return parts[parts.length - 1].substring(0, 12);
  }
  return key.split(':').pop().substring(0, 12);
}

async function getSessionsJson(sessDir, cronFile, MODEL_PRICING) {
  try {
    const sFile = path.join(sessDir, 'sessions.json');
    const raw = await fsp.readFile(sFile, 'utf8');
    const data = JSON.parse(raw);
    const entries = Object.entries(data);
    const results = await Promise.all(entries.map(async ([key, s]) => {
      const sid = s.sessionId || key;
      return {
        key,
        label: s.label || resolveName(key, cronFile),
        model: s.modelOverride || s.model || '-',
        totalTokens: s.totalTokens || 0,
        contextTokens: s.contextTokens || 0,
        kind: s.kind || (key.includes('group') ? 'group' : 'direct'),
        updatedAt: s.updatedAt || 0,
        createdAt: s.createdAt || s.updatedAt || 0,
        aborted: s.abortedLastRun || false,
        thinkingLevel: s.thinkingLevel || null,
        channel: s.channel || '-',
        sessionId: s.sessionId || '-',
        lastMessage: await getLastMessage(sessDir, sid),
        cost: getSessionCost(sessDir, sid, MODEL_PRICING)
      };
    }));
    return results;
  } catch (e) { return []; }
}

async function getCostData(sessDir, cronFile, MODEL_PRICING) {
  try {
    const files = fs.readdirSync(sessDir).filter(f => isSessionFile(f));
    const perModel = {};
    const perDay = {};
    const perSession = {};
    let total = 0;

    for (const file of files) {
      const sid = extractSessionId(file);
      let scost = 0;
      const content = await fsp.readFile(path.join(sessDir, file), 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line);
          if (d.type !== 'message') continue;
          const msg = d.message;
          if (!msg || !msg.usage) continue;
          const c = estimateMsgCost(msg, MODEL_PRICING);
          if (c <= 0) continue;
          const provider = normalizeProvider(msg.provider);
          const model = normalizeModel(provider, msg.model);
          if (model.includes('delivery-mirror')) continue;
          const ts = d.timestamp || '';
          const day = ts.substring(0, 10);
          const modelKey = `${provider}/${model}`;
          perModel[modelKey] = (perModel[modelKey] || 0) + c;
          perDay[day] = (perDay[day] || 0) + c;
          scost += c;
          total += c;
        } catch {}
      }
      if (scost > 0) perSession[sid] = scost;
    }

    const now = new Date();
    const todayKey = now.toISOString().substring(0, 10);
    const weekAgo = new Date(now - 7 * 86400000).toISOString().substring(0, 10);
    let weekCost = 0;
    for (const [d, c] of Object.entries(perDay)) {
      if (d >= weekAgo) weekCost += c;
    }

    let sidLabels = {};
    try {
      const sData = JSON.parse(await fsp.readFile(path.join(sessDir, 'sessions.json'), 'utf8'));
      for (const [key, val] of Object.entries(sData)) {
        if (val.sessionId) sidLabels[val.sessionId] = val.label || key.split(':').slice(2).join(':');
      }
    } catch {}

    const topSessions = Object.entries(perSession).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const perSessionResult = {};
    for (const [sid, cost] of topSessions) {
      let label = sidLabels[sid] || null;
      if (!label) {
        try {
          const jf = path.join(sessDir, sid + '.jsonl');
          let exists = fs.existsSync(jf);
          if (exists) {
            const fileContent = await fsp.readFile(jf, 'utf8');
            const flines = fileContent.split('\n');
            for (const l of flines) {
              if (!l.includes('"user"')) continue;
              try {
                const d = JSON.parse(l);
                const c = d.message?.content;
                const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.find(x => x.type === 'text')?.text || '' : '';
                if (txt) {
                  let t = txt.replace(/\n/g, ' ').trim();
                  const bgMatch = t.match(/background task "([^"]+)"/i);
                  if (bgMatch) t = 'Sub: ' + bgMatch[1];
                  const cronMatch = t.match(/\[cron:([^\]]+)\]/);
                  if (cronMatch) {
                    let cronName = cronMatch[1].substring(0, 8);
                    try {
                      const cj = JSON.parse(fs.readFileSync(cronFile, 'utf8'));
                      const job = cj.jobs?.find(j => j.id?.startsWith(cronMatch[1].substring(0, 8)));
                      if (job?.name) cronName = job.name;
                    } catch {}
                    t = 'Cron: ' + cronName;
                  }
                  if (t.startsWith('System:')) t = t.substring(7).trim();
                  t = t.replace(/^\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*/, '');
                  if (t.startsWith('You are running a boot')) t = 'Boot check';
                  if (t.match(/whatsapp/i)) t = 'WhatsApp session';
                  const subMatch2 = t.match(/background task "([^"]+)"/i);
                  if (!bgMatch && subMatch2) t = 'Sub: ' + subMatch2[1];
                  label = t.substring(0, 35); if (t.length > 35) label += '…';
                  break;
                }
              } catch {}
            }
          }
        } catch {}
      }
      perSessionResult[sid] = { cost, label: label || ('session-' + sid.substring(0, 8)) };
    }

    return {
      total: Math.round(total * 100) / 100,
      today: Math.round((perDay[todayKey] || 0) * 100) / 100,
      week: Math.round(weekCost * 100) / 100,
      perModel,
      perDay: Object.fromEntries(Object.entries(perDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14)),
      perSession: perSessionResult
    };
  } catch (e) { return { total: 0, today: 0, week: 0, perModel: {}, perDay: {}, perSession: {} }; }
}

function getUsageWindows(sessDir, MODEL_PRICING) {
  try {
    const now = Date.now();
    const fiveHoursMs = 5 * 3600000;
    const oneWeekMs = 7 * 86400000;
    const files = fs.readdirSync(sessDir).filter(f => {
      if (!f.endsWith('.jsonl')) return false;
      try { return fs.statSync(path.join(sessDir, f)).mtimeMs > now - oneWeekMs; } catch { return false; }
    });

    const perModel5h = {};
    const perModelWeek = {};
    const recentMessages = [];

    for (const file of files) {
      const lines = fs.readFileSync(path.join(sessDir, file), 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line);
          if (d.type !== 'message') continue;
          const msg = d.message;
          if (!msg || !msg.usage) continue;
          const ts = d.timestamp ? new Date(d.timestamp).getTime() : 0;
          if (!ts) continue;
          const provider = normalizeProvider(msg.provider);
          const model = normalizeModel(provider, msg.model);
          const modelKey = `${provider}/${model}`;
          const inTok = Math.max(0, toNum(msg.usage.input));
          const outTok = Math.max(0, toNum(msg.usage.output));
          const cacheReadTok = Math.max(0, toNum(msg.usage.cacheRead));
          const cacheWriteTok = Math.max(0, toNum(msg.usage.cacheWrite));
          const cost = estimateMsgCost(msg, MODEL_PRICING);

          if (now - ts < fiveHoursMs) {
            if (!perModel5h[modelKey]) perModel5h[modelKey] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0 };
            perModel5h[modelKey].input += inTok;
            perModel5h[modelKey].output += outTok;
            perModel5h[modelKey].cacheRead += cacheReadTok;
            perModel5h[modelKey].cacheWrite += cacheWriteTok;
            perModel5h[modelKey].cost += cost;
            perModel5h[modelKey].calls++;
          }
          if (now - ts < oneWeekMs) {
            if (!perModelWeek[modelKey]) perModelWeek[modelKey] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0 };
            perModelWeek[modelKey].input += inTok;
            perModelWeek[modelKey].output += outTok;
            perModelWeek[modelKey].cacheRead += cacheReadTok;
            perModelWeek[modelKey].cacheWrite += cacheWriteTok;
            perModelWeek[modelKey].cost += cost;
            perModelWeek[modelKey].calls++;
          }
          if (now - ts < fiveHoursMs) {
            recentMessages.push({ ts, model: modelKey, input: inTok, output: outTok, cacheRead: cacheReadTok, cacheWrite: cacheWriteTok, cost });
          }
        } catch {}
      }
    }

    recentMessages.sort((a, b) => b.ts - a.ts);

    const estimatedLimits = { opus: 88000, sonnet: 220000 };

    let windowStart = null;
    if (recentMessages.length > 0) {
      windowStart = recentMessages[recentMessages.length - 1].ts;
    }
    const windowResetIn = windowStart ? Math.max(0, (windowStart + fiveHoursMs) - now) : 0;

    const thirtyMinAgo = now - 30 * 60000;
    const recent30 = recentMessages.filter(m => m.ts >= thirtyMinAgo);
    let burnTokensPerMin = 0;
    let burnCostPerMin = 0;
    if (recent30.length > 0) {
      const totalOut30 = recent30.reduce((s, m) => s + m.output, 0);
      const totalCost30 = recent30.reduce((s, m) => s + m.cost, 0);
      const spanMs = Math.max(now - Math.min(...recent30.map(m => m.ts)), 60000);
      burnTokensPerMin = totalOut30 / (spanMs / 60000);
      burnCostPerMin = totalCost30 / (spanMs / 60000);
    }

    const opusKey = Object.keys(perModel5h).find(k => k.includes('opus')) || '';
    const opusOut = opusKey ? perModel5h[opusKey].output : 0;
    const sonnetKey = Object.keys(perModel5h).find(k => k.includes('sonnet')) || '';
    const sonnetOut = sonnetKey ? perModel5h[sonnetKey].output : 0;

    const opusRemaining = estimatedLimits.opus - opusOut;
    const timeToLimit = burnTokensPerMin > 0 ? (opusRemaining / burnTokensPerMin) * 60000 : null;

    const perModelCost5h = {};
    for (const [model, data] of Object.entries(perModel5h)) {
      const slash = model.indexOf('/');
      const provider = slash >= 0 ? model.slice(0, slash) : 'unknown';
      const modelName = slash >= 0 ? model.slice(slash + 1) : model;
      const rates = MODEL_PRICING[`${provider}/${modelName}`] || {};
      const inputCost = (data.input || 0) / 1000000 * toNum(rates.input);
      const outputCost = (data.output || 0) / 1000000 * toNum(rates.output);
      const cacheReadCost = (data.cacheRead || 0) / 1000000 * toNum(rates.cacheRead);
      const cacheWriteCost = (data.cacheWrite || 0) / 1000000 * toNum(rates.cacheWrite);
      perModelCost5h[model] = {
        inputCost, outputCost, cacheReadCost, cacheWriteCost,
        totalCost: data.cost || (inputCost + outputCost + cacheReadCost + cacheWriteCost)
      };
    }

    const totalCost5h = Object.values(perModel5h).reduce((s, m) => s + (m.cost || 0), 0);
    const totalCalls5h = Object.values(perModel5h).reduce((s, m) => s + (m.calls || 0), 0);
    const costLimit = 35.0;
    const messageLimit = 1000;

    return {
      fiveHour: {
        perModel: perModel5h,
        perModelCost: perModelCost5h,
        windowStart,
        windowResetIn,
        recentCalls: recentMessages.slice(0, 20).map(m => ({
          ...m,
          ago: Math.round((now - m.ts) / 60000) + 'm ago'
        }))
      },
      weekly: { perModel: perModelWeek },
      burnRate: { tokensPerMinute: Math.round(burnTokensPerMin * 100) / 100, costPerMinute: Math.round(burnCostPerMin * 10000) / 10000 },
      estimatedLimits,
      current: {
        opusOutput: opusOut,
        sonnetOutput: sonnetOut,
        totalCost: Math.round(totalCost5h * 100) / 100,
        totalCalls: totalCalls5h,
        opusPct: Math.round((opusOut / estimatedLimits.opus) * 100),
        sonnetPct: Math.round((sonnetOut / estimatedLimits.sonnet) * 100),
        costPct: Math.round((totalCost5h / costLimit) * 100),
        messagePct: Math.round((totalCalls5h / messageLimit) * 100),
        costLimit,
        messageLimit
      },
      predictions: { timeToLimit: timeToLimit ? Math.round(timeToLimit) : null, safe: !timeToLimit || timeToLimit > 3600000 }
    };
  } catch (e) {
    return { fiveHour: { perModel: {} }, weekly: { perModel: {} } };
  }
}

function getTodayTokens(sessDir) {
  try {
    const files = fs.readdirSync(sessDir).filter(f => isSessionFile(f));
    const now = new Date();
    const todayStr = now.toISOString().substring(0, 10);
    const perModel = {};
    let totalInput = 0, totalOutput = 0;

    for (const file of files) {
      const lines = fs.readFileSync(path.join(sessDir, file), 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line);
          if (d.type !== 'message') continue;
          const ts = d.timestamp || '';
          if (!ts.startsWith(todayStr)) continue;
          const msg = d.message;
          if (!msg || !msg.usage) continue;
          const model = (msg.model || 'unknown').split('/').pop();
          if (model === 'delivery-mirror') continue;
          const inTok = (msg.usage.input || 0) + (msg.usage.cacheRead || 0) + (msg.usage.cacheWrite || 0);
          const outTok = msg.usage.output || 0;
          if (!perModel[model]) perModel[model] = { input: 0, output: 0 };
          perModel[model].input += inTok;
          perModel[model].output += outTok;
          totalInput += inTok;
          totalOutput += outTok;
        } catch {}
      }
    }
    return { totalInput, totalOutput, perModel };
  } catch { return { totalInput: 0, totalOutput: 0, perModel: {} }; }
}

function getAvgResponseTime(sessDir) {
  try {
    const files = fs.readdirSync(sessDir).filter(f => isSessionFile(f));
    const now = new Date();
    const todayStr = now.toISOString().substring(0, 10);
    const diffs = [];

    for (const file of files) {
      const lines = fs.readFileSync(path.join(sessDir, file), 'utf8').split('\n');
      let lastUserTs = null;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line);
          if (d.type !== 'message') continue;
          const ts = d.timestamp || '';
          if (!ts.startsWith(todayStr)) continue;
          const role = d.message?.role;
          const msgTs = new Date(ts).getTime();
          if (role === 'user') {
            lastUserTs = msgTs;
          } else if (role === 'assistant' && lastUserTs) {
            const diff = msgTs - lastUserTs;
            if (diff > 0 && diff < 600000) diffs.push(diff);
            lastUserTs = null;
          }
        } catch {}
      }
    }
    if (diffs.length === 0) return 0;
    return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length / 1000);
  } catch { return 0; }
}

function getLifetimeStats(sessDir, MODEL_PRICING) {
  const now = Date.now();
  const cacheKey = 'lifetimeStats';
  const cacheTime = global[cacheKey + 'Time'] || 0;
  if (global[cacheKey] && now - cacheTime < 300000) {
    return global[cacheKey];
  }
  const files = fs.readdirSync(sessDir).filter(f => isSessionFile(f));
  let totalTokens = 0, totalMessages = 0, totalCost = 0, totalSessions = files.length;
  let firstSessionDate = null;
  const activeDays = new Set();
  for (const file of files) {
    const lines = fs.readFileSync(path.join(sessDir, file), 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line);
        if (d.type !== 'message') continue;
        totalMessages++;
        const msg = d.message;
        if (msg?.usage) {
          const inTok = (msg.usage.input || 0) + (msg.usage.cacheRead || 0) + (msg.usage.cacheWrite || 0);
          const outTok = msg.usage.output || 0;
          totalTokens += inTok + outTok;
          totalCost += estimateMsgCost(msg, MODEL_PRICING);
        }
        if (d.timestamp) {
          const ts = new Date(d.timestamp).getTime();
          if (!firstSessionDate || ts < firstSessionDate) firstSessionDate = ts;
          const day = d.timestamp.substring(0, 10);
          activeDays.add(day);
        }
      } catch {}
    }
  }
  const result = {
    totalTokens,
    totalMessages,
    totalCost: Math.round(totalCost * 100) / 100,
    totalSessions,
    firstSessionDate,
    daysActive: activeDays.size
  };
  global[cacheKey] = result;
  global[cacheKey + 'Time'] = now;
  return result;
}

function handle(req, res, ctx) {
  if (req.url === '/api/sessions') {
    getSessionsJson(ctx.sessDir, ctx.cronFile, ctx.MODEL_PRICING).then(data => sendJson(req, res, data));
    return true;
  }

  if (req.url === '/api/usage') {
    const now = Date.now();
    if (!ctx.usageCache.data || now - ctx.usageCache.time > 10000) {
      ctx.usageCache.data = getUsageWindows(ctx.sessDir, ctx.MODEL_PRICING);
      ctx.usageCache.time = now;
    }
    sendJson(req, res, ctx.usageCache.data);
    return true;
  }

  if (req.url === '/api/costs') {
    const now = Date.now();
    if (!ctx.costCache.data || now - ctx.costCache.time > 60000) {
      getCostData(ctx.sessDir, ctx.cronFile, ctx.MODEL_PRICING).then(data => {
        ctx.costCache.data = data;
        ctx.costCache.time = Date.now();
        sendJson(req, res, ctx.costCache.data);
      });
    } else {
      sendJson(req, res, ctx.costCache.data);
    }
    return true;
  }

  if (req.url.startsWith('/api/session-messages?')) {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const rawId = params.get('id') || '';
    const sessionId = rawId.replace(/[^a-zA-Z0-9\-_:.]/g, '');
    const messages = [];
    try {
      const files = fs.readdirSync(ctx.sessDir).filter(f => isSessionFile(f));
      let targetFile = files.find(f => f.includes(sessionId));
      if (!targetFile) {
        const sFile = path.join(ctx.sessDir, 'sessions.json');
        const data = JSON.parse(fs.readFileSync(sFile, 'utf8'));
        for (const [k, v] of Object.entries(data)) {
          if (k === sessionId && v.sessionId) {
            targetFile = files.find(f => f.includes(v.sessionId));
            break;
          }
        }
      }
      if (targetFile) {
        const lines = fs.readFileSync(path.join(ctx.sessDir, targetFile), 'utf8').split('\n').filter(l => l.trim());
        for (let i = Math.max(0, lines.length - 30); i < lines.length; i++) {
          try {
            const d = JSON.parse(lines[i]);
            if (d.type !== 'message') continue;
            const msg = d.message;
            if (!msg) continue;
            let text = '';
            if (typeof msg.content === 'string') text = msg.content;
            else if (Array.isArray(msg.content)) {
              for (const b of msg.content) {
                if (b.type === 'text' && b.text) { text = b.text; break; }
                if (b.type === 'tool_use' || b.type === 'toolCall') { text = '🔧 ' + (b.name || b.toolName || 'tool'); break; }
              }
            }
            if (text) messages.push({ role: msg.role || 'unknown', content: text.substring(0, 300), timestamp: d.timestamp || '' });
          } catch {}
        }
      }
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(messages));
    return true;
  }

  if (req.url === '/api/tokens-today') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getTodayTokens(ctx.sessDir)));
    return true;
  }

  if (req.url === '/api/response-time') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ avgSeconds: getAvgResponseTime(ctx.sessDir) }));
    return true;
  }

  if (req.url === '/api/lifetime-stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      res.end(JSON.stringify(getLifetimeStats(ctx.sessDir, ctx.MODEL_PRICING)));
    } catch (e) {
      res.end(JSON.stringify({ totalTokens: 0, totalMessages: 0, totalCost: 0, totalSessions: 0, firstSessionDate: null, daysActive: 0 }));
    }
    return true;
  }

  return false;
}

module.exports = {
  handle,
  isSessionFile,
  extractSessionId,
  getSessionsJson,
  getCostData,
  getUsageWindows,
  getTodayTokens,
  getAvgResponseTime,
  getLifetimeStats,
  formatLiveEvent: null // will be set below
};

// Live event formatting (used by SSE in system routes)
function formatLiveEvent(data, sessionsCache) {
  const timestamp = data.timestamp || new Date().toISOString();
  const sessionKey = data._sessionKey || data.sessionId || 'unknown';
  const sessions = sessionsCache || [];
  const session = sessions.find(s => s.sessionId === sessionKey || s.key.includes(sessionKey));
  const label = session ? session.label : sessionKey.substring(0, 8);

  if (data.type === 'message') {
    const msg = data.message;
    if (!msg) return null;
    const role = msg.role || 'unknown';
    let content = '';
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          content = block.text.substring(0, 150);
          break;
        } else if (block.type === 'toolCall' || block.type === 'tool_use') {
          content = `🔧 ${block.name || block.toolName || 'tool'}(${(JSON.stringify(block.arguments || block.input || {})).substring(0, 80)})`;
          break;
        } else if (block.type === 'toolResult' || block.type === 'tool_result') {
          const rc = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '');
          content = `📋 Result: ${rc.substring(0, 100)}`;
          break;
        } else if (block.type === 'thinking') {
          content = `💭 ${(block.thinking || '').substring(0, 100)}`;
          break;
        }
      }
      if (!content && msg.content[0]) {
        content = JSON.stringify(msg.content[0]).substring(0, 100);
      }
    } else if (typeof msg.content === 'string') {
      content = msg.content.substring(0, 150);
    }
    if (!content && msg.type === 'tool_result') {
      const rc = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
      content = `📋 ${rc.substring(0, 100)}`;
    }
    if (!content) return null;
    return {
      timestamp,
      session: label,
      role,
      content: content.replace(/\n/g, ' ').trim()
    };
  }
  return null;
}

module.exports.formatLiveEvent = formatLiveEvent;
