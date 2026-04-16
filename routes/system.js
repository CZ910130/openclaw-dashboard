const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, exec } = require('child_process');
const { sendJson, auditLog, getClientIP, safePath } = require('../lib/utils');
const { getSystemStats } = require('../lib/stats');

const SYSTEM_STATS_TTL_MS = 5000;
const SERVICES_TTL_MS = 5000;
const TAILSCALE_TTL_MS = 10000;
const NOTIFICATIONS_TTL_MS = 3000;

let diskHistoryCache = { loaded: false, history: [] };
let servicesStatusCache = { time: 0, data: null };
let tailscaleCache = { time: 0, data: null };
const notificationsCache = new Map();

function trackDiskHistory(diskPercent) {
  const histFile = path.join(__dirname, '..', 'disk-history.json');
  if (!diskHistoryCache.loaded) {
    try { diskHistoryCache.history = JSON.parse(fs.readFileSync(histFile, 'utf8')); } catch { diskHistoryCache.history = []; }
    diskHistoryCache.loaded = true;
  }
  let history = diskHistoryCache.history;
  const now = Date.now();
  if (history.length > 0 && now - history[history.length - 1].t < 1800000) return history;
  history = [...history, { t: now, v: diskPercent }];
  if (history.length > 48) history = history.slice(-48);
  diskHistoryCache.history = history;
  try { fs.writeFileSync(histFile, JSON.stringify(history)); } catch {}
  return history;
}

