#!/usr/bin/env python3
"""
Token Usage Estimator for OpenClaw Dashboard
Parses session logs and estimates costs based on token counts
"""

import json
import os
import glob
from datetime import datetime, timezone
from collections import defaultdict

# Pricing models (per 1M tokens) - UPDATE THESE WITH YOUR ACTUAL RATES
PRICING = {
    "zai": {
        "glm-5": {"input": 0.50, "output": 0.50, "cache_read": 0.25},  # Example rates
        "glm-4.7": {"input": 0.30, "output": 0.30, "cache_read": 0.15},
        "glm-4.7-flash": {"input": 0.10, "output": 0.10, "cache_read": 0.05},
        "default": {"input": 0.50, "output": 0.50, "cache_read": 0.25}
    },
    "kimi-coding": {
        "k2p5": {"input": 2.00, "output": 8.00, "cache_read": 1.00},  # Example rates
        "default": {"input": 2.00, "output": 8.00, "cache_read": 1.00}
    },
    "default": {
        "default": {"input": 1.00, "output": 3.00, "cache_read": 0.50}
    }
}

def parse_sessions():
    """Parse all session files and extract token usage"""
    sessions_dir = os.path.expanduser("~/.openclaw/agents/main/sessions")
    
    # Stats by date
    daily_stats = defaultdict(lambda: {
        "total_input": 0,
        "total_output": 0,
        "total_cache": 0,
        "total_tokens": 0,
        "estimated_cost": 0.0,
        "providers": defaultdict(lambda: {
            "input": 0,
            "output": 0,
            "cache": 0,
            "cost": 0.0
        })
    })
    
    session_files = glob.glob(f"{sessions_dir}/*.jsonl")
    
    for filepath in session_files:
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                current_provider = "unknown"
                current_model = "unknown"
                
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    
                    # Track model changes
                    if event.get("type") == "model_change":
                        current_provider = event.get("provider", "unknown")
                        current_model = event.get("modelId", "unknown")
                    
                    # Extract usage from message events
                    if event.get("type") == "message":
                        msg = event.get("message", {})
                        usage = msg.get("usage", {})
                        
                        # Skip failed/error messages - they have input tokens but no cost
                        stop_reason = msg.get("stopReason", "").lower()
                        if stop_reason == "error" or "error" in str(msg.get("error", "")).lower():
                            continue
                        
                        if not usage:
                            continue
                        
                        # Get timestamp
                        ts = event.get("timestamp", "")
                        if ts:
                            try:
                                date = ts.split("T")[0]  # YYYY-MM-DD
                            except:
                                date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                        else:
                            date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                        
                        # Extract tokens
                        input_tokens = usage.get("input", 0)
                        output_tokens = usage.get("output", 0)
                        cache_read = usage.get("cacheRead", 0)
                        total = usage.get("totalTokens", input_tokens + output_tokens + cache_read)
                        
                        # Get pricing
                        provider_pricing = PRICING.get(current_provider, PRICING["default"])
                        model_pricing = provider_pricing.get(current_model, provider_pricing["default"])
                        
                        # Calculate cost (per 1M tokens)
                        cost = (
                            (input_tokens / 1_000_000) * model_pricing["input"] +
                            (output_tokens / 1_000_000) * model_pricing["output"] +
                            (cache_read / 1_000_000) * model_pricing["cache_read"]
                        )
                        
                        # Update stats
                        daily_stats[date]["total_input"] += input_tokens
                        daily_stats[date]["total_output"] += output_tokens
                        daily_stats[date]["total_cache"] += cache_read
                        daily_stats[date]["total_tokens"] += total
                        daily_stats[date]["estimated_cost"] += cost
                        
                        # Provider breakdown
                        provider_key = f"{current_provider}/{current_model}"
                        daily_stats[date]["providers"][provider_key]["input"] += input_tokens
                        daily_stats[date]["providers"][provider_key]["output"] += output_tokens
                        daily_stats[date]["providers"][provider_key]["cache"] += cache_read
                        daily_stats[date]["providers"][provider_key]["cost"] += cost
                        
        except Exception as e:
            print(f"Error processing {filepath}: {e}")
            continue
    
    return daily_stats

