function getApiBasePath() {
  var pathname = window.location.pathname;
  if (!pathname || pathname === '/') return '';
  var cleaned = pathname.replace(/\/+$/, '');
  if (cleaned.endsWith('/index.html')) {
    return cleaned.slice(0, -'/index.html'.length);
  }
  return cleaned;
}

// Mobile sidebar toggle function
function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.classList.toggle('mobile-open');
  }
}

// Close mobile sidebar when clicking outside
document.addEventListener('click', function(e) {
  const sidebar = document.querySelector('.sidebar');
  const menuBtn = document.querySelector('.mobile-menu-btn');
  if (sidebar && sidebar.classList.contains('mobile-open')) {
    if (!sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
      sidebar.classList.remove('mobile-open');
    }
  }
});

const API_BASE = getApiBasePath();

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function setEmptyState(el, text, icon) {
  if (!el) return;
  if (icon) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${icon}</div><div class="empty-state-text">${escapeHtml(text)}</div></div>`;
  } else {
    el.innerHTML = `<div class="empty-state-text">${escapeHtml(text)}</div>`;
  }
}

// Page Visibility API: pause polling when tab is hidden, resume when visible
const _visibleIntervals = [];
function visibleInterval(fn, ms) {
  const entry = { fn, ms, id: setInterval(fn, ms) };
  _visibleIntervals.push(entry);
  return entry;
}
function clearVisibleInterval(entry) {
  if (!entry) return;
  clearInterval(entry.id);
  const idx = _visibleIntervals.indexOf(entry);
  if (idx !== -1) _visibleIntervals.splice(idx, 1);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    _visibleIntervals.forEach(e => { clearInterval(e.id); e.id = null; });
  } else {
    _visibleIntervals.forEach(e => {
      if (!e.id) { e.fn(); e.id = setInterval(e.fn, e.ms); }
    });
  }
});

let sysSecAuthed = false;
const TOKEN_KEY = 'dashboardToken';
const TOKEN_EXPIRY_KEY = 'dashboardTokenExpiry';

/*
Legacy token-storage auth path kept commented for recovery/debugging.
The dashboard now authenticates with cookie-backed sessions instead.

const TOKEN_LIFETIME = 24 * 60 * 60 * 1000;
const REMEMBER_ME_LIFETIME = 3 * 60 * 60 * 1000;

function getStoredToken() {
  let token = sessionStorage.getItem(TOKEN_KEY);
  let expiry = sessionStorage.getItem(TOKEN_EXPIRY_KEY);

  if (!token || !expiry) {
    token = localStorage.getItem(TOKEN_KEY);
    expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
  }

  if (token && expiry) {
    if (Date.now() < parseInt(expiry)) {
      return token;
    }
    clearStoredToken();
  }
  return null;
}

function setStoredToken(token, rememberMe = false) {
  if (rememberMe) {
    const expiry = Date.now() + REMEMBER_ME_LIFETIME;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_EXPIRY_KEY, expiry.toString());
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(TOKEN_EXPIRY_KEY, (Date.now() + TOKEN_LIFETIME).toString());
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  }
}
*/

function getStoredToken() {
  return null;
}

function setStoredToken(_token, _rememberMe = false) {
  // Cookie session auth only. Kept as a no-op to avoid breaking old call sites.
}

function clearStoredToken() {
  // Cleanup only, in case a browser still has stale legacy token data.
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
}

function showRegistrationForm() {
  document.getElementById('authTitle').textContent = 'Create Account';
  document.getElementById('authSubtitle').textContent = 'Set up your dashboard credentials';
  document.getElementById('registerForm').style.display = 'block';
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('recoveryForm').style.display = 'none';
  setTimeout(() => {
    const el = document.getElementById('regUsername');
    if (el) el.focus();
  }, 100);
}

function showLoginForm() {
  document.getElementById('authTitle').textContent = 'Dashboard Login';
  document.getElementById('authSubtitle').textContent = 'Enter your credentials';
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('recoveryForm').style.display = 'none';
  document.getElementById('usernameInputContainer').style.display = 'block';
  document.getElementById('passwordInputContainer').style.display = 'block';
  document.getElementById('totpInputContainer').style.display = 'none';
  setTimeout(() => {
    const el = document.getElementById('username');
    if (el) el.focus();
  }, 100);
}

function showRecoveryForm() {
  document.getElementById('authTitle').textContent = 'Reset Password';
  document.getElementById('authSubtitle').textContent = 'Enter recovery token and new password';
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('recoveryForm').style.display = 'block';
  setTimeout(() => {
    const el = document.getElementById('recoveryToken');
    if (el) el.focus();
  }, 100);
}

function calculatePasswordStrength(password) {
  let strength = 0;
  if (password.length >= 8) strength += 25;
  if (password.length >= 12) strength += 15;
  if (/[a-z]/.test(password)) strength += 15;
  if (/[A-Z]/.test(password)) strength += 15;
  if (/[0-9]/.test(password)) strength += 15;
  if (/[^a-zA-Z0-9]/.test(password)) strength += 15;
  return Math.min(strength, 100);
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const regPassword = document.getElementById('regPassword');
    const strengthBar = document.getElementById('passwordStrengthBar');
    const strengthText = document.getElementById('passwordStrengthText');
    
    if (regPassword && strengthBar && strengthText) {
      regPassword.addEventListener('input', (e) => {
        const password = e.target.value;
        const strength = calculatePasswordStrength(password);
        strengthBar.style.width = strength + '%';
        
        if (strength < 40) {
          strengthBar.style.background = 'var(--red)';
          strengthText.textContent = 'Weak password';
          strengthText.style.color = 'var(--red)';
        } else if (strength < 70) {
          strengthBar.style.background = 'var(--yellow)';
          strengthText.textContent = 'Medium strength';
          strengthText.style.color = 'var(--yellow)';
        } else {
          strengthBar.style.background = 'var(--green)';
          strengthText.textContent = 'Strong password';
          strengthText.style.color = 'var(--green)';
        }
      });
    }
  });
}

async function handleRegister(event) {
  event.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirmPassword = document.getElementById('regPasswordConfirm').value;
  const registerBtn = document.getElementById('registerBtn');
  const registerError = document.getElementById('registerError');
  
  registerError.style.display = 'none';
  
  if (password !== confirmPassword) {
    registerError.textContent = 'Passwords do not match';
    registerError.style.display = 'block';
    return false;
  }
  
  if (password.length < 8) {
    registerError.textContent = 'Password must be at least 8 characters';
    registerError.style.display = 'block';
    return false;
  }
  
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    registerError.textContent = 'Password must contain at least 1 letter and 1 number';
    registerError.style.display = 'block';
    return false;
  }
  
  registerBtn.disabled = true;
  registerBtn.textContent = 'Creating account...';
  
  try {
    const res = await fetch(API_BASE + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });

    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }

    if (res.ok && data.success) {
      clearStoredToken();
      showApp();
    } else {
      registerError.textContent = data.error || ('Registration failed (' + res.status + ')');
      registerError.style.display = 'block';
      registerBtn.disabled = false;
      registerBtn.textContent = 'Create Account';
    }
  } catch (err) {
    registerError.textContent = 'Network error. Please try again.';
    registerError.style.display = 'block';
    registerBtn.disabled = false;
    registerBtn.textContent = 'Create Account';
  }
  
  return false;
}

async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const totpInput = document.getElementById('totpInput');
  const totpCode = totpInput.value.trim();
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');
  const rememberMe = document.getElementById('rememberMeCheckbox').checked;
  
  loginBtn.disabled = true;
  loginBtn.textContent = 'Logging in...';
  loginError.style.display = 'none';
  
  try {
    const body = { username, password };
    if (totpCode) {
      body.totpCode = totpCode;
    }
    if (rememberMe) {
      body.rememberMe = true;
    }
    
    const res = await fetch(API_BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });

    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }

    if (data.requiresMfa) {
      document.getElementById('authSubtitle').textContent = 'Enter your 6-digit TOTP code';
      document.getElementById('usernameInputContainer').style.display = 'none';
      document.getElementById('passwordInputContainer').style.display = 'none';
      document.getElementById('totpInputContainer').style.display = 'block';
      totpInput.focus();
      loginBtn.disabled = false;
      loginBtn.textContent = 'Verify';
      return false;
    }
    
    if (res.ok && data.success) {
      clearStoredToken();
      showApp();
    } else {
      if (data.lockoutRemaining) {
        loginError.textContent = `Too many failed attempts. Try again in ${data.lockoutRemaining} seconds.`;
      } else {
        loginError.textContent = data.error || 'Invalid credentials';
      }
      loginError.style.display = 'block';
      loginBtn.disabled = false;
      loginBtn.textContent = totpCode ? 'Verify' : 'Login';
      
      if (totpCode) {
        totpInput.value = '';
        totpInput.focus();
      }
    }
  } catch (err) {
    loginError.textContent = 'Network error. Please try again.';
    loginError.style.display = 'block';
    loginBtn.disabled = false;
    loginBtn.textContent = totpCode ? 'Verify' : 'Login';
  }
  
  return false;
}

async function handleRecovery(event) {
  event.preventDefault();
  const recoveryToken = document.getElementById('recoveryToken').value.trim();
  const newPassword = document.getElementById('recoveryNewPassword').value;
  const confirmPassword = document.getElementById('recoveryNewPasswordConfirm').value;
  const recoveryBtn = document.getElementById('recoveryBtn');
  const recoveryError = document.getElementById('recoveryError');
  
  recoveryError.style.display = 'none';
  
  if (newPassword !== confirmPassword) {
    recoveryError.textContent = 'Passwords do not match';
    recoveryError.style.display = 'block';
    return false;
  }
  
  if (newPassword.length < 8) {
    recoveryError.textContent = 'Password must be at least 8 characters';
    recoveryError.style.display = 'block';
    return false;
  }
  
  recoveryBtn.disabled = true;
  recoveryBtn.textContent = 'Resetting password...';
  
  try {
    const res = await fetch(API_BASE + '/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryToken, newPassword })
    });

    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }

    if (res.ok && data.success) {
      showToast('Password reset successfully! Please login.', 'success');
      showLoginForm();
    } else {
      recoveryError.textContent = data.error || ('Password reset failed (' + res.status + ')');
      recoveryError.style.display = 'block';
      recoveryBtn.disabled = false;
      recoveryBtn.textContent = 'Reset Password';
    }
  } catch (err) {
    recoveryError.textContent = 'Network error. Please try again.';
    recoveryError.style.display = 'block';
    recoveryBtn.disabled = false;
    recoveryBtn.textContent = 'Reset Password';
  }
  
  return false;
}

async function handleChangePassword(event) {
  event.preventDefault();
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('newPasswordConfirm').value;
  const changePasswordBtn = document.getElementById('changePasswordBtn');
  const changePasswordError = document.getElementById('changePasswordError');
  
  changePasswordError.style.display = 'none';
  
  if (newPassword !== confirmPassword) {
    changePasswordError.textContent = 'New passwords do not match';
    changePasswordError.style.display = 'block';
    return false;
  }
  
  if (newPassword.length < 8) {
    changePasswordError.textContent = 'New password must be at least 8 characters';
    changePasswordError.style.display = 'block';
    return false;
  }
  
  changePasswordBtn.disabled = true;
  changePasswordBtn.textContent = 'Changing password...';
  
  try {
    const res = await authFetch(API_BASE + '/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    
    const data = await res.json();
    
    if (res.ok && data.success) {
      showToast('Password changed successfully! Other sessions have been invalidated.', 'success');
      document.getElementById('currentPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('newPasswordConfirm').value = '';
    } else {
      changePasswordError.textContent = data.error || 'Password change failed';
      changePasswordError.style.display = 'block';
    }
  } catch (err) {
    changePasswordError.textContent = err.message || 'Network error. Please try again.';
    changePasswordError.style.display = 'block';
  } finally {
    changePasswordBtn.disabled = false;
    changePasswordBtn.textContent = 'Change Password';
  }
  
  return false;
}

async function handleLogout() {
  if (!confirm('Are you sure you want to logout?')) return;
  
  try {
    await authFetch(API_BASE + '/api/auth/logout', { method: 'POST' });
  } catch (e) {
  }
  
  clearStoredToken();
  location.reload();
}

function createSkeletonEl(className, style) {
  var el = document.createElement('div');
  el.className = className;
  if (style) el.style.cssText = style;
  return el;
}

function showSkeletons() {
  // Overview metric skeletons
  ['runningAgents', 'todaySpend', 'ovSessionPct'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el && !el.querySelector('.skeleton')) {
      el.textContent = '';
      el.appendChild(createSkeletonEl('skeleton skeleton-value', 'display:inline-block;'));
    }
  });
  // System gauge skeletons
  document.querySelectorAll('.radial-gauge').forEach(function(g) {
    if (!g.querySelector('.skeleton-overlay')) {
      var overlay = document.createElement('div');
      overlay.className = 'skeleton-overlay';
      overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:2;';
      overlay.appendChild(createSkeletonEl('skeleton skeleton-gauge'));
      g.style.position = 'relative';
      g.appendChild(overlay);
    }
  });
  // Sessions table skeleton rows
  var tbody = document.getElementById('sessionsTableBody');
  if (tbody && !tbody.querySelector('.skeleton')) {
    var container = document.createElement('div');
    container.className = 'skeleton-container';
    for (var i = 0; i < 5; i++) {
      var row = document.createElement('div');
      row.className = 'skeleton-row';
      row.appendChild(createSkeletonEl('skeleton skeleton-avatar'));
      var textBlock = document.createElement('div');
      textBlock.style.cssText = 'flex:1;';
      textBlock.appendChild(createSkeletonEl('skeleton skeleton-text', 'width:' + (60 + Math.round(Math.random() * 30)) + '%;'));
      textBlock.appendChild(createSkeletonEl('skeleton skeleton-text short'));
      row.appendChild(textBlock);
      row.appendChild(createSkeletonEl('skeleton skeleton-bar', 'width:80px;'));
      container.appendChild(row);
    }
    tbody.textContent = '';
    tbody.appendChild(container);
  }
}

function hideSkeletons() {
  ['runningAgents', 'todaySpend', 'ovSessionPct'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el && el.querySelector('.skeleton')) {
      el.textContent = id === 'todaySpend' ? '$0.00' : id === 'ovSessionPct' ? '--%' : '0';
    }
  });
  document.querySelectorAll('.skeleton-overlay').forEach(function(el) { el.remove(); });
}

function showApp() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('mainApp').style.display = 'flex';
  showSkeletons();
  fetchData();
  fetchNewData();
  fetchHealthHistory();
  fetchMemoryFiles();
  fetchKeyFiles();
  checkMFAStatus();
  
  if (localStorage.getItem('usageAutoRefresh') === '1') {
    const cb = document.getElementById('usageAutoRefresh');
    if (cb) { cb.checked = true; toggleUsageAutoRefresh(true, true); }
  }
  visibleInterval(fetchData, 5000);
  visibleInterval(fetchNewData, 15000);
  visibleInterval(fetchHealthHistory, 60000);
  visibleInterval(fetchMemoryFiles, 30000);
  visibleInterval(fetchKeyFiles, 30000);
}

function showLogin() {
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
}

async function checkAuth() {
  try {
    const statusRes = await fetch(API_BASE + '/api/auth/status', { credentials: 'include' });
    const statusData = await statusRes.json();

    if (statusData && statusData.loggedIn) {
      clearStoredToken();
      showApp();
      return;
    }

    const token = getStoredToken();
    if (token && token !== 'undefined' && token !== 'null') {
      const verifyRes = await fetch(API_BASE + '/api/sessions', {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      });
      if (verifyRes.ok) {
        showApp();
        return;
      }
      clearStoredToken();
    } else {
      clearStoredToken();
    }

    if (statusData.registered === false) {
      showRegistrationForm();
      showLogin();
    } else {
      showLoginForm();
      showLogin();
    }
  } catch (err) {
    showLoginForm();
    showLogin();
  }
}

let _csrfToken = null;
let _csrfExpiry = 0;

async function getCsrfToken() {
  const now = Date.now();
  if (_csrfToken && _csrfExpiry > now) {
    return _csrfToken;
  }
  const res = await fetch(API_BASE + '/api/csrf-token', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to get CSRF token');
  const data = await res.json();
  _csrfToken = data.csrfToken || data.token;
  _csrfExpiry = now + (data.expiresIn || 4 * 60 * 60 * 1000);
  return _csrfToken;
}

function authFetch(url, options = {}) {
  const token = getStoredToken();

  options.headers = options.headers || {};
  if (token && token !== 'undefined' && token !== 'null') {
    options.headers['Authorization'] = `Bearer ${token}`;
  }
  options.credentials = 'include';
  if (typeof options.cache === 'undefined') {
    options.cache = 'no-store';
  }

  const method = (options.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && !url.includes('/api/auth/')) {
    return getCsrfToken().then(csrfToken => {
      options.headers['X-CSRF-Token'] = csrfToken;
      return doFetch(url, options, true);
    });
  }

  return doFetch(url, options, false);
}

function doFetch(url, options, allowCsrfRetry = false) {
  return fetch(url, options).then(async res => {
    if (res.status === 401) {
      let bodyText = '';
      try {
        bodyText = await res.clone().text();
      } catch {}
      clearStoredToken();
      _csrfToken = null;
      _csrfExpiry = 0;
      showLogin();
      const message = /session expired/i.test(bodyText) ? 'Session expired, please log in again.' : 'Unauthorized, please log in again.';
      throw new Error(message);
    }

    if (res.status === 403) {
      let bodyText = '';
      try {
        bodyText = await res.clone().text();
      } catch {}
      const looksLikeCsrf = res.headers.get('X-CSRF-Required') || /csrf|Invalid or missing CSRF token/i.test(bodyText);
      if (looksLikeCsrf) {
        _csrfToken = null;
        _csrfExpiry = 0;
        if (allowCsrfRetry) {
          const freshToken = await getCsrfToken();
          const retryOptions = {
            ...options,
            headers: { ...(options.headers || {}), 'X-CSRF-Token': freshToken }
          };
          const retryRes = await fetch(url, retryOptions);
          if (retryRes.status !== 403) return retryRes;
        }
        throw new Error('Security token expired, please retry.');
      }
      throw new Error('Forbidden request. You may need to log in again.');
    }

    return res;
  });
}

const qrcodegen = (function() {
  'use strict';
  
  class QrCode {
    constructor(version, errorCorrectionLevel, dataCodewords, msk) {
      this.version = version;
      this.errorCorrectionLevel = errorCorrectionLevel;
      this.size = version * 4 + 17;
      this.mask = msk;
      
      const qr = [];
      for (let i = 0; i < this.size; i++)
        qr.push(new Array(this.size).fill(false));
      this.modules = qr;
      this.isFunction = qr.map(row => row.slice());
      
      this.drawFunctionPatterns();
      const allCodewords = this.addEccAndInterleave(dataCodewords);
      this.drawCodewords(allCodewords);
      this.applyMask(msk);
      this.drawFormatBits(msk);
      this.isFunction = null;
    }
    
    static encodeText(text, ecl) {
      const segs = QrSegment.makeSegments(text);
      return QrCode.encodeSegments(segs, ecl);
    }
    
    static encodeSegments(segs, ecl, minVersion = 1, maxVersion = 40, mask = -1, boostEcl = true) {
      const version = QrCode.MIN_VERSION;
      for (let v = minVersion; ; v++) {
        const dataCapacityBits = QrCode.getNumDataCodewords(v, ecl) * 8;
        const dataUsedBits = QrSegment.getTotalBits(segs, v);
        if (dataUsedBits <= dataCapacityBits) {
          const bb = [];
          for (const seg of segs) {
            bb.push(...seg.getData());
          }
          while (bb.length < dataCapacityBits)
            bb.push(0);
          const dataCodewords = [];
          for (let i = 0; i < bb.length; i += 8) {
            let byte = 0;
            for (let j = 0; j < 8; j++)
              byte = (byte << 1) | (bb[i + j] || 0);
            dataCodewords.push(byte);
          }
          return new QrCode(v, ecl, dataCodewords, mask === -1 ? 0 : mask);
        }
        if (v >= maxVersion)
          throw new RangeError('Data too long');
      }
    }
    
    getModule(x, y) {
      return this.modules[y][x];
    }
    
    drawFunctionPatterns() {
      for (let i = 0; i < this.size; i++) {
        this.setFunctionModule(6, i, i % 2 === 0);
        this.setFunctionModule(i, 6, i % 2 === 0);
      }
      this.drawFinderPattern(3, 3);
      this.drawFinderPattern(this.size - 4, 3);
      this.drawFinderPattern(3, this.size - 4);
    }
    
    drawFinderPattern(x, y) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          const xx = x + dx;
          const yy = y + dy;
          if (0 <= xx && xx < this.size && 0 <= yy && yy < this.size)
            this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
    
    drawFormatBits(mask) {
      const data = this.errorCorrectionLevel.formatBits << 3 | mask;
      let rem = data;
      for (let i = 0; i < 10; i++)
        rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = (data << 10 | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++)
        this.setFunctionModule(8, i, getBit(bits, i));
      this.setFunctionModule(8, 7, getBit(bits, 6));
      this.setFunctionModule(8, 8, getBit(bits, 7));
      this.setFunctionModule(7, 8, getBit(bits, 8));
      for (let i = 9; i < 15; i++)
        this.setFunctionModule(14 - i, 8, getBit(bits, i));
      for (let i = 0; i < 8; i++)
        this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
      for (let i = 8; i < 15; i++)
        this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
      this.setFunctionModule(8, this.size - 8, true);
    }
    
    drawCodewords(data) {
      let i = 0;
      for (let right = this.size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < this.size; vert++) {
          for (let j = 0; j < 2; j++) {
            const x = right - j;
            const upward = ((right + 1) & 2) === 0;
            const y = upward ? this.size - 1 - vert : vert;
            if (!this.isFunction[y][x] && i < data.length * 8) {
              this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
              i++;
            }
          }
        }
      }
    }
    
    applyMask(mask) {
      for (let y = 0; y < this.size; y++) {
        for (let x = 0; x < this.size; x++) {
          if (!this.isFunction[y][x]) {
            let invert = false;
            if (mask === 0) invert = (x + y) % 2 === 0;
            if (invert) this.modules[y][x] = !this.modules[y][x];
          }
        }
      }
    }
    
    setFunctionModule(x, y, isDark) {
      this.modules[y][x] = isDark;
      this.isFunction[y][x] = true;
    }
    
    addEccAndInterleave(data) {
      const ver = this.version;
      const ecl = this.errorCorrectionLevel;
      const numBlocks = QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
      const blockEccLen = QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
      const rawCodewords = Math.floor(QrCode.getNumRawDataModules(ver) / 8);
      const numShortBlocks = numBlocks - rawCodewords % numBlocks;
      const shortBlockLen = Math.floor(rawCodewords / numBlocks);
      
      const blocks = [];
      const rsDiv = QrCode.reedSolomonComputeDivisor(blockEccLen);
      let k = 0;
      for (let i = 0; i < numBlocks; i++) {
        const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
        k += dat.length;
        const ecc = QrCode.reedSolomonComputeRemainder(dat, rsDiv);
        if (i < numShortBlocks)
          dat.push(0);
        blocks.push(dat.concat(ecc));
      }
      
      const result = [];
      for (let i = 0; i < blocks[0].length; i++) {
        blocks.forEach((block, j) => {
          if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks)
            result.push(block[i]);
        });
      }
      return result;
    }
    
    static getNumRawDataModules(ver) {
      let result = (16 * ver + 128) * ver + 64;
      if (ver >= 2) {
        const numAlign = Math.floor(ver / 7) + 2;
        result -= (25 * numAlign - 10) * numAlign - 55;
        if (ver >= 7) result -= 36;
      }
      return result;
    }
    
    static getNumDataCodewords(ver, ecl) {
      return Math.floor(QrCode.getNumRawDataModules(ver) / 8) -
        QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] *
        QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
    }
    
    static reedSolomonComputeDivisor(degree) {
      const result = [];
      for (let i = 0; i < degree - 1; i++)
        result.push(0);
      result.push(1);
      let root = 1;
      for (let i = 0; i < degree; i++) {
        for (let j = 0; j < result.length; j++) {
          result[j] = QrCode.reedSolomonMultiply(result[j], root);
          if (j + 1 < result.length)
            result[j] ^= result[j + 1];
        }
        root = QrCode.reedSolomonMultiply(root, 0x02);
      }
      return result;
    }
    
    static reedSolomonComputeRemainder(data, divisor) {
      const result = divisor.map(() => 0);
      for (const b of data) {
        const factor = b ^ result.shift();
        result.push(0);
        divisor.forEach((coef, i) => result[i] ^= QrCode.reedSolomonMultiply(coef, factor));
      }
      return result;
    }
    
    static reedSolomonMultiply(x, y) {
      if (x >>> 8 !== 0 || y >>> 8 !== 0) throw new RangeError('Byte out of range');
      let z = 0;
      for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11D);
        z ^= ((y >>> i) & 1) * x;
      }
      return z;
    }
  }
  
  QrCode.MIN_VERSION = 1;
  QrCode.MAX_VERSION = 40;
  QrCode.Ecc = {
    LOW: {ordinal: 0, formatBits: 1},
    MEDIUM: {ordinal: 1, formatBits: 0},
    QUARTILE: {ordinal: 2, formatBits: 3},
    HIGH: {ordinal: 3, formatBits: 2}
  };
  QrCode.ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];
  QrCode.NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];
  
  class QrSegment {
    constructor(mode, numChars, bitData) {
      this.mode = mode;
      this.numChars = numChars;
      this.bitData = bitData;
    }
    
    static makeSegments(text) {
      return [QrSegment.makeBytes(text)];
    }
    
    static makeBytes(data) {
      const bb = [];
      for (let i = 0; i < data.length; i++) {
        const c = data.charCodeAt(i);
        for (let j = 7; j >= 0; j--)
          bb.push((c >>> j) & 1);
      }
      return new QrSegment({modeBits: 0x4, numBitsCharCount: [8, 16, 16]}, data.length, bb);
    }
    
    getData() {
      const result = [];
      for (let i = 0; i < 4; i++)
        result.push((this.mode.modeBits >>> (3 - i)) & 1);
      const ccBits = this.mode.numBitsCharCount[0];
      for (let i = ccBits - 1; i >= 0; i--)
        result.push((this.numChars >>> i) & 1);
      result.push(...this.bitData);
      return result;
    }
    
    static getTotalBits(segs, version) {
      let result = 0;
      for (const seg of segs) {
        const ccbits = seg.mode.numBitsCharCount[0];
        result += 4 + ccbits + seg.bitData.length;
      }
      return result;
    }
  }
  
  function getBit(x, i) {
    return ((x >>> i) & 1) !== 0;
  }
  
  return {QrCode, QrSegment};
})();

async function checkMFAStatus() {
  try {
    const res = await authFetch(API_BASE + '/api/auth/mfa-status');
    const data = await res.json();
    const enabled = data.enabled;
    
    const indicator = document.getElementById('mfaStatusIndicator');
    if (enabled) {
      indicator.textContent = '🔒 MFA Enabled';
      indicator.style.background = 'rgba(16,185,129,0.15)';
      indicator.style.color = 'var(--green)';
      indicator.style.border = '1px solid rgba(16,185,129,0.3)';
      document.getElementById('mfaEnabledView').style.display = 'block';
      document.getElementById('mfaDisabledView').style.display = 'none';
    } else {
      indicator.textContent = '⚠️ MFA Disabled';
      indicator.style.background = 'rgba(245,158,11,0.15)';
      indicator.style.color = 'var(--yellow)';
      indicator.style.border = '1px solid rgba(245,158,11,0.3)';
      document.getElementById('mfaEnabledView').style.display = 'none';
      document.getElementById('mfaDisabledView').style.display = 'block';
    }
    indicator.style.display = 'block';
    document.getElementById('mfaSetupView').style.display = 'none';
  } catch (err) {
    console.error('Failed to check MFA status:', err);
  }
}

function generateQRCodeDataUrl(text) {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  const border = 4;
  const s = qr.size + border * 2;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="256" height="256" shape-rendering="crispEdges">`;
  svg += `<rect width="${s}" height="${s}" fill="#ffffff"/>`;
  let path = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) {
        path += `M${x + border},${y + border}h1v1h-1z`;
      }
    }
  }
  svg += `<path d="${path}" fill="#000000"/>`;
  svg += '</svg>';
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

