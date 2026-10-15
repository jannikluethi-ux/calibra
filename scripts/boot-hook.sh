# Calibra boot hook (sourced from shell rc files; box has no systemd/cron/rc.local - PID1 is tini+pod-daemon).
# Idempotent, silent, non-blocking: starts the prod supervisor if :3456 is not listening.
if [ -x /workspace/global-financial-intelligence/scripts/ensure-prod.sh ] && ! ss -ltn 2>/dev/null | grep -q ':3456 '; then
  ( setsid /workspace/global-financial-intelligence/scripts/ensure-prod.sh >>/workspace/global-financial-intelligence/tmp/boot-hook.log 2>&1 & ) 2>/dev/null
fi
