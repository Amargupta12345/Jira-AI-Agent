#!/usr/bin/env bash
# Clean pipeline artifacts and run logs.
# Usage: ./clean.sh [ticket-key]
#   ./clean.sh           — clean all artifacts + today's logs
#   ./clean.sh JCP-10136 — clean only that ticket's artifacts + logs

set -euo pipefail
cd "$(dirname "$0")"

ticket="${1:-}"

if [ -n "$ticket" ]; then
  rm -rf ".pipeline-state/${ticket}" && echo "Deleted .pipeline-state/${ticket}" || true
  find logs -name "*${ticket}*" -delete 2>/dev/null && echo "Deleted logs matching ${ticket}" || true
else
  rm -rf .pipeline-state/*/  && echo "Deleted all .pipeline-state/*" || true
  rm -rf logs/*/             && echo "Deleted all logs/*" || true
fi

# Clean leftover clone directories
rm -rf .tmp && echo "Deleted .tmp/" || true

echo "Clean done."
