function initializeDashboard() {
  initAuthUi();
  initAppUi();
  initMiscUi();
  initSystemUi();
  beginAuthBootstrap();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDashboard, { once: true });
} else {
  initializeDashboard();
}
