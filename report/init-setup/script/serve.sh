#!/usr/bin/env bash
# Serves the Satchel first-time setup guide locally.
#   report/init-setup/script/serve.sh [port]        (default 8766)
set -euo pipefail
SITE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../site" && pwd)"
PORT="${1:-8766}"
URL="http://127.0.0.1:${PORT}/"
echo "Satchel setup guide → ${URL}  (Ctrl-C to stop)"
if command -v open >/dev/null 2>&1; then (sleep 1 && open "$URL") & elif command -v xdg-open >/dev/null 2>&1; then (sleep 1 && xdg-open "$URL") & fi
if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$SITE"
else
  exec npx --yes http-server "$SITE" -p "$PORT" -a 127.0.0.1 -c-1
fi
