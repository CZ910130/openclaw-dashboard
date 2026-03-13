const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { sendJson } = require('../lib/utils');

function setupUsageRoutes(req, res, WORKSPACE_DIR, dataDir) {
  const providers = {
    'claude': { 
      file: path.join(dataDir, 'claude-usage.json'), 
      script: path.join(WORKSPACE_DIR, 'scripts', 'scrape-claude-usage.sh') 
    },
    'gemini': { 
      file: path.join(dataDir, 'gemini-usage.json'), 
      script: path.join(WORKSPACE_DIR, 'scripts', 'scrape-gemini-usage.sh') 
    },
    'glm': { 
      file: path.join(dataDir, 'glm-usage.json'), 
      script: path.join(WORKSPACE_DIR, 'scripts', 'scrape-glm-usage.sh') 
    },
    'kimi': { 
      file: path.join(dataDir, 'kimi-usage.json'), 
      script: path.join(WORKSPACE_DIR, 'scripts', 'scrape-kimi-usage.sh') 
    }
  };

  // Handle /api/usage/:provider
  const usageMatch = req.url.match(/^\/api\/usage\/([a-z]+)$/);
  if (usageMatch && req.method === 'GET') {
    const provider = usageMatch[1];
    const config = providers[provider];
    if (!config) return false;

    try {
      const data = JSON.parse(fs.readFileSync(config.file, 'utf8'));
      sendJson(req, res, data);
    } catch {
      sendJson(req, res, { error: `No usage data for ${provider}. Run scrape first.` }, 404);
    }
    return true;
  }

  // Handle /api/usage/scrape/:provider
  const scrapeMatch = req.url.match(/^\/api\/usage\/scrape\/([a-z]+)$/);
  if (scrapeMatch && req.method === 'POST') {
    const provider = scrapeMatch[1];
    const config = providers[provider];
    if (!config) return false;

    if (fs.existsSync(config.script)) {
      execFile('bash', [config.script], { timeout: 60000 }, (err) => {});
      sendJson(req, res, { status: 'started', provider });
    } else {
      sendJson(req, res, { status: 'error', message: `${provider} scrape script not found` }, 404);
    }
    return true;
  }

  // Support legacy endpoints for backward compatibility
  const legacyMap = {
    '/api/claude-usage': 'claude',
    '/api/gemini-usage': 'gemini',
    '/api/glm-usage': 'glm',
    '/api/kimi-usage': 'kimi'
  };
  if (legacyMap[req.url] && req.method === 'GET') {
    const provider = legacyMap[req.url];
    const config = providers[provider];
    try {
      const data = JSON.parse(fs.readFileSync(config.file, 'utf8'));
      sendJson(req, res, data);
    } catch {
      sendJson(req, res, { error: `No usage data for ${provider}.` }, 404);
    }
    return true;
  }

  const legacyScrapeMap = {
    '/api/claude-usage-scrape': 'claude',
    '/api/gemini-usage-scrape': 'gemini',
    '/api/glm-usage-scrape': 'glm',
    '/api/kimi-usage-scrape': 'kimi'
  };
  if (legacyScrapeMap[req.url] && req.method === 'POST') {
    const provider = legacyScrapeMap[req.url];
    const config = providers[provider];
    if (fs.existsSync(config.script)) {
      execFile('bash', [config.script], { timeout: 60000 }, (err) => {});
      sendJson(req, res, { status: 'started' });
    } else {
      sendJson(req, res, { status: 'error', message: 'Script not found' }, 404);
    }
    return true;
  }

  return false;
}

module.exports = {
  setupUsageRoutes
};