async function setupMFA() {
  const btn = document.getElementById('enableMfaBtn');
  btn.disabled = true;
  btn.textContent = 'Setting up...';
  
  try {
    const res = await authFetch(API_BASE + '/api/auth/setup-mfa', { method: 'POST' });
    const data = await res.json();
    
    if (res.ok && data.secret) {
      document.getElementById('mfaSecretDisplay').textContent = data.secret;
      const qrCodeContainer = document.getElementById('qrCodeContainer');
      if (qrCodeContainer) {
        qrCodeContainer.innerHTML = '';
        const img = document.createElement('img');
        img.src = generateQRCodeDataUrl(data.otpauth_uri);
        img.width = 256;
        img.height = 256;
        img.style.imageRendering = 'pixelated';
        img.alt = 'MFA QR code';
        qrCodeContainer.appendChild(img);
      }
      document.getElementById('mfaDisabledView').style.display = 'none';
      document.getElementById('mfaSetupView').style.display = 'block';
    } else {
      alert('Failed to setup MFA: ' + (data.error || 'Unknown error'));
      btn.disabled = false;
      btn.textContent = '✅ Enable MFA';
    }
  } catch (err) {
    alert('Failed to setup MFA: ' + err.message);
    btn.disabled = false;
    btn.textContent = '✅ Enable MFA';
  }
}

async function confirmMFASetup() {
  const code = document.getElementById('mfaVerifyCode').value.trim();
  const errorEl = document.getElementById('mfaVerifyError');
  const btn = document.getElementById('confirmMfaBtn');
  errorEl.style.display = 'none';
  
  if (!code || code.length !== 6) {
    errorEl.textContent = 'Enter the 6-digit code from your authenticator app.';
    errorEl.style.display = 'block';
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Verifying...';
  
  try {
    const res = await authFetch(API_BASE + '/api/auth/confirm-mfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totpCode: code })
    });
    const data = await res.json();
    
    if (res.ok && data.success) {
      showToast('MFA enabled successfully!', 'success');
      document.getElementById('mfaSetupView').style.display = 'none';
      document.getElementById('mfaVerifyCode').value = '';
      checkMFAStatus();
    } else {
      errorEl.textContent = data.error || 'Invalid code. Try again.';
      errorEl.style.display = 'block';
      document.getElementById('mfaVerifyCode').value = '';
      document.getElementById('mfaVerifyCode').focus();
    }
  } catch (err) {
    errorEl.textContent = 'Verification failed. Try again.';
    errorEl.style.display = 'block';
  }
  
  btn.disabled = false;
  btn.textContent = '✅ Verify & Enable';
}

function cancelMFASetup() {
  document.getElementById('mfaSetupView').style.display = 'none';
  document.getElementById('mfaVerifyCode').value = '';
  checkMFAStatus();
}

async function disableMFA() {
  const code = prompt('Enter your current 6-digit TOTP code to disable MFA:');
  if (!code) return;
  
  if (!/^\d{6}$/.test(code)) {
    alert('Invalid code format. Must be 6 digits.');
    return;
  }
  
  const btn = document.getElementById('disableMfaBtn');
  btn.disabled = true;
  btn.textContent = 'Disabling...';
  
  try {
    const res = await authFetch(API_BASE + '/api/auth/disable-mfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totpCode: code })
    });
    
    const data = await res.json();
    
    if (res.ok && data.success) {
      alert('MFA has been disabled successfully.');
      checkMFAStatus();
    } else {
      alert('Failed to disable MFA: ' + (data.error || 'Invalid code'));
      btn.disabled = false;
      btn.textContent = '⚠️ Disable MFA';
    }
  } catch (err) {
    alert('Failed to disable MFA: ' + err.message);
    btn.disabled = false;
    btn.textContent = '⚠️ Disable MFA';
  }
}

checkAuth();

// Ensure sidebar is closed on mobile page load
(function() {
  const mq = window.matchMedia("(max-width: 900px)");
  if (mq.matches) {
    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
      sidebar.classList.remove("open");
    }
  }
})();

let sessions = [];
let costs = {};
let usage = {};
let systemStats = {};
let feedPaused = true;
let liveEventSource = null;
let sortBy = 'updated';
let sortDir = 'desc';
let selectedSessions = new Set();
let notificationsEnabled = false;

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const page = item.dataset.page;
    if ((page === 'sys-security' || page === 'security' || page === 'config-editor') && !sysSecAuthed) { showReauthModal(page); return; }
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(page).classList.add('active');
    
    if (page === 'feed') {
      // Don't auto-connect; user clicks Start
    } else if (liveEventSource) {
      liveEventSource.close();
      liveEventSource = null;
    }
    
    if (page === 'memory') {
      fetchMemoryFiles();
    }
    if (page === 'files') {
      fetchKeyFiles();
    }
  });
});

document.querySelectorAll('.view-all-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const page = link.dataset.page;
    document.querySelector(`[data-page="${page}"]`).click();
  });
});

