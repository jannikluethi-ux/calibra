#!/usr/bin/env bash
# Production supervisor for Calibra on :3456 (no systemd on the box).
#   scripts/ensure-prod.sh          -> start supervisor in background if not running (idempotent; safe from cron/@reboot)
#   scripts/ensure-prod.sh --build  -> rebuild (under the same flock), then restart server
#   scripts/ensure-prod.sh --stop   -> stop supervisor and server
#   scripts/ensure-prod.sh --reset  -> clear a CRASHLOOP marker, then start
#   scripts/ensure-prod.sh --start  -> explicit manual start (same as no args, caller=supervisor-manual)
#   add --override-maintenance to start even while scripts/maintenance.sh guard is active
# Maintenance guard: every auto-start path (no args, boot-hook, crash-restart inside --loop) refuses
# to start while tmp/MAINTENANCE is active and unexpired. Starts/stops/blocks are logged to
# tmp/restart-events.log with caller=$CALIBRA_CALLER (boot-hook sets boot-hook; default supervisor-manual).
# The loop runs `next start -p $PORT`, captures the real exit code, restarts with bounded
# exponential back-off (5s doubling to 300s; reset after 10 min stable uptime) and stops with a
# CRASHLOOP marker after CRASH_MAX crashes within CRASH_WINDOW seconds. If the port is already
# served by a healthy instance (EADDRINUSE), the loop exits instead of spinning.
# Exit codes: 1 lib-maintenance missing (fail safe) / build failed, 3 maintenance guard, 4 restore still in progress.
# Logs: $STATE_DIR/prod.log. Test overrides (never needed in prod): CALIBRA_PORT, CALIBRA_STATE_DIR, CALIBRA_RESTORE_STATUS,
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
CALIBRA_HOME="$(pwd)"; export CALIBRA_STATE_DIR="$STATE_DIR"
# Boot-race guard (17 Oct 2026 incident): after a workspace restore the platform may still be copying files
# when the first shell runs the boot hook. If a restore-status file exists and is not finished, wait (bounded)
# instead of starting with half-restored scripts. CALIBRA_RESTORE_STATUS=none disables the check.
RESTORE_STATUS="${CALIBRA_RESTORE_STATUS:-/tmp/sand-copy-in-status.json}"
RESTORE_WAIT="${CALIBRA_RESTORE_WAIT_S:-300}"
restore_in_progress() {
  [ "$RESTORE_STATUS" != none ] && [ -f "$RESTORE_STATUS" ] || return 1
  grep -Eq '"phase"[[:space:]]*:[[:space:]]*"done"' "$RESTORE_STATUS" && return 1
  return 0
}
case "${1:-}" in --stop|--loop) ;; *)
  waited=0
  while restore_in_progress && [ "$waited" -lt "$RESTORE_WAIT" ]; do sleep 2; waited=$((waited + 2)); done
  if restore_in_progress; then
    echo "[$(date -Is)] workspace restore still in progress after ${RESTORE_WAIT}s ($RESTORE_STATUS); not starting" >>"$STATE_DIR/prod.log"
    echo "workspace restore still in progress; not starting (retry later)"; exit 4
  fi ;;
esac
# Fail safe: without the maintenance-guard library we cannot honour the guard, so refuse to run at all.
if [ ! -r scripts/lib-maintenance.sh ] || ! . scripts/lib-maintenance.sh; then
  echo "[$(date -Is)] scripts/lib-maintenance.sh missing or failed to load; refusing to start (fail safe)" >>"$STATE_DIR/prod.log"
  echo "scripts/lib-maintenance.sh missing or failed to load; refusing to start (fail safe)" >&2
  exit 1
fi
CALLER="${CALIBRA_CALLER:-supervisor-manual}"
OVERRIDE="${CALIBRA_OVERRIDE_MAINTENANCE:-0}"
ARGS=()
for a in "$@"; do
  case "$a" in
    --override-maintenance) OVERRIDE=1 ;;
    --start) ;;
    *) ARGS+=("$a") ;;
  esac
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

log() { echo "[$(date -Is)] $*" >>"$LOG"; }
port_busy() { ss -ltn 2>/dev/null | grep -q ":${PORT} "; }
healthy() { [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$HEALTH_URL")" = "200" ]; }

stop() {
  calibra_event "$CALLER" stop "ensure-prod --stop"
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
      if [ "$OVERRIDE" != 1 ] && calibra_maintenance_active supervisor-loop; then
        log "maintenance guard active; supervisor loop not (re)starting server; exiting"
        calibra_event supervisor-loop start-blocked-maintenance "loop exit; reason=$(calibra_guard_get reason)"
        rm -f "$PIDFILE"; exit 0
      fi
      log "starting server on :$PORT"
      calibra_event supervisor-loop server-start "next start -p $PORT (launched by $CALLER)"
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
if calibra_maintenance_active "$CALLER"; then
  if [ "$OVERRIDE" = 1 ]; then
    calibra_event "$CALLER" start-override-maintenance "starting despite active guard (reason=$(calibra_guard_get reason))"
  else
    calibra_event "$CALLER" start-blocked-maintenance "reason=$(calibra_guard_get reason)"
    calibra_maintenance_notice
    echo "maintenance guard active; not starting (use --start --override-maintenance to force)"; exit 3
  fi
fi
calibra_event "$CALLER" supervisor-start "starting supervisor loop on :$PORT"
export CALIBRA_CALLER="$CALLER" CALIBRA_OVERRIDE_MAINTENANCE="$OVERRIDE"
# 8>&- : the long-lived supervisor must NOT inherit the flock fd (it would hold the lock forever)
nohup setsid "$0" --loop 8>&- >/dev/null 2>&1 &
sleep 1
echo "supervisor started (pid $(cat "$PIDFILE" 2>/dev/null))"
