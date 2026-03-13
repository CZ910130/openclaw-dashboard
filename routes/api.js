const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const { execSync, exec } = require('child_process');
const { sendJson, sendCompressed, auditLog, getClientIP } = require('../lib/utils');

function setupApiRoutes(req, res, options) {
  const { 
    sessDir, cronFile, WORKSPACE_DIR, memoryMdPath, heartbeatPath, memoryDir, 
    workspaceFilenames, skillsDir, configFiles, READ_ONLY_FILES, auditLogPath 
  } = options;
  const ip = getClientIP(req);

  if (req.url === '/api/health') {
    sendJson(req, res, { status: 'ok', uptime: process.uptime() });
    return true;
  }

  if (req.url === '/api/crons') {
    try {
      if (!fs.existsSync(cronFile)) return sendJson(req, res, []);
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

  if (req.url === '/api/git') {
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

  if (req.url === '/api/memory-files') {
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
    sendJson(req, res, files);
    return true;
  }

  if (req.url === '/api/key-files') {
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

      // Backup workspace config files
      for (const fname of workspaceFilenames) {
        const fpath = path.join(WORKSPACE_DIR, fname);
        try {
          if (fs.existsSync(fpath)) backupData.workspace[fname] = fs.readFileSync(fpath, 'utf8');
        } catch {}
      }

      // Backup memory files
      backupData.memory = {};
      try {
        if (fs.existsSync(memoryDir)) {
          const entries = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'));
          for (const e of entries) {
            try { backupData.memory[e] = fs.readFileSync(path.join(memoryDir, e), 'utf8'); } catch {}
          }
        }
      } catch {}

      // Backup cron config
      try {
        if (fs.existsSync(cronFile)) backupData.crons = JSON.parse(fs.readFileSync(cronFile, 'utf8'));
      } catch {}

      // Backup sessions metadata
      const sessFile = path.join(sessDir, 'sessions.json');
      try {
        if (fs.existsSync(sessFile)) backupData.sessions = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
      } catch {}

      const body = JSON.stringify(backupData, null, 2);
      res.setHeader('Content-Disposition', `attachment; filename="openclaw-backup-${new Date().toISOString().split('T')[0]}.json"`);
      sendCompressed(req, res, 200, 'application/json', body);
      auditLog(auditLogPath, 'backup_created', ip);
    } catch (e) { sendJson(req, res, { error: 'Backup failed: ' + e.message }, 500); }
    return true;
  }

  if (req.url.startsWith('/api/action/')) {
    const action = req.url.substring(12);
    if (req.method !== 'POST') return false;

    if (action === 'restart-openclaw') {
      exec('systemctl restart openclaw', (err) => {
        if (err) exec('systemctl --user restart openclaw', () => {});
      });
      auditLog(auditLogPath, 'action_restart_openclaw', ip);
      sendJson(req, res, { success: true });
      return true;
    }
    if (action === 'restart-dashboard') {
      setTimeout(() => exec('systemctl restart agent-dashboard', () => {}), 2000);
      auditLog(auditLogPath, 'action_restart_dashboard', ip);
      sendJson(req, res, { success: true, message: 'Restarting...' });
      return true;
    }
  }

  return false;
}

module.exports = {
  setupApiRoutes
};
