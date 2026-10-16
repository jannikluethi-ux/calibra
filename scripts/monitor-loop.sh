#!/usr/bin/env bash
# Box-level uptime scheduler: runs scripts/uptime-check.sh at fixed wall-clock slots
# (default :07/:22/:37/:52 = epoch % 900 == 420; whole-hour UTC offsets keep that aligned in Zurich).
# Independent of the server-side routine, which becomes a backup caller (uptime-check.sh skips with
# SKIPPED-RECENT if a check completed < 5 min ago). The loop never starts/stops prod and cannot message
# chat: notifications go to notify-outbox.jsonl, delivered by the routines (scripts/notify-outbox.sh).
#   scripts/monitor-loop.sh start    enable (creates $DIR/MONITOR_LOOP_ENABLED) + launch detached (setsid/nohup)
#   scripts/monitor-loop.sh stop     stop loop + remove enable flag (boot-hook then won't restart it)
#   scripts/monitor-loop.sh status   rc 0 running, rc 1 not running
#   scripts/monitor-loop.sh --loop   (internal) the loop itself; single instance via flock
# Files in $DIR (= MONITOR_DIR or UPTIME_DIR, default /workspace/calibra-stabilization):
#   scheduler-runs.csv  expected_ts,actual_start,end,duration_s,lateness_s,exit,result,notify  (MISSED rows too)
#   monitor-loop.heartbeat.json, monitor-loop.pid, monitor-loop.log, .monitor-loop.last-slot,
#   .heartbeat-routine-last (written by monitor-heartbeat.sh), .monitor-loop.hbroutine-flag
# Env (tests): MONITOR_PERIOD_S 900, MONITOR_PHASE_S 420, MONITOR_CHECK_TIMEOUT 60, MONITOR_CHECK_CMD,
#   MONITOR_MAX_RUNS (exit after N slots), MONITOR_HBROUTINE_STALE_MIN 40, MONITOR_TICK_S 60 (heartbeat refresh).
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${MONITOR_DIR:-${UPTIME_DIR:-/workspace/calibra-stabilization}}"; export UPTIME_DIR="$DIR"
P="${MONITOR_PERIOD_S:-900}"; PH="${MONITOR_PHASE_S:-420}"; TO="${MONITOR_CHECK_TIMEOUT:-60}"
CMD="${MONITOR_CHECK_CMD:-$REPO/scripts/uptime-check.sh}"
HBSTALE="${MONITOR_HBROUTINE_STALE_MIN:-40}"; TICK="${MONITOR_TICK_S:-60}"
RUNS="$DIR/scheduler-runs.csv"; PIDF="$DIR/monitor-loop.pid"; HB="$DIR/monitor-loop.heartbeat.json"
LOGF="$DIR/monitor-loop.log"; LAST="$DIR/.monitor-loop.last-slot"; HBR="$DIR/.heartbeat-routine-last"
FLAG="$DIR/.monitor-loop.hbroutine-flag"; EN="$DIR/MONITOR_LOOP_ENABLED"
mkdir -p "$DIR"
iso() { date -d "@$1" -Is; }
log() { echo "$(date -Is) [monitor-loop $$] $*" >>"$LOGF"; }
running() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF" 2>/dev/null)" 2>/dev/null; }
outbox() { OUTBOX_SOURCE=monitor-loop UPTIME_DIR="$DIR" "$REPO/scripts/notify-outbox.sh" add "$@" >/dev/null 2>&1 || log "outbox add failed: $*"; }
row() { [ -s "$RUNS" ] || echo "expected_ts,actual_start,end,duration_s,lateness_s,exit,result,notify" >>"$RUNS"; echo "$*" >>"$RUNS"; }
beat() { printf '{"pid":%s,"updated_at":"%s","updated_epoch":%s,"last_slot":"%s","period_s":%s,"phase_s":%s}\n' \
  "$$" "$(date -Is)" "$(date +%s)" "$(cat "$LAST" 2>/dev/null)" "$P" "$PH" >"$HB.tmp" && mv "$HB.tmp" "$HB"; }

check_hb_routine() {  # flag (once per episode) if the heartbeat routine has not run for > HBSTALE min
  local now last age started
  now=$(date +%s); last=$(cat "$HBR" 2>/dev/null | head -c 20); started=$(cat "$DIR/.monitor-loop.started" 2>/dev/null || echo "$now")
  [[ "$last" =~ ^[0-9]+$ ]] || last="$started"
  age=$(( (now - last) / 60 ))
  if [ "$age" -gt "$HBSTALE" ]; then
    if [ ! -f "$FLAG" ]; then
      outbox heartbeat_routine_stale "Calibra monitor: heartbeat routine has not run for ${age} min (last $(iso "$last"))" heartbeat_routine_stale
      echo "$now" >"$FLAG"; log "heartbeat routine stale ${age} min -> outbox"
    fi
  elif [ -f "$FLAG" ]; then
    outbox heartbeat_routine_recovered "Calibra monitor: heartbeat routine running again (last $(iso "$last"))" heartbeat_routine_recovered
    rm -f "$FLAG"; log "heartbeat routine recovered -> outbox"
  fi
}

