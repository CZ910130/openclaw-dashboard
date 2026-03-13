const { execSync, exec } = require('child_process');
const { sendJson, auditLog, getClientIP } = require('../lib/utils');
const { getSystemStats } = require('../lib/stats');

function setupSystemRoutes(req, res, options) {
  const { auditLogPath, ip } = options;

  if (req.url === '/api/system') {
    const stats = getSystemStats();
    // history tracking logic is in server.js for now, but stats includes the snapshot
    sendJson(req, res, stats);
    return true;
  }

  if (req.url === '/api/docker') {
    const run = (cmd) => { try { return execSync(cmd, { timeout: 10000 }).toString(); } catch(e) { return e.stdout ? e.stdout.toString() : 'Error: ' + e.message; } };
    try {
      const containers = JSON.parse(run('docker ps -a --format "{{json .}}" | jq -s "."') || '[]');
      const images = JSON.parse(run('docker images --format "{{json .}}" | jq -s "."') || '[]');
      const system = run('docker system df 2>&1');
      sendJson(req, res, { containers, images, system });
    } catch(e) {
      sendJson(req, res, { containers: [], images: [], system: 'Docker not available: ' + e.message });
    }
    auditLog(auditLogPath, 'docker_view', ip, {});
    return true;
  }

  if (req.url === '/api/docker/action' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try {
        const { action, id } = JSON.parse(body);
        const allowed = { 'start': 1, 'stop': 1, 'restart': 1, 'prune-containers': 1, 'prune-images': 1 };
        if (!allowed[action]) { sendJson(req, res, { error: 'Invalid action' }, 400); return; }
        let result;
        if (action === 'prune-containers') { result = execSync('docker container prune -f', { timeout: 30000 }).toString(); }
        else if (action === 'prune-images') { result = execSync('docker image prune -f', { timeout: 30000 }).toString(); }
        else {
          if (!id || !/^[a-zA-Z0-9_.-]+$/.test(id)) { sendJson(req, res, { error: 'Invalid container ID' }, 400); return; }
          result = execSync('docker ' + action + ' ' + id, { timeout: 15000 }).toString();
        }
        auditLog(auditLogPath, 'docker_action', ip, { action, id });
        sendJson(req, res, { ok: true, result });
      } catch(e) { sendJson(req, res, { error: e.message }, 500); }
    });
    return true;
  }

  if (req.url === '/api/sys-security') {
    const run = (cmd) => { try { return execSync(cmd, { timeout: 10000 }).toString().replace(/</g, '&lt;').replace(/>/g, '&gt;'); } catch(e) { return e.stdout ? e.stdout.toString().replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Error: ' + e.message; } };
    const data = {
      ufw: run('ufw status verbose 2>&1'),
      ports: run('ss -ltnp 2>&1'),
      fail2ban: run('fail2ban-client status 2>&1 && echo "---" && fail2ban-client status sshd 2>&1'),
      ssh: run('journalctl -u ssh --no-pager -n 50 --grep="Failed\\|Invalid\\|Accepted" 2>&1 || journalctl -u sshd --no-pager -n 50 --grep="Failed\\|Invalid\\|Accepted" 2>&1'),
      audit: run('openclaw security audit 2>&1'),
    };
    sendJson(req, res, data);
    auditLog(auditLogPath, 'sys_security_view', ip, {});
    return true;
  }

  return false;
}

module.exports = {
  setupSystemRoutes
};
