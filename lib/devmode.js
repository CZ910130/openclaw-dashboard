const fs = require('fs');
const path = require('path');
const { sendCompressed } = require('./utils');

const IS_DEV = process.env.NODE_ENV === 'development' || process.env.DASHBOARD_DEV === 'true';

// --- Hot Reload via SSE ---
let hotReloadClients = [];

function setupHotReload(rootDir) {
  if (!IS_DEV) return;
  const watchFiles = ['index.html', 'styles.css', 'app.js'];
  for (const file of watchFiles) {
    try {
      fs.watch(path.join(rootDir, file), () => {
        const msg = `data: ${JSON.stringify({ type: 'reload', file })}\n\n`;
        hotReloadClients.forEach(res => { try { res.write(msg); } catch {} });
      });
    } catch {}
  }
  console.log('  🔄 Hot-reload enabled (dev mode)');
}

function handleHotReloadSSE(req, res) {
  if (!IS_DEV) return false;
  if (req.url !== '/api/dev/hot-reload') return false;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('data: {"type":"connected"}\n\n');
  hotReloadClients.push(res);
  req.on('close', () => { hotReloadClients = hotReloadClients.filter(c => c !== res); });
  return true;
}

// --- Enhanced Error Handling ---
function devErrorHandler(req, res, err) {
  if (IS_DEV) {
    const body = JSON.stringify({
      error: err.message,
      stack: err.stack,
      code: err.code,
      path: req.url,
      method: req.method,
      timestamp: new Date().toISOString()
    }, null, 2);
    sendCompressed(req, res, 500, 'application/json', body);
  } else {
    sendCompressed(req, res, 500, 'application/json', JSON.stringify({ error: 'Internal server error' }));
  }
}

// --- API Documentation ---
const API_DOCS = {
  title: 'OpenClaw Dashboard API',
  version: '1.0',
  description: 'REST API for the OpenClaw Agent Dashboard',
  endpoints: [
    // Auth
    { method: 'GET',  path: '/api/auth/status',     description: 'Check registration & login status', auth: false },
    { method: 'POST', path: '/api/auth/login',       description: 'Login with username/password and optional TOTP', auth: false },
    { method: 'POST', path: '/api/auth/register',    description: 'Create a new account', auth: false },
    { method: 'POST', path: '/api/auth/logout',      description: 'Logout and clear session', auth: true },
    { method: 'POST', path: '/api/auth/change-password', description: 'Change password (authenticated)', auth: true },
    { method: 'POST', path: '/api/auth/reset-password',  description: 'Reset password with recovery token', auth: false },
    { method: 'GET',  path: '/api/auth/mfa-status',  description: 'Check if MFA is enabled', auth: true },
    { method: 'POST', path: '/api/auth/setup-mfa',   description: 'Begin MFA setup', auth: true },
    { method: 'POST', path: '/api/auth/confirm-mfa', description: 'Confirm MFA with TOTP code', auth: true },
    { method: 'POST', path: '/api/auth/disable-mfa', description: 'Disable MFA (requires TOTP)', auth: true },
    { method: 'POST', path: '/api/reauth',           description: 'Re-authenticate within session', auth: true },
    // System
    { method: 'GET',  path: '/api/health',           description: 'Server health check and uptime', auth: true },
    { method: 'GET',  path: '/api/system',           description: 'CPU, memory, disk, and crash stats', auth: true },
    { method: 'GET',  path: '/api/docker',           description: 'Docker containers, images, and system info', auth: true },
    { method: 'POST', path: '/api/docker/action',    description: 'Start/stop/restart containers or prune', auth: true },
    { method: 'GET',  path: '/api/sys-security',     description: 'UFW, ports, fail2ban, SSH logs', auth: true },
    // Sessions & Usage
    { method: 'GET',  path: '/api/sessions',         description: 'List all agent sessions with metadata', auth: true },
    { method: 'GET',  path: '/api/session-messages',  description: 'Get messages for a session (?id=)', auth: true, params: [{ name: 'id', type: 'string', description: 'Session ID' }] },
    { method: 'GET',  path: '/api/usage',            description: '5-hour and weekly usage windows per model', auth: true },
    { method: 'GET',  path: '/api/costs',            description: 'Cost breakdown by model, day, and session', auth: true },
    { method: 'GET',  path: '/api/tokens-today',     description: 'Token usage for today by model', auth: true },
    { method: 'GET',  path: '/api/response-time',    description: 'Average response time today', auth: true },
    { method: 'GET',  path: '/api/lifetime-stats',   description: 'Lifetime token, cost, and session stats', auth: true },
    // Data
    { method: 'GET',  path: '/api/crons',            description: 'Scheduled cron jobs with status', auth: true },
    { method: 'GET',  path: '/api/git',              description: 'Recent git commits (7 days)', auth: true },
    { method: 'GET',  path: '/api/memory-files',     description: 'MEMORY.md, HEARTBEAT.md, and memory dir', auth: true },
    { method: 'GET',  path: '/api/key-files',        description: 'Workspace files (AGENTS.md, etc.)', auth: true },
    // Monitoring
    { method: 'GET',  path: '/api/stats',            description: 'API endpoint usage stats and slow queries', auth: true },
    { method: 'GET',  path: '/api/live',             description: 'SSE live feed of session messages', auth: true },
    // Export & Backup
    { method: 'GET',  path: '/api/export/sessions',  description: 'Export sessions as JSON or CSV (?format=json|csv)', auth: true, params: [{ name: 'format', type: 'string', description: 'json or csv (default: json)' }] },
    { method: 'POST', path: '/api/backup',           description: 'Create full workspace backup as JSON', auth: true },
    // Actions
    { method: 'POST', path: '/api/action/restart-openclaw',   description: 'Restart OpenClaw service', auth: true },
    { method: 'POST', path: '/api/action/restart-dashboard',  description: 'Restart dashboard (2s delay)', auth: true },
  ]
};

function handleApiDocs(req, res) {
  if (req.url !== '/api/docs') return false;
  sendCompressed(req, res, 200, 'application/json', JSON.stringify(API_DOCS, null, 2));
  return true;
}

module.exports = {
  IS_DEV,
  setupHotReload,
  handleHotReloadSSE,
  devErrorHandler,
  handleApiDocs
};
