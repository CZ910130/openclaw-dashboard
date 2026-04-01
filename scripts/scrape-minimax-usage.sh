#!/bin/bash
set -euo pipefail
WORKSPACE_DIR="${WORKSPACE_DIR:-${OPENCLAW_WORKSPACE:-$(pwd)}}"
python3 "$(dirname "$0")/scrape-local-provider-usage.py" minimax
