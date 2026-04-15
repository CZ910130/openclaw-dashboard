const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.env.OPENCLAW_WORKSPACE || process.cwd();
const pricingFile = path.join(WORKSPACE_DIR, 'data', 'model_pricing_usd_per_million.json');
const PRICING_CACHE_TTL_MS = 60000;
let pricingCache = { loadedAt: 0, mtimeMs: 0, value: null };

const DEFAULT_MODEL_PRICING = {
  'anthropic/claude-opus-4-6': { input: 15.00, output: 75.00, cacheRead: 1.875, cacheWrite: 18.75 },
  'anthropic/claude-opus-4-5': { input: 15.00, output: 75.00, cacheRead: 1.875, cacheWrite: 18.75 },
  'anthropic/claude-sonnet-4-6': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'anthropic/claude-sonnet-4-5': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'anthropic/claude-3-5-haiku-latest': { input: 0.80, output: 4.00, cacheRead: 0.08, cacheWrite: 1.00 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60, cacheRead: 0.075, cacheWrite: 0.30 },
  'openai/gpt-4.1-mini': { input: 0.40, output: 1.60, cacheRead: 0.20, cacheWrite: 0.80 },
  'openai-codex/gpt-5.4': { input: 2.50, output: 15.00, cacheRead: 0.25, cacheWrite: 0.00 },
  'google/gemini-3-pro-preview': { input: 1.25, output: 10.00, cacheRead: 0.31, cacheWrite: 4.50 },
  'google/gemini-3-flash-preview': { input: 0.15, output: 0.60, cacheRead: 0.04, cacheWrite: 0.15 },
  'xai/grok-4-1-fast': { input: 0.20, output: 0.50, cacheRead: 0.05, cacheWrite: 0.20 },
  // ZhipuAI (zai provider)
  'zai/glm-5': { input: 0.5, output: 0.5, cacheRead: 0, cacheWrite: 0 },
  'zai/glm-4.7': { input: 0.5, output: 0.5, cacheRead: 0, cacheWrite: 0 },
  // Kimi (Moonshot)
  'kimi-coding/k2p5': { input: 2.0, output: 10.0, cacheRead: 0, cacheWrite: 0 },
  // MiniMax
  'minimax/MiniMax-M2.5': { input: 0.3, output: 1.0, cacheRead: 0, cacheWrite: 0 },
  'minimax/MiniMax-M2.1': { input: 0.3, output: 1.0, cacheRead: 0, cacheWrite: 0 },
  'minimax/MiniMax-M2.7': { input: 0.3, output: 1.0, cacheRead: 0, cacheWrite: 0 },
  // OpenCode-Go
  'opencode-go/mimo-v2-pro': { input: 1.0, output: 3.0, cacheRead: 0.2, cacheWrite: 0 }
};

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function loadModelPricing(force = false) {
  try {
    let mtimeMs = 0;
    if (fs.existsSync(pricingFile)) {
      try { mtimeMs = fs.statSync(pricingFile).mtimeMs || 0; } catch {}
    }
    const now = Date.now();
    if (!force && pricingCache.value && (now - pricingCache.loadedAt) < PRICING_CACHE_TTL_MS && pricingCache.mtimeMs === mtimeMs) {
      return pricingCache.value;
    }
    if (!fs.existsSync(pricingFile)) {
      pricingCache = { loadedAt: now, mtimeMs: 0, value: { ...DEFAULT_MODEL_PRICING } };
      return pricingCache.value;
    }
    const parsed = JSON.parse(fs.readFileSync(pricingFile, 'utf8'));
    const rates = parsed && parsed.rates_usd_per_million;
    if (!rates || typeof rates !== 'object') {
      pricingCache = { loadedAt: now, mtimeMs, value: { ...DEFAULT_MODEL_PRICING } };
      return pricingCache.value;
    }
    const out = {};
    for (const [k, v] of Object.entries(rates)) {
      if (!k.includes('/') || !v || typeof v !== 'object') continue;
      out[String(k)] = {
        input: toNum(v.input),
        output: toNum(v.output),
        cacheRead: toNum(v.cacheRead),
        cacheWrite: toNum(v.cacheWrite)
      };
    }
    pricingCache = { loadedAt: now, mtimeMs, value: Object.keys(out).length ? out : { ...DEFAULT_MODEL_PRICING } };
    return pricingCache.value;
  } catch {
    pricingCache = { loadedAt: Date.now(), mtimeMs: 0, value: { ...DEFAULT_MODEL_PRICING } };
    return pricingCache.value;
  }
}

module.exports = {
  DEFAULT_MODEL_PRICING,
  loadModelPricing,
  estimateMsgCost
};

function estimateMsgCost(msg) {
  const { toNum, normalizeProvider, normalizeModel } = require('./utils');
  const MODEL_PRICING = loadModelPricing();
  const usage = msg && msg.usage ? msg.usage : {};
  const explicit = toNum(usage.cost && usage.cost.total);
  if (explicit > 0) return explicit;
  const provider = normalizeProvider(msg && msg.provider);
  const modelNorm = normalizeModel(provider, msg && msg.model);
  const rates = MODEL_PRICING[`${provider}/${modelNorm}`];
  if (!rates) return 0;
  const input = Math.max(0, toNum(usage.input)) / 1_000_000;
  const output = Math.max(0, toNum(usage.output)) / 1_000_000;
  const cacheRead = Math.max(0, toNum(usage.cacheRead)) / 1_000_000;
  const cacheWrite = Math.max(0, toNum(usage.cacheWrite)) / 1_000_000;
  return (
    input * toNum(rates.input) +
    output * toNum(rates.output) +
    cacheRead * toNum(rates.cacheRead) +
    cacheWrite * toNum(rates.cacheWrite)
  );
}
