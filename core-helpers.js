function getApiBasePath() {
  var pathname = window.location.pathname;
  if (!pathname || pathname === '/') return '';
  var cleaned = pathname.replace(/\/+$/, '');
  if (cleaned.endsWith('/index.html')) {
    return cleaned.slice(0, -'/index.html'.length);
  }
  return cleaned;
}

const API_BASE = getApiBasePath();
const AUTH_HIDDEN_CLASS = 'auth-form-hidden';
const APP_HIDDEN_CLASS = 'app-hidden';
const NOTIF_PANEL_OPEN_CLASS = 'notif-panel-open';
const SESSION_MODAL_OPEN_CLASS = 'session-modal-open';
const NOTIF_BADGE_VISIBLE_CLASS = 'notification-badge-visible';

function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.classList.toggle('mobile-open');
  }
}

document.addEventListener('click', function(e) {
  const sidebar = document.querySelector('.sidebar');
  const menuBtn = document.querySelector('.mobile-menu-btn');
  if (sidebar && sidebar.classList.contains('mobile-open')) {
    if (!sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
      sidebar.classList.remove('mobile-open');
    }
  }
});

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
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function setEmptyState(el, text, icon) {
  if (!el) return;
  if (icon) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${icon}</div><div class="empty-state-text">${escapeHtml(text)}</div></div>`;
  } else {
    el.innerHTML = `<div class="empty-state-text">${escapeHtml(text)}</div>`;
  }
}

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

function resolveEl(target) {
  return typeof target === 'string' ? document.getElementById(target) : target;
}

function setHiddenState(target, hidden, hiddenClass = 'auth-form-hidden') {
  const el = resolveEl(target);
  if (!el) return null;
  el.classList.toggle(hiddenClass, hidden);
  return el;
}

function setOpenState(target, isOpen, openClass) {
  const el = resolveEl(target);
  if (!el) return null;
  el.classList.toggle(openClass, isOpen);
  return el;
}

function isOpenState(target, openClass) {
  const el = resolveEl(target);
  return !!el && el.classList.contains(openClass);
}

function setNotifBadgeVisible(target, isVisible, count) {
  const badge = resolveEl(target);
  if (!badge) return;
  if (typeof count === 'number') badge.textContent = count;
  badge.classList.toggle('notification-badge-visible', isVisible);
}
