const crypto = require('crypto');
const fs = require('fs');

const SESSION_ACTIVITY_TIMEOUT = 30 * 60 * 1000;
const SESSION_REMEMBER_LIFETIME = 3 * 60 * 60 * 1000;

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const result = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(result), Buffer.from(hash));
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of input.toUpperCase().replace(/=+$/, '')) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.substring(i, i + 5).padEnd(5, '0');
    result += alphabet[parseInt(chunk, 2)];
  }
  return result;
}

function generateTOTP(secret, timeStep = 30, digits = 6, window = 0) {
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / timeStep) + window;
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter & 0xFFFFFFFF, 4);
  
  const decodedSecret = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', decodedSecret);
  hmac.update(counterBuffer);
  const hash = hmac.digest();
  
  const offset = hash[hash.length - 1] & 0x0f;
  const binary = ((hash[offset] & 0x7f) << 24) | ((hash[offset + 1] & 0xff) << 16) | ((hash[offset + 2] & 0xff) << 8) | (hash[offset + 3] & 0xff);
  const otp = binary % (10 ** digits);
  return otp.toString().padStart(digits, '0');
}

function verifyTOTP(secret, code) {
  for (let w = -1; w <= 1; w++) {
    if (generateTOTP(secret, 30, 6, w) === code) return true;
  }
  return false;
}

function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    if (!value) return;
    list[name] = decodeURIComponent(value);
  });
  return list;
}

function validatePassword(password) {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-zA-Z]/.test(password)) return 'Password must contain at least 1 letter';
  if (!/\d/.test(password)) return 'Password must contain at least 1 number';
  return null;
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getCredentials(credentialsFile) {
  try {
    if (!fs.existsSync(credentialsFile)) return null;
    return JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
  } catch { return null; }
}

function saveCredentials(credentialsFile, creds) {
  const tmp = credentialsFile + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(creds, null, 2), 'utf8');
  fs.renameSync(tmp, credentialsFile);
}

function createSession(sessions, username, ip, rememberMe = false) {
  const token = generateSessionToken();
  const now = Date.now();
  const expiresAt = now + (rememberMe ? SESSION_REMEMBER_LIFETIME : SESSION_ACTIVITY_TIMEOUT);
  sessions.set(token, { username, ip, createdAt: now, lastActivity: now, expiresAt, rememberMe });
  return token;
}

function checkRateLimit(rateLimitStore, ip) {
  const now = Date.now();
  const attempts = rateLimitStore.get(ip) || [];
  const recent = attempts.filter(t => now - t < 15 * 60 * 1000);
  rateLimitStore.set(ip, recent);
  if (recent.length >= 20) {
    const lastAttempt = recent[recent.length - 1];
    const lockoutRemaining = Math.ceil((15 * 60 * 1000 - (now - lastAttempt)) / 1000);
    return { blocked: true, softLocked: true, remainingSeconds: lockoutRemaining };
  }
  if (recent.length >= 5) {
    const lastAttempt = recent[recent.length - 1];
    const lockoutRemaining = Math.ceil((15 * 60 * 1000 - (now - lastAttempt)) / 1000);
    return { blocked: false, softLocked: true, remainingSeconds: lockoutRemaining };
  }
  return { blocked: false, softLocked: false };
}

function recordFailedAuth(rateLimitStore, ip) {
  const now = Date.now();
  const attempts = rateLimitStore.get(ip) || [];
  attempts.push(now);
  rateLimitStore.set(ip, attempts);
}

function clearFailedAuth(rateLimitStore, ip) {
  rateLimitStore.delete(ip);
}

function isAuthenticated(sessions, req) {
  const cookies = parseCookies(req);
  let token = cookies.session_token;
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      try { token = new URL(req.url, 'http://localhost').searchParams.get('token'); } catch { token = null; }
    }
  }
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  const now = Date.now();
  if (now > session.expiresAt) { sessions.delete(token); return false; }
  if (!session.rememberMe) {
    if (now - session.lastActivity > SESSION_ACTIVITY_TIMEOUT) { sessions.delete(token); return false; }
    session.lastActivity = now;
  }
  return true;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  base32Encode,
  verifyTOTP,
  parseCookies,
  validatePassword,
  safeCompare,
  auditLog,
  getCredentials,
  saveCredentials,
  createSession,
  checkRateLimit,
  recordFailedAuth,
  clearFailedAuth,
  isAuthenticated,
  SESSION_ACTIVITY_TIMEOUT,
  SESSION_REMEMBER_LIFETIME
};

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