async function fetchData() {
  try {
    // Fast path: load sessions, costs, system first
    const [sessRes, costsRes, sysRes] = await Promise.all([
      authFetch(API_BASE + '/api/sessions'),
      authFetch(API_BASE + '/api/costs'),
      authFetch(API_BASE + '/api/system')
    ]);
    
    sessions = await sessRes.json();
    costs = await costsRes.json();
    systemStats = await sysRes.json();

    hideSkeletons();
    updateDashboard();
    
    // Then load usage async (slower endpoint)
    authFetch(API_BASE + '/api/usage').then(r => r.json()).then(u => {
      usage = u;
      try { updateDashboard(); } catch {}
    }).catch(() => {});
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

function animateValue(elem, end) {
  const start = parseFloat(elem.textContent.replace(/[^0-9.-]/g, '')) || 0;
  const duration = 600;
  const range = end - start;
  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const value = start + range * progress;
    
    if (elem.dataset.format === 'currency') {
      elem.textContent = '$' + value.toFixed(2);
    } else if (elem.dataset.format === 'percent') {
      elem.textContent = Math.round(value) + '%';
    } else {
      elem.textContent = Math.round(value).toLocaleString();
    }
    
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

function updateRadialGauge(circleId, percent) {
  const circle = document.getElementById(circleId);
  const circumference = 326.73;
  const offset = circumference - (percent / 100) * circumference;
  circle.style.strokeDashoffset = offset;
  
  if (percent < 50) {
    circle.style.stroke = 'var(--green)';
  } else if (percent < 80) {
    circle.style.stroke = 'var(--yellow)';
  } else {
    circle.style.stroke = 'var(--red)';
  }
}

function updateDashboard() {
  try { updateOverview(); } catch(e) { console.error('Overview error:', e); }
  try { updateSessions(); } catch(e) { console.error('Sessions error:', e); }
  try { updateLimits(); } catch(e) { console.error('Limits error:', e); }
  try { updateCosts(); } catch(e) { console.error('Costs error:', e); }
  try { updateStatusBar(); } catch(e) { console.error('StatusBar error:', e); }
}

function updateOverview() {
  const running = sessions.filter(s => {
    const age = Date.now() - s.updatedAt;
    return age < 300000 && !s.aborted;
  }).length;
  
  animateValue(document.getElementById('runningAgents'), running);
  document.getElementById('totalSessions').textContent = sessions.length;
  document.getElementById('activeSessions').textContent = running;
  
  const todayEl = document.getElementById('todaySpend');
  todayEl.dataset.format = 'currency';
  animateValue(todayEl, costs.today || 0);
  
  const opusLimitsKey = Object.keys((usage.fiveHour && usage.fiveHour.perModel) || {}).find(k => k.includes('opus')) || '';
  // Overview usage card: delegate to provider-specific updater
  try {
    if (_currentProvider === 'claude') updateOverviewClaude();

    const cu = _cachedClaudeUsage;
    const sPct = (cu && cu.session) ? cu.session.percent : 0;
    if (sPct >= 80 && !window._usageNotified) {
      sendNotification('High Usage Warning', `Claude session usage at ${sPct}%`);
      window._usageNotified = true;
    } else if (sPct < 70) {
      window._usageNotified = false;
    }
  } catch {}
  
  if (systemStats.cpu) {
    const cpuPct = systemStats.cpu.usage || 0;
    document.getElementById('systemCpu').textContent = cpuPct + '%';
    updateRadialGauge('cpuCircle', cpuPct);
    
    const ramPct = (systemStats.memory && systemStats.memory.percent) || 0;
    document.getElementById('systemRam').textContent = ramPct + '%';
    updateRadialGauge('ramCircle', ramPct);
    const ramDetail = document.getElementById('systemRamDetail');
    if (ramDetail && systemStats.memory) {
      ramDetail.textContent = `${systemStats.memory.usedGB} / ${systemStats.memory.totalGB} GB`;
    }
    
    const temp = systemStats.cpu.temp;
    if (temp !== null && temp !== undefined) {
      const tempPct = Math.min((temp / 90) * 100, 100);
      document.getElementById('systemTemp').textContent = temp.toFixed(0) + '°';
      updateRadialGauge('tempCircle', tempPct);
    } else {
      document.getElementById('systemTemp').textContent = 'N/A';
      updateRadialGauge('tempCircle', 0);
    }
    
    const uptime = systemStats.uptime || 0;
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const uptimeStr = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h` : `${Math.floor(uptime / 60)}m`;
    document.getElementById('systemUptime').textContent = uptimeStr;
    
    if (systemStats.loadAvg) {
      document.getElementById('systemLoad').textContent = 
        `Load: ${systemStats.loadAvg['1m']} ${systemStats.loadAvg['5m']} ${systemStats.loadAvg['15m']}`;
    }
    
    if (systemStats.disk) {
      const diskPct = systemStats.disk.percent || 0;
      document.getElementById('systemDisk').textContent = diskPct + '%';
      updateRadialGauge('diskCircle', diskPct);
      const diskDetail = document.getElementById('systemDiskDetail');
      if (diskDetail) diskDetail.textContent = `${systemStats.disk.used} / ${systemStats.disk.total}`;
    }
    if (systemStats.diskHistory) renderDiskSparkline(systemStats.diskHistory);
    
    const crashes = systemStats.crashCount || 0;
    const crashesToday = systemStats.crashesToday || 0;
    document.getElementById('systemCrashes').textContent = crashes;
    document.getElementById('systemCrashes').style.color = crashes > 0 ? 'var(--red)' : 'var(--green)';
    document.getElementById('systemCrashesToday').textContent = crashesToday;
    document.getElementById('systemCrashesToday').style.color = crashesToday > 0 ? 'var(--red)' : 'var(--green)';
  }
  
  const seen = new Set();
  const recent = sessions
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(s => {
      const dedup = s.label;
      if (seen.has(dedup)) return false;
      seen.add(dedup);
      return true;
    })
    .slice(0, 8);
  
  const recentActivityEl = document.getElementById('recentActivity');
  if (!recent.length) {
    setEmptyState(recentActivityEl, 'No recent activity', '📭');
  } else {
    recentActivityEl.innerHTML = '';
    recent.forEach(s => {
      const age = Date.now() - s.updatedAt;
      const ago = age < 60000 ? 'just now' :
                  age < 3600000 ? Math.round(age / 60000) + 'm ago' :
                  age < 86400000 ? Math.round(age / 3600000) + 'h ago' :
                  Math.round(age / 86400000) + 'd ago';
      const isActive = age < 300000 && !s.aborted;
      const typeClass = s.key.includes('subagent') ? 'sub' :
                        s.key.includes('cron') ? 'cron' :
                        s.kind === 'group' ? 'group' : 'main';
      const badgeText = typeClass;
      const tokens = s.totalTokens || 0;
      const tokStr = tokens >= 1000 ? (tokens / 1000).toFixed(0) + 'k' : String(tokens);
      const costStr = s.cost > 0 ? '$' + s.cost.toFixed(2) : '';
      const dur = s.createdAt ? Date.now() - s.createdAt : 0;
      const durStr = dur > 86400000 ? Math.floor(dur / 86400000) + 'd' :
                     dur > 3600000 ? Math.floor(dur / 3600000) + 'h' :
                     dur > 60000 ? Math.floor(dur / 60000) + 'm' : '';

      const item = document.createElement('div');
      item.className = `activity-item type-${typeClass} ${isActive ? 'running' : ''}`.trim();
      item.onclick = () => openSessionDetail(s.key);

      const dot = document.createElement('div');
      dot.className = `activity-dot ${isActive ? 'running' : ''}`.trim();
      item.appendChild(dot);

      const content = document.createElement('div');
      content.className = 'activity-content';

      const header = document.createElement('div');
      header.className = 'activity-header';
      const name = document.createElement('span');
      name.className = 'activity-name';
      name.textContent = s.label;
      const badge = document.createElement('span');
      badge.className = `badge ${badgeText}`;
      badge.textContent = badgeText;
      const time = document.createElement('span');
      time.className = 'activity-time';
      time.textContent = ago;
      header.appendChild(name);
      header.appendChild(badge);
      header.appendChild(time);
      content.appendChild(header);

      if (s.lastMessage) {
        const snippet = document.createElement('div');
        snippet.className = 'activity-snippet';
        snippet.textContent = s.lastMessage;
        content.appendChild(snippet);
      }

      const meta = document.createElement('div');
      meta.className = 'activity-meta';
      [s.model.split('/').pop(), tokStr + ' tok', costStr, durStr ? '⏱ ' + durStr : ''].filter(Boolean).forEach(val => {
        const span = document.createElement('span');
        span.textContent = val;
        meta.appendChild(span);
      });
      content.appendChild(meta);

      item.appendChild(content);
      recentActivityEl.appendChild(item);
    });
  }
  
  const perDay = costs.perDay || {};
  const days = Object.keys(perDay).sort().slice(-7);
  const maxSpend = Math.max(...days.map(d => perDay[d] || 0), 0.01);
  
  const chartHeight = 120;
  const chartHtml = days.map(day => {
    const amount = perDay[day] || 0;
    const h = Math.max(4, (amount / maxSpend) * chartHeight);
    const date = new Date(day);
    const label = date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    
    return `
      <div class="bar-item">
        <div class="bar-value">$${amount.toFixed(2)}</div>
        <div class="bar" style="height: ${h}px"></div>
        <div class="bar-label">${label}</div>
      </div>
    `;
  }).join('');
  
  const dailySpendChartEl = document.getElementById('dailySpendChart');
  if (chartHtml) dailySpendChartEl.innerHTML = chartHtml;
  else setEmptyState(dailySpendChartEl, 'No data');

  const summaryEl = document.getElementById('dailySpendSummary');
  if (summaryEl) {
    summaryEl.innerHTML = '';
    if (days.length > 0) {
      const vals = days.map(d => perDay[d] || 0);
      const total = vals.reduce((a, b) => a + b, 0);
      const avg = total / vals.length;
      const maxDay = days[vals.indexOf(Math.max(...vals))];
      const maxVal = Math.max(...vals);
      [
        ['7-Day Total', '$' + total.toFixed(2), 'var(--accent)', '18px', null],
        ['Daily Avg', '$' + avg.toFixed(2), 'var(--green)', '18px', null],
        ['Peak Day', new Date(maxDay).toLocaleDateString('en',{month:'short',day:'numeric'}), 'var(--text-primary)', '14px', '$' + maxVal.toFixed(2)]
      ].forEach(([label, value, color, size, sub]) => {
        const box = document.createElement('div');
        const labelEl = document.createElement('div');
        labelEl.style.cssText = 'font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;';
        labelEl.textContent = label;
        const valueEl = document.createElement('div');
        valueEl.style.cssText = `font-size:${size};font-weight:${size === '18px' ? '700' : '600'};color:${color};${size === '18px' ? "font-family:'JetBrains Mono',monospace;" : ''}`;
        valueEl.textContent = value;
        box.appendChild(labelEl);
        box.appendChild(valueEl);
        if (sub) {
          const subEl = document.createElement('div');
          subEl.style.cssText = "font-size:12px;color:var(--yellow);font-family:'JetBrains Mono',monospace;";
          subEl.textContent = sub;
          box.appendChild(subEl);
        }
        summaryEl.appendChild(box);
      });
    }
  }
}

let sessionFilter = 'all';
let sessionSearch = '';
let modelFilter = 'all';
let dateRange = '7d';
let expandedSessionKey = null;
let _msgPollEntry = null;

function refreshExpandedMessages(key) {
  const s = sessions.find(x => x.key === key);
  if (!s) return;
  const el = document.getElementById('expanded-msgs-' + CSS.escape(key));
  if (!el) { expandedSessionKey = null; return; }
  authFetch(API_BASE + '/api/session-messages?id=' + encodeURIComponent(s.sessionId || s.key))
    .then(r => r.json())
    .then(msgs => {
      if (!document.getElementById('expanded-msgs-' + CSS.escape(key))) return;
      const last10 = msgs.slice(-10);
      el.innerHTML = '';
      if (!last10.length) {
        const empty = document.createElement('div');
        empty.style.color = 'var(--text-muted)';
        empty.textContent = 'No messages';
        el.appendChild(empty);
        return;
      }
      last10.forEach(m => {
        const roleColor = m.role === 'user' ? 'var(--blue)' : m.role === 'assistant' ? 'var(--green)' : 'var(--yellow)';
        const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'}) : '';
        const row = document.createElement('div');
        row.style.cssText = 'padding:6px 0;border-bottom:1px solid var(--border);';
        const head = document.createElement('div');
        const role = document.createElement('span');
        role.style.cssText = `font-weight:600;color:${roleColor};text-transform:uppercase;font-size:10px;margin-right:8px;`;
        role.textContent = m.role || '';
        const timeEl = document.createElement('span');
        timeEl.style.cssText = 'color:var(--text-muted);font-size:10px;';
        timeEl.textContent = time;
        head.appendChild(role);
        head.appendChild(timeEl);
        const body = document.createElement('div');
        body.style.cssText = "color:var(--text-primary);line-height:1.4;word-break:break-word;font-family:'JetBrains Mono',monospace;font-size:11px;margin-top:2px;";
        body.textContent = m.content || '';
        row.appendChild(head);
        row.appendChild(body);
        el.appendChild(row);
      });
    }).catch(() => {});
}

function startMsgPoll(key) {
  stopMsgPoll();
  _msgPollEntry = visibleInterval(() => refreshExpandedMessages(key), 5000);
}
function stopMsgPoll() {
  clearVisibleInterval(_msgPollEntry);
  _msgPollEntry = null;
}

document.querySelectorAll('#statusFilters .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#statusFilters .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    sessionFilter = chip.dataset.filter;
    updateSessions();
  });
});

document.querySelectorAll('#modelFilters .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#modelFilters .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    modelFilter = chip.dataset.model;
    updateSessions();
  });
});

document.querySelectorAll('#dateFilters .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#dateFilters .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    dateRange = chip.dataset.range;
    updateSessions();
  });
});

document.getElementById('sessionSearch').addEventListener('input', (e) => {
  sessionSearch = e.target.value.toLowerCase();
  updateSessions();
});

document.querySelectorAll('.table-header .sortable').forEach(header => {
  header.addEventListener('click', () => {
    const newSort = header.dataset.sort;
    if (sortBy === newSort) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = newSort;
      sortDir = 'desc';
    }
    updateSessions();
  });
});

function getFilteredSessions() {
  let filtered = [...sessions];
  const now = Date.now();

  if (dateRange === 'today') {
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    filtered = filtered.filter(s => s.updatedAt >= todayStart.getTime());
  } else if (dateRange === '7d') {
    filtered = filtered.filter(s => now - s.updatedAt < 7 * 86400000);
  } else if (dateRange === '30d') {
    filtered = filtered.filter(s => now - s.updatedAt < 30 * 86400000);
  }

  if (sessionFilter === 'running') {
    filtered = filtered.filter(s => now - s.updatedAt < 300000 && !s.aborted);
  } else if (sessionFilter === 'complete') {
    filtered = filtered.filter(s => now - s.updatedAt >= 300000 && !s.aborted);
  } else if (sessionFilter === 'aborted') {
    filtered = filtered.filter(s => s.aborted);
  } else if (sessionFilter === 'subagent') {
    filtered = filtered.filter(s => s.key.includes('subagent'));
  } else if (sessionFilter === 'cron') {
    filtered = filtered.filter(s => s.key.includes('cron'));
  } else if (sessionFilter === 'group') {
    filtered = filtered.filter(s => s.kind === 'group' || s.key.includes('group'));
  }

  if (modelFilter !== 'all') {
    filtered = filtered.filter(s => {
      const m = s.model.toLowerCase();
      if (modelFilter === 'opus-4-6') return m.includes('opus');
      if (modelFilter === 'sonnet') return m.includes('sonnet');
      if (modelFilter === 'gemini') return m.includes('gemini');
      return true;
    });
  }

  if (sessionSearch) {
    filtered = filtered.filter(s =>
      s.label.toLowerCase().includes(sessionSearch) ||
      s.key.toLowerCase().includes(sessionSearch) ||
      s.model.toLowerCase().includes(sessionSearch)
    );
  }

  return filtered;
}

function getModelColor(model) {
  const m = model.toLowerCase();
  if (m.includes('opus-4-6') || m.includes('opus-4')) return 'var(--accent)';
  if (m.includes('opus-4-5')) return 'var(--purple)';
  if (m.includes('sonnet')) return 'var(--cyan)';
  if (m.includes('gemini')) return 'var(--yellow)';
  return 'var(--text-muted)';
}

function updateSessionsStats(filtered) {
  const totalTokens = filtered.reduce((sum, s) => sum + (s.totalTokens || 0), 0);
  const totalCost = filtered.reduce((sum, s) => sum + (s.cost || 0), 0);
  document.getElementById('statsSessionCount').textContent = filtered.length;
  document.getElementById('statsTotalTokens').textContent = totalTokens >= 1000000 ? (totalTokens / 1000000).toFixed(1) + 'M' : totalTokens >= 1000 ? (totalTokens / 1000).toFixed(0) + 'k' : totalTokens;
  document.getElementById('statsTotalCost').textContent = '$' + totalCost.toFixed(2);
}

function renderTimeline(filtered) {
  const now = Date.now();
  const rangeMs = dateRange === 'today' ? 86400000 : dateRange === '7d' ? 7 * 86400000 : dateRange === '30d' ? 30 * 86400000 : 30 * 86400000;
  const start = now - rangeMs;
  const seen = new Set();
  const items = filtered.filter(s => s.updatedAt > start).sort((a, b) => b.updatedAt - a.updatedAt).filter(s => { if (seen.has(s.label)) return false; seen.add(s.label); return true; }).slice(0, 12);
  const timelineEl = document.getElementById('timelineCanvas');
  if (!items.length) {
    setEmptyState(timelineEl, 'No sessions in range');
    return;
  }

  const colors = { main: 'var(--accent)', sub: 'var(--cyan)', cron: 'var(--yellow)', group: 'var(--blue)' };
  const isMobile = window.innerWidth <= 768;
  const tickCount = dateRange === 'today' ? 6 : (isMobile ? 3 : 7);
  timelineEl.innerHTML = '';

  items.forEach(s => {
    const typeClass = s.key.includes('subagent') ? 'sub' : s.key.includes('cron') ? 'cron' : s.kind === 'group' ? 'group' : 'main';
    const color = colors[typeClass] || 'var(--accent)';
    const created = Math.max(s.createdAt || s.updatedAt, start);
    const leftPct = Math.max(((created - start) / rangeMs) * 100, 0);
    const rightPct = Math.min(((s.updatedAt - start) / rangeMs) * 100, 100);
    const widthPct = Math.max(rightPct - leftPct, 1);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
    row.innerHTML = `<div style="width:100px;flex-shrink:0;font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--text-secondary);">${escapeHtml(s.label)}</div><div style="flex:1;height:14px;background:var(--bg-primary);border-radius:4px;position:relative;overflow:hidden;"><div style="position:absolute;left:${leftPct}%;width:${widthPct}%;height:100%;background:${color};border-radius:4px;opacity:0.8;"></div></div>`;
    timelineEl.appendChild(row);
  });

  const ticksWrap = document.createElement('div');
  ticksWrap.style.cssText = 'position:relative;height:18px;margin-left:108px;';
  for (let i = 0; i <= tickCount; i++) {
    const t = start + (rangeMs / tickCount) * i;
    const d = new Date(t);
    const label = dateRange === 'today' ? d.toLocaleTimeString('en', {hour:'2-digit',minute:'2-digit'}) : d.toLocaleDateString('en', {month:'short',day:'numeric'});
    const tick = document.createElement('div');
    tick.style.cssText = `position:absolute;left:${(i / tickCount) * 100}%;bottom:0;transform:translateX(-50%);font-size:9px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;white-space:nowrap;`;
    tick.textContent = label;
    ticksWrap.appendChild(tick);
  }
  timelineEl.appendChild(ticksWrap);
}

function toggleSessionExpand(key, e) {
  if (e) e.stopPropagation();
  const existing = document.getElementById('expanded-' + CSS.escape(key));
  if (existing) {
    existing.remove();
    expandedSessionKey = null;
    stopMsgPoll();
    return;
  }
  const prev = document.querySelector('.session-expanded');
  if (prev) prev.remove();
  expandedSessionKey = key;

  const s = sessions.find(x => x.key === key);
  if (!s) return;
  const row = document.querySelector(`[data-session-key="${CSS.escape(key)}"]`);
  if (!row) return;

  const age = Date.now() - s.updatedAt;
  const ago = age < 60000 ? 'just now' : age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
  const createdAgo = s.createdAt ? new Date(s.createdAt).toLocaleString() : '--';
  const modelColor = getModelColor(s.model);

  const detail = document.createElement('div');
  detail.id = 'expanded-' + key;
  detail.className = 'session-expanded';
  detail.style.cssText = 'padding:16px 20px;background:var(--bg-tertiary);border-bottom:1px solid var(--border);animation:fadeIn 0.2s ease;';

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px;';
  [
    ['Session Key', s.key, 'mono', '11px', null],
    ['Model', s.model.split('/').pop(), 'mono', '12px', modelColor],
    ['Tokens', (s.totalTokens||0).toLocaleString(), 'mono', '12px', null],
    ['Cost', '$' + (s.cost||0).toFixed(2), 'mono', '12px', null],
    ['Channel', s.channel || '--', '', '12px', null],
    ['Created', createdAgo, '', '12px', null],
    ['Last Active', ago, '', '12px', null]
  ].forEach(([label, value, cls, fontSize, color]) => {
    const cell = document.createElement('div');
    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'font-size:10px;color:var(--text-muted);text-transform:uppercase;';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    if (cls) valueEl.className = cls;
    valueEl.style.fontSize = fontSize;
    if (label === 'Session Key') valueEl.style.wordBreak = 'break-all';
    if (color) valueEl.style.color = color;
    valueEl.textContent = value;
    cell.appendChild(labelEl);
    cell.appendChild(valueEl);
    grid.appendChild(cell);
  });

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
  const title = document.createElement('span');
  title.style.cssText = 'font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;';
  title.textContent = 'Recent Messages';
  const fullBtn = document.createElement('button');
  fullBtn.textContent = 'Full View';
  fullBtn.style.cssText = 'background:var(--accent);color:white;border:none;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;';
  fullBtn.onclick = () => openSessionDetail(s.key);
  header.appendChild(title);
  header.appendChild(fullBtn);

  const msgs = document.createElement('div');
  msgs.id = 'expanded-msgs-' + CSS.escape(key);
  msgs.style.cssText = 'font-size:12px;color:var(--text-muted);';
  msgs.textContent = 'Loading...';

  detail.appendChild(grid);
  detail.appendChild(header);
  detail.appendChild(msgs);
  row.after(detail);

  refreshExpandedMessages(key);
  startMsgPoll(key);
}

function updateSessions() {
  const filtered = getFilteredSessions();
  updateSessionsStats(filtered);
  try { renderTimeline(filtered); } catch(e) { console.error('Timeline error:', e); }
  if (expandedSessionKey) {
    refreshExpandedMessages(expandedSessionKey);
    return;
  }

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    let aVal, bVal;
    if (sortBy === 'label') { aVal = a.label; bVal = b.label; }
    else if (sortBy === 'tokens') { aVal = a.totalTokens || 0; bVal = b.totalTokens || 0; }
    else if (sortBy === 'cost') { aVal = a.cost || 0; bVal = b.cost || 0; }
    else if (sortBy === 'updated') { aVal = a.updatedAt; bVal = b.updatedAt; }
    else { aVal = a.model; bVal = b.model; }
    return sortDir === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
  });

  const tbody = document.getElementById('sessionsTableBody');
  if (!sorted.length) {
    setEmptyState(tbody, 'No sessions found', '🔍');
    return;
  }
  tbody.innerHTML = '';

  sorted.forEach(s => {
    const age = Date.now() - s.updatedAt;
    const ago = age < 60000 ? 'just now' : age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
    const isActive = age < 300000 && !s.aborted;
    const statusClass = s.aborted ? 'aborted' : isActive ? 'running' : '';
    const statusDot = s.aborted ? '🔴' : isActive ? '🟢' : '⚪';
    const typeClass = s.key.includes('subagent') ? 'sub' : s.key.includes('cron') ? 'cron' : s.kind === 'group' ? 'group' : 'main';
    const shortModel = s.model.split('/').pop();
    const modelColor = getModelColor(s.model);
    const costStr = s.cost > 0 ? '$' + s.cost.toFixed(2) : '-';

    const row = document.createElement('div');
    row.className = `table-row ${statusClass}`.trim();
    row.dataset.sessionKey = s.key;

    const appendCell = (opts = {}) => {
      const cell = document.createElement('div');
      cell.className = `table-cell${opts.mono ? ' mono' : ''}`;
      if (opts.style) cell.style.cssText = opts.style;
      if (opts.onClick) cell.onclick = opts.onClick;
      if (opts.html != null) cell.innerHTML = opts.html;
      else if (opts.text != null) cell.textContent = opts.text;
      row.appendChild(cell);
      return cell;
    };

    const cbCell = appendCell();
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'session-checkbox';
    checkbox.checked = selectedSessions.has(s.key);
    checkbox.onchange = () => toggleSessionCompare(s.key, checkbox.checked);
    checkbox.onclick = (event) => event.stopPropagation();
    cbCell.appendChild(checkbox);

    const expandClick = (event) => toggleSessionExpand(s.key, event);
    appendCell({ text: statusDot, onClick: expandClick });

    const labelCell = appendCell({ style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', onClick: expandClick });
    const strong = document.createElement('strong');
    strong.textContent = s.label;
    labelCell.appendChild(strong);
    if (isActive) {
      const live = document.createElement('span');
      live.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:1px 5px;background:rgba(16,185,129,0.15);color:var(--green);border-radius:4px;font-size:9px;font-weight:600;vertical-align:middle;margin-left:6px;';
      live.innerHTML = '●&thinsp;LIVE';
      labelCell.appendChild(live);
    }

    appendCell({ onClick: expandClick, html: `<span class="badge ${typeClass}">${escapeHtml(typeClass)}</span>` });
    appendCell({ mono: true, style: `color:${modelColor};`, text: shortModel, onClick: expandClick });
    appendCell({ mono: true, text: (s.totalTokens||0).toLocaleString(), onClick: expandClick });
    appendCell({ mono: true, text: costStr, onClick: expandClick });
    appendCell({ style: "font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;", text: s.lastMessage || '', onClick: expandClick });
    appendCell({ text: ago, onClick: expandClick });

    tbody.appendChild(row);
  });
}

let _cachedClaudeUsage = null;
let _cachedOpenAIUsage = null;
let _cachedOpenCodeGoUsage = null;
let _usageAutoEntry = null;

function _setClaudeUsageBars(data) {
  _setUsageBar('cuSession', data && data.session, '% used');
  _setUsageBar('cuWeekly', data && data.weekly_all, '% used');
  _setUsageBar('cuSonnet', data && data.weekly_sonnet, '% used');
}

function _setUsageBar(prefix, data, defaultLabelTemplate) {
  if (!data) return;
  const bar = document.getElementById(prefix + 'Bar');
  const pct = document.getElementById(prefix + 'Pct');
  const label = document.getElementById(prefix + 'Label');
  const reset = document.getElementById(prefix + 'Reset');
  if (bar) { bar.style.width = data.percent + '%'; bar.style.background = getProgressColor(data.percent); }
  if (pct) pct.textContent = data.percent + '%';
  if (label) label.textContent = data.label || (defaultLabelTemplate === '% used' ? (data.percent + '% used') : (data.percent + '% used'));
  if (reset) reset.textContent = data.detail || (data.resets ? 'Resets ' + data.resets : '');
}

function resolveUsageProvider(provider) {
  if (provider === 'glm') return 'openai';
  if (provider === 'kimi' || provider === 'minimax') return 'opencode-go';
  return provider;
}

const PROVIDER_USAGE_CONFIG = {
  claude: {
    endpoint: 'claude',
    cacheName: 'Claude',
    sourceHint: 'Source: provider API',
    modelStorageKey: 'claudeModel',
    models: [
      { value: 'session', label: '5h Session' },
      { value: 'weekly_all', label: 'Weekly (All)' },
      { value: 'weekly_sonnet', label: 'Weekly (Sonnet)' }
    ],
    button: { id: 'provBtnClaude', activeBg: 'var(--accent)' },
    fetchIntervalMs: 60000,
    scrape: {
      btnIds: ['scrapeBtn', 'overviewScrapeBtn'],
      busyTexts: ['⏳ Refreshing...', '⏳'],
      idleTexts: ['⟳ Refresh', '⟳'],
      success: 'Usage data refreshed',
      failure: 'Failed to refresh usage data',
      pollAttempts: 12,
      pollDelayMs: 2000
    },
    applyData(data) {
      _setClaudeUsageBars(data);
    },
    selectOverviewData(data, model) {
      const keyMap = { session: 'session', weekly_all: 'weekly_all', weekly_sonnet: 'weekly_sonnet' };
      return data ? data[keyMap[model] || 'session'] : null;
    }
  },
  openai: {
    endpoint: 'openai',
    cacheName: 'OpenAI',
    sourceHint: 'Source: local sessions',
    modelStorageKey: 'openaiModel',
    models: [{ value: 'session', label: 'Last 24h' }],
    button: { id: 'provBtnOpenAI', activeBg: '#10a37f' },
    fetchIntervalMs: 60000,
    scrapedAtId: 'openaiUsageScrapedAt',
    scrapeBtnId: 'openaiScrapeBtn',
    scrapeSuccess: 'ChatGPT usage refreshed',
    scrapeFailure: 'Failed to refresh ChatGPT usage',
    applyData(data) {
      _setUsageBar('openaiSession', data && data.session);
    },
    selectOverviewData(data) {
      return data && data.session;
    }
  },
  'opencode-go': {
    endpoint: 'opencode-go',
    cacheName: 'OpenCodeGo',
    sourceHint: 'Source: local sessions',
    modelStorageKey: 'opencodeGoModel',
    models: [{ value: 'session', label: 'Last 24h' }],
    button: { id: 'provBtnOpenCodeGo', activeBg: '#4285f4' },
    fetchIntervalMs: 60000,
    scrapedAtId: 'opencodeGoUsageScrapedAt',
    scrapeBtnId: 'opencodeGoScrapeBtn',
    scrapeSuccess: 'OpenCode-Go usage refreshed',
    scrapeFailure: 'Failed to refresh OpenCode-Go usage',
    applyData(data) {
      _setUsageBar('opencodeGoSession', data && data.session);
    },
    selectOverviewData(data) {
      return data && data.session;
    }
  }
};

const PROVIDER_USAGE_CACHE = {
  claude: () => _cachedClaudeUsage,
  openai: () => _cachedOpenAIUsage,
  'opencode-go': () => _cachedOpenCodeGoUsage
};

function _getProviderUsageCache(provider) {
  const canonical = resolveUsageProvider(provider);
  return PROVIDER_USAGE_CACHE[canonical] ? PROVIDER_USAGE_CACHE[canonical]() : null;
}

function _setProviderUsageCache(provider, value) {
  const canonical = resolveUsageProvider(provider);
  if (canonical === 'claude') _cachedClaudeUsage = value;
  else if (canonical === 'openai') _cachedOpenAIUsage = value;
  else if (canonical === 'opencode-go') _cachedOpenCodeGoUsage = value;
}

async function fetchProviderUsage(provider) {
  const canonical = resolveUsageProvider(provider);
  const cfg = PROVIDER_USAGE_CONFIG[canonical];
  if (!cfg) return;
  try {
    const r = await authFetch(API_BASE + '/api/' + cfg.endpoint + '-usage');
    const d = await r.json();
    if (d.error) return;
    _setProviderUsageCache(canonical, d);
    if (typeof cfg.applyData === 'function') cfg.applyData(d);
    const tsId = cfg.scrapedAtId || 'claudeUsageScrapedAt';
    const ts = document.getElementById(tsId);
    if (ts && d.scraped_at) {
      const ago = Math.round((Date.now() - new Date(d.scraped_at).getTime()) / 60000);
      ts.textContent = ago < 1 ? 'Just now' : ago + 'm ago';
    }
  } catch {}
}

async function scrapeProviderUsage(provider) {
  const canonical = resolveUsageProvider(provider);
  const cfg = PROVIDER_USAGE_CONFIG[canonical];
  if (!cfg) return;
  const label = document.getElementById('usageAutoLabel');
  const btnIds = cfg.scrape && cfg.scrape.btnIds ? cfg.scrape.btnIds : [cfg.scrapeBtnId];
  const buttons = btnIds.map(id => document.getElementById(id)).filter(Boolean);
  const origTexts = buttons.map(btn => btn.textContent);
  buttons.forEach((btn, idx) => {
    btn.textContent = (cfg.scrape && cfg.scrape.busyTexts && cfg.scrape.busyTexts[idx]) || '⏳ Refreshing...';
    btn.disabled = true;
  });
  if (label && _usageAutoEntry) label.textContent = '⏳...';
  try {
    await authFetch(API_BASE + '/api/' + cfg.endpoint + '-usage-scrape', { method: 'POST' });
    const oldTs = ((_getProviderUsageCache(canonical) || {}).scraped_at) || '';
    const attempts = (cfg.scrape && cfg.scrape.pollAttempts) || 5;
    const delayMs = (cfg.scrape && cfg.scrape.pollDelayMs) || 1200;
    for (let i = 0; i < attempts; i++) {
      await new Promise(r => setTimeout(r, delayMs));
      await fetchProviderUsage(canonical);
      const current = _getProviderUsageCache(canonical);
      if (current && current.scraped_at && current.scraped_at !== oldTs) break;
    }
    showToast((cfg.scrape && cfg.scrape.success) || cfg.scrapeSuccess || 'Usage refreshed', 'success');
    if (typeof updateDashboard === 'function') updateDashboard();
  } catch (e) {
    showToast((cfg.scrape && cfg.scrape.failure) || cfg.scrapeFailure || 'Failed to refresh usage', 'danger');
  } finally {
    buttons.forEach((btn, idx) => {
      btn.textContent = (cfg.scrape && cfg.scrape.idleTexts && cfg.scrape.idleTexts[idx]) || origTexts[idx] || '⟳ Refresh';
      btn.disabled = false;
    });
    if (label && _usageAutoEntry) label.textContent = 'Auto ✓';
  }
}

async function fetchClaudeUsage() { return fetchProviderUsage('claude'); }
async function fetchOpenAIUsage() { return fetchProviderUsage('openai'); }
async function fetchOpenCodeGoUsage() { return fetchProviderUsage('opencode-go'); }
async function scrapeClaudeUsage() { return scrapeProviderUsage('claude'); }
async function scrapeOpenAIUsage() { return scrapeProviderUsage('openai'); }
async function scrapeOpenCodeGoUsage() { return scrapeProviderUsage('opencode-go'); }

function toggleUsageAutoRefresh(on, init) {
  if (!init) localStorage.setItem('usageAutoRefresh', on ? '1' : '0');
  const track = document.getElementById('usageToggleTrack');
  const thumb = document.getElementById('usageToggleThumb');
  const label = document.getElementById('usageAutoLabel');
  if (on) {
    track.style.background = 'var(--green)';
    thumb.style.left = '18px';
    label.textContent = 'Auto ✓';
    label.style.color = 'var(--green)';
    scrapeCurrentProvider();
    _usageAutoEntry = visibleInterval(scrapeCurrentProvider, 120000);
  } else {
    track.style.background = 'var(--bg-tertiary)';
    thumb.style.left = '2px';
    label.textContent = 'Auto';
    label.style.color = 'var(--text-muted)';
    clearVisibleInterval(_usageAutoEntry);
    _usageAutoEntry = null;
  }
}

let _currentProvider = resolveUsageProvider(localStorage.getItem('usageProvider') || 'claude');
let _currentModel = localStorage.getItem('usageModel') || 'session';

function _getProviderModelOptions() {
  const cfg = PROVIDER_USAGE_CONFIG[_currentProvider] || PROVIDER_USAGE_CONFIG.claude;
  return cfg.models || [];
}

function _populateModelSelect() {
  const sel = document.getElementById('modelSelect');
  if (!sel) return;
  const opts = _getProviderModelOptions();
  sel.innerHTML = '';
  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  });
  if (opts.some(o => o.value === _currentModel)) {
    sel.value = _currentModel;
  } else if (opts.length) {
    _currentModel = opts[0].value;
    sel.value = _currentModel;
  }
}

function _setOverviewBar(pct, label, sourceHint) {
  pct = parseFloat(pct) || 0;
  const pctEl = document.getElementById('ovSessionPct');
  const barEl = document.getElementById('overviewSessionBar');
  const labelEl = document.getElementById('overviewUsageLabel');
  const warnEl = document.getElementById('overviewUsageWarn');
  const sourceEl = document.getElementById('usageSourceHint');
  if (pctEl) pctEl.textContent = pct + '%';
  if (barEl) { barEl.style.width = Math.min(pct, 100) + '%'; barEl.style.background = pct < 50 ? 'var(--green)' : pct < 80 ? '#f59e0b' : '#ef4444'; }
  if (labelEl) labelEl.textContent = String(label || '').replace(/[<>&]/g, '');
  if (warnEl) warnEl.style.display = pct >= 80 ? '' : 'none';
  if (sourceEl) sourceEl.textContent = sourceHint || 'Source: provider/local';
}

function updateOverviewForProvider(provider) {
  const canonical = resolveUsageProvider(provider || _currentProvider);
  const cfg = PROVIDER_USAGE_CONFIG[canonical];
  if (!cfg) return;
  _populateModelSelect();
  const data = cfg.selectOverviewData(_getProviderUsageCache(canonical), _currentModel);
  if (!data) return;
  _setOverviewBar(data.percent, data.label || data.detail || (data.resets ? 'Resets ' + data.resets : ''), cfg.sourceHint);
}

function updateOverviewClaude() { return updateOverviewForProvider('claude'); }
function updateOverviewOpenAI() { return updateOverviewForProvider('openai'); }
function updateOverviewOpenCodeGo() { return updateOverviewForProvider('opencode-go'); }

function switchModel(val) {
  _currentModel = val;
  const cfg = PROVIDER_USAGE_CONFIG[_currentProvider] || PROVIDER_USAGE_CONFIG.claude;
  localStorage.setItem(cfg.modelStorageKey || 'usageModel', val);
  updateOverviewForProvider(_currentProvider);
}

function switchProvider(prov) {
  _currentProvider = resolveUsageProvider(prov);
  localStorage.setItem('usageProvider', _currentProvider);
  Object.values(PROVIDER_USAGE_CONFIG).forEach(cfg => {
    const btn = cfg.button && document.getElementById(cfg.button.id);
    if (btn) {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text-muted)';
    }
  });
  const activeCfg = PROVIDER_USAGE_CONFIG[_currentProvider] || PROVIDER_USAGE_CONFIG.claude;
  const activeBtn = activeCfg.button && document.getElementById(activeCfg.button.id);
  if (activeBtn) {
    activeBtn.style.background = activeCfg.button.activeBg;
    activeBtn.style.color = '#fff';
  }
  _currentModel = localStorage.getItem(activeCfg.modelStorageKey) || ((activeCfg.models && activeCfg.models[0] && activeCfg.models[0].value) || 'session');
  updateOverviewForProvider(_currentProvider);
  if (_usageAutoEntry) {
    clearVisibleInterval(_usageAutoEntry);
    _usageAutoEntry = visibleInterval(scrapeCurrentProvider, 120000);
  }
}

function scrapeCurrentProvider() {
  return scrapeProviderUsage(_currentProvider);
}

Object.keys(PROVIDER_USAGE_CONFIG).forEach(provider => {
  fetchProviderUsage(provider);
  visibleInterval(() => fetchProviderUsage(provider), PROVIDER_USAGE_CONFIG[provider].fetchIntervalMs || 60000);
});
switchProvider(_currentProvider);

function getProgressColor(pct) {
  if (pct < 50) return 'linear-gradient(90deg, #10b981, #34d399)';
  if (pct < 80) return 'linear-gradient(90deg, #f59e0b, #fbbf24)';
  return 'linear-gradient(90deg, #ef4444, #f87171)';
}

function formatMs(ms) {
  if (!ms || ms <= 0) return '--';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

function updateLimits() {
  const limits = usage.estimatedLimits || { opus: 88000, sonnet: 220000 };
  const models = (usage.fiveHour && usage.fiveHour.perModel) || {};

  const opusKey = Object.keys(models).find(k => k.includes('opus')) || '';
  const sonnetKey = Object.keys(models).find(k => k.includes('sonnet')) || '';
  const opusData = opusKey ? models[opusKey] : { output: 0, input: 0, cost: 0, calls: 0 };
  const sonnetData = sonnetKey ? models[sonnetKey] : { output: 0, input: 0, cost: 0, calls: 0 };

  const opusPct = Math.min(Math.round((opusData.output / limits.opus) * 100), 100);
  const sonnetPct = Math.min(Math.round((sonnetData.output / limits.sonnet) * 100), 100);

  const opusEl = document.getElementById('opusUsageLimits');
  opusEl.dataset.format = 'percent';
  animateValue(opusEl, opusPct);

  document.getElementById('opusProgressBar').style.width = opusPct + '%';
  document.getElementById('opusProgressBar').style.background = getProgressColor(opusPct);
  document.getElementById('opusProgressPct').textContent = opusPct + '%';
  document.getElementById('opusTokenLabel').textContent = (opusData.output / 1000).toFixed(1) + 'k / ' + (limits.opus / 1000) + 'k';

  if (opusPct >= 80) {
    document.getElementById('opusProgressBar').style.animation = 'pulse 2s ease-in-out infinite';
  } else {
    document.getElementById('opusProgressBar').style.animation = 'none';
  }

  document.getElementById('sonnetProgressBar').style.width = sonnetPct + '%';
  document.getElementById('sonnetProgressBar').style.background = getProgressColor(sonnetPct);
  document.getElementById('sonnetProgressPct').textContent = sonnetPct + '%';
  document.getElementById('sonnetTokenLabel').textContent = (sonnetData.output / 1000).toFixed(1) + 'k / ' + (limits.sonnet / 1000) + 'k';

  const totalCalls = Object.values(models).reduce((sum, m) => sum + (m.calls || 0), 0);
  animateValue(document.getElementById('totalCalls'), totalCalls);

  const windowCost = Object.values(models).reduce((sum, m) => sum + (m.cost || 0), 0);
  const costEl = document.getElementById('windowCost');
  costEl.dataset.format = 'currency';
  animateValue(costEl, windowCost);

  const burnRate = usage.burnRate || { tokensPerMinute: 0, costPerMinute: 0 };
  document.getElementById('burnRateDisplay').textContent = burnRate.tokensPerMinute > 0 ? burnRate.tokensPerMinute.toFixed(0) : '--';
  document.getElementById('costPerMinValue').textContent = '$' + burnRate.costPerMinute.toFixed(4);

  const predictions = usage.predictions || { timeToLimit: null, safe: true };
  const ttlEl = document.getElementById('timeToLimitValue');
  const ttlSub = document.getElementById('timeToLimitSub');
  if (predictions.safe || !predictions.timeToLimit) {
    ttlEl.textContent = '✅ Safe';
    ttlEl.style.color = 'var(--green)';
    ttlSub.textContent = 'Low usage rate';
  } else {
    ttlEl.textContent = formatMs(predictions.timeToLimit);
    ttlEl.style.color = predictions.timeToLimit < 1800000 ? 'var(--red)' : 'var(--yellow)';
    ttlSub.textContent = 'At current burn rate';
    if (predictions.timeToLimit < 1800000) {
      document.getElementById('timeToLimitCard').style.boxShadow = '0 0 20px rgba(239,68,68,0.3)';
    }
  }

  const resetIn = (usage.fiveHour && usage.fiveHour.windowResetIn) || 0;
  document.getElementById('windowResetValue').textContent = resetIn > 0 ? formatMs(resetIn) : 'No window';
  document.getElementById('windowResetSub').textContent = (usage.fiveHour && usage.fiveHour.windowStart) ? 'Since ' + new Date(usage.fiveHour.windowStart).toLocaleTimeString('en', {hour:'2-digit',minute:'2-digit'}) : '';

  const windowBreakdownEl = document.getElementById('windowBreakdown');
  const modelEntries = Object.entries(models).sort(function(a, b) { return b[1].output - a[1].output; });
  if (!modelEntries.length) {
    setEmptyState(windowBreakdownEl, 'No data');
  } else {
    windowBreakdownEl.innerHTML = '';
    modelEntries.forEach(function(entry) {
      var model = entry[0], data = entry[1];
      var shortModel = model.split('/').pop();
      var calc = (usage.fiveHour && usage.fiveHour.perModelCost && usage.fiveHour.perModelCost[model]) || {};
      var inputCost = calc.inputCost || 0;
      var outputCost = calc.outputCost || 0;
      var cacheReadCost = calc.cacheReadCost || 0;
      var cacheWriteCost = calc.cacheWriteCost || 0;
      var totalModelCost = calc.totalCost || (inputCost + outputCost + cacheReadCost + cacheWriteCost);
      var cacheCost = cacheReadCost + cacheWriteCost;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border);';
      wrap.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:6px;">' +
        '<span class="mono" style="font-size:14px;font-weight:600;">' + escapeHtml(shortModel) + '</span>' +
        '<span class="mono" style="font-size:14px;font-weight:600;color:var(--accent);">$' + totalModelCost.toFixed(4) + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:16px;font-size:11px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;">' +
        '<span>' + data.calls + ' calls</span>' +
        '<span>' + (data.input/1000).toFixed(0) + 'k in ($' + inputCost.toFixed(4) + ')</span>' +
        '<span>' + (data.output/1000).toFixed(0) + 'k out ($' + outputCost.toFixed(4) + ')</span>' +
        (cacheCost > 0 ? '<span>cache ($' + cacheCost.toFixed(4) + ')</span>' : '') +
        '</div>';
      windowBreakdownEl.appendChild(wrap);
    });
  }

  const recentCalls = (usage.fiveHour && usage.fiveHour.recentCalls) || [];
  const recentCallsEl = document.getElementById('recentCalls');
  if (!recentCalls.length) {
    setEmptyState(recentCallsEl, 'No recent calls');
  } else {
    recentCallsEl.innerHTML = '';
    recentCalls.slice(0, 15).forEach(call => {
      const shortModel = call.model.split('/').pop();
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;';
      row.innerHTML = `<div><div class="mono" style="font-weight:600;">${escapeHtml(shortModel)}</div><div style="color:var(--text-muted);font-size:11px;">${escapeHtml(call.ago)}</div></div><div style="text-align:right;"><div class="mono">${call.output.toLocaleString()} out</div><div style="color:var(--text-muted);font-size:11px;">$${call.cost.toFixed(4)}</div></div>`;
      recentCallsEl.appendChild(row);
    });
  }
  
  // Model usage donut chart
  try {
    const donutEl = document.getElementById('modelUsageDonut');
    if (donutEl && costs.perModel) {
      const modelData = Object.entries(costs.perModel).map(([m, cost]) => {
        const shortModel = m.split('/').pop();
        let color = 'var(--text-muted)';
        if (shortModel.includes('opus')) color = '#a855f7';  // Purple
        else if (shortModel.includes('sonnet')) color = '#3b82f6';  // Blue
        else if (shortModel.includes('gemini')) color = '#10b981';  // Green
        else if (shortModel.includes('glm')) color = '#f59e0b';  // Amber/Orange
        else if (shortModel.includes('kimi') || shortModel.includes('k2p5')) color = '#ef4444';  // Red
        else if (shortModel.includes('minimax') || shortModel.includes('m2.5') || shortModel.includes('opencode') || shortModel.includes('mimo')) color = '#8b5cf6';  // Violet
        return { model: shortModel, cost, color };
      }).filter(d => d.cost > 0).sort((a, b) => b.cost - a.cost);
      
      if (modelData.length === 0) {
        setEmptyState(donutEl, 'No data');
      } else {
        const total = modelData.reduce((s, d) => s + d.cost, 0);
        const size = 200, r = 70, strokeW = 40;
        donutEl.innerHTML = '';

        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:32px;align-items:center;';
        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

        const bgCircle = document.createElementNS(svgNs, 'circle');
        bgCircle.setAttribute('cx', String(size / 2));
        bgCircle.setAttribute('cy', String(size / 2));
        bgCircle.setAttribute('r', String(r));
        bgCircle.setAttribute('fill', 'var(--bg-primary)');
        svg.appendChild(bgCircle);

        let currentAngle = 0;
        modelData.forEach(d => {
          const pct = d.cost / total;
          let shape;
          if (pct >= 0.999) {
            shape = document.createElementNS(svgNs, 'circle');
            shape.setAttribute('cx', String(size / 2));
            shape.setAttribute('cy', String(size / 2));
            shape.setAttribute('r', String(r));
            shape.setAttribute('fill', d.color);
          } else {
            const angle = pct * 360;
            const largeArc = angle > 180 ? 1 : 0;
            const startX = size / 2 + r * Math.cos((currentAngle - 90) * Math.PI / 180);
            const startY = size / 2 + r * Math.sin((currentAngle - 90) * Math.PI / 180);
            const endX = size / 2 + r * Math.cos((currentAngle + angle - 90) * Math.PI / 180);
            const endY = size / 2 + r * Math.sin((currentAngle + angle - 90) * Math.PI / 180);
            currentAngle += angle;
            shape = document.createElementNS(svgNs, 'path');
            shape.setAttribute('d', `M ${size/2},${size/2} L ${startX},${startY} A ${r},${r} 0 ${largeArc},1 ${endX},${endY} Z`);
            shape.setAttribute('fill', d.color);
          }
          shape.setAttribute('opacity', '0.8');
          const title = document.createElementNS(svgNs, 'title');
          title.textContent = `${d.model}: ${pct >= 0.999 ? '100' : (pct * 100).toFixed(1)}%`;
          shape.appendChild(title);
          svg.appendChild(shape);
        });

        const innerCircle = document.createElementNS(svgNs, 'circle');
        innerCircle.setAttribute('cx', String(size / 2));
        innerCircle.setAttribute('cy', String(size / 2));
        innerCircle.setAttribute('r', String(r - strokeW / 2));
        innerCircle.setAttribute('fill', 'var(--bg-card)');
        svg.appendChild(innerCircle);
        wrap.appendChild(svg);

        const legend = document.createElement('div');
        legend.style.flex = '1';
        modelData.forEach(d => {
          const pct = ((d.cost / total) * 100).toFixed(1);
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
          row.innerHTML = `<div style="width:16px;height:16px;background:${d.color};border-radius:3px;opacity:0.8;"></div><span style="font-size:13px;flex:1;">${escapeHtml(d.model)}</span><span style="font-size:13px;font-weight:600;font-family:'JetBrains Mono',monospace;">${pct}%</span>`;
          legend.appendChild(row);
        });
        wrap.appendChild(legend);
        donutEl.appendChild(wrap);
      }
    }
  } catch (e) {
    console.error('Donut chart error:', e);
  }
}

function updateCosts() {
  const todayEl = document.getElementById('costToday');
  todayEl.dataset.format = 'currency';
  animateValue(todayEl, costs.today || 0);
  
  const weekEl = document.getElementById('costWeek');
  weekEl.dataset.format = 'currency';
  animateValue(weekEl, costs.week || 0);
  
  const totalEl = document.getElementById('costTotal');
  totalEl.dataset.format = 'currency';
  animateValue(totalEl, costs.total || 0);
  
  const perDay = costs.perDay || {};
  const dayCount = Object.keys(perDay).length || 1;
  const avgEl = document.getElementById('costAvg');
  avgEl.dataset.format = 'currency';
  animateValue(avgEl, (costs.total || 0) / dayCount);
  
  const days = Object.keys(perDay).sort().slice(-14);
  const maxSpend = Math.max(...days.map(d => perDay[d] || 0), 0.01);
  
  // Render SVG line chart
  try {
    const chartEl = document.getElementById('costTrendChart');
    if (chartEl && days.length > 0) {
      const w = 800, h = 220;
      const pad = window.innerWidth <= 768 ? 40 : 70;
      const vals = days.map(d => perDay[d] || 0);
      const minVal = 0;
      const maxVal = Math.max(...vals, 0.01);
      const range = maxVal - minVal || 1;
      const count = vals.length;
      // Fix division by zero for single point
      const xStep = count > 1 ? (w - pad * 2) / (count - 1) : 0;
      
      const points = vals.map((v, i) => {
        const x = count > 1 ? pad + i * xStep : w / 2;
        const y = h - pad - ((v - minVal) / range) * (h - pad * 2);
        return `${x},${y}`;
      }).join(' ');
      
      // Color gradient based on spend level (green -> yellow -> red)
      const getDotColor = (v) => {
        const ratio = v / maxVal;
        if (ratio < 0.3) return '#10b981'; // green
        if (ratio < 0.6) return '#f59e0b'; // yellow  
        return '#ef4444'; // red
      };
      
      const dots = vals.map((v, i) => {
        const x = count > 1 ? pad + i * xStep : w / 2;
        const y = h - pad - ((v - minVal) / range) * (h - pad * 2);
        const date = new Date(days[i]);
        const label = date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
        const color = getDotColor(v);
        return `<circle cx="${x}" cy="${y}" r="6" fill="${color}" stroke="var(--bg-card)" stroke-width="2" style="cursor:pointer;filter:drop-shadow(0 0 4px ${color}40);"><title>${label}: $${v.toFixed(2)}</title></circle>`;
      }).join('');
      
      // Show all labels for small datasets, sparse for larger
      const labelInterval = count <= 7 ? 1 : Math.ceil(count / 7);
      const xLabels = days.map((d, i) => {
        if (i % labelInterval !== 0 && i !== count - 1) return '';
        const x = count > 1 ? pad + i * xStep : w / 2;
        const date = new Date(d);
        const label = date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
        return `<text x="${x}" y="${h - 15}" fill="var(--text-secondary)" font-size="11" text-anchor="middle" font-family="JetBrains Mono, monospace">${label}</text>`;
      }).join('');
      
      const yTicks = [0, maxVal / 2, maxVal].map((val, i) => {
        const y = h - pad - (i / 2) * (h - pad * 2);
        const formattedVal = val >= 1 ? '$' + val.toFixed(2) : val >= 0.1 ? '$' + val.toFixed(2) : '$' + val.toFixed(3);
        return `<text x="${pad - 10}" y="${y + 4}" fill="var(--text-secondary)" font-size="11" text-anchor="end" font-family="JetBrains Mono, monospace">${formattedVal}</text>
          <line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="4,4" opacity="0.5"/>`;
      }).join('');
      
      // Only draw line if more than 1 point
      const lineSvg = count > 1 ? `<polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>` : '';
      
      chartEl.innerHTML = '';
      const svgNs = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNs, 'svg');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', String(h));
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('style', 'max-width:100%;height:auto;');
      svg.innerHTML = `${yTicks}${lineSvg}${dots}${xLabels}`;
      chartEl.appendChild(svg);
    }
  } catch (e) {
    console.error('Cost chart error:', e);
  }
  
  const costByModelEl = document.getElementById('costByModel');
  const perModelEntries = Object.entries(costs.perModel || {}).sort((a, b) => b[1] - a[1]);
  if (!perModelEntries.length) {
    setEmptyState(costByModelEl, 'No data');
  } else {
    costByModelEl.innerHTML = '';
    perModelEntries.forEach(([model, cost]) => {
      const shortModel = model.split('/').pop();
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border);';
      row.innerHTML = `<span class="mono">${escapeHtml(shortModel)}</span><span class="mono" style="font-weight:700;">$${cost.toFixed(2)}</span>`;
      costByModelEl.appendChild(row);
    });
  }

  const topSessionsEl = document.getElementById('topSessions');
  const perSessionEntries = Object.entries(costs.perSession || {})
    .map(([sid, v]) => [sid, typeof v === 'object' ? v : { cost: v, label: sid.substring(0, 12) }])
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 10);
  if (!perSessionEntries.length) {
    setEmptyState(topSessionsEl, 'No data');
  } else {
    topSessionsEl.innerHTML = '';
    perSessionEntries.forEach(([, v]) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border);';
      row.innerHTML = `<span>${escapeHtml(v.label)}</span><span class="mono" style="font-weight:700;">$${v.cost.toFixed(2)}</span>`;
      topSessionsEl.appendChild(row);
    });
  }
}

function updateStatusBar() {
  if (systemStats.uptime) {
    const uptime = systemStats.uptime;
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const uptimeStr = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h` : `${Math.floor(uptime / 60)}m`;
    document.getElementById('statusUptime').textContent = uptimeStr;
  }
  
  const mainSession = sessions.find(s => s.key.includes('main:main'));
  if (mainSession) {
    document.getElementById('statusModel').textContent = mainSession.model.split('/').pop();
  }
  
  if (sessions.length > 0) {
    const latest = sessions.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b);
    const age = Date.now() - latest.updatedAt;
    const ago = age < 60000 ? 'just now' :
                age < 3600000 ? Math.round(age / 60000) + 'm ago' :
                age < 86400000 ? Math.round(age / 3600000) + 'h ago' :
                Math.round(age / 86400000) + 'd ago';
    document.getElementById('statusLastActivity').textContent = ago;
  }
}

const _feedSessions = new Set();

function getSessionColor(name) {
  const colors = ['#6366f1','#ec4899','#10b981','#f59e0b','#8b5cf6','#06b6d4','#ef4444','#84cc16','#f97316','#14b8a6'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function applyFeedFilter() {
  const sf = document.getElementById('feedSessionFilter').value;
  const rf = document.getElementById('feedRoleFilter').value;
  document.querySelectorAll('.feed-item').forEach(el => {
    const matchSession = sf === 'all' || el.dataset.session === sf;
    const matchRole = rf === 'all' || el.dataset.role === rf;
    let matchSearch = true;
    if (feedSearchTerm) {
      const content = el.querySelector('.feed-content');
      if (content) {
        const text = content.getAttribute('data-original') || content.textContent;
        if (!content.getAttribute('data-original')) {
          content.setAttribute('data-original', text);
        }
        matchSearch = text.toLowerCase().includes(feedSearchTerm);
        if (matchSearch && feedSearchTerm) {
          content.innerHTML = highlightText(text, feedSearchTerm);
        } else {
          content.textContent = text;
        }
      }
    }
    el.style.display = (matchSession && matchRole && matchSearch) ? '' : 'none';
  });
}

function connectLiveFeed() {
  if (liveEventSource) return;
  
  // Populate session filter from known sessions
  const sel = document.getElementById('feedSessionFilter');
  if (sel && sessions.length) {
    const current = sel.value;
    const opts = ['<option value="all">All Sessions</option>'];
    const seen = new Set();
    sessions.forEach(s => {
      const label = s.label || s.key.split(':').slice(2).join(':') || s.key;
      if (!seen.has(label)) { seen.add(label); opts.push(`<option value="${label}">${label}</option>`); }
    });
    sel.innerHTML = opts.join('');
    sel.value = current || 'all';
  }

  liveEventSource = new EventSource(API_BASE + '/api/live');
  
  liveEventSource.onmessage = (event) => {
    if (feedPaused) return;
    
    try {
      const data = JSON.parse(event.data);
      if (data.status === 'connected') {
        const feed = document.getElementById('feedStream');
        if (feed.querySelector('[data-placeholder]')) feed.innerHTML = '';
        return;
      }
      
      const feed = document.getElementById('feedStream');
      const ph = feed.querySelector('[data-placeholder]');
      if (ph) ph.remove();
      const roleClass = data.role || 'assistant';
      const roleLabel = (data.role || 'assistant').toUpperCase();
      const sessionName = data.session || 'unknown';
      const sessionColor = getSessionColor(sessionName);
      
      // Add to session filter if new
      if (!_feedSessions.has(sessionName)) {
        _feedSessions.add(sessionName);
        const sel = document.getElementById('feedSessionFilter');
        if (sel && ![...sel.options].find(o => o.value === sessionName)) {
          sel.add(new Option(sessionName, sessionName));
        }
      }
      
      const sfEl = document.getElementById('feedSessionFilter');
      const rfEl = document.getElementById('feedRoleFilter');
      const sf = sfEl ? sfEl.value : 'all';
      const rf = rfEl ? rfEl.value : 'all';
      const visible = (sf === 'all' || sf === sessionName) && (rf === 'all' || rf === roleClass);

      const time = new Date(data.timestamp).toLocaleTimeString('en', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
      
      const item = document.createElement('div');
      item.className = `feed-item role-${roleClass}`;
      item.dataset.session = sessionName;
      item.dataset.role = roleClass;
      if (!visible) item.style.display = 'none';
      item.innerHTML = `
        <div class="feed-header-line">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="background:${sessionColor};color:#fff;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:600;letter-spacing:0.02em;">${escapeHtml(sessionName)}</span>
            <span class="feed-role ${roleClass}">${escapeHtml(roleLabel)}</span>
          </div>
          <span class="feed-time">${escapeHtml(time)}</span>
        </div>
        <div class="feed-content">${escapeHtml(data.content || '')}</div>
      `;
      
      feed.insertBefore(item, feed.firstChild);
      
      const items = feed.querySelectorAll('.feed-item');
      if (items.length > 200) {
        items[items.length - 1].remove();
      }
      
      // Check for sub-agent completion notification
      if (data.session && data.session.toLowerCase().includes('sub') && data.role === 'assistant' && data.content && data.content.toLowerCase().includes('complet')) {
        sendNotification('Sub-agent Complete', `${data.session} finished a task`);
      }
    } catch (e) {
      console.error('Feed parse error:', e);
    }
  };
  
  liveEventSource.onerror = () => {
    console.error('Live feed disconnected');
    liveEventSource.close();
    liveEventSource = null;
    setTimeout(connectLiveFeed, 5000);
  };
}

document.getElementById('pauseBtn').addEventListener('click', function() {
  if (!liveEventSource) {
    this.textContent = '⏳ Loading...';
    this.disabled = true;
    const feed = document.getElementById('feedStream');
    feed.innerHTML = '<div data-placeholder style="text-align:center;padding:24px;color:var(--text-muted);">Connecting to live stream...</div>';
    feedPaused = false;
    connectLiveFeed();
    setTimeout(() => { this.textContent = '⏸ Pause'; this.disabled = false; }, 1500);
  } else {
    feedPaused = !feedPaused;
    if (feedPaused) {
      liveEventSource.close();
      liveEventSource = null;
      this.textContent = '▶ Start';
    } else {
      this.textContent = '⏳ Loading...';
      this.disabled = true;
      connectLiveFeed();
      setTimeout(() => { this.textContent = '⏸ Pause'; this.disabled = false; }, 1500);
    }
  }
});

let healthHistory = [];

async function fetchHealthHistory() {
  try {
    const res = await authFetch(API_BASE + '/api/health-history');
    healthHistory = await res.json();
    renderHealthSparklines();
  } catch {}
}

function renderHealthSparklines() {
  if (!healthHistory || healthHistory.length < 2) return;
  
  const renderSparkline = (containerId, dataKey, color) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    const w = 120, h = 30;
    const vals = healthHistory.map(p => p[dataKey] || 0);
    const min = Math.max(Math.min(...vals) - 5, 0);
    const max = Math.min(Math.max(...vals) + 5, 100);
    const range = max - min || 1;
    const points = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    }).join(' ');
    el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  };
  
  renderSparkline('cpuSparkline', 'cpu', 'var(--green)');
  renderSparkline('ramSparkline', 'ram', 'var(--blue)');
  renderSparkline('tempSparkline', 'temp', 'var(--yellow)');
  renderSparkline('diskSparkline', 'disk', 'var(--purple)');
}

async function fetchNewData() {
  try {
    const [cronsRes, gitRes, svcRes, memRes, tokRes, rtRes] = await Promise.all([
      authFetch(API_BASE + '/api/crons'),
      authFetch(API_BASE + '/api/git'),
      authFetch(API_BASE + '/api/services'),
      authFetch(API_BASE + '/api/memory'),
      authFetch(API_BASE + '/api/tokens-today'),
      authFetch(API_BASE + '/api/response-time')
    ]);
    const crons = await cronsRes.json();
    const git = await gitRes.json();
    const services = await svcRes.json();
    const memFiles = await memRes.json();
    const tokens = await tokRes.json();
    const rt = await rtRes.json();

    const servicesStatusEl = document.getElementById('servicesStatus');
    if (!services.length) {
      setEmptyState(servicesStatusEl, 'No services');
    } else {
      servicesStatusEl.innerHTML = '';
      services.forEach((s, i) => {
        const isLast = i === services.length - 1;
        const status = s.active === null ? 'N/A' : (s.active ? 'Running' : 'Stopped');
        const dotColor = s.active === null ? 'var(--text-muted)' : (s.active ? 'var(--green)' : 'var(--red)');
        const textColor = s.active === null ? 'var(--text-muted)' : (s.active ? 'var(--green)' : 'var(--red)');
        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:${isLast ? 'none' : '1px solid var(--border)'};`;
        row.innerHTML = `<span style="width:10px;height:10px;border-radius:50%;background:${dotColor};flex-shrink:0;"></span><span style="font-weight:600;font-size:14px;">${escapeHtml(s.name)}</span><span style="margin-left:auto;font-size:12px;color:${textColor};">${escapeHtml(status)}</span>`;
        servicesStatusEl.appendChild(row);
      });
    }

    const now = Date.now();
    const cronJobsEl = document.getElementById('cronJobs');
    if (!crons.length) {
      setEmptyState(cronJobsEl, 'No cron jobs');
    } else {
      cronJobsEl.innerHTML = '';
      crons.forEach(c => {
        const statusIcon = c.lastStatus === 'ok' ? '✅' : c.lastStatus === 'unknown' ? '⚪' : '❌';
        const nextAgo = c.nextRunAt > now ? formatTimeAgo(c.nextRunAt - now, true) : '--';
        const toggleColor = c.enabled ? 'var(--green)' : 'var(--text-muted)';
        const toggleBg = c.enabled ? 'rgba(16,185,129,0.2)' : 'var(--bg-tertiary)';
        const row = document.createElement('div');
        row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--border);';
        row.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><span style="font-weight:600;font-size:13px;flex:1;">${statusIcon} ${escapeHtml(c.name)}</span></div><span class="mono" style="font-size:11px;color:var(--text-muted);">${escapeHtml(c.schedule)}</span><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Next: ${escapeHtml(c.enabled ? nextAgo : 'disabled')} · Last: ${c.lastDuration ? (c.lastDuration / 1000).toFixed(0) + 's' : '--'}</div>`;
        const header = row.firstElementChild;
        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = c.enabled ? 'ON' : 'OFF';
        toggleBtn.style.cssText = `padding:2px 8px;background:${toggleBg};color:${toggleColor};border:1px solid var(--border);border-radius:4px;font-size:10px;font-weight:600;cursor:pointer;margin-right:4px;`;
        toggleBtn.onclick = () => window.toggleCronJob(c.id);
        const runBtn = document.createElement('button');
        runBtn.textContent = '▶';
        runBtn.style.cssText = 'padding:2px 8px;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;font-size:10px;cursor:pointer;';
        runBtn.onclick = () => window.runCronJob(c.id);
        header.appendChild(toggleBtn);
        header.appendChild(runBtn);
        cronJobsEl.appendChild(row);
      });
    }

// Cron management
window.toggleCronJob = async function(id) {
  try {
    const res = await authFetch(API_BASE + `/api/cron/${id}/toggle`, { method: 'POST' });
    if (!res.ok) {
      const body = await res.text();
      showToast('Cron toggle failed: ' + res.status + ' ' + body, 'error');
      return;
    }
    await fetchNewData();
  } catch (e) {
    showToast('Cron toggle error: ' + e.message, 'error');
  }
};

window.runCronJob = async function(id) {
  showToast('Triggering cron job...', 'info');
  try {
    const res = await authFetch(API_BASE + `/api/cron/${id}/run`, { method: 'POST' });
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      const detail = payload?.error || payload?.detail || `${res.status}`;
      showToast('Cron run failed: ' + detail, 'error');
      return;
    }

    if (payload?.success && payload?.reason === 'already-running') {
      showToast('Cron job is already running ⏳', 'info');
      return;
    }

    showToast('Cron job triggered ✅', 'success');
    sendNotification('Cron Job Started', `Running cron job ${id.substring(0, 8)}...`);
    setTimeout(fetchNewData, 3000);
  } catch (e) {
    showToast('Cron run error: ' + e.message, 'error');
  }
};

    const gitActivityEl = document.getElementById('gitActivity');
    if (!git.length) {
      setEmptyState(gitActivityEl, 'No recent commits');
    } else {
      gitActivityEl.innerHTML = '';
      git.forEach(c => {
        const age = now - c.timestamp;
        const ago = age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;';
        row.innerHTML = `<span class="mono" style="color:var(--accent);flex-shrink:0;">${escapeHtml(c.hash)}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.message)}</span><span style="flex-shrink:0;color:var(--text-muted);">${escapeHtml(c.repo)}</span><span style="flex-shrink:0;color:var(--text-muted);">${escapeHtml(ago)}</span>`;
        gitActivityEl.appendChild(row);
      });
    }

    const memLimit = 5;
    const memoryFilesEl = document.getElementById('memoryFiles');
    if (!memFiles.length) {
      setEmptyState(memoryFilesEl, 'No files');
    } else {
      memoryFilesEl.innerHTML = '';
      memFiles.forEach((f, idx) => {
        const age = now - f.modified;
        const ago = age < 60000 ? 'just now' : age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
        const row = document.createElement('div');
        row.className = 'mem-file-item';
        row.style.cssText = `display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border);${idx >= memLimit ? 'display:none;' : ''}`;
        row.innerHTML = `<span class="mono" style="font-size:13px;">📄 ${escapeHtml(f.name)}</span><span style="font-size:12px;color:var(--text-muted);">${escapeHtml(ago)}</span>`;
        memoryFilesEl.appendChild(row);
      });
      if (memFiles.length > memLimit) {
        const more = document.createElement('div');
        more.id = 'memShowMore';
        more.style.cssText = 'text-align:center;padding:10px 0;cursor:pointer;color:var(--accent);font-size:13px;font-weight:500;';
        more.textContent = `Show all (${memFiles.length} files) ↓`;
        more.onclick = function() {
          document.querySelectorAll('.mem-file-item').forEach(e => e.style.display = 'flex');
          this.style.display = 'none';
        };
        memoryFilesEl.appendChild(more);
      }
    }

    const inK = (tokens.totalInput / 1000).toFixed(0) + 'k';
    const outK = (tokens.totalOutput / 1000).toFixed(0) + 'k';
    document.getElementById('todayTokensOut').textContent = inK + ' in / ' + outK + ' out';

    const tokenBreakdownEl = document.getElementById('tokenBreakdown');
    const perModelEntries = Object.entries(tokens.perModel || {});
    if (!perModelEntries.length) {
      setEmptyState(tokenBreakdownEl, 'No token data');
    } else {
      tokenBreakdownEl.innerHTML = '';
      const maxTok = Math.max(...Object.values(tokens.perModel).map(m => m.input + m.output), 1);
      perModelEntries
        .sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output))
        .forEach(([model, d]) => {
          const total = d.input + d.output;
          const pct = (total / maxTok) * 100;
          const wrap = document.createElement('div');
          wrap.style.marginBottom = '12px';
          wrap.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;"><span class="mono">${escapeHtml(model)}</span><span class="mono" style="color:var(--text-muted);">${(d.input/1000).toFixed(0)}k in / ${(d.output/1000).toFixed(0)}k out</span></div><div style="height:6px;background:var(--bg-tertiary);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),var(--purple));border-radius:3px;"></div></div>`;
          tokenBreakdownEl.appendChild(wrap);
        });
    }

    const modelColors = {'claude-opus-4-6':'var(--accent)','claude-opus-4-5':'var(--purple)','claude-sonnet-4-5':'var(--cyan)','gemini-3-pro-preview':'var(--yellow)','gemini-2.5-flash':'var(--green)'};
    const uniqueSessions = [];
    const seenLabels = new Set();
    sessions.sort((a,b) => b.updatedAt - a.updatedAt).forEach(s => {
      if (!seenLabels.has(s.label)) { seenLabels.add(s.label); uniqueSessions.push(s); }
    });
    const sessionModelsEl = document.getElementById('sessionModels');
    if (!uniqueSessions.length) {
      setEmptyState(sessionModelsEl, 'No sessions');
    } else {
      sessionModelsEl.innerHTML = '';
      uniqueSessions.forEach(s => {
        const shortModel = s.model.split('/').pop();
        const color = modelColors[shortModel] || 'var(--text-muted)';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);';
        row.innerHTML = `<span style="font-weight:500;font-size:13px;">${escapeHtml(s.label)}</span><span class="mono" style="font-size:11px;color:${color};background:${color}18;padding:2px 8px;border-radius:4px;">${escapeHtml(shortModel)}</span>`;
        sessionModelsEl.appendChild(row);
      });
    }

    const rtVal = rt.avgSeconds;
    document.getElementById('avgResponseTime').textContent = rtVal > 0 ? rtVal + 's' : '--';
  } catch (e) { console.error('New data fetch error:', e); }
}

