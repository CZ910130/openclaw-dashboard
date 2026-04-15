let sysSecAuthed = false;
const TOKEN_KEY = 'dashboardToken';
const TOKEN_EXPIRY_KEY = 'dashboardTokenExpiry';

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
  setHiddenState('registerForm', false);
  setHiddenState('loginForm', true);
  setHiddenState('recoveryForm', true);
  setHiddenState('registerError', true);
  setTimeout(() => {
    const el = document.getElementById('regUsername');
    if (el) el.focus();
  }, 100);
}

function showLoginForm() {
  document.getElementById('authTitle').textContent = 'Dashboard Login';
  document.getElementById('authSubtitle').textContent = 'Enter your credentials';
  setHiddenState('registerForm', true);
  setHiddenState('loginForm', false);
  setHiddenState('recoveryForm', true);
  setHiddenState('usernameInputContainer', false);
  setHiddenState('passwordInputContainer', false);
  setHiddenState('totpInputContainer', true);
  setHiddenState('loginError', true);
  setTimeout(() => {
    const el = document.getElementById('username');
    if (el) el.focus();
  }, 100);
}

function showRecoveryForm() {
  document.getElementById('authTitle').textContent = 'Reset Password';
  document.getElementById('authSubtitle').textContent = 'Enter recovery token and new password';
  setHiddenState('registerForm', true);
  setHiddenState('loginForm', true);
  setHiddenState('recoveryForm', false);
  setHiddenState('recoveryError', true);
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

async function handleRegister(event) {
  event.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirmPassword = document.getElementById('regPasswordConfirm').value;
  const registerBtn = document.getElementById('registerBtn');
  const registerError = document.getElementById('registerError');
  
  setHiddenState(registerError, true);
  
  if (password !== confirmPassword) {
    registerError.textContent = 'Passwords do not match';
    setHiddenState(registerError, false);
    return false;
  }
  
  if (password.length < 8) {
    registerError.textContent = 'Password must be at least 8 characters';
    setHiddenState(registerError, false);
    return false;
  }
  
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    registerError.textContent = 'Password must contain at least 1 letter and 1 number';
    setHiddenState(registerError, false);
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
      setHiddenState(registerError, false);
      registerBtn.disabled = false;
      registerBtn.textContent = 'Create Account';
    }
  } catch (err) {
    registerError.textContent = 'Network error. Please try again.';
    setHiddenState(registerError, false);
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
  setHiddenState(loginError, true);
  
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
      setHiddenState('usernameInputContainer', true);
      setHiddenState('passwordInputContainer', true);
      setHiddenState('totpInputContainer', false);
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
      setHiddenState(loginError, false);
      loginBtn.disabled = false;
      loginBtn.textContent = totpCode ? 'Verify' : 'Login';
      
      if (totpCode) {
        totpInput.value = '';
        totpInput.focus();
      }
    }
  } catch (err) {
    loginError.textContent = 'Network error. Please try again.';
    setHiddenState(loginError, false);
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
  
  setHiddenState(recoveryError, true);
  
  if (newPassword !== confirmPassword) {
    recoveryError.textContent = 'Passwords do not match';
    setHiddenState(recoveryError, false);
    return false;
  }
  
  if (newPassword.length < 8) {
    recoveryError.textContent = 'Password must be at least 8 characters';
    setHiddenState(recoveryError, false);
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
      setHiddenState(recoveryError, false);
      recoveryBtn.disabled = false;
      recoveryBtn.textContent = 'Reset Password';
    }
  } catch (err) {
    recoveryError.textContent = 'Network error. Please try again.';
    setHiddenState(recoveryError, false);
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
  
  setHiddenState(changePasswordError, true);
  
  if (newPassword !== confirmPassword) {
    changePasswordError.textContent = 'New passwords do not match';
    setHiddenState(changePasswordError, false);
    return false;
  }
  
  if (newPassword.length < 8) {
    changePasswordError.textContent = 'New password must be at least 8 characters';
    setHiddenState(changePasswordError, false);
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
      setHiddenState(changePasswordError, false);
    }
  } catch (err) {
    changePasswordError.textContent = err.message || 'Network error. Please try again.';
    setHiddenState(changePasswordError, false);
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
  setHiddenState('loginPage', true, APP_HIDDEN_CLASS);
  setHiddenState('mainApp', false, APP_HIDDEN_CLASS);
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
  setHiddenState('loginPage', false, APP_HIDDEN_CLASS);
  setHiddenState('mainApp', true, APP_HIDDEN_CLASS);
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
    indicator.classList.remove('mfa-status-enabled', 'mfa-status-disabled');
    if (enabled) {
      indicator.textContent = '🔒 MFA Enabled';
      indicator.classList.add('mfa-status-enabled');
      setHiddenState('mfaEnabledView', false);
      setHiddenState('mfaDisabledView', true);
    } else {
      indicator.textContent = '⚠️ MFA Disabled';
      indicator.classList.add('mfa-status-disabled');
      setHiddenState('mfaEnabledView', true);
      setHiddenState('mfaDisabledView', false);
    }
    setHiddenState(indicator, false);
    setHiddenState('mfaSetupView', true);
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
      setHiddenState('mfaDisabledView', true);
      setHiddenState('mfaSetupView', false);
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
  setHiddenState(errorEl, true);
  
  if (!code || code.length !== 6) {
    errorEl.textContent = 'Enter the 6-digit code from your authenticator app.';
    setHiddenState(errorEl, false);
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
      setHiddenState('mfaSetupView', true);
      document.getElementById('mfaVerifyCode').value = '';
      checkMFAStatus();
    } else {
      errorEl.textContent = data.error || 'Invalid code. Try again.';
      setHiddenState(errorEl, false);
      document.getElementById('mfaVerifyCode').value = '';
      document.getElementById('mfaVerifyCode').focus();
    }
  } catch (err) {
    errorEl.textContent = 'Verification failed. Try again.';
    setHiddenState(errorEl, false);
  }
  
  btn.disabled = false;
  btn.textContent = '✅ Verify & Enable';
}

function cancelMFASetup() {
  setHiddenState('mfaSetupView', true);
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

function initAuthUi() {
  const regPassword = document.getElementById('regPassword');
  const strengthBar = document.getElementById('passwordStrengthBar');
  const strengthText = document.getElementById('passwordStrengthText');

  if (regPassword && strengthBar && strengthText && !regPassword.dataset.boundStrength) {
    regPassword.dataset.boundStrength = 'true';
    regPassword.addEventListener('input', (e) => {
      const password = e.target.value;
      const strength = calculatePasswordStrength(password);
      strengthBar.style.width = strength + '%';
      strengthBar.classList.remove('password-strength-weak', 'password-strength-medium', 'password-strength-strong');
      strengthText.classList.remove('password-strength-text-weak', 'password-strength-text-medium', 'password-strength-text-strong');

      if (strength < 40) {
        strengthBar.classList.add('password-strength-weak');
        strengthText.textContent = 'Weak password';
        strengthText.classList.add('password-strength-text-weak');
      } else if (strength < 70) {
        strengthBar.classList.add('password-strength-medium');
        strengthText.textContent = 'Medium strength';
        strengthText.classList.add('password-strength-text-medium');
      } else {
        strengthBar.classList.add('password-strength-strong');
        strengthText.textContent = 'Strong password';
        strengthText.classList.add('password-strength-text-strong');
      }
    });
  }
}

function beginAuthBootstrap() {
  checkAuth();
}
