#!/usr/bin/env bash
# Maintenance guard for Calibra prod.
#   scripts/maintenance.sh on --reason "text" [--ttl MINUTES]   (default 60, max 240)
#   scripts/maintenance.sh off
#   scripts/maintenance.sh status
# While active and unexpired: boot-hook.sh will not start prod (prints a one-line notice to stderr)
# and ensure-prod.sh refuses auto-start unless --override-maintenance is given.
# The guard never stops a running server; it only suppresses automatic starts.
set -uo pipefail
cd "$(dirname "$0")/.."
CALIBRA_HOME="$(pwd)"
. scripts/lib-maintenance.sh
F="$(calibra_guard_file)"; mkdir -p "$(dirname "$F")"
cmd="${1:-status}"; shift || true
case "$cmd" in
  on)
    reason=""; ttl=60
    while [ $# -gt 0 ]; do
      case "$1" in
        --reason) reason="${2:-}"; shift 2 ;;
        --ttl) ttl="${2:-}"; shift 2 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
      esac
    done
    [ -n "$reason" ] || { echo "--reason is required" >&2; exit 2; }
    case "$ttl" in ''|*[!0-9]*) echo "--ttl must be a positive integer (minutes)" >&2; exit 2 ;; esac
    [ "$ttl" -ge 1 ] || { echo "--ttl must be >= 1" >&2; exit 2; }
    if [ "$ttl" -gt 240 ]; then echo "--ttl capped at 240 minutes (requested $ttl)" >&2; ttl=240; fi
    now="$(calibra_now)"; exp=$(( now + ttl*60 ))
    reason1="$(printf '%s' "$reason" | tr '\n\r' '  ')"
    tmpf="$F.tmp.$$"
    {
      echo "start=$(date -d "@$now" -Is)"; echo "start_epoch=$now"
      echo "expires=$(date -d "@$exp" -Is)"; echo "expires_epoch=$exp"
      echo "ttl_min=$ttl"; echo "reason=$reason1"
      echo "user=${USER:-$(id -un)}"; echo "pid=$PPID"; echo "host=$(hostname)"
    } >"$tmpf" && mv -f "$tmpf" "$F"
    calibra_event maintenance maintenance-on "ttl=${ttl}m expires=$(date -d "@$exp" -Is) reason=$reason1"
    echo "maintenance ON until $(date -d "@$exp" -Is) (ttl ${ttl}m): $reason1" ;;
  off)
    if [ -f "$F" ]; then
      calibra_event maintenance maintenance-off "reason=$(calibra_guard_get reason)"
      rm -f "$F"; echo "maintenance OFF (guard removed). Prod is NOT started automatically by this command;"
      echo "to start now: scripts/ensure-prod.sh --start"
    else echo "maintenance already off"; fi ;;
  status)
    if calibra_maintenance_active maintenance-status; then
      echo "maintenance ACTIVE"; sed 's/^/  /' "$F"; exit 0
    else echo "maintenance inactive"; exit 1; fi ;;
  *) echo "usage: $0 on --reason X [--ttl MIN] | off | status" >&2; exit 2 ;;
esac