// Memory page
let memoryFiles = [];
async function fetchMemoryFiles() {
  try {
    const res = await authFetch(API_BASE + '/api/memory-files');
    memoryFiles = await res.json();
    renderMemoryFilesList();
  } catch {}
}

function renderMemoryFilesList() {
  const el = document.getElementById('memoryFilesList');
  if (!el) return;
  const now = Date.now();
  if (!memoryFiles.length) {
    setEmptyState(el, 'No memory files');
    return;
  }
  el.innerHTML = '';
  memoryFiles.forEach(f => {
    const age = now - f.modified;
    const ago = age < 60000 ? 'just now' : age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
    const sizeKb = (f.size / 1024).toFixed(1);
    const icon = f.name.includes('MEMORY') ? '🧠' : f.name.includes('HEARTBEAT') ? '💓' : '📄';
    const item = document.createElement('div');
    item.style.cssText = 'padding:12px;border-bottom:1px solid var(--border);cursor:pointer;transition:all 0.2s;';
    item.onmouseover = () => { item.style.background = 'var(--bg-tertiary)'; };
    item.onmouseout = () => { item.style.background = 'transparent'; };
    item.onclick = () => window.loadMemoryFile(encodeURIComponent(f.name));
    item.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><span style="font-size:18px;">${icon}</span><span style="font-weight:600;font-size:13px;flex:1;">${escapeHtml(f.name)}</span></div><div style="font-size:11px;color:var(--text-muted);">${sizeKb} KB · ${escapeHtml(ago)}</div>`;
    el.appendChild(item);
  });
}

window.loadMemoryFile = async function(name) {
  try {
    name = decodeURIComponent(name);
    const titleEl = document.getElementById('memoryFileTitle');
    const contentEl = document.getElementById('memoryFileContent');
    titleEl.textContent = name;
    contentEl.innerHTML = '<div style="color:var(--text-muted);">Loading...</div>';
    const res = await authFetch(API_BASE + '/api/memory-file?path=' + encodeURIComponent(name));
    const content = await res.text();
    let html = escapeHtml(content)
      .replace(/^### (.+)$/gm, '<div style="font-size:16px;font-weight:700;color:var(--accent);margin:16px 0 8px;">$1</div>')
      .replace(/^## (.+)$/gm, '<div style="font-size:18px;font-weight:700;color:var(--accent);margin:20px 0 12px;">$1</div>')
      .replace(/^# (.+)$/gm, '<div style="font-size:20px;font-weight:700;color:var(--accent);margin:24px 0 16px;">$1</div>')
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-primary);font-weight:700;">$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="background:var(--bg-tertiary);padding:2px 6px;border-radius:4px;font-size:11px;">$1</code>');
    contentEl.innerHTML = html;
  } catch (e) {
    document.getElementById('memoryFileContent').innerHTML = '<div style="color:var(--red);">Failed to load file</div>';
  }
};

// Files page
let keyFiles = [];
let currentKeyFile = null;
let keyFileEditing = false;
let _currentKeyFileRaw = '';

window.fetchKeyFiles = async function fetchKeyFiles() {
  try {
    const res = await authFetch(API_BASE + '/api/key-files');
    keyFiles = await res.json();
    renderKeyFilesList();
  } catch {}
}

function renderKeyFilesList() {
  const el = document.getElementById('keyFilesList');
  if (!el) return;
  const now = Date.now();
  if (!keyFiles.length) {
    setEmptyState(el, 'No files found');
    return;
  }
  el.innerHTML = '';
  keyFiles.forEach(f => {
    const age = now - f.modified;
    const ago = age < 60000 ? 'just now' : age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
    const sizeKb = (f.size / 1024).toFixed(1);
    const icon = f.name.startsWith('skills/') ? '🎯' : f.name.endsWith('.service') ? '⚙️' : f.name.endsWith('.json') ? '🔧' : '📄';
    const isSelected = f.name === currentKeyFile;
    const item = document.createElement('div');
    item.style.cssText = `padding:12px;border-bottom:1px solid var(--border);cursor:pointer;transition:all 0.2s;${isSelected ? 'background:var(--bg-tertiary);' : ''}`;
    item.onmouseover = () => { item.style.background = 'var(--bg-tertiary)'; };
    item.onmouseout = () => { item.style.background = isSelected ? 'var(--bg-tertiary)' : 'transparent'; };
    item.onclick = () => window.loadKeyFile(encodeURIComponent(f.name));
    item.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><span style="font-size:18px;">${icon}</span><span style="font-weight:600;font-size:13px;flex:1;">${escapeHtml(f.name)}</span></div><div style="font-size:11px;color:var(--text-muted);">${sizeKb} KB · ${escapeHtml(ago)}</div>`;
    el.appendChild(item);
  });
}

