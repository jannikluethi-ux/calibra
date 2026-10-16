# Calibra boot hook (sourced from shell rc files; box has no systemd/cron/rc.local).
# Idempotent, silent, non-blocking. Flock prevents a stampede while the server is starting.
HOOK_DIR=/workspace/global-financial-intelligence
if [ -x "$HOOK_DIR/scripts/ensure-prod.sh" ] && ! ss -ltn 2>/dev/null | grep -q ':3456 '; then
  mkdir -p "$HOOK_DIR/tmp"
  (
    flock -n 9 || exit 0
    # Re-check after lock: another hook may have started the supervisor
    if ss -ltn 2>/dev/null | grep -q ':3456 '; then exit 0; fi
    if [ -f "$HOOK_DIR/tmp/prod-supervisor.pid" ] && kill -0 "$(cat "$HOOK_DIR/tmp/prod-supervisor.pid")" 2>/dev/null; then exit 0; fi
    setsid "$HOOK_DIR/scripts/ensure-prod.sh" >>"$HOOK_DIR/tmp/boot-hook.log" 2>&1 &
  ) 9>"$HOOK_DIR/tmp/boot-hook.lock" 2>/dev/null
fi
