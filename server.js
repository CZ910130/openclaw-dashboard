const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const context = require('./lib/context');
const { sendJson, sendCompressed, setSecurityHeaders, setSameSiteCORS, getClientIP, httpsEnforcement } = require('./lib/utils');
const { parseCookies, isAuthenticated, checkRateLimit, SESSION_ACTIVITY_TIMEOUT } = require('./lib/auth');
const { getSystemStats } = require('./lib/stats');
const { loadModelPricing } = require('./lib/pricing');

const authRoutes = require('./routes/auth');
const sessionRoutes = require('./routes/sessions');
const systemRoutes = require('./routes/system');
const apiRoutes = require('./routes/api');
const dockerRoutes = require('./routes/docker');
const { setupUsageRoutes } = require('./routes/usage');

const {
  APP_DIR, PORT, WORKSPACE_DIR, WORKSPACE_SOURCE, dataDir, sessDir, cronFile, auditLogPath,
  credentialsFile, mfaSecretFile, memoryDir, memoryMdPath, heartbeatPath,
  healthHistoryFile, skillsDir, configFiles, workspaceFilenames, READ_ONLY_FILES
} = context;

// --- Initialize directories ---
try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
try { fs.mkdirSync(path.dirname(auditLogPath), { recursive: true }); } catch {}
try { fs.mkdirSync(path.dirname(credentialsFile), { recursive: true }); } catch {}

// --- Recovery Token ---
let DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN;
if (!DASHBOARD_TOKEN) {
  DASHBOARD_TOKEN = crypto.randomBytes(16).toString('hex');
}
// Only print recovery token on first setup (no credentials yet)
const isFirstSetup = !fs.existsSync(credentialsFile);
if (isFirstSetup) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  🔐 Recovery Token: ' + DASHBOARD_TOKEN);
  console.log('═══════════════════════════════════════════════════════════\n');
}

// --- MFA Secret ---
let MFA_SECRET = process.env.DASHBOARD_MFA_SECRET;
if (!MFA_SECRET && fs.existsSync(mfaSecretFile)) {
  try { MFA_SECRET = fs.readFileSync(mfaSecretFile, 'utf8').trim(); } catch {}
}

// --- Shared State ---
const sessions = new Map();
const rateLimitStore = new Map();
const pendingMfaSecrets = new Map();
const csrfTokens = new Map();
const CSRF_TOKEN_LIFETIME = 4 * 60 * 60 * 1000;
const MODEL_PRICING = loadModelPricing();

// --- Caches ---
const usageCache = { data: null, time: 0 };
const costCache = { data: null, time: 0 };

function clearCaches() {
  usageCache.data = null;
  usageCache.time = 0;
  costCache.data = null;
  costCache.time = 0;
}

// --- API Rate Limiting ---
const apiRateLimitStore = new Map();
function checkApiRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 120;
  let entry = apiRateLimitStore.get(ip);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 1 };
    apiRateLimitStore.set(ip, entry);
    return { blocked: false };
  }
  entry.count++;
  if (entry.count > maxRequests) {
    const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
    return { blocked: true, retryAfter };
  }
  return { blocked: false };
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of apiRateLimitStore) {
    if (now - entry.windowStart > 120000) apiRateLimitStore.delete(ip);
  }
}, 300000).unref();

// --- CSRF ---
function validateCsrfToken(req) {
  const token = req.headers['x-csrf-token'];
  if (!token) return false;
  const entry = csrfTokens.get(token);
  if (!entry) return false;
  if (Date.now() - entry.createdAt > CSRF_TOKEN_LIFETIME) {
    csrfTokens.delete(token);
    return false;
  }
  // Bind CSRF token to session - verify it was issued for current session
  const cookies = parseCookies(req);
  if (entry.sessionToken && entry.sessionToken !== cookies.session_token) {
    return false;
  }
  return true;
}
function requireCsrf(req, res) {
  if (!validateCsrfToken(req)) {
    setSecurityHeaders(res);
    res.writeHead(403, { 'Content-Type': 'application/json', 'X-CSRF-Required': '1' });
    res.end(JSON.stringify({ error: 'Invalid or missing CSRF token', code: 'csrf_required', detail: 'Refresh the security token and retry.' }));
    return false;
  }
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of csrfTokens) {
    if (now - entry.createdAt > CSRF_TOKEN_LIFETIME) csrfTokens.delete(token);
  }
}, 30 * 60 * 1000).unref();

