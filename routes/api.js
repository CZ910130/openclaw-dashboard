const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { exec, execSync } = require('child_process');
const { sendJson, sendCompressed, auditLog, getClientIP, safePath } = require('../lib/utils');
const { parseCookies } = require('../lib/auth');

const MAX_FILE_BODY = 1024 * 1024;

function buildKeyFilesAllowed(ctx) {
  const { WORKSPACE_DIR, workspaceFilenames, skillsDir, configFiles } = ctx;
  const map = {};
  for (const fname of workspaceFilenames) {
    const fpath = path.join(WORKSPACE_DIR, fname);
    if (fs.existsSync(fpath)) map[fname] = fpath;
  }
  try {
    if (fs.existsSync(skillsDir)) {
      for (const e of fs.readdirSync(skillsDir).sort()) {
        const ep = path.join(skillsDir, e);
        const stat = fs.statSync(ep);
        if (stat.isDirectory()) {
          const sm = path.join(ep, 'SKILL.md');
          if (fs.existsSync(sm)) map['skills/' + e + '/SKILL.md'] = sm;
        } else if (e.endsWith('.md')) {
          map['skills/' + e] = ep;
        }
      }
    }
  } catch {}
  for (const cf of configFiles) {
    if (fs.existsSync(cf.path)) map[cf.name] = cf.path;
  }
  return map;
}

function getMemoryFiles(ctx) {
  const { memoryMdPath, heartbeatPath, memoryDir } = ctx;
  const files = [];
  try {
    if (fs.existsSync(memoryMdPath)) {
      const stat = fs.statSync(memoryMdPath);
      files.push({ name: 'MEMORY.md', modified: stat.mtimeMs, size: stat.size });
    }
  } catch {}
  try {
    if (fs.existsSync(heartbeatPath)) {
      const stat = fs.statSync(heartbeatPath);
      files.push({ name: 'HEARTBEAT.md', modified: stat.mtimeMs, size: stat.size });
    }
  } catch {}
  try {
    if (fs.existsSync(memoryDir)) {
      const entries = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md')).sort().reverse();
      entries.forEach(e => {
        try {
          const stat = fs.statSync(path.join(memoryDir, e));
          files.push({ name: 'memory/' + e, modified: stat.mtimeMs, size: stat.size });
        } catch {}
      });
    }
  } catch {}
  return files;
}

