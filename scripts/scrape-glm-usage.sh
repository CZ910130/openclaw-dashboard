#!/bin/bash
# GLM (Zhipu AI) Usage Scraper — thin wrapper around scrape-provider-usage.sh
#
# Platform: https://open.bigmodel.cn/
# Models: glm-5, glm-4.7, glm-4.7-flash, glm-4.7-flashx
# Set GLM_API_KEY or ZHIPU_API_KEY environment variable

export PROVIDER_NAME="GLM"
export PROVIDER_KEY="${GLM_API_KEY:-${ZHIPU_API_KEY:-}}"
export API_BASE_URLS="https://open.bigmodel.cn"
export API_ENDPOINTS="/api/paas/v4/account:/api/paas/v4/balance:/api/paas/v4/usage:/api/paas/v4/user/info"
export OUTPUT_SUFFIX="glm"
export KEY_ENV_NAMES="GLM_API_KEY or ZHIPU_API_KEY"
export DOC_URL="https://open.bigmodel.cn/"
export DOC_LINKS="https://open.bigmodel.cn/dev/api:https://platform.zhipuai.com/docs"

exec "$(dirname "$0")/scrape-provider-usage.sh"