window.loadKeyFile = async function(name) {
  name = decodeURIComponent(name);
  currentKeyFile = name;
  keyFileEditing = false;
  const titleEl = document.getElementById('keyFileTitle');
  const contentEl = document.getElementById('keyFileContent');
  const editorEl = document.getElementById('keyFileEditor');
  const editBtn = document.getElementById('keyFileEditBtn');
  const saveBtn = document.getElementById('keyFileSaveBtn');
  const cancelBtn = document.getElementById('keyFileCancelBtn');

  titleEl.textContent = name;
  contentEl.innerHTML = '<div style="color:var(--text-muted);">Loading...</div>';
  contentEl.style.display = 'block';
  editorEl.style.display = 'none';
  editBtn.style.display = 'inline-block';
  saveBtn.style.display = 'none';
  cancelBtn.style.display = 'none';

  renderKeyFilesList();

  try {
    const res = await authFetch(API_BASE + '/api/key-file?path=' + encodeURIComponent(name));
    if (!res.ok) { contentEl.innerHTML = '<div style="color:var(--red);">Failed to load: ' + res.status + '</div>'; return; }
    const content = await res.text();
    _currentKeyFileRaw = content;

    if (name.endsWith('.md')) {
      let html = escapeHtml(content)
        .replace(/^### (.+)$/gm, '<div style="font-size:16px;font-weight:700;color:var(--accent);margin:16px 0 8px;">$1</div>')
        .replace(/^## (.+)$/gm, '<div style="font-size:18px;font-weight:700;color:var(--accent);margin:20px 0 12px;">$1</div>')
        .replace(/^# (.+)$/gm, '<div style="font-size:20px;font-weight:700;color:var(--accent);margin:24px 0 16px;">$1</div>')
        .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-primary);font-weight:700;">$1</strong>')
        .replace(/`([^`]+)`/g, '<code style="background:var(--bg-tertiary);padding:2px 6px;border-radius:4px;font-size:11px;">$1</code>');
      contentEl.innerHTML = html;
    } else {
      contentEl.innerHTML = '<pre style="white-space:pre-wrap;word-wrap:break-word;">' + escapeHtml(content) + '</pre>';
    }
  } catch (e) {
    contentEl.innerHTML = '<div style="color:var(--red);">Failed to load file</div>';
  }
};

window.editKeyFile = function() {
  if (!currentKeyFile) return;
  keyFileEditing = true;
  const contentEl = document.getElementById('keyFileContent');
  const editorEl = document.getElementById('keyFileEditor');
  const editBtn = document.getElementById('keyFileEditBtn');
  const saveBtn = document.getElementById('keyFileSaveBtn');
  const cancelBtn = document.getElementById('keyFileCancelBtn');

  editorEl.value = _currentKeyFileRaw;
  contentEl.style.display = 'none';
  editorEl.style.display = 'block';
  editBtn.style.display = 'none';
  saveBtn.style.display = 'inline-block';
  cancelBtn.style.display = 'inline-block';
  editorEl.focus();
};

window.cancelEditKeyFile = function() {
  keyFileEditing = false;
  const contentEl = document.getElementById('keyFileContent');
  const editorEl = document.getElementById('keyFileEditor');
  const editBtn = document.getElementById('keyFileEditBtn');
  const saveBtn = document.getElementById('keyFileSaveBtn');
  const cancelBtn = document.getElementById('keyFileCancelBtn');

  contentEl.style.display = 'block';
  editorEl.style.display = 'none';
  editBtn.style.display = 'inline-block';
  saveBtn.style.display = 'none';
  cancelBtn.style.display = 'none';
};

window.saveKeyFile = async function() {
  if (!currentKeyFile) return;
  const editorEl = document.getElementById('keyFileEditor');
  const saveBtn = document.getElementById('keyFileSaveBtn');
  const content = editorEl.value;

  saveBtn.textContent = 'Saving…';
  saveBtn.disabled = true;

  try {
    const res = await authFetch(API_BASE + '/api/key-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentKeyFile, content })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');

    saveBtn.textContent = 'Saved!';
    setTimeout(() => {
      saveBtn.textContent = 'Save';
      saveBtn.disabled = false;
    }, 1200);
    window.cancelEditKeyFile();
    await window.loadKeyFile(currentKeyFile);
  } catch (e) {
    saveBtn.textContent = 'Save';
    saveBtn.disabled = false;
    const contentEl = document.getElementById('keyFileContent');
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'color:var(--red);font-size:12px;margin-top:8px;';
    errDiv.textContent = 'Error: ' + e.message;
    contentEl.parentNode.appendChild(errDiv);
    setTimeout(() => errDiv.remove(), 4000);
  }
};

function formatTimeAgo(ms, future) {
  if (ms < 60000) return (future ? 'in ' : '') + 'less than a minute';
  if (ms < 3600000) return (future ? 'in ' : '') + Math.round(ms/60000) + 'm';
  if (ms < 86400000) return (future ? 'in ' : '') + Math.round(ms/3600000) + 'h';
  return (future ? 'in ' : '') + Math.round(ms/86400000) + 'd';
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  
  const pages = ['overview', 'sessions', 'costs', 'limits', 'feed'];
  if (e.key >= '1' && e.key <= '5') {
    const idx = parseInt(e.key) - 1;
    if (pages[idx]) {
      document.querySelector(`[data-page="${pages[idx]}"]`).click();
    }
  } else if (e.key === ' ' && document.querySelector('.page.active').id === 'feed') {
    e.preventDefault();
    document.getElementById('pauseBtn').click();
  } else if (e.key === 'Escape') {
    closeSessionModal();
    toggleShortcuts(false);
  } else if (e.key === '/') {
    e.preventDefault();
    const activePage = document.querySelector('.page.active').id;
    if (activePage === 'sessions') {
      document.getElementById('sessionSearch').focus();
    } else if (activePage === 'feed') {
      document.getElementById('feedSearchInput').focus();
    }
  } else if (e.key === '?') {
    e.preventDefault();
    toggleShortcuts();
  }
});

function toggleShortcuts(force) {
  const overlay = document.getElementById('shortcutsOverlay');
  if (force === false) {
    overlay.classList.remove('active');
  } else {
    overlay.classList.toggle('active');
  }
}

// Browser notifications
if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
  notificationsEnabled = true;
}

function sendNotification(title, body) {
  if (notificationsEnabled && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '✨' });
    } catch {}
  }
}

// Feed search
let feedSearchTerm = '';
{
  const feedSearchInputEl = document.getElementById('feedSearchInput');
  if (feedSearchInputEl) {
    feedSearchInputEl.addEventListener('input', (e) => {
      feedSearchTerm = e.target.value.toLowerCase();
      applyFeedFilter();
    });
  }
}

function clearFeedSearch() {
  document.getElementById('feedSearchInput').value = '';
  feedSearchTerm = '';
  applyFeedFilter();
}

function highlightText(text, term) {
  if (!term) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(term);
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.substring(0, idx)) + '<span class="search-highlight">' + escapeHtml(text.substring(idx, idx + term.length)) + '</span>' + escapeHtml(text.substring(idx + term.length));
}

// Session comparison
let compareMode = false;
function toggleSessionCompare(key, checked) {
  if (checked) {
    selectedSessions.add(key);
  } else {
    selectedSessions.delete(key);
  }
  
  const btn = document.getElementById('compareBtn');
  if (selectedSessions.size === 2) {
    if (!btn) {
      const b = document.createElement('button');
      b.id = 'compareBtn';
      b.className = 'compare-btn';
      b.textContent = 'Compare Sessions';
      b.onclick = showComparison;
      document.body.appendChild(b);
    }
  } else if (btn) {
    btn.remove();
  }
}

function showComparison() {
  const keys = Array.from(selectedSessions);
  const s1 = sessions.find(s => s.key === keys[0]);
  const s2 = sessions.find(s => s.key === keys[1]);
  if (!s1 || !s2) return;

  const maxTokens = Math.max(s1.totalTokens || 0, s2.totalTokens || 0, 1);
  const maxCost = Math.max(s1.cost || 0, s2.cost || 0, 0.0001);

  const modal = document.getElementById('sessionModal');
  const modalStats = modal.querySelector('#modalStats');
  const modalMessages = modal.querySelector('#modalMessages');
  modal.querySelector('#modalTitle').textContent = 'Session Comparison';
  modal.querySelector('#modalKey').textContent = '';
  modalStats.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:24px;';
  [
    { s: s1, color: 'var(--accent)', costColor: 'var(--green)' },
    { s: s2, color: 'var(--purple)', costColor: 'var(--cyan)' }
  ].forEach(({ s, color, costColor }) => {
    const col = document.createElement('div');
    col.innerHTML = `
      <h3 style="font-size:16px;font-weight:700;margin-bottom:16px;color:${color};">${escapeHtml(s.label)}</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div><span style="color:var(--text-muted);font-size:12px;">Model:</span> <span class="mono">${escapeHtml(s.model.split('/').pop())}</span></div>
        <div><span style="color:var(--text-muted);font-size:12px;">Tokens:</span> <span class="mono">${(s.totalTokens||0).toLocaleString()}</span></div>
        <div><span style="color:var(--text-muted);font-size:12px;">Cost:</span> <span class="mono">$${(s.cost||0).toFixed(2)}</span></div>
        <div style="margin-top:12px;">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Tokens</div>
          <div style="height:24px;background:var(--bg-primary);border-radius:6px;overflow:hidden;">
            <div style="height:100%;width:${Math.round(((s.totalTokens||0)/maxTokens)*100)}%;background:${color};border-radius:6px;"></div>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:8px;margin-bottom:4px;">Cost</div>
          <div style="height:24px;background:var(--bg-primary);border-radius:6px;overflow:hidden;">
            <div style="height:100%;width:${Math.round(((s.cost||0)/maxCost)*100)}%;background:${costColor};border-radius:6px;"></div>
          </div>
        </div>
      </div>`;
    wrapper.appendChild(col);
  });
  modalStats.appendChild(wrapper);
  modalMessages.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">Comparison complete</div>';
  modal.style.display = 'flex';
}

function renderDiskSparkline(history) {
  if (!history || history.length < 2) return;
  const el = document.getElementById('diskSparkline');
  if (!el) return;
  const w = 120, h = 40;
  const vals = history.map(p => p.v);
  const min = Math.max(Math.min(...vals) - 2, 0);
  const max = Math.min(Math.max(...vals) + 2, 100);
  const range = max - min || 1;
  const points = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="var(--purple)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

const origUpdateOverview = updateOverview;
const _origUpdateOverview = updateOverview;

function openSessionDetail(key) {
  const s = sessions.find(x => x.key === key);
  if (!s) return;
  const modalTitle = document.getElementById('modalTitle');
  const modalKey = document.getElementById('modalKey');
  const modalStats = document.getElementById('modalStats');
  const modalMessages = document.getElementById('modalMessages');
  modalTitle.textContent = s.label;
  modalKey.textContent = s.key;
  const age = Date.now() - s.updatedAt;
  const ago = age < 60000 ? 'just now' : age < 3600000 ? Math.round(age/60000)+'m ago' : age < 86400000 ? Math.round(age/3600000)+'h ago' : Math.round(age/86400000)+'d ago';
  const isActive = age < 300000 && !s.aborted;
  modalStats.innerHTML = '';
  [
    ['Status', isActive ? '🟢 Active' : s.aborted ? '🔴 Aborted' : '⚪ Idle', isActive ? 'var(--green)' : 'var(--text-primary)', false],
    ['Model', s.model.split('/').pop(), null, true],
    ['Tokens', (s.totalTokens||0).toLocaleString(), null, true],
    ['Cost', '$' + (s.cost||0).toFixed(2), null, true],
    ['Last Active', ago, null, false],
    ['Channel', s.channel || '--', null, false]
  ].forEach(([label, value, color, mono]) => {
    const box = document.createElement('div');
    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    if (mono) valueEl.className = 'mono';
    valueEl.style.cssText = `font-size:13px;${color ? 'font-weight:600;color:' + color + ';' : ''}`;
    valueEl.textContent = value;
    box.appendChild(labelEl);
    box.appendChild(valueEl);
    modalStats.appendChild(box);
  });
  modalMessages.innerHTML = '';
  const loading = document.createElement('div');
  loading.style.cssText = 'color:var(--text-muted);font-size:13px;';
  loading.textContent = 'Loading...';
  modalMessages.appendChild(loading);
  document.getElementById('sessionModal').style.display = 'flex';
  authFetch(API_BASE + '/api/session-messages?id=' + encodeURIComponent(s.sessionId || s.key))
    .then(r => r.json())
    .then(msgs => {
      if (!msgs.length) {
        modalMessages.innerHTML = '';
        const empty = document.createElement('div');
        empty.style.cssText = 'color:var(--text-muted);font-size:13px;';
        empty.textContent = 'No messages found';
        modalMessages.appendChild(empty);
        return;
      }
      modalMessages.innerHTML = '';
      msgs.forEach(m => {
        const roleColor = m.role === 'user' ? 'var(--blue)' : m.role === 'assistant' ? 'var(--green)' : 'var(--yellow)';
        const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('en', {hour:'2-digit',minute:'2-digit'}) : '';
        const row = document.createElement('div');
        row.style.cssText = 'padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:4px;';
        const role = document.createElement('span');
        role.style.cssText = `font-weight:600;color:${roleColor};text-transform:uppercase;font-size:10px;`;
        role.textContent = m.role || '';
        const timeEl = document.createElement('span');
        timeEl.style.cssText = 'color:var(--text-muted);font-size:10px;';
        timeEl.textContent = time;
        head.appendChild(role);
        head.appendChild(timeEl);
        const body = document.createElement('div');
        body.style.cssText = "color:var(--text-primary);line-height:1.4;word-break:break-word;font-family:'JetBrains Mono',monospace;font-size:11px;";
        body.textContent = m.content || '';
        row.appendChild(head);
        row.appendChild(body);
        modalMessages.appendChild(row);
      });
    }).catch(() => {
      modalMessages.innerHTML = '';
      const failed = document.createElement('div');
      failed.style.color = 'var(--text-muted)';
      failed.textContent = 'Failed to load';
      modalMessages.appendChild(failed);
    });
}
function closeSessionModal() { document.getElementById('sessionModal').style.display = 'none'; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSessionModal(); });

// Toast notifications
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const icons = { success: '✅', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const iconEl = document.createElement('div');
  iconEl.className = 'toast-icon';
  iconEl.textContent = icons[type] || icons.info;

  const contentEl = document.createElement('div');
  contentEl.className = 'toast-content';
  const messageEl = document.createElement('div');
  messageEl.className = 'toast-message';
  messageEl.textContent = String(message || '');
  contentEl.appendChild(messageEl);

  toast.appendChild(iconEl);
  toast.appendChild(contentEl);
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Quick Actions
async function quickAction(action, evt) {
  const confirmMsg = {
    'restart-openclaw': 'Restart OpenClaw? This will interrupt running tasks.',
    'restart-dashboard': 'Restart Dashboard? Page will reload.',
    'restart-tailscale': 'Restart Tailscale? Network may drop briefly.',
    'update-openclaw': 'Update OpenClaw? This may take a minute.',
    'kill-tmux': 'Kill all tmux sessions? (including Claude persistent session)',
    'sys-update': 'Run apt update + upgrade? This may take several minutes.',
    'disk-cleanup': null,
    'restart-claude': null,
    'check-update': null,
    'clear-cache': null,
    'gc': null,
    'scrape-usage': null
  };
  
  if (confirmMsg[action] && !confirm(confirmMsg[action])) return;

  const loadingLabels = {
    'restart-openclaw': '🔄 Restarting...',
    'restart-dashboard': '🔄 Restarting...',
    'clear-cache': '🗑️ Clearing...',
    'restart-tailscale': '🌐 Restarting...',
    'update-openclaw': '⬆️ Updating...',
    'kill-tmux': '🧹 Killing...',
    'gc': '♻️ Running GC...',
    'check-update': '🔍 Checking...',
    'sys-update': '📦 Updating...',
    'disk-cleanup': '💾 Cleaning...',
    'restart-claude': '🤖 Restarting...'
  };

  const evtTarget = evt && evt.target ? evt.target : null;
  const triggerBtn = (evtTarget && typeof evtTarget.closest === 'function' ? evtTarget.closest('.qa-btn') : null) || evtTarget;
  const origText = triggerBtn && triggerBtn.textContent ? triggerBtn.textContent : '';
  if (triggerBtn) { triggerBtn.textContent = loadingLabels[action] || '⏳ Working...'; triggerBtn.disabled = true; triggerBtn.style.opacity = '0.6'; triggerBtn.style.pointerEvents = 'none'; }

  try {
    const res = await authFetch(`/api/action/${action}`, { method: 'POST' });
    const data = await res.json();
    
    if (data.success) {
      showToast(data.output || data.message || 'Action completed successfully', 'success');
      
      if (action === 'restart-dashboard') {
        setTimeout(() => location.reload(), 3000);
      } else if (action === 'clear-cache') {
        setTimeout(() => fetchData(), 500);
      }
    } else {
      showToast('Action failed: ' + (data.error || 'Unknown error'), 'warning');
    }
  } catch (e) {
    showToast('Action failed: ' + e.message, 'warning');
  } finally {
    if (triggerBtn) { triggerBtn.textContent = origText; triggerBtn.disabled = false; triggerBtn.style.opacity = '1'; triggerBtn.style.pointerEvents = ''; }
  }
}

// Tailscale Status
async function fetchTailscaleStatus() {
  try {
    const res = await authFetch(API_BASE + '/api/tailscale');
    const data = await res.json();

    const statusEl = document.getElementById('tailscaleStatus');
    if (!statusEl) return;

    if (data.error) {
      statusEl.innerHTML = '';
      const msg = document.createElement('div');
      msg.style.color = 'var(--text-muted)';
      msg.textContent = data.error;
      statusEl.appendChild(msg);
      return;
    }

    statusEl.innerHTML = '';
    const rows = [
      ['Status', data.online ? 'Online' : 'Offline', data.online ? 'var(--green)' : 'var(--red)', false],
      ['Device', data.hostname, null, true],
      ['Tailnet IP', data.ip, null, true],
      ['Connected Peers', String(data.peers), null, false]
    ];
    rows.forEach((row, idx) => {
      const el = document.createElement('div');
      el.style.cssText = `display:flex;justify-content:space-between;padding:8px 0;${idx < rows.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}`;
      const left = document.createElement('span');
      left.style.color = 'var(--text-muted)';
      left.textContent = row[0];
      const right = document.createElement('span');
      if (row[2]) right.style.cssText = `color:${row[2]};font-weight:600;`;
      if (row[3]) right.className = 'mono';
      if (row[3]) right.style.fontSize = '13px';
      right.textContent = row[1] || '--';
      el.appendChild(left);
      el.appendChild(right);
      statusEl.appendChild(el);
    });

    if (data.routes && data.routes.length > 0) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid var(--border);';
      const title = document.createElement('div');
      title.style.cssText = 'font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;';
      title.textContent = 'Active Routes';
      wrap.appendChild(title);
      data.routes.forEach(r => {
        const line = document.createElement('div');
        line.style.cssText = "font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--text-secondary);margin-bottom:4px;";
        line.textContent = r;
        wrap.appendChild(line);
      });
      statusEl.appendChild(wrap);
    }
  } catch (e) {
    const statusEl = document.getElementById('tailscaleStatus');
    if (statusEl) {
      statusEl.innerHTML = '';
      const msg = document.createElement('div');
      msg.style.color = 'var(--text-muted)';
      msg.textContent = 'Failed to load';
      statusEl.appendChild(msg);
    }
  }
}

// Lifetime Stats
async function fetchLifetimeStats() {
  try {
    const res = await authFetch(API_BASE + '/api/lifetime-stats');
    const data = await res.json();
    
    document.getElementById('ltTokens').textContent = data.totalTokens >= 1000000 ? (data.totalTokens / 1000000).toFixed(1) + 'M' : data.totalTokens >= 1000 ? (data.totalTokens / 1000).toFixed(0) + 'k' : data.totalTokens;
    document.getElementById('ltMessages').textContent = data.totalMessages.toLocaleString();
    document.getElementById('ltCost').textContent = '$' + data.totalCost.toFixed(2);
    document.getElementById('ltSessions').textContent = data.totalSessions;
    document.getElementById('ltDaysActive').textContent = data.daysActive;
    
    if (data.firstSessionDate) {
      const date = new Date(data.firstSessionDate);
      document.getElementById('ltFirstDate').textContent = date.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  } catch {}
}

// Activity Streak — GitHub-style contribution graph
function calculateStreak() {
  try {
    const perDay = costs.perDay || {};

    document.getElementById('currentStreak').textContent = costs.currentStreak || 0;
    document.getElementById('longestStreak').textContent = costs.longestStreak || 0;

    const calendarEl = document.getElementById('streakCalendar');
    if (!calendarEl) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 364 days (52 weeks), aligned to start on Sunday
    const startDay = new Date(today);
    startDay.setDate(startDay.getDate() - 363);
    startDay.setDate(startDay.getDate() - startDay.getDay());

    const dayCosts = [];
    const d = new Date(startDay);
    while (d <= today) {
      const key = d.toISOString().substring(0, 10);
      dayCosts.push({ date: key, cost: perDay[key] || 0 });
      d.setDate(d.getDate() + 1);
    }

    // Quartile thresholds from non-zero values
    const nonZero = dayCosts.map(x => x.cost).filter(c => c > 0).sort((a, b) => a - b);
    let q1 = 0, q2 = 0, q3 = 0;
    if (nonZero.length > 0) {
      q1 = nonZero[Math.floor(nonZero.length * 0.25)];
      q2 = nonZero[Math.floor(nonZero.length * 0.50)];
      q3 = nonZero[Math.floor(nonZero.length * 0.75)];
    }
    function getLevel(cost) {
      if (cost <= 0) return 0;
      if (cost <= q1) return 1;
      if (cost <= q2) return 2;
      if (cost <= q3) return 3;
      return 4;
    }

    // Group into weeks (columns)
    const weeks = [];
    for (let i = 0; i < dayCosts.length; i += 7) weeks.push(dayCosts.slice(i, i + 7));

    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

    // Build DOM instead of innerHTML for safety
    const frag = document.createDocumentFragment();

    // Dynamic cell size to fill card width
    const dayLabelWidth = 28;
    const gapPx = 3;
    const availWidth = calendarEl.parentElement.clientWidth - dayLabelWidth;
    const dynamicCell = Math.max(10, Math.min(14, Math.round((availWidth - (weeks.length - 1) * gapPx) / weeks.length)));
    const weekPx = dynamicCell + gapPx;

    // Month labels — positioned absolutely above the grid columns
    const monthRow = document.createElement('div');
    monthRow.className = 'contrib-months';
    let lastMonth = -1;
    for (let wi = 0; wi < weeks.length; wi++) {
      const firstDay = new Date(weeks[wi][0].date);
      const m = firstDay.getMonth();
      if (m !== lastMonth) {
        const ml = document.createElement('span');
        ml.className = 'contrib-month-label';
        ml.textContent = months[m];
        ml.style.left = (wi * weekPx) + 'px';
        monthRow.appendChild(ml);
        lastMonth = m;
      }
    }
    frag.appendChild(monthRow);

    // Grid container
    const grid = document.createElement('div');
    grid.className = 'contrib-grid';

    // Day labels column
    const dayCol = document.createElement('div');
    dayCol.className = 'contrib-days';
    for (const label of dayLabels) {
      const dl = document.createElement('div');
      dl.className = 'contrib-day-label';
      dl.textContent = label;
      dayCol.appendChild(dl);
    }
    grid.appendChild(dayCol);

    // Week columns
    for (const week of weeks) {
      const col = document.createElement('div');
      col.className = 'contrib-col';
      for (let row = 0; row < 7; row++) {
        const cell = document.createElement('div');
        cell.className = 'contrib-cell';
        cell.style.width = dynamicCell + 'px';
        cell.style.height = dynamicCell + 'px';
        if (row < week.length) {
          const entry = week[row];
          const isFuture = new Date(entry.date) > today;
          const level = isFuture ? -1 : getLevel(entry.cost);
          cell.classList.add('contrib-level-' + level);
          cell.title = entry.date + ': ' + (entry.cost > 0 ? '$' + entry.cost.toFixed(2) : 'No activity');
        } else {
          cell.classList.add('contrib-level--1');
        }
        col.appendChild(cell);
      }
      grid.appendChild(col);
    }
    frag.appendChild(grid);

    // Legend — render into header row beside streak stats
    const legendEl = document.getElementById('streakLegend');
    if (legendEl) {
      legendEl.innerHTML = '';
      const lessSpan = document.createElement('span');
      lessSpan.textContent = 'Less';
      legendEl.appendChild(lessSpan);
      for (let i = 0; i <= 4; i++) {
        const lc = document.createElement('div');
        lc.className = 'contrib-cell contrib-level-' + i;
        legendEl.appendChild(lc);
      }
      const moreSpan = document.createElement('span');
      moreSpan.textContent = 'More';
      legendEl.appendChild(moreSpan);
    }

    calendarEl.replaceChildren(frag);

    // Align legend right edge with grid right edge
    if (legendEl) {
      const headerDiv = legendEl.parentElement;
      const gridEl = calendarEl.querySelector('.contrib-grid');
      if (headerDiv && gridEl) {
        legendEl.style.right = (headerDiv.offsetWidth - gridEl.offsetWidth) + 'px';
      }
    }
  } catch (e) {
    console.error('Streak calculation error:', e);
  }
}

// Logs Viewer
let logAutoRefreshEntry = null;

async function fetchLogs() {
  const service = document.getElementById('logService').value;
  const lines = document.getElementById('logLines').value;
  const viewer = document.getElementById('logViewer');

  if (!viewer) return;
  viewer.innerHTML = '<div style="color:var(--text-muted);">Loading logs...</div>';

  try {
    const res = await authFetch(API_BASE + `/api/logs?service=${service}&lines=${lines}`);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const logs = await res.text();
    viewer.textContent = logs;
    viewer.scrollTop = viewer.scrollHeight;
  } catch (e) {
    viewer.innerHTML = '<div style="color:var(--red);">Failed to load logs: ' + e.message + '</div>';
  }
}

function toggleLogAutoRefresh(enabled) {
  clearVisibleInterval(logAutoRefreshEntry);
  logAutoRefreshEntry = null;

  if (enabled) {
    fetchLogs();
    logAutoRefreshEntry = visibleInterval(fetchLogs, 5000);
  }
}

// Update document title with usage percentage
function updatePageTitle() {
  try {
    const cu = _cachedClaudeUsage;
    if (cu && cu.session) {
      document.title = cu.session.percent + '% | Agent Dashboard';
    }
  } catch {}
}

// Add session duration to stats
const origUpdateSessionsStats = updateSessionsStats;
updateSessionsStats = function(filtered) {
  origUpdateSessionsStats(filtered);
  
  // Calculate average session duration
  try {
    const durations = filtered
      .filter(s => s.createdAt && s.updatedAt)
      .map(s => s.updatedAt - s.createdAt)
      .filter(d => d > 0 && d < 86400000 * 30);
    
    if (durations.length > 0) {
      const avgDur = durations.reduce((a, b) => a + b, 0) / durations.length;
      const hours = Math.floor(avgDur / 3600000);
      const mins = Math.floor((avgDur % 3600000) / 60000);
      
      const statsBar = document.getElementById('sessionsStatsBar');
      if (statsBar) {
        const avgDurEl = document.getElementById('statsAvgDuration');
        if (!avgDurEl) {
          const container = statsBar.querySelector('div[style*="display:flex"]');
          if (container) {
            const durDiv = document.createElement('div');
            durDiv.style.cssText = 'display:flex;align-items:center;gap:8px;';
            durDiv.innerHTML = `<span style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Avg Duration</span><span class="mono" style="font-size:20px;font-weight:700;" id="statsAvgDuration">${hours > 0 ? hours + 'h ' : ''}${mins}m</span>`;
            container.appendChild(durDiv);
          }
        } else {
          avgDurEl.textContent = `${hours > 0 ? hours + 'h ' : ''}${mins}m`;
        }
      }
    }
  } catch {}
};

// Add duration to expanded session view
const origToggleSessionExpand = toggleSessionExpand;
toggleSessionExpand = function(key, e) {
  origToggleSessionExpand(key, e);
  
  try {
    const s = sessions.find(x => x.key === key);
    if (!s || !s.createdAt) return;
    
    const detail = document.getElementById('expanded-' + CSS.escape(key));
    if (!detail) return;
    
    const now = s.updatedAt || Date.now();
    const duration = now - s.createdAt;
    
    const days = Math.floor(duration / 86400000);
    const hours = Math.floor((duration % 86400000) / 3600000);
    const mins = Math.floor((duration % 3600000) / 60000);
    
    let durStr = '';
    if (days > 0) durStr = `${days}d ${hours}h`;
    else if (hours > 0) durStr = `${hours}h ${mins}m`;
    else durStr = `${mins}m`;
    
    const grid = detail.querySelector('div[style*="display:grid"]');
    if (grid && !document.getElementById('dur-' + CSS.escape(key))) {
      const durDiv = document.createElement('div');
      durDiv.id = 'dur-' + CSS.escape(key);
      durDiv.innerHTML = `<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;">Duration</div><div style="font-size:12px;">${durStr}</div>`;
      grid.appendChild(durDiv);
    }
  } catch {}
};

// Fetch new data on load
fetchTailscaleStatus();
fetchLifetimeStats();

// Periodic updates (paused when tab is hidden)
visibleInterval(fetchTailscaleStatus, 30000);
visibleInterval(fetchLifetimeStats, 60000);
visibleInterval(updatePageTitle, 5000);
visibleInterval(() => { if (costs.perDay) calculateStreak(); }, 10000);

// Initial calls
setTimeout(() => {
  if (costs.perDay) calculateStreak();
  updatePageTitle();
}, 2000);

function toggleTheme() {
  const btn = document.getElementById('themeToggle');
  document.body.classList.toggle('light-theme');
  const isLight = document.body.classList.contains('light-theme');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  btn.textContent = isLight ? '☀️' : '🌙';
}
(function() {
  if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-theme');
    document.getElementById('themeToggle').textContent = '☀️';
  }
})();

