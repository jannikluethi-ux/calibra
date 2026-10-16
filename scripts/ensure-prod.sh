#!/usr/bin/env bash
# Production supervisor for Calibra on :3456 (no systemd on the box).
#   scripts/ensure-prod.sh          -> start supervisor in background if not running (idempotent; safe from cron/@reboot)
#   scripts/ensure-prod.sh --build  -> rebuild (under the same flock), then restart server
#   scripts/ensure-prod.sh --stop   -> stop supervisor and server
#   scripts/ensure-prod.sh --reset  -> clear a CRASHLOOP marker, then start
# The loop runs `next start -p $PORT`, captures the real exit code, restarts with bounded
# exponential back-off (5s doubling to 300s; reset after 10 min stable uptime) and stops with a
# CRASHLOOP marker after CRASH_MAX crashes within CRASH_WINDOW seconds. If the port is already
# served by a healthy instance (EADDRINUSE), the loop exits instead of spinning.
# Logs: $STATE_DIR/prod.log. Test overrides (never needed in prod): CALIBRA_PORT, CALIBRA_STATE_DIR,
# CALIBRA_SUPERVISE_CMD, CALIBRA_BACKOFF_MIN/MAX, CALIBRA_STABLE_SECS, CALIBRA_CRASH_MAX/WINDOW.
set -uo pipefail
cd "$(dirname "$0")/.."
PORT="${CALIBRA_PORT:-3456}"
STATE_DIR="${CALIBRA_STATE_DIR:-tmp}"
mkdir -p "$STATE_DIR"
PIDFILE="$STATE_DIR/prod-supervisor.pid"
LOG="$STATE_DIR/prod.log"
CRASHLOOP="$STATE_DIR/CRASHLOOP"
BACKOFF_MIN="${CALIBRA_BACKOFF_MIN:-5}"
BACKOFF_MAX="${CALIBRA_BACKOFF_MAX:-300}"
STABLE_SECS="${CALIBRA_STABLE_SECS:-600}"
CRASH_MAX="${CALIBRA_CRASH_MAX:-5}"
CRASH_WINDOW="${CALIBRA_CRASH_WINDOW:-900}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/scheduler/status"

log() { echo "[$(date -Is)] $*" >>"$LOG"; }
port_busy() { ss -ltn 2>/dev/null | grep -q ":${PORT} "; }
healthy() { [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$HEALTH_URL")" = "200" ]; }

stop() {
  # supervisor runs in its own session (setsid), so kill the whole process group
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill -TERM -- "-$(cat "$PIDFILE")" 2>/dev/null || kill "$(cat "$PIDFILE")"
  fi
  rm -f "$PIDFILE"
  for _ in $(seq 1 20); do port_busy || break; sleep 0.5; done
}

run_server() {
  if [ -n "${CALIBRA_SUPERVISE_CMD:-}" ]; then
    bash -c "$CALIBRA_SUPERVISE_CMD"
  else
    exec node_modules/.bin/next start -p "$PORT"
  fi
}

loop() {
  echo $$ >"$PIDFILE"
  local backoff=$BACKOFF_MIN crashes=() child=""
  trap '[ -n "$child" ] && kill -TERM "$child" 2>/dev/null; log "supervisor stopping (signal)"; exit 0' TERM INT
  while true; do
    if port_busy; then
      if healthy; then
        log "port $PORT already served by a healthy instance (EADDRINUSE avoided); supervisor exiting"
        rm -f "$PIDFILE"; exit 0
      fi
      log "port $PORT busy but health check failed; counting as failed start"
      rc=98; up=0
    else
      log "starting server on :$PORT"
      local start; start=$(date +%s)
      run_server >>"$LOG" 2>&1 &
      child=$!
      wait "$child"; rc=$?
      child=""
      up=$(( $(date +%s) - start ))
      if tail -n 30 "$LOG" | grep -q EADDRINUSE && healthy; then
        log "server exited rc=$rc with EADDRINUSE; port $PORT served by a healthy instance; supervisor exiting"
        rm -f "$PIDFILE"; exit 0
      fi
    fi
    now=$(date +%s)
    if [ "$up" -ge "$STABLE_SECS" ]; then backoff=$BACKOFF_MIN; crashes=(); fi
    crashes+=("$now")
    local kept=(); for t in "${crashes[@]}"; do [ $(( now - t )) -le "$CRASH_WINDOW" ] && kept+=("$t"); done; crashes=("${kept[@]}")
    if [ "${#crashes[@]}" -ge "$CRASH_MAX" ]; then
      echo "$(date -Is) rc=$rc crashes=${#crashes[@]} window=${CRASH_WINDOW}s" >"$CRASHLOOP"
      log "CRASHLOOP: ${#crashes[@]} exits within ${CRASH_WINDOW}s (last rc=$rc); supervisor stopped; marker $CRASHLOOP (run --reset after fixing)"
      rm -f "$PIDFILE"; exit 1
    fi
    log "server exited rc=$rc after ${up}s; restart $(( ${#crashes[@]} ))/${CRASH_MAX} in ${backoff}s"
    sleep "$backoff"
    backoff=$(( backoff * 2 )); [ "$backoff" -gt "$BACKOFF_MAX" ] && backoff=$BACKOFF_MAX
  done
}

case "${1:-}" in
  --stop) stop; exit 0 ;;
  --loop) loop ;;
esac

# Single-flight: only one ensure-prod may build/start at a time (boot-hook can fire from many shells).
exec 8>"$STATE_DIR/ensure-prod.lock"
if ! flock -w "${CALIBRA_LOCK_WAIT:-0}" 8; then
  echo "another ensure-prod is already starting"; exit 0
fi
case "${1:-}" in
  --reset) rm -f "$CRASHLOOP"; log "CRASHLOOP marker cleared by --reset" ;;
  --build)
    [ -d node_modules/next ] || npm install
    npm run build || exit 1
    stop ;;
esac
if [ -f "$CRASHLOOP" ]; then
  echo "CRASHLOOP marker present ($CRASHLOOP): $(cat "$CRASHLOOP"); fix the cause, then run $0 --reset"; exit 1
fi
[ -d node_modules/next ] || npm install
[ -f .next/BUILD_ID ] || npm run build || exit 1
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "supervisor already running (pid $(cat "$PIDFILE"))"; exit 0
fi
if port_busy; then
  if healthy; then echo "port $PORT already served by a healthy instance; not starting another"; exit 0; fi
  echo "port $PORT busy by another process (dev server?); stop it first"; exit 1
fi
# 8>&- : the long-lived supervisor must NOT inherit the flock fd (it would hold the lock forever)
nohup setsid "$0" --loop 8>&- >/dev/null 2>&1 &
sleep 1
echo "supervisor started (pid $(cat "$PIDFILE" 2>/dev/null))"
