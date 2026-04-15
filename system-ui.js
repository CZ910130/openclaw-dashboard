function syncThemeToggleButtons(isLight) {
  ['themeToggle', 'themeToggleMobile'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = isLight ? '☀️' : '🌙';
  });
}

function toggleTheme() {
  document.body.classList.toggle('light-theme');
  const isLight = document.body.classList.contains('light-theme');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  syncThemeToggleButtons(isLight);
}
(function() {
  const isLight = localStorage.getItem('theme') === 'light';
  if (isLight) {
    document.body.classList.add('light-theme');
  }
  syncThemeToggleButtons(isLight);
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
    overlay.className = 'reauth-overlay';
    overlay.addEventListener('click', e => {
      if (e.target === overlay) cancelReauth();
    });

    const panel = document.createElement('div');
    panel.className = 'reauth-panel';

    const title = document.createElement('h3');
    title.className = 'reauth-title';
    title.textContent = '🔒 Re-authentication Required';

    const desc = document.createElement('p');
    desc.className = 'reauth-desc';
    desc.textContent = 'Enter your credentials to access System Security.';

    const pass = document.createElement('input');
    pass.type = 'password';
    pass.id = 'reauthPass';
    pass.placeholder = 'Password';
    pass.className = 'form-input reauth-input';

    const totp = document.createElement('input');
    totp.type = 'text';
    totp.id = 'reauthTotp';
    totp.placeholder = 'Authenticator Code (if enabled)';
    totp.maxLength = 6;
    totp.autocomplete = 'one-time-code';
    totp.className = 'form-input form-input-code reauth-input';

    const error = document.createElement('div');
    error.id = 'reauthError';
    error.className = 'form-inline-error auth-form-hidden reauth-error';

    const actions = document.createElement('div');
    actions.className = 'reauth-actions';
    const verifyBtn = document.createElement('button');
    verifyBtn.textContent = 'Verify';
    verifyBtn.className = 'reauth-action-btn reauth-action-btn-primary';
    verifyBtn.addEventListener('click', () => submitReauth());
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'reauth-action-btn reauth-action-btn-secondary';
    cancelBtn.addEventListener('click', () => cancelReauth());
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
  setOpenState(overlay, true, 'reauth-overlay-open');
  document.getElementById('reauthPass').value = '';
  document.getElementById('reauthTotp').value = '';
  setHiddenState('reauthError', true);
  setTimeout(() => document.getElementById('reauthPass').focus(), 100);
}

async function submitReauth() {
  const pass = document.getElementById('reauthPass').value;
  const totp = document.getElementById('reauthTotp').value;
  const errEl = document.getElementById('reauthError');
  if (!pass) { errEl.textContent = 'Password required'; setHiddenState(errEl, false); return; }
  try {
    const res = await fetch(API_BASE + '/api/reauth', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass, totp: totp || undefined })
    });
    const data = await res.json();
    if (data.needsTotp && !totp) { errEl.textContent = 'Authenticator code required'; setHiddenState(errEl, false); document.getElementById('reauthTotp').focus(); return; }
    if (data.error) { errEl.textContent = data.error; setHiddenState(errEl, false); return; }
    sysSecAuthed = true;
    setOpenState('reauthOverlay', false, 'reauth-overlay-open');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelector('[data-page="' + reauthTargetPage + '"]').classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(reauthTargetPage).classList.add('active');
    if (reauthTargetPage === 'sys-security') fetchSysSecurity();
    if (reauthTargetPage === 'config-editor') loadConfig();

  } catch(e) { errEl.textContent = 'Error: ' + e.message; setHiddenState(errEl, false); }
}

async function loadConfig() {
  const ta = document.getElementById('configTextarea');
  const errEl = document.getElementById('configError');
  const sucEl = document.getElementById('configSuccess');
  setHiddenState(errEl, true);
  setHiddenState(sucEl, true);
  ta.value = 'Loading...';
  try {
    const res = await authFetch(API_BASE + '/api/openclaw-config');
    const data = await res.json();
    if (data.error) {
      errEl.textContent = data.error;
      setHiddenState(errEl, false);
      return;
    }
    ta.value = JSON.stringify(JSON.parse(data.config), null, 2);
  } catch(e) {
    errEl.textContent = 'Failed to load: ' + e.message;
    setHiddenState(errEl, false);
  }
}

async function saveConfig() {
  const ta = document.getElementById('configTextarea');
  const errEl = document.getElementById('configError');
  const sucEl = document.getElementById('configSuccess');
  setHiddenState(errEl, true);
  setHiddenState(sucEl, true);
  try {
    JSON.parse(ta.value);
  } catch(e) {
    errEl.textContent = 'Invalid JSON: ' + e.message;
    setHiddenState(errEl, false);
    return;
  }
  if (!confirm('Save config and restart OpenClaw gateway?')) return;
  try {
    const res = await authFetch(API_BASE + '/api/openclaw-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: ta.value })
    });
    const data = await res.json();
    if (data.error) {
      errEl.textContent = data.error;
      setHiddenState(errEl, false);
      return;
    }
    sucEl.textContent = '✅ Config saved. Backup: ' + data.backup + '. Gateway restarting...';
    setHiddenState(sucEl, false);
    showToast('Config saved, gateway restarting...', 'success');
  } catch(e) {
    errEl.textContent = 'Save failed: ' + e.message;
    setHiddenState(errEl, false);
  }
}