async function fetchSysSecurity() {
  try {
    const res = await authFetch(API_BASE + '/api/sys-security');
    const data = await res.json();
    document.getElementById('secUfw').textContent = data.ufw || 'N/A';
    document.getElementById('secPorts').textContent = data.ports || 'N/A';
    document.getElementById('secF2b').textContent = data.fail2ban || 'N/A';
    document.getElementById('secSsh').textContent = data.ssh || 'N/A';
    document.getElementById('secAudit').textContent = data.audit || 'N/A';
  } catch(e) { showToast('Security fetch error: ' + e.message, 'warning'); }
}

let reauthTargetPage = 'sys-security';
function showReauthModal(targetPage) {
  reauthTargetPage = targetPage || 'sys-security';
  let overlay = document.getElementById('reauthOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'reauthOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:600;display:flex;align-items:center;justify-content:center;';

    const panel = document.createElement('div');
    panel.style.cssText = 'background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:32px;max-width:380px;width:90%;';

    const title = document.createElement('h3');
    title.style.marginBottom = '8px';
    title.textContent = '🔒 Re-authentication Required';

    const desc = document.createElement('p');
    desc.style.cssText = 'font-size:13px;color:var(--text-secondary);margin-bottom:20px;';
    desc.textContent = 'Enter your credentials to access System Security.';

    const pass = document.createElement('input');
    pass.type = 'password';
    pass.id = 'reauthPass';
    pass.placeholder = 'Password';
    pass.style.cssText = 'width:100%;padding:12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px;margin-bottom:12px;';

    const totp = document.createElement('input');
    totp.type = 'text';
    totp.id = 'reauthTotp';
    totp.placeholder = 'Authenticator Code (if enabled)';
    totp.maxLength = 6;
    totp.autocomplete = 'one-time-code';
    totp.style.cssText = "width:100%;padding:12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px;margin-bottom:12px;font-family:JetBrains Mono,monospace;";

    const error = document.createElement('div');
    error.id = 'reauthError';
    error.style.cssText = 'display:none;color:var(--red);font-size:12px;margin-bottom:12px;padding:8px;background:rgba(239,68,68,0.1);border-radius:6px;';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;';
    const verifyBtn = document.createElement('button');
    verifyBtn.textContent = 'Verify';
    verifyBtn.style.cssText = 'flex:1;padding:12px;background:linear-gradient(135deg,var(--accent),var(--purple));color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;';
    verifyBtn.onclick = () => submitReauth();
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'flex:1;padding:12px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;font-weight:500;cursor:pointer;';
    cancelBtn.onclick = () => cancelReauth();
    actions.appendChild(verifyBtn);
    actions.appendChild(cancelBtn);

    panel.appendChild(title);
    panel.appendChild(desc);
    panel.appendChild(pass);
    panel.appendChild(totp);
    panel.appendChild(error);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    pass.addEventListener('keydown', e => { if (e.key === 'Enter') totp.focus(); });
    totp.addEventListener('keydown', e => { if (e.key === 'Enter') submitReauth(); });
  }
  overlay.style.display = 'flex';
  document.getElementById('reauthPass').value = '';
  document.getElementById('reauthTotp').value = '';
  document.getElementById('reauthError').style.display = 'none';
  setTimeout(() => document.getElementById('reauthPass').focus(), 100);
}