function handle(req, res, ctx) {
  const {
    cronFile,
    WORKSPACE_DIR,
    memoryMdPath,
    heartbeatPath,
    memoryDir,
    workspaceFilenames,
    skillsDir,
    configFiles,
    READ_ONLY_FILES,
    auditLogPath,
    csrfTokens,
    liveClients,
    startLiveWatcher,
    formatLiveEvent,
    sessDir,
    clearCaches
  } = ctx;

  const ip = getClientIP(req);

  // GET /api/health
  if (req.url === '/api/health' && req.method === 'GET') {
    sendJson(req, res, { status: 'ok', uptime: process.uptime() });
    return true;
  }

  // GET /api/csrf-token
  if (req.url === '/api/csrf-token' && req.method === 'GET') {
    const cookies = parseCookies(req);
    const token = crypto.randomBytes(32).toString('hex');
    csrfTokens.set(token, { sessionToken: cookies.session_token || '', createdAt: Date.now() });
    sendJson(req, res, { csrfToken: token });
    return true;
  }

  // GET /api/crons
  if (req.url === '/api/crons' && req.method === 'GET') {
    try {
      if (!fs.existsSync(cronFile)) return sendJson(req, res, []), true;
      const data = JSON.parse(fs.readFileSync(cronFile, 'utf8'));
      const jobs = (data.jobs || []).map(j => {
        let humanSchedule = j.schedule?.expr || '';
        try {
          const parts = humanSchedule.split(' ');
          if (parts.length === 5) {
            const [min, hour, dom, mon, dow] = parts;
            const dowNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            let readable = '';
            if (dow !== '*') readable = dowNames[parseInt(dow)] || dow;
            if (hour !== '*' && min !== '*') readable += (readable ? ' ' : '') + `${hour.padStart(2,'0')}:${min.padStart(2,'0')}`;
            if (j.schedule?.tz) readable += ` (${j.schedule.tz.split('/').pop()})`;
            if (readable) humanSchedule = readable;
          }
        } catch {}
        return {
          id: j.id,
          name: j.name || j.id.substring(0, 8),
          schedule: humanSchedule,
          enabled: j.enabled !== false,
          lastStatus: j.state?.lastStatus || 'unknown',
          lastRunAt: j.state?.lastRunAtMs || 0,
          nextRunAt: j.state?.nextRunAtMs || 0,
          lastDuration: j.state?.lastDurationMs || 0
        };
      });
      sendJson(req, res, jobs);
    } catch { sendJson(req, res, []); }
    return true;
  }

  // POST /api/cron/:id/:action
  if (req.url.startsWith('/api/cron/') && req.method === 'POST') {
    try {
      const parts = req.url.split('/');
      const action = parts[parts.length - 1];
      const id = parts[parts.length - 2].replace(/[^a-zA-Z0-9\-_]/g, '');
      if (!id) { res.writeHead(400); res.end('Invalid id'); return true; }

      if (action === 'toggle') {
        if (!fs.existsSync(cronFile)) throw new Error('No cron file');
        const data = JSON.parse(fs.readFileSync(cronFile, 'utf8'));
        const job = (data.jobs || []).find(j => j.id === id);
        if (!job) throw new Error('Job not found');
        job.enabled = !job.enabled;
        fs.writeFileSync(cronFile, JSON.stringify(data, null, 2));
        auditLog(auditLogPath, 'cron_toggle', ip, { cronId: id, enabled: job.enabled });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, enabled: job.enabled }));
      } else if (action === 'run') {
        exec(`openclaw cron run ${id} --timeout 30000 2>&1`, { timeout: 35000, env: { ...process.env } }, (err, stdout, stderr) => {
          const trimmed = (stdout || '').trim();
          let parsed = null;
          try {
            parsed = trimmed ? JSON.parse(trimmed) : null;
          } catch {}

          if (err && !(parsed && parsed.ok && parsed.reason === 'already-running')) {
            auditLog(auditLogPath, 'cron_run_error', ip, { cronId: id, error: err.message, stdout: trimmed || '', stderr: (stderr || '').trim() });
            console.error(`[cron run] error for ${id}:`, err.message, stderr?.trim(), trimmed);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Cron trigger failed', detail: trimmed || stderr?.trim() || err.message }));
            }
            return;
          }

          const alreadyRunning = !!(parsed && parsed.ok && parsed.reason === 'already-running');
          auditLog(auditLogPath, alreadyRunning ? 'cron_run_already_running' : 'cron_run', ip, { cronId: id, reason: alreadyRunning ? 'already-running' : 'started' });
          console.log(`[cron run] ${alreadyRunning ? 'already running' : 'started'} ${id}:`, trimmed || stderr?.trim());
          if (!res.headersSent) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              ran: parsed?.ran !== false,
              reason: alreadyRunning ? 'already-running' : 'started',
              output: trimmed || null
            }));
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // GET /api/git
  if (req.url === '/api/git' && req.method === 'GET') {
    try {
      const commits = [];
      const repos = [];
      const projDir = path.join(WORKSPACE_DIR, 'projects');
      if (fs.existsSync(projDir)) {
        fs.readdirSync(projDir).forEach(d => {
          const full = path.join(projDir, d);
          if (fs.existsSync(path.join(full, '.git'))) repos.push({ path: full, name: d });
        });
      }
      if (fs.existsSync(path.join(WORKSPACE_DIR, '.git'))) repos.push({ path: WORKSPACE_DIR, name: path.basename(WORKSPACE_DIR) });

      for (const repo of repos) {
        try {
          const log = execSync(`git -C ${repo.path} log --oneline --since='7 days ago' -10 --format='%H|%s|%at'`, { encoding: 'utf8', timeout: 5000 }).trim();
          if (!log) continue;
          log.split('\n').forEach(line => {
            const [hash, msg, ts] = line.split('|');
            commits.push({ repo: repo.name, hash: (hash || '').substring(0, 7), message: msg || '', timestamp: parseInt(ts || '0') * 1000 });
          });
        } catch {}
      }
      commits.sort((a, b) => b.timestamp - a.timestamp);
      sendJson(req, res, commits.slice(0, 15));
    } catch { sendJson(req, res, []); }
    return true;
  }

  // GET /api/memory (alias for memory-files)
  if (req.url === '/api/memory' && req.method === 'GET') {
    sendJson(req, res, getMemoryFiles(ctx));
    return true;
  }

  // GET /api/memory-files
  if (req.url === '/api/memory-files' && req.method === 'GET') {
    sendJson(req, res, getMemoryFiles(ctx));
    return true;
  }

  // GET /api/memory-file?path=...
  if (req.url.startsWith('/api/memory-file?') && req.method === 'GET') {
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const fname = params.get('path') || '';
      let fpath = '';
      if (fname === 'MEMORY.md') fpath = memoryMdPath;
      else if (fname === 'HEARTBEAT.md') fpath = heartbeatPath;
      else if (fname.startsWith('memory/')) fpath = safePath(WORKSPACE_DIR, fname);
      else throw new Error('Invalid path');

      if (fs.existsSync(fpath)) {
        const content = fs.readFileSync(fpath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(content);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad request');
    }
    return true;
  }

  // GET /api/key-files
  if (req.url === '/api/key-files' && req.method === 'GET') {
    const files = [];
    for (const fname of workspaceFilenames) {
      const fpath = path.join(WORKSPACE_DIR, fname);
      try {
        if (fs.existsSync(fpath)) {
          const stat = fs.statSync(fpath);
          files.push({ name: fname, modified: stat.mtimeMs, size: stat.size, editable: true });
        }
      } catch {}
    }
    try {
      if (fs.existsSync(skillsDir)) {
        const entries = fs.readdirSync(skillsDir).sort();
        for (const e of entries) {
          const entryPath = path.join(skillsDir, e);
          try {
            const stat = fs.statSync(entryPath);
            if (stat.isDirectory()) {
              const skillMd = path.join(entryPath, 'SKILL.md');
              if (fs.existsSync(skillMd)) {
                const fstat = fs.statSync(skillMd);
                files.push({ name: 'skills/' + e + '/SKILL.md', modified: fstat.mtimeMs, size: fstat.size, editable: true });
              }
            } else if (e.endsWith('.md')) {
              files.push({ name: 'skills/' + e, modified: stat.mtimeMs, size: stat.size, editable: true });
            }
          } catch {}
        }
      }
    } catch {}
    for (const cf of configFiles) {
      try {
        if (fs.existsSync(cf.path)) {
          const stat = fs.statSync(cf.path);
          files.push({ name: cf.name, modified: stat.mtimeMs, size: stat.size, editable: !READ_ONLY_FILES.has(cf.name) });
        }
      } catch {}
    }
    sendJson(req, res, files);
    return true;
  }

  // GET /api/key-file?path=...
  if (req.url.startsWith('/api/key-file') && req.method === 'GET') {
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const name = params.get('path') || '';
      const allowed = buildKeyFilesAllowed(ctx);
      if (!allowed[name]) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return true;
      }
      const fpath = allowed[name];
      if (!fs.existsSync(fpath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
        return true;
      }
      const content = fs.readFileSync(fpath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(content);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad request');
    }
    return true;
  }

  // POST /api/key-file
  if (req.url === '/api/key-file' && req.method === 'POST') {
    let body = '';
    let overflow = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_FILE_BODY) { overflow = true; req.destroy(); }
    });
    req.on('end', () => {
      if (overflow) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large (max 1MB)' }));
        return;
      }
      try {
        const { path: name, content } = JSON.parse(body);
        if (typeof name !== 'string' || typeof content !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request body' }));
          return;
        }
        if (READ_ONLY_FILES.has(name)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File is read-only' }));
          return;
        }
        const allowed = buildKeyFilesAllowed(ctx);
        if (!allowed[name]) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden' }));
          return;
        }
        const fpath = allowed[name];
        auditLog(auditLogPath, 'file_edit', ip, { file: name });
        try {
          if (fs.existsSync(fpath)) {
            fs.copyFileSync(fpath, fpath + '.bak');
          }
        } catch {}
        const tmp = fpath + '.tmp.' + Date.now();
        fs.writeFileSync(tmp, content, 'utf8');
        fs.renameSync(tmp, fpath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/action/*
  if (req.url.startsWith('/api/action/') && req.method === 'POST') {
    const action = req.url.substring('/api/action/'.length);

    if (action === 'restart-openclaw') {
      try {
        auditLog(auditLogPath, 'action_restart_openclaw', ip);
        exec('systemctl restart openclaw', (err) => {
          if (err) {
            exec('systemctl --user restart openclaw', (err2) => {
              if (err2) {
                exec('systemctl --user restart openclaw-gateway', (err3) => {});
              }
            });
          }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return true;
    }

    if (action === 'restart-dashboard') {
      try {
        auditLog(auditLogPath, 'action_restart_dashboard', ip);
        setTimeout(() => {
          exec('systemctl restart agent-dashboard', (err) => {});
        }, 2000);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Restarting in 2 seconds...' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return true;
    }

    if (action === 'clear-cache') {
      try {
        if (typeof clearCaches === 'function') clearCaches();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return true;
    }

    if (action === 'restart-tailscale') {
      auditLog(auditLogPath, 'action_restart_tailscale', ip);
      // Try sudo -n (non-interactive) first, fall back to regular exec
      exec('sudo -n systemctl restart tailscaled', (err) => {
        if (err && err.message.includes('password')) {
          // Try without sudo as fallback (might work in containers)
          exec('systemctl restart tailscaled', (err2) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (err2) {
              res.end(JSON.stringify({ 
                success: false, 
                error: 'Permission denied. Tailscale restart requires root privileges. Try: sudo systemctl restart tailscaled' 
              }));
            } else {
              res.end(JSON.stringify({ success: true }));
            }
          });
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: !err, error: err?.message }));
        }
      });
      return true;
    }

    if (action === 'update-openclaw') {
      auditLog(auditLogPath, 'action_update_openclaw', ip);
      exec('npm update -g openclaw', { timeout: 120000 }, (err, stdout) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: !err, output: stdout?.trim(), error: err?.message }));
      });
      return true;
    }

    if (action === 'kill-tmux') {
      exec('tmux kill-session -t claude-persistent 2>/dev/null; echo ok', (err, stdout) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
      return true;
    }

    if (action === 'gc') {
      const { execFile } = require('child_process');
      const projDir = path.join(WORKSPACE_DIR, 'projects');
      // Use execFile with cwd to avoid shell injection
      execFile('git', ['gc', '--quiet'], { cwd: WORKSPACE_DIR }, (err) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
      return true;
    }

    if (action === 'check-update') {
      exec('npm outdated -g openclaw 2>/dev/null || echo "up to date"', { timeout: 30000 }, (err, stdout) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, output: (stdout || '').trim() || 'All packages up to date' }));
      });
      return true;
    }

    if (action === 'sys-update') {
      auditLog(auditLogPath, 'action_sys_update', ip);
      exec('apt update -qq && apt upgrade -y -qq 2>&1 | tail -5', { timeout: 300000 }, (err, stdout) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: !err, output: (stdout || '').trim(), error: err?.message }));
      });
      return true;
    }

    if (action === 'disk-cleanup') {
      exec('apt autoremove -y -qq 2>/dev/null; apt clean 2>/dev/null; journalctl --vacuum-time=7d 2>/dev/null; echo "Cleanup done"', { timeout: 60000 }, (err, stdout) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, output: (stdout || '').trim() }));
      });
      return true;
    }

    if (action === 'restart-claude') {
      // Escape WORKSPACE_DIR to prevent shell injection
      const escapedDir = WORKSPACE_DIR.replace(/["'\\]/g, '\\$&');
      exec(`tmux kill-session -t claude-persistent 2>/dev/null; sleep 1; tmux new-session -d -s claude-persistent -x 200 -y 60 && tmux send-keys -t claude-persistent "cd \"${escapedDir}\" && claude" Enter && echo "Claude session started"`, { timeout: 20000 }, (err, stdout) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: !err, output: (stdout || '').trim() }));
      });
      return true;
    }

    return false;
  }

  // --- Export Sessions ---
  if (req.url.startsWith('/api/export/sessions')) {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const format = params.get('format') || 'json';

    try {
      const sessFile = path.join(sessDir, 'sessions.json');
      if (!fs.existsSync(sessFile)) { sendJson(req, res, { error: 'No sessions data' }, 404); return true; }
      const data = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
      const entries = Object.entries(data).map(([key, s]) => ({
        key,
        label: s.label || key.split(':').pop(),
        model: s.modelOverride || s.model || '-',
        totalTokens: s.totalTokens || 0,
        contextTokens: s.contextTokens || 0,
        kind: s.kind || 'direct',
        updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : '',
        createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : '',
        sessionId: s.sessionId || '-',
        channel: s.channel || '-'
      }));

      if (format === 'csv') {
        const headers = ['key', 'label', 'model', 'totalTokens', 'contextTokens', 'kind', 'updatedAt', 'createdAt', 'sessionId', 'channel'];
        const csvRows = [headers.join(',')];
        for (const entry of entries) {
          csvRows.push(headers.map(h => {
            const val = String(entry[h] || '');
            return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
          }).join(','));
        }
        const csvBody = csvRows.join('\n');
        res.setHeader('Content-Disposition', 'attachment; filename="sessions-export.csv"');
        sendCompressed(req, res, 200, 'text/csv', csvBody);
      } else {
        const jsonBody = JSON.stringify(entries, null, 2);
        res.setHeader('Content-Disposition', 'attachment; filename="sessions-export.json"');
        sendCompressed(req, res, 200, 'application/json', jsonBody);
      }
      auditLog(auditLogPath, 'export_sessions', ip, { format });
    } catch (e) { sendJson(req, res, { error: 'Export failed: ' + e.message }, 500); }
    return true;
  }

  // --- Backup ---
  if (req.url === '/api/backup' && req.method === 'POST') {
    try {
      const backupData = {
        timestamp: new Date().toISOString(),
        version: '1.0',
        workspace: {}
      };
      for (const fname of workspaceFilenames) {
        const fpath = path.join(WORKSPACE_DIR, fname);
        try { if (fs.existsSync(fpath)) backupData.workspace[fname] = fs.readFileSync(fpath, 'utf8'); } catch {}
      }
      backupData.memory = {};
      try {
        if (fs.existsSync(memoryDir)) {
          for (const e of fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'))) {
            try { backupData.memory[e] = fs.readFileSync(path.join(memoryDir, e), 'utf8'); } catch {}
          }
        }
      } catch {}
      try { if (fs.existsSync(cronFile)) backupData.crons = JSON.parse(fs.readFileSync(cronFile, 'utf8')); } catch {}
      const sessFile = path.join(sessDir, 'sessions.json');
      try { if (fs.existsSync(sessFile)) backupData.sessions = JSON.parse(fs.readFileSync(sessFile, 'utf8')); } catch {}

      const body = JSON.stringify(backupData, null, 2);
      res.setHeader('Content-Disposition', `attachment; filename="openclaw-backup-${new Date().toISOString().split('T')[0]}.json"`);
      sendCompressed(req, res, 200, 'application/json', body);
      auditLog(auditLogPath, 'backup_created', ip);
    } catch (e) { sendJson(req, res, { error: 'Backup failed: ' + e.message }, 500); }
    return true;
  }

  // GET /api/live (SSE)
  if ((req.url === '/api/live' || req.url.startsWith('/api/live?')) && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    liveClients.push(res);
    startLiveWatcher();

    res.write('data: {"status":"connected"}\n\n');

    try {
      const cutoff = Date.now() - 3600000;
      const files = fs.readdirSync(sessDir).filter(f => {
        if (!f.endsWith('.jsonl')) return false;
        try { return fs.statSync(path.join(sessDir, f)).mtimeMs > cutoff; } catch { return false; }
      });
      const recentEvents = [];
      files.forEach(file => {
        const sessionKey = file.replace('.jsonl', '');
        const content = fs.readFileSync(path.join(sessDir, file), 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        lines.slice(-5).forEach(line => {
          try {
            const data = JSON.parse(line);
            data._sessionKey = sessionKey;
            const event = formatLiveEvent(data);
            if (event) recentEvents.push(event);
          } catch {}
        });
      });
      recentEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      recentEvents.slice(0, 20).forEach(event => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
    } catch {}

    req.on('close', () => {
      const idx = liveClients.indexOf(res);
      if (idx !== -1) liveClients.splice(idx, 1);
    });

    return true;
  }

  return false;
}

// Backward compatibility alias
const setupApiRoutes = handle;

module.exports = {
  handle,
  setupApiRoutes
};
