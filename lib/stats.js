const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { toNum, normalizeProvider, normalizeModel, estimateMsgCost } = require('./utils');

async function tailRead(filePath, bytes = 8192) {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.size === 0) return '';
    const readBytes = Math.min(bytes, stat.size);
    const buf = Buffer.alloc(readBytes);
    const fh = await fsp.open(filePath, 'r');
    try {
      await fh.read(buf, 0, readBytes, stat.size - readBytes);
    } finally {
      await fh.close();
    }
    const chunk = buf.toString('utf8');
    if (readBytes < stat.size) {
      const nl = chunk.indexOf('\n');
      return nl >= 0 ? chunk.slice(nl + 1) : chunk;
    }
    return chunk;
  } catch { return ''; }
}

async function getLastMessage(sessDir, sessionId) {
  try {
    const filePath = path.join(sessDir, sessionId + '.jsonl');
    const tail = await tailRead(filePath, 16384);
    if (!tail) return '';
    const lines = tail.split('\n').filter(l => l.trim());
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
      try {
        const d = JSON.parse(lines[i]);
        if (d.type !== 'message') continue;
        const msg = d.message;
        if (!msg) continue;
        const role = msg.role;
        if (role !== 'user' && role !== 'assistant') continue;
        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const b of msg.content) {
            if (b.type === 'text' && b.text) { text = b.text; break; }
          }
        }
        if (text) return text.replace(/\n/g, ' ').substring(0, 80);
      } catch {}
    }
    return '';
  } catch { return ''; }
}

function getMemoryStats() {
  const totalMem = os.totalmem();
  if (process.platform !== 'darwin') {
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    return { total: totalMem, used: usedMem, free: freeMem, percent: Math.round((usedMem / totalMem) * 100) };
  }
  try {
    const out = execSync('vm_stat', { encoding: 'utf8', timeout: 2000 });
    let pageSize = 4096;
    const pageSizeMatch = out.match(/page size of (\d+) bytes/);
    if (pageSizeMatch) pageSize = parseInt(pageSizeMatch[1], 10);
    const num = (name) => {
      const m = out.match(new RegExp(name + ':\\s*(\\d+)'));
      return m ? parseInt(m[1], 10) * pageSize : 0;
    };
    const free = num('Pages free');
    const active = num('Pages active');
    const inactive = num('Pages inactive');
    const wired = num('Pages wired');
    const compressed = num('Pages occupied by compressor');
    const usedMem = active + wired + (compressed || 0);
    const availMem = free + inactive;
    const usedDisplay = Math.min(usedMem, totalMem - free);
    const memPercent = totalMem > 0 ? Math.min(100, Math.round((usedDisplay / totalMem) * 100)) : 0;
    return { total: totalMem, used: usedDisplay, free: free, percent: memPercent };
  } catch (e) {
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    return { total: totalMem, used: usedMem, free: freeMem, percent: Math.round((usedMem / totalMem) * 100) };
  }
}

function getSystemStats() {
  try {
    const mem = getMemoryStats();
    const totalMem = mem.total;
    const usedMem = mem.used;
    const freeMem = mem.free;
    const memPercent = mem.percent;

    let cpuTemp = null;
    if (process.platform === 'linux') {
      try {
        const tempRaw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim();
        cpuTemp = parseInt(tempRaw, 10) / 1000;
      } catch {}
    } else if (process.platform === 'darwin') {
      try {
        const out = execSync('osx-cpu-temp 2>/dev/null || true', { encoding: 'utf8', timeout: 2000 }).trim();
        const match = out.match(/(\d+(?:\.\d+)?)/);
        if (match) cpuTemp = parseFloat(match[1]);
      } catch {}
    }

    const loadAvg = os.loadavg();
    const uptime = os.uptime();

    let cpuUsage = 0;
    try {
      const loadAvg1m = os.loadavg()[0];
      const numCpus = os.cpus().length;
      cpuUsage = Math.min(Math.round((loadAvg1m / numCpus) * 100), 100);
    } catch {
      cpuUsage = 0;
    }

    let diskPercent = 0, diskUsed = '', diskTotal = '';
    try {
      if (process.platform === 'darwin') {
        const df = execSync("df -g / | tail -1", { encoding: 'utf8' }).trim();
        const parts = df.split(/\s+/).filter(Boolean);
        if (parts.length >= 5) {
          const totalGB = parseInt(parts[1], 10) || 0;
          const usedGB = parseInt(parts[2], 10) || 0;
          const pctStr = parts[4].replace('%', '');
          diskPercent = parseInt(pctStr, 10) || 0;
          diskUsed = usedGB + 'G';
          diskTotal = totalGB + 'G';
        }
      } else {
        const df = execSync("df / --output=pcent,used,size -B1G | tail -1", { encoding: 'utf8' }).trim();
        const parts = df.split(/\s+/);
        diskPercent = parseInt(parts[0], 10) || 0;
        diskUsed = (parts[1] || '') + 'G';
        diskTotal = (parts[2] || '') + 'G';
      }
    } catch {}

    let crashCount = 0;
    let crashesToday = 0;
    if (process.platform === 'linux') {
      try {
        let logs = '';
        try {
          logs = execSync("journalctl -u openclaw --since '7 days ago' --no-pager -o short 2>/dev/null | grep -ci 'SIGABRT\\|SIGSEGV\\|exit code [1-9]\\|process crashed\\|fatal error' || echo 0", { encoding: 'utf8' }).trim();
        } catch {
          logs = execSync("journalctl --user -u openclaw --since '7 days ago' --no-pager -o short 2>/dev/null | grep -ci 'SIGABRT\\|SIGSEGV\\|exit code [1-9]\\|process crashed\\|fatal error' || echo 0", { encoding: 'utf8' }).trim();
        }
        crashCount = parseInt(logs, 10) || 0;
      } catch {}
      try {
        let logs = '';
        try {
          logs = execSync("journalctl -u openclaw --since today --no-pager -o short 2>/dev/null | grep -ci 'SIGABRT\\|SIGSEGV\\|exit code [1-9]\\|process crashed\\|fatal error' || echo 0", { encoding: 'utf8' }).trim();
        } catch {
          logs = execSync("journalctl --user -u openclaw --since today --no-pager -o short 2>/dev/null | grep -ci 'SIGABRT\\|SIGSEGV\\|exit code [1-9]\\|process crashed\\|fatal error' || echo 0", { encoding: 'utf8' }).trim();
        }
        crashesToday = parseInt(logs, 10) || 0;
      } catch {}
    }

    return {
      cpu: { usage: cpuUsage, temp: cpuTemp },
      disk: { percent: diskPercent, used: diskUsed, total: diskTotal },
      crashCount,
      crashesToday,
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        percent: memPercent,
        totalGB: (totalMem / 1073741824).toFixed(1),
        usedGB: (usedMem / 1073741824).toFixed(1),
        freeGB: (freeMem / 1073741824).toFixed(1)
      },
      loadAvg: { '1m': loadAvg[0].toFixed(2), '5m': loadAvg[1].toFixed(2), '15m': loadAvg[2].toFixed(2) },
      uptime: uptime
    };
  } catch (e) {
    return { cpu: { usage: 0, temp: null }, memory: { total: 0, used: 0, free: 0, percent: 0 }, loadAvg: { '1m': 0, '5m': 0, '15m': 0 }, uptime: 0 };
  }
}

module.exports = {
  tailRead,
  getLastMessage,
  getSystemStats
};