// --- Auth Middleware ---
function requireAuth(req, res) {
  const ip = getClientIP(req);
  const limitCheck = checkRateLimit(rateLimitStore, ip);
  if (limitCheck.blocked) {
    setSecurityHeaders(res);
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Too many failed attempts', retryAfter: limitCheck.remainingSeconds }));
    return false;
  }
  if (!isAuthenticated(sessions, req)) {
    setSecurityHeaders(res);
    res.writeHead(401, { 'Content-Type': 'application/json', 'X-Auth-Required': '1' });
    res.end(JSON.stringify({ error: 'Unauthorized', code: 'auth_required', detail: 'Your dashboard session is missing or expired. Please log in again.' }));
    return false;
  }
  return true;
}

// --- Health History ---
let healthHistory = [];
try { if (fs.existsSync(healthHistoryFile)) healthHistory = JSON.parse(fs.readFileSync(healthHistoryFile, 'utf8')); } catch {}

function saveHealthSnapshot() {
  try {
    const s = getSystemStats();
    healthHistory.push({ t: Date.now(), cpu: s.cpu?.usage || 0, ram: s.memory?.percent || 0, temp: s.cpu?.temp || 0, disk: s.disk?.percent || 0 });
    if (healthHistory.length > 288) healthHistory = healthHistory.slice(-288);
    const dir = path.dirname(healthHistoryFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(healthHistoryFile, JSON.stringify(healthHistory));
  } catch {}
}
setInterval(saveHealthSnapshot, 5 * 60 * 1000);
saveHealthSnapshot();

// --- Session Cleanup ---
setInterval(() => {
  const now = Date.now();
  for (const [token, sess] of sessions.entries()) {
    if (now > sess.expiresAt) {
      sessions.delete(token);
    } else if (!sess.rememberMe && now - sess.lastActivity > SESSION_ACTIVITY_TIMEOUT) {
      sessions.delete(token);
    }
  }
}, 60 * 1000);

// --- Live Feed (SSE) ---
let liveClients = [];
let liveWatcher = null;
const _fileWatchers = {};
const _fileSizes = {};

const { isSessionFile, formatLiveEvent } = sessionRoutes;

function broadcastLiveEvent(data) {
  if (liveClients.length === 0) return;
  const event = formatLiveEvent(data);
  if (!event) return;
  const message = `data: ${JSON.stringify(event)}\n\n`;
  liveClients.forEach(res => { try { res.write(message); } catch {} });
}

function watchSessionFile(file) {
  const filePath = path.join(sessDir, file);
  const sessionKey = file.replace('.jsonl', '');
  if (_fileWatchers[file]) return;
  try { _fileSizes[file] = fs.statSync(filePath).size; } catch { _fileSizes[file] = 0; }
  try {
    _fileWatchers[file] = fs.watch(filePath, (eventType) => {
      if (eventType !== 'change') return;
      try {
        const stats = fs.statSync(filePath);
        if (stats.size <= (_fileSizes[file] || 0)) return;
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.allocUnsafe(stats.size - (_fileSizes[file] || 0));
        fs.readSync(fd, buf, 0, buf.length, _fileSizes[file] || 0);
        fs.closeSync(fd);
        _fileSizes[file] = stats.size;
        buf.toString('utf8').split('\n').filter(l => l.trim()).forEach(line => {
          try { const data = JSON.parse(line); data._sessionKey = sessionKey; broadcastLiveEvent(data); } catch {}
        });
      } catch {}
    });
  } catch {}
}

function startLiveWatcher() {
  if (liveWatcher) return;
  try {
    fs.readdirSync(sessDir).filter(f => isSessionFile(f)).forEach(watchSessionFile);
    liveWatcher = fs.watch(sessDir, (eventType, filename) => {
      if (filename && isSessionFile(filename) && !_fileWatchers[filename]) {
        try { if (fs.existsSync(path.join(sessDir, filename))) watchSessionFile(filename); } catch {}
      }
    });
  } catch {}
}

// --- Shared Context for Route Modules ---
const ctx = {
  // Paths
  sessDir, cronFile, WORKSPACE_DIR, dataDir, auditLogPath, credentialsFile,
  memoryDir, memoryMdPath, heartbeatPath, skillsDir, configFiles, workspaceFilenames, READ_ONLY_FILES,
  // State
  sessions, rateLimitStore, pendingMfaSecrets, csrfTokens,
  DASHBOARD_TOKEN, MFA_SECRET, MODEL_PRICING,
  // Caches
  usageCache, costCache,
  clearCaches,
  // Health
  healthHistory,
  // Auth helpers
  requireAuth,
  // SSE
  get liveClients() { return liveClients; },
  set liveClients(v) { liveClients = v; },
  startLiveWatcher,
  formatLiveEvent,
  _fileWatchers,
};

// --- Static Files ---
const htmlPath = path.join(__dirname, 'index.html');
const staticFiles = {
  '/styles.css': { file: path.join(__dirname, 'styles.css'), type: 'text/css' },
  '/render-helpers.js': { file: path.join(__dirname, 'render-helpers.js'), type: 'application/javascript' },
  '/app.js': { file: path.join(__dirname, 'app.js'), type: 'application/javascript' },
  '/misc-ui.js': { file: path.join(__dirname, 'misc-ui.js'), type: 'application/javascript' },
  '/system-ui.js': { file: path.join(__dirname, 'system-ui.js'), type: 'application/javascript' }
};

// --- Main Server ---
const server = http.createServer((req, res) => {
  if (!httpsEnforcement(req, res)) return;
  setSecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const ip = getClientIP(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    setSameSiteCORS(req, res);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-CSRF-Token');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.writeHead(204); res.end(); return;
  }

  // Auth routes (before requireAuth — these handle their own auth)
  if (req.url.startsWith('/api/auth/') || req.url === '/api/reauth') {
    if (authRoutes.handle(req, res, ctx)) return;
  }

  // Static files
  if (req.url === '/' || req.url === '/index.html') {
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch { res.writeHead(500); res.end('Error loading dashboard'); }
    return;
  }
  const staticKey = req.url.split('?')[0];
  if (staticFiles[staticKey]) {
    const { file, type } = staticFiles[staticKey];
    try {
      const content = fs.readFileSync(file, 'utf8');
      sendCompressed(req, res, 200, type, content);
    } catch { res.writeHead(404); res.end('Not found'); }
    return;
  }

  // Health endpoint (no auth required)
  if (req.url === '/api/health') {
    sendJson(req, res, { status: 'ok', uptime: process.uptime() });
    return;
  }

  // All other /api/ routes require authentication
  if (req.url.startsWith('/api/')) {
    if (!requireAuth(req, res)) return;
    setSameSiteCORS(req, res);

    // API rate limiting
    const apiLimit = checkApiRateLimit(ip);
    if (apiLimit.blocked) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(apiLimit.retryAfter) });
      res.end(JSON.stringify({ error: 'Too many requests', retryAfter: apiLimit.retryAfter }));
      return;
    }

    // CSRF enforcement on state-changing methods (except auth/reauth)
    if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') &&
        !req.url.startsWith('/api/auth/') && !req.url.startsWith('/api/reauth')) {
      if (!requireCsrf(req, res)) return;
    }

    // Delegate to route modules (chain of responsibility)
    if (sessionRoutes.handle(req, res, ctx)) return;
    if (systemRoutes.handle(req, res, ctx)) return;
    if (dockerRoutes.handle(req, res, ctx)) return;
    if (setupUsageRoutes(req, res, WORKSPACE_DIR, dataDir)) return;
    if (apiRoutes.handle(req, res, ctx)) return;

    // Default API 404
    sendJson(req, res, { error: 'Not found' }, 404);
  } else {
    // Non-API fallback: serve index.html (SPA)
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch { res.writeHead(500); res.end('Error loading dashboard'); }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Dashboard: http://0.0.0.0:' + PORT);
  console.log('[dashboard] appDir=' + APP_DIR);
  console.log('[dashboard] workspaceDir=' + WORKSPACE_DIR + ' (source=' + WORKSPACE_SOURCE + ')');
  console.log('[dashboard] authDataDir=' + path.dirname(credentialsFile));
});
