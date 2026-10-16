#!/usr/bin/env bash
# Production supervisor for Calibra on :3456 (no systemd on the box).
#   scripts/ensure-prod.sh          -> start supervisor in background if not running (idempotent; safe from cron/@reboot)
#   scripts/ensure-prod.sh --build  -> rebuild, then restart server
#   scripts/ensure-prod.sh --stop   -> stop supervisor and server
# The loop runs `next start -p 3456` and restarts it ~5s after any exit. Logs: tmp/prod.log
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p tmp
PIDFILE=tmp/prod-supervisor.pid

stop() {
  # supervisor runs in its own session (setsid), so kill the whole process group
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill -TERM -- "-$(cat "$PIDFILE")" 2>/dev/null || kill "$(cat "$PIDFILE")"
  fi
  rm -f "$PIDFILE"
  for _ in $(seq 1 20); do ss -ltn 2>/dev/null | grep -q ':3456 ' || break; sleep 0.5; done
}

case "${1:-}" in
  --stop) stop; exit 0 ;;
  --loop)
    echo $$ >"$PIDFILE"
    while true; do
      echo "[$(date -Is)] starting next start" >>tmp/prod.log
      npx next start -p 3456 >>tmp/prod.log 2>&1 &
      wait $!
      echo "[$(date -Is)] next start exited ($?); restarting in 5s" >>tmp/prod.log
      sleep 5
    done ;;
  --build)
    [ -d node_modules/next ] || npm install
    npm run build || exit 1
    stop ;;
esac

# Single-flight: only one ensure-prod may build/start at a time (boot-hook can fire from many shells)
exec 8>tmp/ensure-prod.lock
if ! flock -n 8; then
  echo "another ensure-prod is already starting"; exit 0
fi
[ -d node_modules/next ] || npm install
[ -f .next/BUILD_ID ] || npm run build || exit 1
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "supervisor already running (pid $(cat "$PIDFILE"))"; exit 0
fi
if ss -ltn 2>/dev/null | grep -q ':3456 '; then
  echo "port 3456 busy by another process (dev server?); stop it first"; exit 1
fi
nohup setsid "$0" --loop >/dev/null 2>&1 &
sleep 1
echo "supervisor started (pid $(cat "$PIDFILE" 2>/dev/null))"
