#!/usr/bin/env bash
# Start (or reuse) a cloudflared quick tunnel to the prod app on :3456 with an auto-restart loop.
# Quick-tunnel URLs are random and change on every restart; see tmp/tunnel-url.txt for the current one.
#   scripts/demo-tunnel.sh         -> start if not running, print URL
#   scripts/demo-tunnel.sh --stop
set -uo pipefail
cd "$(dirname "$0")/.."; mkdir -p tmp
PIDFILE=tmp/tunnel-supervisor.pid
CF=$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")
case "${1:-}" in
  --stop) [ -f "$PIDFILE" ] && kill -TERM -- "-$(cat "$PIDFILE")" 2>/dev/null; rm -f "$PIDFILE" tmp/tunnel-url.txt; exit 0 ;;
  --loop)
    echo $$ >"$PIDFILE"
    while true; do
      : >tmp/tunnel.log
      "$CF" tunnel --no-autoupdate --protocol http2 --url http://localhost:3456 >>tmp/tunnel.log 2>&1 &
      CPID=$!
      for _ in $(seq 1 60); do u=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' tmp/tunnel.log | head -1); [ -n "$u" ] && { echo "$u" >tmp/tunnel-url.txt; break; }; sleep 1; done
      wait $CPID; rm -f tmp/tunnel-url.txt; sleep 10
    done ;;
esac
if ! { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }; then
  setsid "$0" --loop >/dev/null 2>&1 < /dev/null &
fi
for _ in $(seq 1 60); do [ -s tmp/tunnel-url.txt ] && break; sleep 1; done
cat tmp/tunnel-url.txt 2>/dev/null || { echo "no URL yet; see tmp/tunnel.log" >&2; exit 1; }