def update_dashboard_data(stats):
    """Update dashboard data files with estimated costs"""
    dashboard_dir = os.path.expanduser("~/openclaw-dashboard/data")
    os.makedirs(dashboard_dir, exist_ok=True)
    
    # Generate per-day cost data
    per_day = {}
    for date, data in sorted(stats.items()):
        per_day[date] = round(data["estimated_cost"], 4)
    
    # Provider breakdown
    provider_costs = defaultdict(float)
    for date, data in stats.items():
        for provider, pdata in data["providers"].items():
            provider_costs[provider] += pdata["cost"]
    
    # Summary
    summary = {
        "total_sessions": len(stats),
        "total_tokens": sum(d["total_tokens"] for d in stats.values()),
        "total_input_tokens": sum(d["total_input"] for d in stats.values()),
        "total_output_tokens": sum(d["total_output"] for d in stats.values()),
        "total_cache_tokens": sum(d["total_cache"] for d in stats.values()),
        "estimated_total_cost": round(sum(d["estimated_cost"] for d in stats.values()), 4),
        "provider_breakdown": {k: round(v, 4) for k, v in provider_costs.items()},
        "per_day": per_day,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "note": "Estimated costs based on token counts - actual billing may differ"
    }
    
    # Write summary
    summary_file = os.path.join(dashboard_dir, "estimated-usage.json")
    with open(summary_file, 'w') as f:
        json.dump(summary, f, indent=2)
    
    # Write GLM-specific data (for dashboard compatibility)
    glm_data = {
        "provider": "zai",
        "models": ["glm-5", "glm-4.7", "glm-4.7-flash", "glm-4.7-flashx"],
        "estimated_cost": round(sum(
            d["providers"][p]["cost"] 
            for d in stats.values() 
            for p in d["providers"] 
            if p.startswith("zai/")
        ), 4),
        "total_tokens": sum(
            d["providers"][p]["input"] + d["providers"][p]["output"] + d["providers"][p]["cache"]
            for d in stats.values()
            for p in d["providers"]
            if p.startswith("zai/")
        ),
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "per_day": {d: round(data["estimated_cost"], 4) for d, data in sorted(stats.items()) if any(p.startswith("zai/") for p in data["providers"])},
        "note": "Estimated from session logs - actual billing may differ"
    }
    
    with open(os.path.join(dashboard_dir, "glm-usage.json"), 'w') as f:
        json.dump(glm_data, f, indent=2)
    
    # Write Kimi-specific data
    kimi_data = {
        "provider": "kimi-coding",
        "models": ["k2p5"],
        "estimated_cost": round(sum(
            d["providers"][p]["cost"]
            for d in stats.values()
            for p in d["providers"]
            if p.startswith("kimi-coding/")
        ), 4),
        "total_tokens": sum(
            d["providers"][p]["input"] + d["providers"][p]["output"] + d["providers"][p]["cache"]
            for d in stats.values()
            for p in d["providers"]
            if p.startswith("kimi-coding/")
        ),
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "per_day": {d: round(data["estimated_cost"], 4) for d, data in sorted(stats.items()) if any(p.startswith("kimi-coding/") for p in data["providers"])},
        "note": "Estimated from session logs - actual billing may differ"
    }
    
    with open(os.path.join(dashboard_dir, "kimi-usage.json"), 'w') as f:
        json.dump(kimi_data, f, indent=2)
    
    return summary

def main():
    print("🔍 Parsing session logs for token usage...")
    stats = parse_sessions()
    
    if not stats:
        print("⚠️ No usage data found in sessions")
        return
    
    print(f"📊 Found data for {len(stats)} days")
    print("💾 Updating dashboard data files...")
    
    summary = update_dashboard_data(stats)
    
    print(f"\n✅ Updated!")
    print(f"   Total tokens: {summary['total_tokens']:,}")
    print(f"   Estimated cost: ${summary['estimated_total_cost']:.4f}")
    print(f"   Providers: {list(summary['provider_breakdown'].keys())}")

if __name__ == "__main__":
    main()
