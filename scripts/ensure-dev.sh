#!/usr/bin/env bash
# Recover a local dev server after a box reset wipes node_modules.
# Does not touch data/gfi.db. Does not change app behavior.
# If something is already listening on 3456, it exits instead of starting a second server.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules/next ]; then
  echo "node_modules/next missing; running npm install"
  npm install
fi

if ss -ltn 2>/dev/null | grep -q ':3456 '; then
  echo "Something is already listening on port 3456; not starting another next dev."
  exit 0
fi

exec npm run dev
