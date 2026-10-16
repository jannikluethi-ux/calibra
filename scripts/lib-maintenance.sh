# Calibra maintenance-guard helpers. Sourced by boot-hook.sh, ensure-prod.sh and maintenance.sh.
# Safe to source into interactive shells: defines functions only, no `set` options, no exit.
# Guard file: $CALIBRA_STATE_DIR/MAINTENANCE (key=value lines: start, start_epoch, expires,
# expires_epoch, reason, user, pid, host). An expired guard is treated as INACTIVE, logged to the
# restart-events log and removed, so a forgotten/interrupted session can never disable prod forever.
# Restart events: $CALIBRA_STATE_DIR/restart-events.log, one line per event:
#   ts=<iso> caller=<boot-hook|supervisor-manual|supervisor-loop|maintenance|...> action=<...> pid=<pid> detail="<...>"
calibra_state_dir() { echo "${CALIBRA_STATE_DIR:-${CALIBRA_HOME:-/workspace/global-financial-intelligence}/tmp}"; }
calibra_guard_file() { echo "$(calibra_state_dir)/MAINTENANCE"; }
calibra_now() { echo "${CALIBRA_NOW_EPOCH:-$(date +%s)}"; }
calibra_event() { # caller action detail
  local d; d="$(calibra_state_dir)"; mkdir -p "$d" 2>/dev/null || return 0
  printf 'ts=%s caller=%s action=%s pid=%s detail="%s"\n' "$(date -Is)" "$1" "$2" "$$" "$(printf '%s' "${3:-}" | tr '\n"' "  ")" >>"$d/restart-events.log" 2>/dev/null || true
}
calibra_guard_get() { sed -n "s/^$1=//p" "$(calibra_guard_file)" 2>/dev/null | head -n1; }
# Returns 0 if maintenance is active and unexpired. Expired/corrupt guards are logged and removed.
calibra_maintenance_active() {
  local f exp now; f="$(calibra_guard_file)"
  [ -f "$f" ] || return 1
  exp="$(calibra_guard_get expires_epoch)"; now="$(calibra_now)"
  case "$exp" in ''|*[!0-9]*)
    calibra_event "${1:-guard-check}" maintenance-guard-invalid "unparseable guard removed: $(tr '\n' ';' <"$f" 2>/dev/null)"
    rm -f "$f"; return 1 ;;
  esac
  if [ "$now" -ge "$exp" ]; then
    calibra_event "${1:-guard-check}" maintenance-expired-cleanup "guard expired at $(calibra_guard_get expires) reason=$(calibra_guard_get reason) user=$(calibra_guard_get user); removed"
    rm -f "$f"; return 1
  fi
  return 0
}
calibra_maintenance_notice() {
  echo "[calibra] MAINTENANCE active until $(calibra_guard_get expires) (reason: $(calibra_guard_get reason); by $(calibra_guard_get user)) - prod auto-start suppressed; 'scripts/maintenance.sh off' to end" >&2
}
