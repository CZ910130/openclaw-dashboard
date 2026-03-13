#!/bin/bash
# Generic Provider Usage Scraper
# Parameterized script for providers with undocumented usage APIs.
# Called by provider-specific wrapper scripts.
#
# Required environment variables:
#   PROVIDER_NAME   - Display name (e.g., "GLM", "Kimi")
#   PROVIDER_KEY    - API key value
#   API_BASE_URLS   - Colon-separated base URLs to try
#   API_ENDPOINTS   - Colon-separated endpoint paths to try
#   OUTPUT_SUFFIX   - Output file suffix (e.g., "glm", "kimi")
#   KEY_ENV_NAMES   - Comma-separated env var names for docs (e.g., "GLM_API_KEY, ZHIPU_API_KEY")
#   DOC_URL         - Primary documentation URL
#   DOC_LINKS       - Colon-separated documentation links for error messages

set -euo pipefail

WORKSPACE_DIR="${WORKSPACE_DIR:-${OPENCLAW_WORKSPACE:-$(pwd)}}"
OUTPUT_FILE="${WORKSPACE_DIR}/data/${OUTPUT_SUFFIX}-usage.json"
LOCK_FILE="/tmp/${OUTPUT_SUFFIX}-usage-scrape.lock"

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
  pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "Already running (pid $pid)"
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"
trap "rm -f $LOCK_FILE" EXIT

mkdir -p "${WORKSPACE_DIR}/data"

# Check for API key
if [ -z "${PROVIDER_KEY:-}" ]; then
  cat > "$OUTPUT_FILE" << EOF
{
  "error": "${PROVIDER_NAME} API key not configured",
  "message": "Set ${KEY_ENV_NAMES} environment variable",
  "documentation": "Visit ${DOC_URL} to obtain API credentials",
  "scraped_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  cat "$OUTPUT_FILE"
  exit 1
fi

echo "Fetching ${PROVIDER_NAME} usage data..." >&2

# Split base URLs and endpoints
IFS=':' read -ra BASE_URL_ARRAY <<< "$API_BASE_URLS"
IFS=':' read -ra ENDPOINT_ARRAY <<< "$API_ENDPOINTS"

RESPONSE=""
HTTP_CODE="000"
BODY=""

for base_url in "${BASE_URL_ARRAY[@]}"; do
  for endpoint in "${ENDPOINT_ARRAY[@]}"; do
    echo "Trying: ${base_url}${endpoint}" >&2
    RESPONSE=$(curl -s -w "\n%{http_code}" \
      -H "Authorization: Bearer ${PROVIDER_KEY}" \
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

# Build doc links JSON array
IFS=':' read -ra DOC_LINK_ARRAY <<< "$DOC_LINKS"
DOC_LINKS_JSON=""
for link in "${DOC_LINK_ARRAY[@]}"; do
  if [ -n "$DOC_LINKS_JSON" ]; then
    DOC_LINKS_JSON="${DOC_LINKS_JSON}, "
  fi
  DOC_LINKS_JSON="${DOC_LINKS_JSON}\"${link}\""
done

if [ "$HTTP_CODE" != "200" ]; then
  cat > "$OUTPUT_FILE" << EOF
{
  "error": "Unable to fetch ${PROVIDER_NAME} usage data",
  "message": "API endpoint not found or not documented",
  "http_code": ${HTTP_CODE:-000},
  "note": "Update when official API documentation is available",
  "documentation_links": [${DOC_LINKS_JSON}],
  "scraped_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
else
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
    # Try common response structures
    if 'balance' in data or 'usage' in data or 'quota' in data:
        balance = data.get('balance', data.get('quota', data.get('usage', {})))
        if isinstance(balance, dict):
            output['session'] = {
                'percent': balance.get('percent_used', 0),
                'resets': balance.get('reset_time', 'unknown')
            }
    elif 'data' in data:
        output['session'] = {
            'percent': 0,
            'resets': 'unknown',
            'raw': data.get('data', {})
        }
    print(json.dumps(output, indent=2))
except Exception as e:
    print(json.dumps({
        'error': 'Failed to parse ${PROVIDER_NAME} response',
        'message': str(e),
        'scraped_at': datetime.now(timezone.utc).isoformat()
    }, indent=2))
" > "$OUTPUT_FILE"
fi

cat "$OUTPUT_FILE"
