#!/usr/bin/env python3
import glob
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

PROVIDER_SLOT = (sys.argv[1] if len(sys.argv) > 1 else 'openai').strip().lower()
WORKSPACE_DIR = os.environ.get('WORKSPACE_DIR') or os.environ.get('OPENCLAW_WORKSPACE') or os.getcwd()
OPENCLAW_DIR = os.environ.get('OPENCLAW_DIR') or os.path.join(os.path.expanduser('~'), '.openclaw')
AGENT_ID = os.environ.get('OPENCLAW_AGENT') or 'main'
SESSIONS_DIR = os.path.join(OPENCLAW_DIR, 'agents', AGENT_ID, 'sessions')
OUTPUT_FILE = os.path.join(WORKSPACE_DIR, 'data', f'{PROVIDER_SLOT}-usage.json')

PROVIDER_PREFIXES = {
    'openai': ['openai-codex', 'openai'],
    'minimax': ['minimax'],
    'opencode-go': ['opencode-go'],
}
DISPLAY_NAME = {
    'openai': 'ChatGPT',
    'minimax': 'MiniMax',
    'opencode-go': 'OpenCode-Go',
}

# Fallback prices if explicit cost is missing in message usage
RATES = {
    ('openai-codex', 'gpt-5.4'): {'input': 2.5, 'output': 15.0, 'cache_read': 0.25},
    ('openai', 'gpt-4o-mini'): {'input': 0.15, 'output': 0.60, 'cache_read': 0.075},
    ('minimax', 'MiniMax-M2.7'): {'input': 0.3, 'output': 1.0, 'cache_read': 0.0},
    ('minimax', 'MiniMax-M2.5'): {'input': 0.3, 'output': 1.0, 'cache_read': 0.0},
    ('minimax', 'MiniMax-M2.1'): {'input': 0.3, 'output': 1.0, 'cache_read': 0.0},
    ('opencode-go', 'mimo-v2-pro'): {'input': 1.0, 'output': 3.0, 'cache_read': 0.2},
}


def to_num(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def fmt_int(n):
    return f"{int(round(n)):,}"


def fmt_cost(v):
    if v >= 10:
        return f"${v:,.2f}"
    if v >= 1:
        return f"${v:,.3f}"
    return f"${v:,.4f}"


def in_slot(provider):
    provider = str(provider or '').strip().lower()
    return any(provider.startswith(prefix) for prefix in PROVIDER_PREFIXES.get(PROVIDER_SLOT, []))


def estimate_cost(provider, model, usage):
    explicit = to_num(((usage or {}).get('cost') or {}).get('total'))
    if explicit > 0:
        return explicit
    rates = RATES.get((str(provider or ''), str(model or '')))
    if not rates:
        return 0.0
    return (
        to_num((usage or {}).get('input')) / 1_000_000 * rates['input'] +
        to_num((usage or {}).get('output')) / 1_000_000 * rates['output'] +
        to_num((usage or {}).get('cacheRead')) / 1_000_000 * rates['cache_read']
    )


def parse_sessions():
    now = datetime.now(timezone.utc)
    cutoff_24h = now - timedelta(hours=24)
    totals_24h_cost_all = 0.0
    totals_24h_tokens_all = 0.0
    slot = {
        'cost_24h': 0.0,
        'tokens_24h': 0.0,
        'messages_24h': 0,
        'cost_all': 0.0,
        'tokens_all': 0.0,
        'messages_all': 0,
        'models_24h': defaultdict(lambda: {'cost': 0.0, 'tokens': 0.0, 'messages': 0}),
    }

    for filepath in glob.glob(os.path.join(SESSIONS_DIR, '*.jsonl')):
        current_provider = 'unknown'
        current_model = 'unknown'
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        event = json.loads(line)
                    except Exception:
                        continue

                    if event.get('type') == 'model_change':
                        current_provider = event.get('provider', current_provider)
                        current_model = event.get('modelId', current_model)
                        continue

                    if event.get('type') != 'message':
                        continue

                    msg = event.get('message') or {}
                    usage = msg.get('usage') or {}
                    if not usage:
                        continue

                    provider = msg.get('provider') or current_provider
                    model = msg.get('model') or current_model
                    ts_raw = msg.get('timestamp') or event.get('timestamp')
                    try:
                        ts = datetime.fromisoformat(str(ts_raw).replace('Z', '+00:00'))
                    except Exception:
                        ts = now

                    tokens = (
                        to_num(usage.get('totalTokens')) or
                        to_num(usage.get('input')) + to_num(usage.get('output')) +
                        to_num(usage.get('cacheRead')) + to_num(usage.get('cacheWrite'))
                    )
                    cost = estimate_cost(provider, model, usage)

                    if ts >= cutoff_24h:
                        totals_24h_cost_all += cost
                        totals_24h_tokens_all += tokens

                    if not in_slot(provider):
                        continue

                    slot['cost_all'] += cost
                    slot['tokens_all'] += tokens
                    slot['messages_all'] += 1

                    if ts >= cutoff_24h:
                        slot['cost_24h'] += cost
                        slot['tokens_24h'] += tokens
                        slot['messages_24h'] += 1
                        m = slot['models_24h'][str(model or 'unknown')]
                        m['cost'] += cost
                        m['tokens'] += tokens
                        m['messages'] += 1
        except Exception:
            continue

    denom = totals_24h_cost_all if totals_24h_cost_all > 0 else totals_24h_tokens_all
    numer = slot['cost_24h'] if totals_24h_cost_all > 0 else slot['tokens_24h']
    percent = round((numer / denom) * 100, 1) if denom > 0 else 0.0

    top_model = None
    if slot['models_24h']:
        top_model = max(slot['models_24h'].items(), key=lambda kv: (kv[1]['cost'], kv[1]['tokens']))[0]

    label = f"{fmt_cost(slot['cost_24h'])} / 24h"
    detail_parts = [
        f"{fmt_int(slot['tokens_24h'])} tokens",
        f"{slot['messages_24h']} msgs",
    ]
    if top_model:
        detail_parts.append(f"top {top_model}")
    detail = ' • '.join(detail_parts)

    return {
        'provider': PROVIDER_SLOT,
        'display_name': DISPLAY_NAME.get(PROVIDER_SLOT, PROVIDER_SLOT),
        'scraped_at': now.isoformat(),
        'session': {
            'percent': percent,
            'label': label,
            'detail': detail,
            'resets': None,
        },
        'all_time': {
            'cost': round(slot['cost_all'], 6),
            'tokens': int(round(slot['tokens_all'])),
            'messages': slot['messages_all'],
        },
        'last_24h': {
            'cost': round(slot['cost_24h'], 6),
            'tokens': int(round(slot['tokens_24h'])),
            'messages': slot['messages_24h'],
            'share_percent': percent,
            'top_model': top_model,
        },
        'source': 'local_sessions',
        'note': 'Derived from local OpenClaw session logs and explicit message usage when available.'
    }


def main():
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    data = parse_sessions()
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    print(json.dumps(data, indent=2))


if __name__ == '__main__':
    main()