async function submitReauth() {
  const pass = document.getElementById('reauthPass').value;
  const totp = document.getElementById('reauthTotp').value;
  const errEl = document.getElementById('reauthError');
  if (!pass) { errEl.textContent = 'Password required'; errEl.style.display = 'block'; return; }
  try {
    const res = await fetch(API_BASE + '/api/reauth', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass, totp: totp || undefined })
    });
    const data = await res.json();
    if (data.needsTotp && !totp) { errEl.textContent = 'Authenticator code required'; errEl.style.display = 'block'; document.getElementById('reauthTotp').focus(); return; }
    if (data.error) { errEl.textContent = data.error; errEl.style.display = 'block'; return; }
    sysSecAuthed = true;
    document.getElementById('reauthOverlay').style.display = 'none';
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelector('[data-page="' + reauthTargetPage + '"]').classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(reauthTargetPage).classList.add('active');
    if (reauthTargetPage === 'sys-security') fetchSysSecurity();
    if (reauthTargetPage === 'config-editor') loadConfig();

  } catch(e) { errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block'; }
}

async function loadConfig() {
  const ta = document.getElementById('configTextarea');
  const errEl = document.getElementById('configError');
  const sucEl = document.getElementById('configSuccess');
  errEl.style.display = 'none';
  sucEl.style.display = 'none';
  ta.value = 'Loading...';
  try {
    const res = await authFetch(API_BASE + '/api/openclaw-config');
    const data = await res.json();
    if (data.error) { errEl.textContent = data.error; errEl.style.display = 'block'; return; }
    ta.value = JSON.stringify(JSON.parse(data.config), null, 2);
  } catch(e) { errEl.textContent = 'Failed to load: ' + e.message; errEl.style.display = 'block'; }
}

