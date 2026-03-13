#!/bin/bash
# Kimi (Moonshot AI) Usage Scraper — thin wrapper around scrape-provider-usage.sh
#
# Platform: https://platform.moonshot.cn/
# Models: kimi-k2.5, k2p5 (coding)
# Set KIMI_API_KEY or MOONSHOT_API_KEY environment variable

export PROVIDER_NAME="Kimi"
export PROVIDER_KEY="${KIMI_API_KEY:-${MOONSHOT_API_KEY:-}}"
export API_BASE_URLS="https://api.moonshot.cn/v1:https://api.kimi.com/coding"
export API_ENDPOINTS="/users/me:/balance:/usage:/account"
export OUTPUT_SUFFIX="kimi"
export KEY_ENV_NAMES="KIMI_API_KEY or MOONSHOT_API_KEY"
export DOC_URL="https://platform.moonshot.cn/"
export DOC_LINKS="https://platform.moonshot.cn/docs:https://platform.moonshot.cn/docs/api/intro"

exec "$(dirname "$0")/scrape-provider-usage.sh"
