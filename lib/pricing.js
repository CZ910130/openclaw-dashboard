const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.env.OPENCLAW_WORKSPACE || process.cwd();
const pricingFile = path.join(WORKSPACE_DIR, 'data', 'model_pricing_usd_per_million.json');

const DEFAULT_MODEL_PRICING = {
  'anthropic/claude-opus-4-6': { input: 15.00, output: 75.00, cacheRead: 1.875, cacheWrite: 18.75 },
  'anthropic/claude-opus-4-5': { input: 15.00, output: 75.00, cacheRead: 1.875, cacheWrite: 18.75 },
  'anthropic/claude-sonnet-4-6': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'anthropic/claude-sonnet-4-5': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'anthropic/claude-3-5-haiku-latest': { input: 0.80, output: 4.00, cacheRead: 0.08, cacheWrite: 1.00 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60, cacheRead: 0.075, cacheWrite: 0.30 },
  'openai/gpt-4.1-mini': { input: 0.40, output: 1.60, cacheRead: 0.20, cacheWrite: 0.80 },
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
  'minimax/MiniMax-M2.1': { input: 0.3, output: 1.0, cacheRead: 0, cacheWrite: 0 }
};

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function loadModelPricing() {
  try {
    if (!fs.existsSync(pricingFile)) return { ...DEFAULT_MODEL_PRICING };
    const parsed = JSON.parse(fs.readFileSync(pricingFile, 'utf8'));
    const rates = parsed && parsed.rates_usd_per_million;
    if (!rates || typeof rates !== 'object') return { ...DEFAULT_MODEL_PRICING };
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
    return Object.keys(out).length ? out : { ...DEFAULT_MODEL_PRICING };
  } catch {
    return { ...DEFAULT_MODEL_PRICING };
  }
}

module.exports = {
  DEFAULT_MODEL_PRICING,
  loadModelPricing
};
