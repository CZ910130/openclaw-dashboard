'use strict';

const { execSync } = require('child_process');
const { getClientIP } = require('../lib/http');
const { auditLog } = require('../lib/auth');

const run = (cmd) => {
  try {
    return execSync(cmd, { timeout: 10000 }).toString();
  } catch (e) {
    return e.stdout ? e.stdout.toString() : 'Error: ' + e.message;
  }
};

const ALLOWED_ACTIONS = ['start', 'stop', 'restart', 'prune-containers', 'prune-images'];
const ID_PATTERN = /^[a-zA-Z0-9_.-]+$/;

function handle(req, res, ctx) {
  const url = req.url.split('?')[0];
  const ip = getClientIP(req);

  // GET /api/docker
  if (url === '/api/docker' && req.method === 'GET') {
    try {
      const containers = JSON.parse(run('docker ps -a --format "{{json .}}" | jq -s "."') || '[]');
      const images = JSON.parse(run('docker images --format "{{json .}}" | jq -s "."') || '[]');
      const system = run('docker system df 2>&1');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ containers, images, system }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ containers: [], images: [], system: 'Docker not available: ' + e.message }));
    }
    auditLog(ctx.auditLogPath, 'docker_view', ip, {});
    return true;
  }

  // POST /api/docker/action
  if (url === '/api/docker/action' && req.method === 'POST') {
    let body = '';
    let destroyed = false;

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) {
        destroyed = true;
        req.destroy();
      }
    });

    req.on('end', () => {
      if (destroyed) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }

      try {
        const { action, id } = JSON.parse(body);

        if (!ALLOWED_ACTIONS.includes(action)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid action' }));
          return;
        }

        let result;

        if (action === 'prune-containers') {
          // Shell execution needed for docker CLI commands as specified
          result = execSync('docker container prune -f', { timeout: 30000 }).toString();
        } else if (action === 'prune-images') {
          result = execSync('docker image prune -f', { timeout: 30000 }).toString();
        } else {
          // start, stop, restart - validate id strictly before use
          if (!id || !ID_PATTERN.test(id)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid container ID' }));
            return;
          }
          result = execSync('docker ' + action + ' ' + id, { timeout: 15000 }).toString();
        }

        auditLog(ctx.auditLogPath, 'docker_action', ip, { action, id });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

    return true;
  }

  return false;
}

module.exports = { handle };
