const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { loadModelPricing } = require('./pricing');

const MODEL_PRICING = loadModelPricing();

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeProvider(provider) {
  return String(provider || 'unknown').trim().toLowerCase();
}

function safePath(base, requested) {
  const resolved = path.resolve(base, requested);
  if (!resolved.startsWith(path.resolve(base))) {
    throw new Error('Path traversal attempt');
  }
  return resolved;
}

function normalizeModel(provider, model) {
  const p = normalizeProvider(provider);
  let m = String(model || 'unknown').trim();
  const pref = p + '/';
  if (m.toLowerCase().startsWith(pref)) m = m.slice(pref.length);
  const ml = m.toLowerCase();
  if (p === 'anthropic') {
    if (ml.startsWith('claude-opus-4-6')) return 'claude-opus-4-6';
    if (ml.startsWith('claude-opus-4-5')) return 'claude-opus-4-5';
    if (ml.startsWith('claude-sonnet-4-6') || ml.includes('sonnet-20241022')) return 'claude-sonnet-4-6';
    if (ml.startsWith('claude-sonnet-4-5') || ml.includes('sonnet-20240620')) return 'claude-sonnet-4-5';
    if (ml.startsWith('claude-3-5-haiku')) return 'claude-3-5-haiku-latest';
  }
  if (p === 'openai') {
    if (ml.startsWith('gpt-4o-mini')) return 'gpt-4o-mini';
    if (ml.startsWith('gpt-4.1-mini')) return 'gpt-4.1-mini';
  }
  if (p === 'google' && ml.startsWith('gemini-3-flash-preview')) return 'gemini-3-flash-preview';
  if (p === 'xai' && ml.startsWith('grok-4-1-fast')) return 'grok-4-1-fast';
  if (p === 'nvidia' && ml.includes('kimi-k2.5')) return 'moonshotai/kimi-k2.5';
  if (p === 'zai' && ml.startsWith('glm-5')) return 'glm-5';
  if (p === 'zai' && ml.startsWith('glm-4.7')) return 'glm-4.7';
  if (p === 'kimi-coding' && ml.includes('k2p5')) return 'k2p5';
  if (p === 'minimax' && ml.includes('MiniMax-M2.5')) return 'MiniMax-M2.5';
  if (p === 'minimax' && ml.includes('MiniMax-M2.1')) return 'MiniMax-M2.1';
  return m;
}

function estimateMsgCost(msg) {
  const usage = msg && msg.usage ? msg.usage : {};
  const explicit = toNum(usage.cost && usage.cost.total);
  if (explicit > 0) return explicit;
  const provider = normalizeProvider(msg && msg.provider);
  const modelNorm = normalizeModel(provider, msg && msg.model);
  const rates = MODEL_PRICING[`${provider}/${modelNorm}`];
  if (!rates) return 0;
  const input = Math.max(0, toNum(usage.input)) / 1_000_000;
  const output = Math.max(0, toNum(usage.output)) / 1_000_000;
  const cacheRead = Math.max(0, toNum(usage.cacheRead)) / 1_000_000;
  const cacheWrite = Math.max(0, toNum(usage.cacheWrite)) / 1_000_000;
  return (
    input * toNum(rates.input) +
    output * toNum(rates.output) +
    cacheRead * toNum(rates.cacheRead) +
    cacheWrite * toNum(rates.cacheWrite)
  );
}

function auditLog(filePath, event, ip, details = {}) {
  try {
    const timestamp = new Date().toISOString();
    const entry = JSON.stringify({ timestamp, event, ip, ...details }) + '\n';
    fs.appendFileSync(filePath, entry, 'utf8');
    const stats = fs.statSync(filePath);
    if (stats.size > 10 * 1024 * 1024) {
      const lines = fs.readFileSync(filePath, 'utf8').split('\n');
      const keep = lines.slice(-5000).join('\n');
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, keep, 'utf8');
      fs.renameSync(tmpPath, filePath);
    }
  } catch {}
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:");
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function sendCompressed(req, res, statusCode, contentType, body) {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (acceptEncoding.includes('gzip') && Buffer.byteLength(body) > 1024) {
    zlib.gzip(Buffer.from(body), (err, compressed) => {
      if (err) {
        res.writeHead(statusCode, { 'Content-Type': contentType });
        res.end(body);
        return;
      }
      res.writeHead(statusCode, {
        'Content-Type': contentType,
        'Content-Encoding': 'gzip',
        'Vary': 'Accept-Encoding'
      });
      res.end(compressed);
    });
  } else {
    res.writeHead(statusCode, { 'Content-Type': contentType });
    res.end(body);
  }
}

function sendJson(req, res, data, statusCode = 200) {
  sendCompressed(req, res, statusCode, 'application/json', JSON.stringify(data));
}

function getClientIP(req) {
  // Support X-Forwarded-For when behind a trusted proxy
  const trustProxy = process.env.TRUST_PROXY === 'true';
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      // X-Forwarded-For can contain multiple IPs, use the first one
      const ips = forwarded.split(',').map(ip => ip.trim());
      if (ips.length > 0 && ips[0]) return ips[0];
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

function setSameSiteCORS(req, res) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  const proto = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const expectedOrigin = `${proto}://${host}`;
  if (origin === expectedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else if (!origin && !req.headers.referer) {
    res.setHeader('Access-Control-Allow-Origin', expectedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

function isLocalhost(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function isTailscaleIP(ip) {
  const clean = ip.replace('::ffff:', '');
  return clean.startsWith('100.') && parseInt(clean.split('.')[1]) >= 64 && parseInt(clean.split('.')[1]) <= 127;
}

function httpsEnforcement(req, res) {
  if (process.env.DASHBOARD_ALLOW_HTTP === 'true') return true;
  const ip = getClientIP(req);
  if (isLocalhost(ip)) return true;
  if (isTailscaleIP(ip)) return true;
  if (req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https') return true;
  setSecurityHeaders(res);
  res.writeHead(403, { 'Content-Type': 'text/plain' });
  res.end('HTTPS required. Access via localhost, Tailscale, or enable HTTPS.');
  return false;
}

module.exports = {
  toNum,
  normalizeProvider,
  normalizeModel,
  safePath,
  estimateMsgCost,
  auditLog,
  setSecurityHeaders,
  setSameSiteCORS,
  sendCompressed,
  sendJson,
  getClientIP,
  isLocalhost,
  isTailscaleIP,
  httpsEnforcement
};
