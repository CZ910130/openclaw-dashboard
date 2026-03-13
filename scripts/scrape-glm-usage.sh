#!/bin/bash
# GLM (Zhipu AI) Usage Scraper
# 
# API Documentation Status: INCOMPLETE
# Platform: https://open.bigmodel.cn/
# API Base: https://open.bigmodel.cn/api/paas/v4/
#
# AUTHENTICATION REQUIRED:
# - JWT Token (obtained from Zhipu AI platform)
# - Set environment variable: GLM_API_KEY or ZHIPU_API_KEY
#
# KNOWN ENDPOINTS:
# - POST /api/paas/v4/chat/completions - Chat completions
# - Models: glm-5, glm-4.7, glm-4.7-flash, glm-4.7-flashx
#
# USAGE TRACKING:
# - Status: UNDOCUMENTED
# - Need to find: Account balance, token usage, rate limits
# - Possible endpoints (UNVERIFIED):
#   - GET /api/paas/v4/account
#   - GET /api/paas/v4/balance
#   - GET /api/paas/v4/usage
#   - GET /api/paas/v4/user/info
#
# IMPLEMENTATION NOTES:
# - This is a placeholder script
# - Update this script when official API documentation is available
# - Check platform.zhipuai.com for updates

WORKSPACE_DIR="${WORKSPACE_DIR:-${OPENCLAW_WORKSPACE:-$(pwd)}}"
OUTPUT_FILE="${WORKSPACE_DIR}/data/glm-usage.json"
LOCK_FILE="/tmp/glm-usage-scrape.lock"

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
GLM_API_KEY="${GLM_API_KEY:-${ZHIPU_API_KEY:-}}"

if [ -z "$GLM_API_KEY" ]; then
  cat > "$OUTPUT_FILE" << EOF
{
  "error": "GLM API key not configured",
  "message": "Set GLM_API_KEY or ZHIPU_API_KEY environment variable",
  "documentation": "Visit https://open.bigmodel.cn/ to obtain API credentials",
  "scraped_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  cat "$OUTPUT_FILE"
  exit 1
fi

# Attempt to fetch usage data
# NOTE: This endpoint is UNVERIFIED and may not exist
# Update the endpoint when official documentation is available

echo "Fetching GLM usage data..." >&2

# Try multiple possible endpoints
ENDPOINTS=(
  "/api/paas/v4/account"
  "/api/paas/v4/balance"
  "/api/paas/v4/usage"
  "/api/paas/v4/user/info"
)

RESPONSE=""
for endpoint in "${ENDPOINTS[@]}"; do
  echo "Trying endpoint: $endpoint" >&2
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer ${GLM_API_KEY}" \
    -H "Content-Type: application/json" \
    "https://open.bigmodel.cn${endpoint}" 2>&1)
  
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')
  
  if [ "$HTTP_CODE" = "200" ]; then
    echo "Success with endpoint: $endpoint" >&2
    break
  fi
done

# If no endpoint worked, return placeholder
if [ "$HTTP_CODE" != "200" ]; then
  cat > "$OUTPUT_FILE" << EOF
{
  "error": "Unable to fetch GLM usage data",
  "message": "API endpoint not found or not documented",
  "http_code": ${HTTP_CODE:-000},
  "note": "Update scrape-glm-usage.sh when official API documentation is available",
  "documentation_links": [
    "https://open.bigmodel.cn/dev/api",
    "https://platform.zhipuai.com/docs"
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
    if 'balance' in data:
        output['session'] = {
            'percent': data.get('percent_used', 0),
            'resets': data.get('reset_time', 'unknown')
        }
    
    print(json.dumps(output, indent=2))
except Exception as e:
    print(json.dumps({
        'error': 'Failed to parse GLM response',
        'message': str(e),
        'scraped_at': datetime.now(timezone.utc).isoformat()
    }, indent=2))
" > "$OUTPUT_FILE"
fi

cat "$OUTPUT_FILE"