async function saveConfig() {
  const ta = document.getElementById('configTextarea');
  const errEl = document.getElementById('configError');
  const sucEl = document.getElementById('configSuccess');
  errEl.style.display = 'none';
  sucEl.style.display = 'none';
  try {
    JSON.parse(ta.value);
  } catch(e) { errEl.textContent = 'Invalid JSON: ' + e.message; errEl.style.display = 'block'; return; }
  if (!confirm('Save config and restart OpenClaw gateway?')) return;
  try {
    const res = await authFetch(API_BASE + '/api/openclaw-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: ta.value })
    });
    const data = await res.json();
    if (data.error) { errEl.textContent = data.error; errEl.style.display = 'block'; return; }
    sucEl.textContent = '✅ Config saved. Backup: ' + data.backup + '. Gateway restarting...';
    sucEl.style.display = 'block';
    showToast('Config saved, gateway restarting...', 'success');
  } catch(e) { errEl.textContent = 'Save failed: ' + e.message; errEl.style.display = 'block'; }
}

function cancelReauth() {
  document.getElementById('reauthOverlay').style.display = 'none';
  document.querySelector('[data-page="overview"]').click();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    if (item.dataset.page === 'sys-security' && sysSecAuthed) fetchSysSecurity();
    if (item.dataset.page === 'config-editor' && sysSecAuthed) loadConfig();
    if (item.dataset.page === 'docker') loadDocker();
  });
});

async function loadDocker() {
  try {
    const res = await authFetch(API_BASE + '/api/docker');
    const data = await res.json();
    const ce = document.getElementById('dockerContainers');
    if (data.containers && data.containers.length) {
      const table = document.createElement('table');
      table.style.cssText = 'width:100%;font-size:12px;border-collapse:collapse;';
      table.innerHTML = '<tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:6px;">Name</th><th style="text-align:left;padding:6px;">Image</th><th style="text-align:left;padding:6px;">Status</th><th style="text-align:left;padding:6px;">Ports</th><th style="padding:6px;">Actions</th></tr>';
      data.containers.forEach(c => {
        const running = c.State === 'running';
        const dot = running ? '🟢' : '🔴';
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border)';
        tr.innerHTML = `<td style="padding:6px;">${dot} ${escapeHtml(c.Names || '')}</td><td style="padding:6px;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.Image || '')}</td><td style="padding:6px;color:var(--text-secondary);">${escapeHtml(c.Status || '')}</td><td style="padding:6px;color:var(--text-muted);font-size:11px;">${escapeHtml(c.Ports || '-')}</td><td style="padding:6px;text-align:center;"></td>`;
        const actionsTd = tr.lastElementChild;
        const actionDefs = running ? [
          { label: 'Stop', action: 'stop', color: 'var(--red)' },
          { label: 'Restart', action: 'restart', color: 'var(--yellow)' }
        ] : [
          { label: 'Start', action: 'start', color: 'var(--green)' }
        ];
        actionDefs.forEach((def, idx) => {
          const btn = document.createElement('button');
          btn.textContent = def.label;
          btn.style.cssText = `padding:3px 8px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;color:${def.color};cursor:pointer;font-size:11px;${idx < actionDefs.length - 1 ? 'margin-right:4px;' : ''}`;
          btn.onclick = () => dockerAction(def.action, c.Names || '');
          actionsTd.appendChild(btn);
        });
        table.appendChild(tr);
      });
      ce.innerHTML = '';
      ce.appendChild(table);
    } else { ce.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No containers found</div>'; }

    const ie = document.getElementById('dockerImages');
    if (data.images && data.images.length) {
      const table = document.createElement('table');
      table.style.cssText = 'width:100%;font-size:12px;border-collapse:collapse;';
      table.innerHTML = '<tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:6px;">Repository</th><th style="text-align:left;padding:6px;">Tag</th><th style="text-align:left;padding:6px;">Size</th></tr>';
      data.images.forEach(i => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border)';
        tr.innerHTML = `<td style="padding:6px;">${escapeHtml(i.Repository || '')}</td><td style="padding:6px;color:var(--text-secondary);">${escapeHtml(i.Tag || '')}</td><td style="padding:6px;color:var(--text-muted);">${escapeHtml(i.Size || '')}</td>`;
        table.appendChild(tr);
      });
      ie.innerHTML = '';
      ie.appendChild(table);
    } else { ie.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No images found</div>'; }

    document.getElementById('dockerSystem').textContent = data.system || 'N/A';
  } catch(e) { showToast('Docker fetch error: ' + e.message, 'warning'); }
}

const notifIcons = {
  login_success: '✅', login_failed: '❌', login_locked: '🔒', logout: '👋',
  register: '📝', reauth_success: '🔓', reauth_failed: '🚫',
  config_saved: '⚙️', config_read: '📖', docker_view: '🐳', docker_action: '🐳',
  sys_security_view: '🛡️', auth_failed: '⚠️', login_mfa_failed: '🔑',
  password_changed: '🔐', mfa_enabled: '📱', mfa_disabled: '📱',
  cron_toggle: '🔄', cron_run: '▶️', cron_run_error: '❌'
};

const notifLabels = {
  login_success: 'Login', login_failed: 'Login Failed', login_locked: 'Account Locked', logout: 'Logout',
  register: 'Account Created', reauth_success: 'Re-authenticated', reauth_failed: 'Re-auth Failed',
  config_saved: 'Config Saved', config_read: 'Config Read', docker_view: 'Docker View', docker_action: 'Docker Action',
  sys_security_view: 'Security View', auth_failed: 'Auth Failed', login_mfa_failed: 'MFA Failed',
  password_changed: 'Password Changed', mfa_enabled: 'MFA Enabled', mfa_disabled: 'MFA Disabled',
  cron_toggle: 'Cron Toggled', cron_run: 'Cron Triggered', cron_run_error: 'Cron Run Failed'
};
let notifLastSeen = localStorage.getItem('notifLastSeen') || '';

function toggleNotifPanel() {
  console.log('toggleNotifPanel called');
  const panel = document.getElementById('notifPanel');
  console.log('Panel element:', panel);
  console.log('Current display:', panel.style.display);
  if (panel.style.display === 'flex') { panel.style.display = 'none'; console.log('Hiding panel'); return; }
  panel.style.display = 'flex';
  console.log('Showing panel');
  fetchNotifications();
}

async function fetchNotifications() {
  try {
    const res = await authFetch(API_BASE + '/api/notifications?limit=50');
    const data = await res.json();
    const body = document.getElementById('notifPanelBody');
    if (!data.events || !data.events.length) {
      body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">No events yet</div>';
      return;
    }
    body.innerHTML = '';
    data.events.forEach(e => {
      const icon = notifIcons[e.event] || '📋';
      const time = e.timestamp ? new Date(e.timestamp).toLocaleString() : '';
      const detail = e.username ? ' (' + e.username + ')' : '';
      const ip = e.ip ? ' from ' + e.ip : '';
      const item = document.createElement('div');
      item.className = 'notif-item';
      item.innerHTML = `<div class="notif-icon">${icon}</div><div class="notif-content"><div class="notif-event">${escapeHtml((notifLabels[e.event] || (e.event||'').replace(/_/g, ' ')) + detail + ip)}</div><div class="notif-time">${escapeHtml(time)}</div></div>`;
      body.appendChild(item);
    });
    if (data.events.length) {
      notifLastSeen = data.events[0].timestamp;
      localStorage.setItem('notifLastSeen', notifLastSeen);
      document.getElementById('notifBadge').style.display = 'none';
      const badgeMobile = document.getElementById('notifBadgeMobile');
      if (badgeMobile) badgeMobile.style.display = 'none';
    }
  } catch(e) { showToast('Notification fetch error: ' + e.message, 'warning'); }
}

async function checkNewNotifications() {
  try {
    const res = await authFetch(API_BASE + '/api/notifications?limit=5');
    const data = await res.json();
    if (data.events && data.events.length && notifLastSeen) {
      const newCount = data.events.filter(e => e.timestamp > notifLastSeen).length;
      const badge = document.getElementById('notifBadge');
      const badgeMobile = document.getElementById('notifBadgeMobile');
      if (newCount > 0) {
        badge.textContent = newCount;
        badge.style.display = 'flex';
        if (badgeMobile) { badgeMobile.textContent = newCount; badgeMobile.style.display = 'flex'; }
      }
    }
  } catch {}
}
visibleInterval(checkNewNotifications, 30000);
setTimeout(checkNewNotifications, 3000);
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notifPanel');
  const bell = document.getElementById('notificationBell');
  const bellMobile = document.getElementById('notificationBellMobile');
  if (panel.style.display === 'flex' && !panel.contains(e.target) && !bell.contains(e.target) && (!bellMobile || !bellMobile.contains(e.target))) panel.style.display = 'none';
});

async function dockerAction(action, id) {
  const label = action === 'prune-containers' ? 'prune stopped containers' : action === 'prune-images' ? 'prune unused images' : action + ' ' + id;
  if (!confirm('Run: ' + label + '?')) return;
  try {
    const res = await authFetch(API_BASE + '/api/docker/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id })
    });
    const data = await res.json();
    if (data.error) { showToast('Error: ' + data.error, 'warning'); return; }
    showToast(label + ' done', 'success');
    loadDocker();
  } catch(e) { showToast('Error: ' + e.message, 'warning'); }
}