function cancelReauth() {
  setOpenState('reauthOverlay', false, 'reauth-overlay-open');
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
    const makeCell = (tag, text, style, className) => {
      const el = document.createElement(tag);
      if (style) el.style.cssText = style;
      if (className) el.className = className;
      el.textContent = text;
      return el;
    };
    const ce = document.getElementById('dockerContainers');
    if (data.containers && data.containers.length) {
      const table = document.createElement('table');
      table.style.cssText = 'width:100%;font-size:12px;border-collapse:collapse;';
      const headerRow = document.createElement('tr');
      headerRow.style.borderBottom = '1px solid var(--border)';
      ['Name', 'Image', 'Status', 'Ports', 'Actions'].forEach((label, idx) => {
        headerRow.appendChild(makeCell('th', label, `text-align:${idx === 4 ? 'center' : 'left'};padding:6px;`));
      });
      table.appendChild(headerRow);
      data.containers.forEach(c => {
        const running = c.State === 'running';
        const dot = running ? '🟢' : '🔴';
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border)';
        tr.appendChild(makeCell('td', `${dot} ${c.Names || ''}`, 'padding:6px;'));
        tr.appendChild(makeCell('td', c.Image || '', 'padding:6px;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;'));
        tr.appendChild(makeCell('td', c.Status || '', 'padding:6px;color:var(--text-secondary);'));
        tr.appendChild(makeCell('td', c.Ports || '-', 'padding:6px;color:var(--text-muted);font-size:11px;'));
        const actionsTd = makeCell('td', '', 'padding:6px;text-align:center;');
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
          btn.addEventListener('click', () => dockerAction(def.action, c.Names || ''));
          actionsTd.appendChild(btn);
        });
        tr.appendChild(actionsTd);
        table.appendChild(tr);
      });
      ce.innerHTML = '';
      ce.appendChild(table);
    } else {
      setViewerMessage(ce, 'No containers found');
      ce.firstElementChild.style.fontSize = '13px';
    }

    const ie = document.getElementById('dockerImages');
    if (data.images && data.images.length) {
      const table = document.createElement('table');
      table.style.cssText = 'width:100%;font-size:12px;border-collapse:collapse;';
      const headerRow = document.createElement('tr');
      headerRow.style.borderBottom = '1px solid var(--border)';
      ['Repository', 'Tag', 'Size'].forEach(label => {
        headerRow.appendChild(makeCell('th', label, 'text-align:left;padding:6px;'));
      });
      table.appendChild(headerRow);
      data.images.forEach(i => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border)';
        tr.appendChild(makeCell('td', i.Repository || '', 'padding:6px;'));
        tr.appendChild(makeCell('td', i.Tag || '', 'padding:6px;color:var(--text-secondary);'));
        tr.appendChild(makeCell('td', i.Size || '', 'padding:6px;color:var(--text-muted);'));
        table.appendChild(tr);
      });
      ie.innerHTML = '';
      ie.appendChild(table);
    } else {
      setViewerMessage(ie, 'No images found');
      ie.firstElementChild.style.fontSize = '13px';
    }

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

function setNotifPanelExpanded(isExpanded) {
  ['notificationBell', 'notificationBellMobile'].forEach(id => {
    const bell = document.getElementById(id);
    if (bell) bell.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
  });
}

function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  const isOpen = isOpenState(panel, NOTIF_PANEL_OPEN_CLASS);
  setOpenState(panel, !isOpen, NOTIF_PANEL_OPEN_CLASS);
  setNotifPanelExpanded(!isOpen);
  if (!isOpen) fetchNotifications();
}

async function fetchNotifications() {
  try {
    const res = await authFetch(API_BASE + '/api/notifications?limit=50');
    const data = await res.json();
    const body = document.getElementById('notifPanelBody');
    if (!data.events || !data.events.length) {
      body.innerHTML = '';
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:20px;text-align:center;color:var(--text-muted);';
      empty.textContent = 'No events yet';
      body.appendChild(empty);
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
      const iconEl = document.createElement('div');
      iconEl.className = 'notif-icon';
      iconEl.textContent = icon;
      const contentEl = document.createElement('div');
      contentEl.className = 'notif-content';
      const eventEl = document.createElement('div');
      eventEl.className = 'notif-event';
      eventEl.textContent = (notifLabels[e.event] || (e.event||'').replace(/_/g, ' ')) + detail + ip;
      const timeEl = document.createElement('div');
      timeEl.className = 'notif-time';
      timeEl.textContent = time;
      contentEl.appendChild(eventEl);
      contentEl.appendChild(timeEl);
      item.appendChild(iconEl);
      item.appendChild(contentEl);
      body.appendChild(item);
    });
    if (data.events.length) {
      notifLastSeen = data.events[0].timestamp;
      localStorage.setItem('notifLastSeen', notifLastSeen);
      setNotifBadgeVisible('notifBadge', false);
      setNotifBadgeVisible('notifBadgeMobile', false);
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
        setNotifBadgeVisible(badge, true, newCount);
        setNotifBadgeVisible(badgeMobile, true, newCount);
      }
    }
  } catch {}
}
function handleNotifPanelOutsideClick(e) {
  const panel = document.getElementById('notifPanel');
  const bell = document.getElementById('notificationBell');
  const bellMobile = document.getElementById('notificationBellMobile');
  if (!panel || !bell) return;
  if (isOpenState(panel, NOTIF_PANEL_OPEN_CLASS) && !panel.contains(e.target) && !bell.contains(e.target) && (!bellMobile || !bellMobile.contains(e.target))) {
    setOpenState(panel, false, NOTIF_PANEL_OPEN_CLASS);
    setNotifPanelExpanded(false);
  }
}

function initSystemUi() {
  if (!document.body.dataset.boundSystemUi) {
    document.body.dataset.boundSystemUi = 'true';
    document.addEventListener('click', handleNotifPanelOutsideClick);
  }
  visibleInterval(checkNewNotifications, 30000);
  setTimeout(checkNewNotifications, 3000);
}

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