function getServicesStatus() {
  const now = Date.now();
  if (servicesStatusCache.data && now - servicesStatusCache.time < SERVICES_TTL_MS) {
    return servicesStatusCache.data;
  }

  const services = ['openclaw', 'agent-dashboard', 'tailscaled'];

  const safePattern = (s) => /^[\w.\-\\/\[\]:space()^$|+]+$/.test(s);
  const hasProcess = (pattern) => {
    if (!safePattern(pattern)) return false;
    try {
      execSync(`pgrep -fa -- '${pattern}'`, { stdio: 'ignore', timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  };
  const safeName = (s) => /^[\w.-]+$/.test(s);
  const isSystemdServiceActive = (name) => {
    if (!safeName(name)) return false;
    for (const cmd of [
      `systemctl is-active --quiet ${name}`,
      `systemctl --user is-active --quiet ${name}`
    ]) {
      try {
        execSync(cmd, { stdio: 'ignore', timeout: 3000 });
        return true;
      } catch {}
    }
    return false;
  };

  if (os.platform() === 'linux') {
    const serviceDetectors = {
      openclaw: {
        systemd: ['openclaw', 'openclaw-gateway', 'openclaw-webhooks'],
        processes: [
          '(^|[[:space:]])openclaw([[:space:]]|$)',
          'openclaw-gateway',
          'openclaw-webhooks'
        ]
      },
      'agent-dashboard': {
        systemd: ['agent-dashboard'],
        processes: ['agent-dashboard.*server\\.js', 'node.*server\\.js'],
        portCheck: { host: 'localhost', port: 7000 }
      },
      tailscaled: {
        systemd: ['tailscaled'],
        processes: ['(^|[[:space:]])tailscaled([[:space:]]|$)']
      }
    };

    const result = services.map(name => {
      const detector = serviceDetectors[name];
      if (!detector) return { name, active: false };

      const activeBySystemd = detector.systemd.some(isSystemdServiceActive);
      if (activeBySystemd) return { name, active: true };

      const activeByProcess = detector.processes.some(hasProcess);
      if (activeByProcess) return { name, active: true };

      if (detector.portCheck) {
        try {
          const { host, port } = detector.portCheck;
          execSync(`timeout 2 bash -c 'echo > /dev/tcp/${host}/${port}' 2>/dev/null`, { stdio: 'ignore', timeout: 3000 });
          return { name, active: true };
        } catch {}
      }

      return { name, active: false };
    });
    servicesStatusCache = { time: now, data: result };
    return result;
  }

  if (os.platform() === 'darwin') {
    const gatewayUrl = process.env.GATEWAY_DASHBOARD_URL || 'http://localhost:18789';
    let agentDashboardActive = false;
    try {
      const code = execSync(`curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 --max-time 3 "${gatewayUrl}" 2>/dev/null`, { encoding: 'utf8', timeout: 5000 }).trim();
      agentDashboardActive = code.length >= 1 && (code[0] === '2' || code[0] === '3');
    } catch { }

    let tailscaledActive = false;
    const tailscalePaths = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'tailscale'];
    for (const t of tailscalePaths) {
      try {
        execSync(`${t} status 2>/dev/null`, { encoding: 'utf8', timeout: 3000 });
        tailscaledActive = true;
        break;
      } catch { }
    }

    let listOut = '';
    try {
      listOut = execSync('launchctl list 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
    } catch { listOut = ''; }
    const runningLabels = new Set();
    for (const line of listOut.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const cols = trimmed.split(/\s+/);
      const pid = cols[0];
      const label = cols.length >= 3 ? cols[cols.length - 1] : '';
      if (pid !== '-' && pid !== '0' && label) runningLabels.add(label.toLowerCase());
    }
    const openclawActive = Array.from(runningLabels).some(label =>
      label === 'openclaw' || label.includes('openclaw')
    );

    const result = services.map(name => {
      if (name === 'agent-dashboard') return { name, active: agentDashboardActive };
      if (name === 'tailscaled') return { name, active: tailscaledActive };
      return { name, active: openclawActive };
    });
    servicesStatusCache = { time: now, data: result };
    return result;
  }

  const fallback = services.map(name => ({ name, active: null }));
  servicesStatusCache = { time: now, data: fallback };
  return fallback;
}

function handle(req, res, ctx) {
  const { auditLogPath, WORKSPACE_DIR, healthHistory } = ctx;
  const ip = getClientIP(req);

  if (req.url === '/api/system') {
    const now = Date.now();
    if (!ctx.systemRouteCache.system || now - ctx.systemRouteCache.system.time > SYSTEM_STATS_TTL_MS) {
      const stats = getSystemStats();
      if (stats.disk) stats.diskHistory = trackDiskHistory(stats.disk.percent || 0);
      ctx.systemRouteCache.system = { time: now, data: stats };
    }
    sendJson(req, res, ctx.systemRouteCache.system.data);
    return true;
  }

  if (req.url === '/api/health-history') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(healthHistory));
    return true;
  }

  if (req.url === '/api/services') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getServicesStatus()));
    return true;
  }

  if (req.url === '/api/tailscale') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const now = Date.now();
    if (tailscaleCache.data && now - tailscaleCache.time < TAILSCALE_TTL_MS) {
      res.end(JSON.stringify(tailscaleCache.data));
      return true;
    }
    try {
      const statusJson = execSync('tailscale status --json 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
      const status = JSON.parse(statusJson);
      const self = status.Self || {};
      const peers = Object.values(status.Peer || {}).filter(p => p.Online).length;
      let routes = [];
      try {
        const serveStatus = execSync('tailscale serve status 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
        if (serveStatus && !serveStatus.includes('No serve config')) {
          routes = serveStatus.split('\n').filter(l => l.includes('http')).map(l => l.trim());
        }
      } catch {}
      tailscaleCache = {
        time: now,
        data: {
          hostname: self.HostName || 'unknown',
          ip: self.TailscaleIPs?.[0] || 'unknown',
          online: self.Online || false,
          peers,
          routes
        }
      };
      res.end(JSON.stringify(tailscaleCache.data));
    } catch (e) {
      tailscaleCache = { time: now, data: { error: 'Tailscale not available', hostname: '--', ip: '--', online: false, peers: 0, routes: [] } };
      res.end(JSON.stringify(tailscaleCache.data));
    }
    return true;
  }

  if (req.url === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: 'OpenClaw Dashboard', version: '1.0.0' }));
    return true;
  }

  if (req.url === '/api/openclaw-config' && req.method === 'GET') {
    const configPath = process.env.OPENCLAW_CONFIG || path.join(process.env.HOME || '/root', '.openclaw', 'openclaw.json');
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      JSON.parse(content);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ config: content, path: configPath }));
    } catch(e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    auditLog(auditLogPath, 'config_read', ip, {});
    return true;
  }

  if (req.url === '/api/openclaw-config' && req.method === 'PUT') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1048576) req.destroy(); });
    req.on('end', () => {
      try {
        const { config } = JSON.parse(body);
        JSON.parse(config);
        const configPath = process.env.OPENCLAW_CONFIG || path.join(process.env.HOME || '/root', '.openclaw', 'openclaw.json');
        const backupPath = configPath + '.bak.' + Date.now();
        fs.copyFileSync(configPath, backupPath);
        fs.writeFileSync(configPath, config, 'utf8');
        auditLog(auditLogPath, 'config_saved', ip, { backup: backupPath });
        try { execSync('openclaw gateway restart', { timeout: 15000 }); } catch(e) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, backup: backupPath }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON: ' + e.message }));
      }
    });
    return true;
  }

  if (req.url.startsWith('/api/notifications')) {
    const limit = parseInt(new URL(req.url, 'http://localhost').searchParams.get('limit') || '50');
    try {
      const cappedLimit = Math.min(limit, 200);
      const stat = fs.statSync(auditLogPath);
      const cacheKey = `${auditLogPath}:${stat.size}:${stat.mtimeMs}:${cappedLimit}`;
      const now = Date.now();
      const cached = notificationsCache.get(cacheKey);
      if (cached && now - cached.time < NOTIFICATIONS_TTL_MS) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ events: cached.events }));
        return true;
      }
      const raw = fs.readFileSync(auditLogPath, 'utf8').trim();
      const lines = raw.split('\n').filter(Boolean).slice(-cappedLimit);
      const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
      notificationsCache.clear();
      notificationsCache.set(cacheKey, { time: now, events });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ events }));
    } catch(e) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ events: [] })); }
    return true;
  }

  if (req.url.startsWith('/api/logs')) {
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const allowedServices = ['openclaw', 'agent-dashboard', 'tailscaled', 'sshd', 'nginx'];
      const service = params.get('service') || 'openclaw';
      if (!allowedServices.includes(service)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid service name');
        return true;
      }
      if (process.platform !== 'linux') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Logs (journalctl) are only available on Linux.\nOn macOS use Console.app or: log show --predicate \'processImagePath contains "openclaw"\' --last 1h');
        return true;
      }
      const lines = Math.min(Math.max(parseInt(params.get('lines')) || 100, 1), 1000);
      const serviceUnitCandidates = {
        openclaw: ['openclaw', 'openclaw-gateway', 'openclaw-webhooks'],
        'agent-dashboard': ['agent-dashboard'],
        tailscaled: ['tailscaled'],
        sshd: ['sshd'],
        nginx: ['nginx']
      };
      const units = serviceUnitCandidates[service] || [service];
      const scopes = ['system', 'user'];
      const sourceLogs = [];

      // Collect logs from all scopes and units
      for (const scope of scopes) {
        for (const unit of units) {
          try {
            const scopeFlag = scope === 'user' ? '--user ' : '';
            const out = execSync(`journalctl ${scopeFlag}-u ${unit} --no-pager -n ${lines} -o short 2>/dev/null`, { encoding: 'utf8', timeout: 10000 });
            if (out && out.trim() && !out.includes('-- No entries --')) {
              const linesArray = out.split('\n').filter(l => l.trim());
              // Get last timestamp for sorting (newest source first)
              const lastTimestamp = linesArray[linesArray.length - 1]?.substring(0, 15) || '';
              sourceLogs.push({
                scope,
                unit,
                logs: out,
                lastTimestamp,
                lineCount: linesArray.length
              });
            }
          } catch {}
        }
      }

      let logs = '';
      if (sourceLogs.length === 0) {
        logs = `No logs available for "${service}". Tried units: ${units.join(', ')} in system + user journal.`;
      } else if (sourceLogs.length === 1) {
        // Single source
        logs = `[source ${sourceLogs[0].scope}:${sourceLogs[0].unit}]\n${sourceLogs[0].logs}`;
      } else {
        // Multiple sources - sort by recency (oldest first, newest last)
        sourceLogs.sort((a, b) => a.lastTimestamp.localeCompare(b.lastTimestamp));

        // Show each source as separate block
        logs = `${sourceLogs.length} log sources found (chronological by latest entry):\n`;
        for (const entry of sourceLogs) {
          logs += `\n═══════════════════════════════════════════════════════════\n`;
          logs += `[source ${entry.scope}:${entry.unit}] (${entry.lineCount} lines, latest: ${entry.lastTimestamp})\n`;
          logs += `═══════════════════════════════════════════════════════════\n`;
          logs += entry.logs;
          if (!entry.logs.endsWith('\n')) logs += '\n';
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(logs);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error fetching logs');
    }
    return true;
  }

  if (req.url === '/api/sys-security') {
    const run = (cmd) => { try { return execSync(cmd, { timeout: 10000 }).toString().replace(/</g, '&lt;').replace(/>/g, '&gt;'); } catch(e) { return e.stdout ? e.stdout.toString().replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Error: ' + e.message; } };
    const data = {
      ufw: run('ufw status verbose 2>&1'),
      ports: run('ss -ltnp 2>&1'),
      fail2ban: run('fail2ban-client status 2>&1 && echo "---" && fail2ban-client status sshd 2>&1'),
      ssh: run('journalctl -u ssh --no-pager -n 50 --grep="Failed\\|Invalid\\|Accepted" 2>&1 || journalctl -u sshd --no-pager -n 50 --grep="Failed\\|Invalid\\|Accepted" 2>&1'),
      audit: run('openclaw security audit 2>&1'),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    auditLog(auditLogPath, 'sys_security_view', ip, {});
    return true;
  }

  return false;
}

module.exports = { handle };
