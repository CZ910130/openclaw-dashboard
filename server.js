const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { exec, execFile } = require('child_process');
const crypto = require('crypto');

const context = require('./lib/context');
const utils = require('./lib/utils');
const auth = require('./lib/auth');
const stats = require('./lib/stats');
const { setupUsageRoutes } = require('./routes/usage');
const { setupSystemRoutes } = require('./routes/system');
const { setupApiRoutes } = require('./routes/api');

const {
  PORT, WORKSPACE_DIR, dataDir, sessDir, cronFile, auditLogPath, credentialsFile, mfaSecretFile
} = context;

const {
  sendJson, sendCompressed, auditLog, setSecurityHeaders, getClientIP
} = utils;

// --- Initialize directories ---
try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
try { fs.mkdirSync(path.dirname(auditLogPath), { recursive: true }); } catch {}
try { fs.mkdirSync(path.dirname(credentialsFile), { recursive: true }); } catch {}

// --- Recovery Token ---
let DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN;
if (!DASHBOARD_TOKEN) {
  DASHBOARD_TOKEN = crypto.randomBytes(16).toString('hex');
}
console.log('\n═══════════════════════════════════════════════════════════');
console.log('  🔐 Recovery Token: ' + DASHBOARD_TOKEN);
console.log('═══════════════════════════════════════════════════════════\n');

// --- MFA Secret ---
let MFA_SECRET = process.env.DASHBOARD_MFA_SECRET;
if (!MFA_SECRET && fs.existsSync(mfaSecretFile)) {
  try { MFA_SECRET = fs.readFileSync(mfaSecretFile, 'utf8').trim(); } catch {}
}

// --- Sessions ---
const sessions = new Map();
const rateLimitStore = new Map();
const pendingMfaSecrets = new Map();
const csrfTokens = new Map();

function createSession(username, ip, rememberMe = false) {
  const token = auth.generateSessionToken();
  const now = Date.now();
  const expiresAt = now + (rememberMe ? auth.SESSION_REMEMBER_LIFETIME : auth.SESSION_ACTIVITY_TIMEOUT);
  sessions.set(token, { username, ip, createdAt: now, lastActivity: now, expiresAt, rememberMe });
  saveSessions(); // Persist new session
  return token;
}

function getCredentials() {
  try {
    if (!fs.existsSync(credentialsFile)) return null;
    return JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
  } catch { return null; }
}

function saveCredentials(creds) {
  const tmp = credentialsFile + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(creds, null, 2), 'utf8');
  fs.renameSync(tmp, credentialsFile);
}

// --- Security Middleware ---
function isAuthenticated(req) {
  const cookies = auth.parseCookies(req);
  let token = cookies.session_token;
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.substring(7);
    else try { token = new URL(req.url, 'http://localhost').searchParams.get('token'); } catch { token = null; }
  }
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  const now = Date.now();
  if (now > session.expiresAt) { sessions.delete(token); return false; }
  if (!session.rememberMe) {
    if (now - session.lastActivity > auth.SESSION_ACTIVITY_TIMEOUT) { sessions.delete(token); return false; }
    session.lastActivity = now;
  }
  return true;
}

function requireAuth(req, res) {
  if (!isAuthenticated(req)) {
    setSecurityHeaders(res);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
  }
  return true;
}

// --- Health History ---
let healthHistory = [];
try { if (fs.existsSync(context.healthHistoryFile)) healthHistory = JSON.parse(fs.readFileSync(context.healthHistoryFile, 'utf8')); } catch {}

function saveHealthSnapshot() {
  try {
    const s = stats.getSystemStats();
    healthHistory.push({ t: Date.now(), cpu: s.cpu?.usage || 0, ram: s.memory?.percent || 0, temp: s.cpu?.temp || 0, disk: s.disk?.percent || 0 });
    if (healthHistory.length > 288) healthHistory = healthHistory.slice(-288);
    fs.writeFileSync(context.healthHistoryFile, JSON.stringify(healthHistory));
  } catch {}
}
setInterval(saveHealthSnapshot, 5 * 60 * 1000);
saveHealthSnapshot();

// --- Live Feed (SSE) ---
let liveClients = [];
let liveWatcher = null;
const _fileWatchers = {};
const _fileSizes = {};

function broadcastLiveEvent(data) {
  if (liveClients.length === 0) return;
  const timestamp = data.timestamp || new Date().toISOString();
  const sessionKey = data._sessionKey || 'unknown';
  if (data.type === 'message') {
    let content = '';
    const msg = data.message;
    if (Array.isArray(msg.content)) {
      const t = msg.content.find(b => b.type === 'text');
      if (t) content = t.text;
    } else if (typeof msg.content === 'string') content = msg.content;
    if (content) {
      const event = { timestamp, session: sessionKey.substring(0, 8), role: msg.role, content: content.substring(0, 150).replace(/\n/g, ' ') };
      const message = `data: ${JSON.stringify(event)}\n\n`;
      liveClients.forEach(res => { try { res.write(message); } catch {} });
    }
  }
}

function watchSessionFile(file) {
  const filePath = path.join(sessDir, file);
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
          try { const data = JSON.parse(line); data._sessionKey = file.replace('.jsonl', ''); broadcastLiveEvent(data); } catch {}
        });
      } catch {}
    });
  } catch {}
}