run_slot() {  # $1 = slot epoch
  local s="$1" t0 t1 out ec res nt
  t0=$(date +%s.%N)
  out="$(UPTIME_CALLER=loop UPTIME_DIR="$DIR" timeout -k 5 "$TO" "$CMD" 2>>"$LOGF")"; ec=$?
  t1=$(date +%s.%N)
  if [ "$ec" = 124 ] || [ "$ec" = 137 ]; then res=TIMEOUT; nt=none
  else
    res=$(printf '%s' "$out" | tail -n1 | python3 -c 'import json,sys
try: d=json.loads(sys.stdin.read()); print(d.get("status","ERROR"), d.get("notify","none"))
except Exception: print("ERROR none")' 2>/dev/null); nt=${res#* }; res=${res% *}
    [ "$ec" = 75 ] && res=SKIPPED-LOCK
  fi
  row "$(iso "$s"),$(date -d "@${t0%.*}" -Is),$(date -d "@${t1%.*}" -Is),$(python3 -c "print(f'{$t1-$t0:.2f}')"),$(python3 -c "print(f'{$t0-$s:.1f}')"),$ec,$res,$nt"
  log "slot $(iso "$s") exit=$ec result=$res notify=$nt"
}

loop() {
  exec 9>"$DIR/.monitor-loop.lock"
  flock -n 9 || { echo "monitor-loop already running" >&2; exit 0; }
  echo $$ >"$PIDF"; date +%s >"$DIR/.monitor-loop.started"
  trap 'log "stopping (signal)"; rm -f "$PIDF"; exit 0' TERM INT
  log "loop started period=${P}s phase=${PH}s timeout=${TO}s cmd=$CMD"
  local n=0 now target last s
  while :; do
    now=$(date +%s); target=$(( (now - PH) / P * P + PH ))
    last=$(cat "$LAST" 2>/dev/null)
    if ! [[ "$last" =~ ^[0-9]+$ ]]; then echo "$target" >"$LAST"; last=$target   # first start: wait for next slot
    elif [ "$target" -gt "$last" ]; then
      for (( s=last+P; s<target; s+=P )); do row "$(iso "$s"),,,,,,MISSED,none"; log "slot $(iso "$s") MISSED"; done
      run_slot "$target"; echo "$target" >"$LAST"; n=$((n+1))
      [ -n "${MONITOR_MAX_RUNS:-}" ] && [ "$n" -ge "$MONITOR_MAX_RUNS" ] && { log "max runs reached"; rm -f "$PIDF"; exit 0; }
    fi
    check_hb_routine; beat
    now=$(date +%s); s=$(( $(cat "$LAST") + P - now )); [ "$s" -lt 1 ] && s=1; [ "$s" -gt "$TICK" ] && s=$TICK
    sleep "$s" & wait $!
  done
}

case "${1:-status}" in
  --loop) loop ;;
  start)
    touch "$EN"
    if running; then echo "monitor-loop already running (pid $(cat "$PIDF"))"; exit 0; fi
    nohup setsid "$0" --loop 9>&- >/dev/null 2>&1 &
    for _ in $(seq 20); do running && break; sleep 0.2; done
    running && echo "monitor-loop started (pid $(cat "$PIDF")); runs -> $RUNS" || { echo "monitor-loop failed to start; see $LOGF"; exit 1; } ;;
  stop)
    rm -f "$EN"
    if running; then LP=$(cat "$PIDF"); kill -TERM -- "-$LP" 2>/dev/null || kill "$LP"; for _ in $(seq 25); do running || break; sleep 0.2; done; echo "monitor-loop stopped"; else echo "monitor-loop not running"; fi
    rm -f "$PIDF" ;;
  status)
    if running; then echo "monitor-loop RUNNING pid $(cat "$PIDF") enabled=$([ -f "$EN" ] && echo yes || echo no)"; cat "$HB" 2>/dev/null; tail -n 3 "$RUNS" 2>/dev/null; exit 0
    else echo "monitor-loop NOT running enabled=$([ -f "$EN" ] && echo yes || echo no)"; exit 1; fi ;;
  *) echo "usage: $0 start|stop|status"; exit 2 ;;
esac
