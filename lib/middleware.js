const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- Static File Cache with Gzip Pre-compression ---
const staticCache = {};

function preloadStaticFile(filePath, contentType) {
  try {
    const raw = fs.readFileSync(filePath);
    const compressed = zlib.gzipSync(raw);
    staticCache[path.basename(filePath)] = { raw, compressed, contentType, mtime: fs.statSync(filePath).mtimeMs };
  } catch {}
}

function initStaticCache(rootDir) {
  const files = [
    { name: 'index.html', type: 'text/html' },
    { name: 'styles.css', type: 'text/css' },
    { name: 'core-helpers.js', type: 'application/javascript' },
    { name: 'render-helpers.js', type: 'application/javascript' },
    { name: 'app.js', type: 'application/javascript' },
    { name: 'misc-ui.js', type: 'application/javascript' },
    { name: 'system-ui.js', type: 'application/javascript' }
  ];
  for (const f of files) {
    preloadStaticFile(path.join(rootDir, f.name), f.type);
    // Watch for changes and invalidate cache
    try {
      fs.watch(path.join(rootDir, f.name), () => {
        preloadStaticFile(path.join(rootDir, f.name), f.type);
      });
    } catch {}
  }
}

function serveStatic(req, res, filename) {
  const entry = staticCache[filename];
  if (!entry) return false;
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (acceptEncoding.includes('gzip')) {
    res.writeHead(200, {
      'Content-Type': entry.contentType,
      'Content-Encoding': 'gzip',
      'Vary': 'Accept-Encoding',
      'Content-Length': entry.compressed.length
    });
    res.end(entry.compressed);
  } else {
    res.writeHead(200, {
      'Content-Type': entry.contentType,
      'Content-Length': entry.raw.length
    });
    res.end(entry.raw);
  }
  return true;
}

// --- Request Timing & API Stats ---
const apiStats = {
  totalRequests: 0,
  endpoints: {},      // { path: { count, totalMs, maxMs, lastAccessed } }
  slowQueries: [],    // [{ path, method, durationMs, timestamp }]
  startTime: Date.now()
};

const SLOW_QUERY_THRESHOLD_MS = 2000;
const MAX_SLOW_QUERIES = 50;

function trackRequest(req, res) {
  const start = process.hrtime.bigint();
  const originalEnd = res.end.bind(res);

  res.end = function (...args) {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationMs = Math.round(durationNs / 1e6 * 100) / 100;

    // Only track API routes
    const url = req.url.split('?')[0];
    if (url.startsWith('/api/')) {
      apiStats.totalRequests++;
      if (!apiStats.endpoints[url]) {
        apiStats.endpoints[url] = { count: 0, totalMs: 0, maxMs: 0, lastAccessed: 0 };
      }
      const ep = apiStats.endpoints[url];
      ep.count++;
      ep.totalMs += durationMs;
      if (durationMs > ep.maxMs) ep.maxMs = durationMs;
      ep.lastAccessed = Date.now();

      // Slow query detection
      if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
        apiStats.slowQueries.push({
          path: url,
          method: req.method,
          durationMs,
          statusCode: res.statusCode,
          timestamp: new Date().toISOString()
        });
        if (apiStats.slowQueries.length > MAX_SLOW_QUERIES) {
          apiStats.slowQueries = apiStats.slowQueries.slice(-MAX_SLOW_QUERIES);
        }
      }
    }

    // Add Server-Timing header for transparency
    res.setHeader('Server-Timing', `total;dur=${durationMs}`);
    return originalEnd(...args);
  };
}

function getApiStats() {
  const endpoints = Object.entries(apiStats.endpoints)
    .map(([path, data]) => ({
      path,
      count: data.count,
      avgMs: Math.round(data.totalMs / data.count * 100) / 100,
      maxMs: data.maxMs,
      lastAccessed: data.lastAccessed
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalRequests: apiStats.totalRequests,
    uptimeSeconds: Math.round((Date.now() - apiStats.startTime) / 1000),
    endpoints,
    slowQueries: apiStats.slowQueries.slice(-20).reverse()
  };
}

module.exports = {
  initStaticCache,
  serveStatic,
  trackRequest,
  getApiStats
};