// --- HTTPS Redirect ---
function httpsRedirect(req, res) {
  if (process.env.DASHBOARD_ALLOW_HTTP === 'true') return true;
  const ip = getClientIP(req);
  // Allow localhost and Tailscale without HTTPS
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  const cleanIp = ip.replace('::ffff:', '');
  if (cleanIp.startsWith('100.') && parseInt(cleanIp.split('.')[1]) >= 64 && parseInt(cleanIp.split('.')[1]) <= 127) return true;
  // Check if already HTTPS
  if (req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https') return true;
  // Redirect to HTTPS
  const host = req.headers.host || 'localhost';
  const httpsUrl = `https://${host}${req.url}`;
  res.writeHead(307, { 'Location': httpsUrl, 'Content-Type': 'text/plain' });
  res.end('Redirecting to HTTPS...');
  return false;
}

// --- Persistent Sessions ---
const sessionsFile = path.join(dataDir, 'sessions.json');

function loadSessions() {
  try {
    if (!fs.existsSync(sessionsFile)) return;
    const data = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    const now = Date.now();
    for (const [token, sess] of Object.entries(data)) {
      if (now < sess.expiresAt) {
        sessions.set(token, sess);
      }
    }
    console.log(`  📁 Loaded ${sessions.size} persistent sessions`);
  } catch (e) {
    console.error('  ⚠️ Failed to load sessions:', e.message);
  }
}

function saveSessions() {
  try {
    const data = Object.fromEntries(sessions);
    const tmp = sessionsFile + '.tmp.' + Date.now();
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, sessionsFile);
  } catch {}
}

// Load sessions on startup
loadSessions();
// Save sessions periodically (every 30 seconds)
setInterval(saveSessions, 30000);

// --- Main Server ---
const server = http.createServer((req, res) => {
  // HTTPS redirect first
  if (!httpsRedirect(req, res)) return;
  
  const ip = getClientIP(req);
  setSecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.writeHead(204); res.end(); return;
  }

  // Auth Routes
  if (req.url === '/api/auth/status') {
    sendJson(req, res, { registered: !!getCredentials(), loggedIn: isAuthenticated(req) });
    return;
  }

  if (req.url === '/api/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { username, password, totpCode, rememberMe } = JSON.parse(body);
        const creds = getCredentials();
        if (!creds || username !== creds.username || !auth.verifyPassword(password, creds.passwordHash, creds.salt)) {
          auditLog(auditLogPath, 'login_failed', ip, { username });
          sendJson(req, res, { error: 'Invalid credentials' }, 401); return;
        }
        const secret = creds.mfaSecret || MFA_SECRET;
        if (secret && !totpCode) { sendJson(req, res, { requiresMfa: true }); return; }
        if (secret && !auth.verifyTOTP(secret, totpCode)) { sendJson(req, res, { error: 'Invalid TOTP' }, 401); return; }
        
        const token = createSession(username, ip, rememberMe);
        const cookie = [`session_token=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Lax'];
        res.setHeader('Set-Cookie', cookie.join('; '));
        sendJson(req, res, { success: true, sessionToken: token });
        auditLog(auditLogPath, 'login_success', ip, { username });
      } catch { sendJson(req, res, { error: 'Bad request' }, 400); }
    });
    return;
  }

  // Static files
  if (req.url === '/' || req.url === '/index.html') {
    try { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(path.join(__dirname, 'index.html'))); } catch { res.writeHead(500); res.end('Error'); }
    return;
  }
  if (req.url === '/styles.css') {
    try { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end(fs.readFileSync(path.join(__dirname, 'styles.css'))); } catch { res.writeHead(404); res.end('Not found'); }
    return;
  }
  if (req.url === '/app.js') {
    try { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(path.join(__dirname, 'app.js'))); } catch { res.writeHead(404); res.end('Not found'); }
    return;
  }

  // Protected API Routes
  if (req.url.startsWith('/api/')) {
    if (!requireAuth(req, res)) return;

    if (setupUsageRoutes(req, res, WORKSPACE_DIR, dataDir)) return;
    if (setupSystemRoutes(req, res, { auditLogPath, ip })) return;
    if (setupApiRoutes(req, res, context)) return;

    if (req.url === '/api/live') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      liveClients.push(res);
      if (!liveWatcher) {
        fs.readdirSync(sessDir).filter(f => f.endsWith('.jsonl')).forEach(watchSessionFile);
        liveWatcher = fs.watch(sessDir, (et, fn) => { if (fn && fn.endsWith('.jsonl') && !_fileWatchers[fn]) watchSessionFile(fn); });
      }
      res.write('data: {"status":"connected"}\n\n');
      req.on('close', () => { liveClients = liveClients.filter(c => c !== res); });
      return;
    }

    if (req.url === '/api/sessions') {
      stats.getLastMessage(sessDir, 'main').then(() => { // dummy call to warm up
        fsp.readFile(path.join(sessDir, 'sessions.json'), 'utf8').then(raw => {
          const data = JSON.parse(raw);
          const entries = Object.entries(data);
          Promise.all(entries.map(async ([key, s]) => ({
            key, label: s.label || key.split(':').pop(), model: s.model || '-', updatedAt: s.updatedAt || 0, sessionId: s.sessionId || '-'
          }))).then(results => sendJson(req, res, results));
        }).catch(() => sendJson(req, res, []));
      });
      return;
    }

    // Default API 404
    sendJson(req, res, { error: 'Not found' }, 404);
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => { console.log('Dashboard: http://0.0.0.0:' + PORT); });
