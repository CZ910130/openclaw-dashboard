const crypto = require('crypto');
const {
  hashPassword, verifyPassword, getCredentials, saveCredentials,
  createSession, validatePassword, safeCompare,
  base32Encode, verifyTOTP,
  auditLog, checkRateLimit, recordFailedAuth, clearFailedAuth,
  isAuthenticated
} = require('../utils/auth');
const { setSecurityHeaders, setSameSiteCORS, getClientIP } = require('../utils/http');

function handle(req, res, ctx) {
  const ip = getClientIP(req);

  if (req.url === '/api/auth/status') {
    const creds = getCredentials(ctx.credentialsFile);
    const registered = !!creds;
    const loggedIn = isAuthenticated(ctx.sessions, req);
    setSameSiteCORS(req, res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ registered, loggedIn }));
    return true;
  }

  if (req.url === '/api/auth/register' && req.method === 'POST') {
    const creds = getCredentials(ctx.credentialsFile);
    if (creds) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Already registered' }));
      return true;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 2048) req.destroy(); });
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        if (!username || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Username and password required' }));
          return;
        }
        const pwdError = validatePassword(password);
        if (pwdError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: pwdError }));
          return;
        }
        const { hash, salt } = hashPassword(password);
        const newCreds = { username, passwordHash: hash, salt, iterations: 100000 };
        saveCredentials(ctx.credentialsFile, newCreds);
        const sessionToken = createSession(ctx.sessions, username, ip, false);
        clearFailedAuth(ctx.rateLimitStore, ip);
        auditLog(ctx.auditLogPath, 'register', ip, { username });
        setSameSiteCORS(req, res);
        const cookieOptions = [`session_token=${sessionToken}`, 'HttpOnly', 'Path=/', 'SameSite=Lax'];
        if (req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https') cookieOptions.push('Secure');
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': cookieOptions.join('; ')
        });
        res.end(JSON.stringify({ success: true, sessionToken }));
      } catch (e) {
        console.error('Registration error:', e);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
    return true;
  }

  if (req.url === '/api/auth/login' && req.method === 'POST') {
    const limitCheck = checkRateLimit(ctx.rateLimitStore, ip);
    if (limitCheck.softLocked) {
      auditLog(ctx.auditLogPath, 'login_locked', ip, { remainingSeconds: limitCheck.remainingSeconds, hardLocked: limitCheck.blocked });
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many failed login attempts', lockoutRemaining: limitCheck.remainingSeconds }));
      return true;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 2048) req.destroy(); });
    req.on('end', () => {
      try {
        const { username, password, totpCode, rememberMe } = JSON.parse(body);
        const creds = getCredentials(ctx.credentialsFile);
        if (!creds) {
          recordFailedAuth(ctx.rateLimitStore, ip);
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No account registered' }));
          return;
        }
        if (username !== creds.username) {
          recordFailedAuth(ctx.rateLimitStore, ip);
          auditLog(ctx.auditLogPath, 'login_failed', ip, { username });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid username or password' }));
          return;
        }
        if (!verifyPassword(password, creds.passwordHash, creds.salt)) {
          recordFailedAuth(ctx.rateLimitStore, ip);
          auditLog(ctx.auditLogPath, 'login_failed', ip, { username });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid username or password' }));
          return;
        }
        if (ctx.MFA_SECRET || creds.mfaSecret) {
          const secret = creds.mfaSecret || ctx.MFA_SECRET;
          if (!totpCode) {
            setSameSiteCORS(req, res);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ requiresMfa: true }));
            return;
          }
          if (!verifyTOTP(secret, totpCode)) {
            recordFailedAuth(ctx.rateLimitStore, ip);
            auditLog(ctx.auditLogPath, 'login_mfa_failed', ip, { username });
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid TOTP code' }));
            return;
          }
        }
        const sessionToken = createSession(ctx.sessions, username, ip, rememberMe);
        clearFailedAuth(ctx.rateLimitStore, ip);
        auditLog(ctx.auditLogPath, 'login_success', ip, { username });
        setSameSiteCORS(req, res);
        const cookieOptions = [`session_token=${sessionToken}`, 'HttpOnly', 'Path=/', 'SameSite=Lax'];
        if (req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https') cookieOptions.push('Secure');
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': cookieOptions.join('; ')
        });
        res.end(JSON.stringify({ success: true, sessionToken }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
    return true;
  }

  if (req.url === '/api/auth/logout' && req.method === 'POST') {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      ctx.sessions.delete(token);
    }
    auditLog(ctx.auditLogPath, 'logout', ip);
    setSameSiteCORS(req, res);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'session_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax'
    });
    res.end(JSON.stringify({ success: true }));
    return true;
  }

  if (req.url === '/api/auth/reset-password' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 2048) req.destroy(); });
    req.on('end', () => {
      try {
        const { recoveryToken, newPassword } = JSON.parse(body);
        if (!safeCompare(recoveryToken, ctx.DASHBOARD_TOKEN)) {
          recordFailedAuth(ctx.rateLimitStore, ip);
          auditLog(ctx.auditLogPath, 'password_reset_failed', ip);
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid recovery token' }));
          return;
        }
        const pwdError = validatePassword(newPassword);
        if (pwdError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: pwdError }));
          return;
        }
        const creds = getCredentials(ctx.credentialsFile);
        if (!creds) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No account registered' }));
          return;
        }
        const { hash, salt } = hashPassword(newPassword);
        creds.passwordHash = hash;
        creds.salt = salt;
        saveCredentials(ctx.credentialsFile, creds);
        ctx.sessions.clear();
        clearFailedAuth(ctx.rateLimitStore, ip);
        auditLog(ctx.auditLogPath, 'password_reset_success', ip);
        setSameSiteCORS(req, res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
    return true;
  }

  if (req.url === '/api/auth/change-password' && req.method === 'POST') {
    if (!ctx.requireAuth(req, res)) return true;
    setSameSiteCORS(req, res);
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 2048) req.destroy(); });
    req.on('end', () => {
      try {
        const { currentPassword, newPassword } = JSON.parse(body);
        const creds = getCredentials(ctx.credentialsFile);
        if (!creds) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No account registered' }));
          return;
        }
        if (!verifyPassword(currentPassword, creds.passwordHash, creds.salt)) {
          recordFailedAuth(ctx.rateLimitStore, ip);
          auditLog(ctx.auditLogPath, 'password_change_failed', ip);
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Current password is incorrect' }));
          return;
        }
        const pwdError = validatePassword(newPassword);
        if (pwdError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: pwdError }));
          return;
        }
        const { hash, salt } = hashPassword(newPassword);
        creds.passwordHash = hash;
        creds.salt = salt;
        saveCredentials(ctx.credentialsFile, creds);
        const authHeader = req.headers.authorization;
        const currentToken = authHeader ? authHeader.substring(7) : null;
        for (const [token] of ctx.sessions.entries()) {
          if (token !== currentToken) ctx.sessions.delete(token);
        }
        clearFailedAuth(ctx.rateLimitStore, ip);
        auditLog(ctx.auditLogPath, 'password_change_success', ip);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
    return true;
  }

  if (req.url === '/api/auth/mfa-status') {
    if (!ctx.requireAuth(req, res)) return true;
    setSameSiteCORS(req, res);
    const creds = getCredentials(ctx.credentialsFile);
    const enabled = !!(creds?.mfaSecret || ctx.MFA_SECRET);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ enabled }));
    return true;
  }

  if (req.url === '/api/auth/setup-mfa' && req.method === 'POST') {
    if (!ctx.requireAuth(req, res)) return true;
    setSameSiteCORS(req, res);
    try {
      const secret = base32Encode(crypto.randomBytes(20));
      const otpauth_uri = `otpauth://totp/OpenClaw:Dashboard?secret=${secret}&issuer=OpenClaw&algorithm=SHA1&digits=6&period=30`;
      ctx.pendingMfaSecrets.set(ip, { secret, createdAt: Date.now() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ secret, otpauth_uri }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  if (req.url === '/api/auth/confirm-mfa' && req.method === 'POST') {
    if (!ctx.requireAuth(req, res)) return true;
    setSameSiteCORS(req, res);
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const { totpCode } = JSON.parse(body);
        const pending = ctx.pendingMfaSecrets.get(ip);
        if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
          ctx.pendingMfaSecrets.delete(ip);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'MFA setup expired. Please try again.' }));
          return;
        }
        if (!totpCode || !verifyTOTP(pending.secret, totpCode)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid TOTP code. Please try again.' }));
          return;
        }
        const creds = getCredentials(ctx.credentialsFile);
        if (creds) {
          creds.mfaSecret = pending.secret;
          saveCredentials(ctx.credentialsFile, creds);
        }
        ctx.pendingMfaSecrets.delete(ip);
        auditLog(ctx.auditLogPath, 'mfa_setup', ip);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  if (req.url === '/api/auth/disable-mfa' && req.method === 'POST') {
    if (!ctx.requireAuth(req, res)) return true;
    setSameSiteCORS(req, res);
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const { totpCode } = JSON.parse(body);
        const creds = getCredentials(ctx.credentialsFile);
        const mfaSecret = creds?.mfaSecret || ctx.MFA_SECRET;
        if (!mfaSecret) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'MFA is not enabled' }));
          return;
        }
        if (!totpCode || !verifyTOTP(mfaSecret, totpCode)) {
          auditLog(ctx.auditLogPath, 'mfa_disable_failed', ip);
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid TOTP code' }));
          return;
        }
        if (creds) {
          delete creds.mfaSecret;
          saveCredentials(ctx.credentialsFile, creds);
        }
        auditLog(ctx.auditLogPath, 'mfa_disabled', ip);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
    return true;
  }

  if (req.url === '/api/reauth' && req.method === 'POST') {
    if (!ctx.requireAuth(req, res)) return true;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { password, totp } = JSON.parse(body);
        const creds = getCredentials(ctx.credentialsFile);
        if (!creds) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No credentials configured' })); return; }
        if (!verifyPassword(password, creds.passwordHash, creds.salt)) {
          recordFailedAuth(ctx.rateLimitStore, ip);
          auditLog(ctx.auditLogPath, 'reauth_failed', ip, {});
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid password' }));
          return;
        }
        const mfaSecret = creds.mfaSecret || ctx.MFA_SECRET;
        if (mfaSecret) {
          if (!totp) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'TOTP required', needsTotp: true })); return; }
          if (!verifyTOTP(mfaSecret, totp)) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid TOTP code' })); return; }
        }
        auditLog(ctx.auditLogPath, 'reauth_success', ip, {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    });
    return true;
  }

  return false;
}

module.exports = { handle };
