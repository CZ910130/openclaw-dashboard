#!/bin/bash
# Kimi (Moonshot AI) Usage Scraper
# 
# API Documentation Status: INCOMPLETE
# Platform: https://platform.moonshot.cn/
# API Base: https://api.moonshot.cn/v1/ (or https://api.kimi.com/coding/)
#
# AUTHENTICATION REQUIRED:
# - API Key (obtained from Moonshot AI platform)
# - Set environment variable: KIMI_API_KEY or MOONSHOT_API_KEY
#
# KNOWN ENDPOINTS:
# - GET /v1/models - List available models
# - POST /v1/chat/completions - Chat completions
# - Models: kimi-k2.5, k2p5 (coding)
#
# USAGE TRACKING:
# - Status: UNDOCUMENTED
# - Need to find: Account balance, token usage, rate limits
# - Possible endpoints (UNVERIFIED):
#   - GET /v1/users/me
#   - GET /v1/balance
#   - GET /v1/usage
#   - GET /v1/account
#
# IMPLEMENTATION NOTES:
# - This is a placeholder script
# - Update this script when official API documentation is available
# - Check platform.moonshot.cn for updates

WORKSPACE_DIR="${WORKSPACE_DIR:-${OPENCLAW_WORKSPACE:-$(pwd)}}"
OUTPUT_FILE="${WORKSPACE_DIR}/data/kimi-usage.json"
LOCK_FILE="/tmp/kimi-usage-scrape.lock"

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
  pid=$(cat "$LOCK_FILE")
  if kill -0 "$pid" 2>/dev/null; then
    echo "Already running (pid $pid)"
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"
trap "rm -f $LOCK_FILE" EXIT

mkdir -p "${WORKSPACE_DIR}/data"

# Check for API key
KIMI_API_KEY="${KIMI_API_KEY:-${MOONSHOT_API_KEY:-}}"

if [ -z "$KIMI_API_KEY" ]; then
  cat > "$OUTPUT_FILE" << EOF
{
  "error": "Kimi API key not configured",
  "message": "Set KIMI_API_KEY or MOONSHOT_API_KEY environment variable",
  "documentation": "Visit https://platform.moonshot.cn/ to obtain API credentials",
  "scraped_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  cat "$OUTPUT_FILE"
  exit 1
fi

# Attempt to fetch usage data
# NOTE: These endpoints are UNVERIFIED and may not exist
# Update the endpoint when official documentation is available

echo "Fetching Kimi usage data..." >&2

# Try multiple possible endpoints at both base URLs
BASE_URLS=(
  "https://api.moonshot.cn/v1"
  "https://api.kimi.com/coding"
)

ENDPOINTS=(
  "/users/me"
  "/balance"
  "/usage"
  "/account"
)

RESPONSE=""
HTTP_CODE="000"

for base_url in "${BASE_URLS[@]}"; do
  for endpoint in "${ENDPOINTS[@]}"; do
    echo "Trying: ${base_url}${endpoint}" >&2
    RESPONSE=$(curl -s -w "\n%{http_code}" \
      -H "Authorization: Bearer ${KIMI_API_KEY}" \
      -H "Content-Type: application/json" \
      "${base_url}${endpoint}" 2>&1)
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" = "200" ]; then
      echo "Success with: ${base_url}${endpoint}" >&2
      break 2
    fi
  done
done

# If no endpoint worked, return placeholder
if [ "$HTTP_CODE" != "200" ]; then
  cat > "$OUTPUT_FILE" << EOF
{
  "error": "Unable to fetch Kimi usage data",
  "message": "API endpoint not found or not documented",
  "http_code": ${HTTP_CODE:-000},
  "note": "Update scrape-kimi-usage.sh when official API documentation is available",
  "documentation_links": [
    "https://platform.moonshot.cn/docs",
    "https://platform.moonshot.cn/docs/api/intro"
  ],
  "scraped_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
else
  # Parse successful response
  echo "$BODY" | python3 -c "
import sys, json
from datetime import datetime, timezone

try:
    data = json.load(sys.stdin)
    output = {
        'scraped_at': datetime.now(timezone.utc).isoformat(),
        'session': None,
        'raw_response': data
    }
    
    # Try to extract usage information from response
    # Update this parsing logic based on actual API response format
    if 'balance' in data or 'usage' in data or 'quota' in data:
        balance = data.get('balance', data.get('quota', {}))
        output['session'] = {
            'percent': balance.get('percent_used', 0),
            'resets': balance.get('reset_time', 'unknown')
        }
    elif 'data' in data:
        # OpenAI-style response
        output['session'] = {
            'percent': 0,
            'resets': 'unknown',
            'raw': data.get('data', {})
        }
    
    print(json.dumps(output, indent=2))
except Exception as e:
    print(json.dumps({
        'error': 'Failed to parse Kimi response',
        'message': str(e),
        'scraped_at': datetime.now(timezone.utc).isoformat()
    }, indent=2))
" > "$OUTPUT_FILE"
fi

cat "$OUTPUT_FILE"
