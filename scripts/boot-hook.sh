# Calibra boot hook (sourced from shell rc files; box has no systemd/cron/rc.local).
# Idempotent, non-blocking. Flock prevents a stampede while the server is starting.
# Respects the maintenance guard (scripts/maintenance.sh): while active it does NOT start prod
# and prints one notice line to stderr. Every start it triggers is logged with caller=boot-hook
# in tmp/restart-events.log. Skips silently while a workspace restore is unfinished or when
# lib-maintenance.sh is missing (fail safe; a later shell retries).
# Test overrides: CALIBRA_HOME, CALIBRA_PORT, CALIBRA_STATE_DIR, CALIBRA_RESTORE_STATUS.
__calibra_boot_hook() {
  local HOOK_DIR="${CALIBRA_HOME:-}"
  if [ -z "$HOOK_DIR" ] && [ -n "${BASH_SOURCE[0]:-}" ]; then HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"; fi
  HOOK_DIR="${HOOK_DIR:-/workspace/global-financial-intelligence}"
  local PORT="${CALIBRA_PORT:-3456}"
  [ -x "$HOOK_DIR/scripts/ensure-prod.sh" ] || return 0
  # Boot-race guard: do nothing while a workspace restore is still copying files (next shell retries).
  local RS="${CALIBRA_RESTORE_STATUS:-/tmp/sand-copy-in-status.json}"
  if [ "$RS" != none ] && [ -f "$RS" ] && ! grep -Eq '"phase"[[:space:]]*:[[:space:]]*"done"' "$RS" 2>/dev/null; then
    return 0
  fi
  # Fail safe: never start prod without the maintenance-guard library (it may not be restored yet).
  if [ ! -r "$HOOK_DIR/scripts/lib-maintenance.sh" ] || ! . "$HOOK_DIR/scripts/lib-maintenance.sh" 2>/dev/null \
     || ! type calibra_maintenance_active >/dev/null 2>&1; then
    return 0
  fi
  local SD="${CALIBRA_STATE_DIR:-$HOOK_DIR/tmp}"
  # Box monitor loop: (re)start only if enabled via `scripts/monitor-loop.sh start` and not running.
  local MD="${MONITOR_DIR:-${UPTIME_DIR:-/workspace/calibra-stabilization}}"
  if [ -f "$MD/MONITOR_LOOP_ENABLED" ] && [ -x "$HOOK_DIR/scripts/monitor-loop.sh" ] && \
     ! { [ -f "$MD/monitor-loop.pid" ] && kill -0 "$(cat "$MD/monitor-loop.pid" 2>/dev/null)" 2>/dev/null; }; then
    MONITOR_DIR="$MD" "$HOOK_DIR/scripts/monitor-loop.sh" start >/dev/null 2>&1 </dev/null
  fi
  ss -ltn 2>/dev/null | grep -q ":${PORT} " && return 0
  mkdir -p "$SD"
  if CALIBRA_HOME="$HOOK_DIR" CALIBRA_STATE_DIR="$SD" calibra_maintenance_active boot-hook; then
    CALIBRA_HOME="$HOOK_DIR" CALIBRA_STATE_DIR="$SD" calibra_maintenance_notice
    return 0
  fi
  (
    flock -n 9 || exit 0
    if ss -ltn 2>/dev/null | grep -q ":${PORT} "; then exit 0; fi
    if [ -f "$SD/prod-supervisor.pid" ] && kill -0 "$(cat "$SD/prod-supervisor.pid")" 2>/dev/null; then exit 0; fi
    CALIBRA_STATE_DIR="$SD" calibra_event boot-hook start-requested "port $PORT not listening; launching ensure-prod.sh from shell pid $$"
    CALIBRA_CALLER=boot-hook CALIBRA_STATE_DIR="$SD" CALIBRA_PORT="$PORT" setsid "$HOOK_DIR/scripts/ensure-prod.sh" >>"$SD/boot-hook.log" 2>&1 &
  ) 9>"$SD/boot-hook.lock" 2>/dev/null
}
__calibra_boot_hook
unset -f __calibra_boot_hook
