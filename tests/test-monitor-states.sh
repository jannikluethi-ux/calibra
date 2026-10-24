#!/usr/bin/env bash
# B2.3 deterministic tests for the monitoring state model of scripts/uptime-check.sh
# (app failure vs host pause vs stale/idle scheduler vs delayed check vs recovery; voided entries respected).
# Fake clocks (UPTIME_NOW_EPOCH / UPTIME_MONO_S / UPTIME_BOOT_ID), mock HTTP on a spare loopback port with
# absolute lastTick timestamps, temp UPTIME_DIR/CALIBRA_STATE_DIR. Never touches live state or :3456.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"; LIVE=/workspace/calibra-stabilization
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "PASS: $*"; }; ko() { FAIL=$((FAIL+1)); echo "FAIL: $*"; }
check() { local d="$1"; shift; if "$@"; then ok "$d"; else ko "$d"; fi; }
jf() { python3 -c "import json,sys;d=json.loads(sys.argv[1]);print(d$2)" "$1"; }
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
livesum() { [ -d "$LIVE" ] && (cd "$LIVE" && sha256sum uptime-log.csv uptime-state.json uptime-transitions.jsonl .heartbeat-dedupe.json \
  notify-outbox.jsonl notify-outbox.delivered.jsonl notify-outbox.voided.jsonl scheduler-runs.csv monitor-loop.heartbeat.json 2>/dev/null) | sha256sum; }
L0="$(livesum)"
W="$(mktemp -d)"; P="$(free_port)"; DEAD="$(free_port)"; M="$W/mode"
echo '{}' >"$M"
python3 "$REPO/tests/mock_calibra.py" "$P" "$M" & MOCK=$!
trap 'kill $MOCK 2>/dev/null; rm -rf "$W"' EXIT
for _ in $(seq 25); do curl -s -o /dev/null "http://127.0.0.1:$P/" && break; sleep 0.2; done
export UPTIME_MIN_INTERVAL_S=0 CALIBRA_STATE_DIR="$W/sd" CALIBRA_BASE_URL="http://127.0.0.1:$P" UPTIME_CURL_MAX=3 UPTIME_OUTBOX=1 UPTIME_CALLER=test
mkdir -p "$W/sd"
T0=1792800000; M0=5000; BA=boot-a
iso() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }
# mode ROOT SCHED ENABLED STARTED TICK_EPOCH|null|none  (none = omit enabled/started like a pre-B2.2 build)
mode() { python3 - "$@" >"$M" <<'PY'
import json,sys
from datetime import datetime,timezone
r,s,en,st,tk=sys.argv[1:6]; c={"root":int(r),"sched":int(s)}
if en!="-": c["enabled"]=en=="1"
if st!="-": c["started"]=st=="1"
c["tick_at"]=None if tk=="null" else datetime.fromtimestamp(int(tk),timezone.utc).isoformat().replace("+00:00","Z")
print(json.dumps(c))
PY
}
# C DIR NOW MONO [BOOT] [extra env...]
C() { local d="$1" n="$2" m="$3" b="${4:-$BA}"; shift 4 2>/dev/null || shift $#
  env UPTIME_DIR="$d" UPTIME_NOW_EPOCH="$n" UPTIME_MONO_S="$m" UPTIME_BOOT_ID="$b" "$@" "$REPO/scripts/uptime-check.sh"; }
S3() { echo "$(jf "$1" '["status"]')/$(jf "$1" '["app_state"]')/$(jf "$1" '["scheduler_state"]')/$(jf "$1" '["observation"]')/$(jf "$1" '["notify"]')"; }
types() { [ -f "$1/notify-outbox.jsonl" ] && python3 -c "import json,sys;print(','.join(json.loads(l)['type'] for l in open(sys.argv[1]) if l.strip()))" "$1/notify-outbox.jsonl" || echo ""; }
trans() { [ -f "$1/uptime-transitions.jsonl" ] && python3 -c "import json,sys;print(','.join(json.loads(l)['transition'] for l in open(sys.argv[1])))" "$1/uptime-transitions.jsonl" || echo ""; }

echo "== 1. genuine application outage (enabled+started scheduler, fresh tick)"
D="$W/o"; mkdir -p "$D"
mode 200 200 1 1 $((T0-60)); o=$(C "$D" $T0 $M0); echo "$o"
check "first check: UP/UP/FRESH/FIRST/none" test "$(S3 "$o")" = "UP/UP/FRESH/FIRST/none"
mode 500 200 1 1 $((T0+840)); o=$(C "$D" $((T0+900)) $((M0+900))); echo "$o"
check "root 500 -> DOWN/APP_DOWN notify=down" test "$(S3 "$o")" = "DOWN/APP_DOWN/FRESH/ON_TIME/down"
o=$(C "$D" $((T0+1800)) $((M0+1800)) $BA CALIBRA_BASE_URL=http://127.0.0.1:$DEAD); echo "$o"
check "connection refused while DOWN -> DOWN, no re-alert, scheduler NO_DATA" test "$(S3 "$o")" = "DOWN/APP_DOWN/NO_DATA/ON_TIME/none"
mode 200 200 1 1 $((T0+2640)); o=$(C "$D" $((T0+2700)) $((M0+2700))); echo "$o"
check "healthy after real DOWN -> RECOVERED notify=recovery" test "$(S3 "$o")" = "RECOVERED/RECOVERED/FRESH/ON_TIME/recovery"
check "outage bounds reported" test "$(jf "$o" '["outage"]["kind"]')" = bounds
check "outbox: down,recovery" test "$(types "$D")" = "down,recovery"
check "transitions: DOWN,RECOVERED" test "$(trans "$D")" = "DOWN,RECOVERED"
mode 200 200 1 1 $((T0+3500)); touch "$W/sd/CRASHLOOP"; o=$(C "$D" $((T0+3600)) $((M0+3600))); rm -f "$W/sd/CRASHLOOP"
check "CRASHLOOP marker -> DOWN/APP_DOWN notify=down" test "$(S3 "$o")" = "DOWN/APP_DOWN/FRESH/ON_TIME/down"
mode 200 500 1 1 $((T0+3500)); o=$(C "$D" $((T0+4500)) $((M0+4500)))
check "status endpoint 500 while DOWN -> DOWN, NO_DATA, no re-alert" test "$(S3 "$o")" = "DOWN/APP_DOWN/NO_DATA/ON_TIME/none"

echo "== 2. paused host (wall jumps 10 h, monotonic only 15 min)"
D="$W/p"; mkdir -p "$D"
mode 200 200 1 1 $((T0-60)); C "$D" $T0 $M0 >/dev/null
o=$(C "$D" $((T0+36000)) $((M0+900))); echo "$o"
check "pause: UP, tick 601 min old -> UNVERIFIED_RESUME, HOST_PAUSED, notify none" test "$(S3 "$o")" = "UP/UP/UNVERIFIED_RESUME/HOST_PAUSED/none"
check "paused_s = 35100" test "$(jf "$o" '["paused_s"]')" = 35100.0
check "no monitor-gap heartbeat (monotonic gap 15 min)" test "$(jf "$o" '["mono_gap_min"]')" = 15.0
check "no outbox entry for a pause" test "$(types "$D")" = ""
mode 200 200 1 1 $((T0+36840)); o=$(C "$D" $((T0+36900)) $((M0+1800)))
check "next check after resume: tick fresh -> FRESH/ON_TIME/none" test "$(S3 "$o")" = "UP/UP/FRESH/ON_TIME/none"
mode 200 200 1 1 $((T0+36840)); C "$D" $((T0+80000)) $((M0+2700)) >/dev/null
o=$(C "$D" $((T0+80900)) $((M0+3600))); echo "$o"
check "tick still stale on the 2nd check after resume (no pause) -> STALE warning, not DOWN" test "$(S3 "$o")" = "UP/UP/STALE/ON_TIME/scheduler_stale"
D="$W/p2"; mkdir -p "$D"; mode 200 200 1 1 $((T0-60)); C "$D" $T0 $M0 >/dev/null
mode 500 200 1 1 $((T0-60)); o=$(C "$D" $((T0+36000)) $((M0+900)))
check "pause does not mask a real failure: DOWN after resume still alerts" test "$(S3 "$o")" = "DOWN/APP_DOWN/UNVERIFIED_RESUME/HOST_PAUSED/down"
D="$W/p3"; mkdir -p "$D"; mode 200 200 1 1 $((T0-60)); C "$D" $T0 $M0 >/dev/null
o=$(C "$D" $((T0+3*3600)) 120 boot-b); echo "$o"
check "reboot (new boot_id, uptime 2 min) -> REBOOTED, tick UNVERIFIED_RESUME, no heartbeat" test "$(S3 "$o")" = "UP/UP/UNVERIFIED_RESUME/REBOOTED/none"
D="$W/p4"; mkdir -p "$D"; mode 200 200 1 1 $((T0-60)); C "$D" $T0 $M0 >/dev/null
mode 200 200 1 1 $((T0+1440)); o=$(C "$D" $((T0+1500)) $((M0+1500)))
check "box running but no check for 25 min (monotonic) -> GAP notify=heartbeat" test "$(S3 "$o")" = "UP/UP/FRESH/GAP/heartbeat"

echo "== 3. stale scheduler timestamp while the app is healthy"
for case in "0 - IDLE_DISABLED" "1 0 IDLE_NOT_STARTED" "- - UNKNOWN"; do
  set -- $case; D="$W/s-$3"; mkdir -p "$D"
  mode 200 200 $1 $2 $((T0-60)); C "$D" $T0 $M0 >/dev/null
  for a in 663.7 189.0 389.6 33.7 222.7; do   # tick ages of the 5 voided false DOWNs (Oct 20-22)
    n=$((T0+900)); mode 200 200 $1 $2 $(python3 -c "print(int($n-$a*60))"); o=$(C "$D" $n $((M0+900)))
    [ "$(S3 "$o")" = "UP/UP/$3/ON_TIME/none" ] || { ko "$3 replay age $a: $(S3 "$o")"; continue 2; }
  done
  ok "enabled=$1 started=$2: replayed voided tick ages -> UP/$3, notify none"
  check "$3: no outbox entries, no transitions" test "$(types "$D")|$(trans "$D")" = "|"
done
D="$W/s-on"; mkdir -p "$D"
mode 200 200 1 1 $((T0-60)); C "$D" $T0 $M0 >/dev/null
mode 200 200 1 1 $((T0+900-45*60)); o=$(C "$D" $((T0+900)) $((M0+900))); echo "$o"
check "enabled+started, tick 45 min -> UP + scheduler_stale warning (not DOWN)" test "$(S3 "$o")" = "UP/UP/STALE/ON_TIME/scheduler_stale"
check "csv status column stays UP" test "$(tail -n1 "$D/uptime-log.csv" | cut -d, -f2)" = UP
o=$(C "$D" $((T0+1800)) $((M0+1800))); check "still stale -> deduped (none)" test "$(jf "$o" '["notify"]')" = none
mode 200 200 1 1 null; o=$(C "$D" $((T0+2700)) $((M0+2700))); check "lastTick missing while enabled+started -> STALE, no re-alert" test "$(S3 "$o")" = "UP/UP/STALE/ON_TIME/none"
mode 200 200 1 1 $((T0+3540)); o=$(C "$D" $((T0+3600)) $((M0+3600)))
check "tick fresh again -> scheduler_resumed (not RECOVERED)" test "$(S3 "$o")" = "UP/UP/FRESH/ON_TIME/scheduler_resumed"
check "outbox: scheduler_stale,scheduler_resumed only" test "$(types "$D")" = "scheduler_stale,scheduler_resumed"
check "transitions: SCHEDULER_STALE,SCHEDULER_RESUMED (no DOWN/RECOVERED)" test "$(trans "$D")" = "SCHEDULER_STALE,SCHEDULER_RESUMED"
mode 200 200 1 1 $((T0)); C "$D" $((T0+4500)) $((M0+4500)) >/dev/null
mode 200 200 0 0 $((T0)); o=$(C "$D" $((T0+5400)) $((M0+5400)))
check "stale episode then scheduler disabled by design -> silent clear (no resumed/recovery)" test "$(S3 "$o")|$(types "$D")" = "UP/UP/IDLE_DISABLED/ON_TIME/none|scheduler_stale,scheduler_resumed,scheduler_stale"

echo "== 4. delayed execution"
D="$W/d"; mkdir -p "$D"; mode 200 200 1 1 $((T0-60)); C "$D" $T0 $M0 >/dev/null
mode 200 200 1 1 $((T0+1140)); o=$(C "$D" $((T0+1200)) $((M0+1200)) $BA UPTIME_SLOT_EPOCH=$((T0+900))); echo "$o"
check "check 300 s after its slot, no pause -> DELAYED, UP, notify none" test "$(S3 "$o")/$(jf "$o" '["delay_s"]')" = "UP/UP/FRESH/DELAYED/none/300.0"
o=$(C "$D" $((T0+1830)) $((M0+1830)) $BA UPTIME_SLOT_EPOCH=$((T0+1800)))
check "30 s late (<= 60 s loop wake granularity) -> ON_TIME" test "$(jf "$o" '["observation"]')" = ON_TIME
o=$(C "$D" $((T0+3000)) $((M0+2400)) $BA UPTIME_SLOT_EPOCH=$((T0+2700)))
check "300 s late explained by a 600 s pause -> HOST_PAUSED (not DELAYED)" test "$(jf "$o" '["observation"]')" = HOST_PAUSED
check "delays and pauses never reach the outbox" test "$(types "$D")" = ""

echo "== 5. recovery semantics: RECOVERED only after a real DOWN"
D="$W/r"; mkdir -p "$D"
cat >"$D/uptime-state.json" <<J
{"status":"DOWN","last_check_at":"$(iso $T0)","lastCheck":"$(iso $T0)","lastDetail":"lastTick stale (663.7 min)","first_failed_at":"$(iso $T0)","last_healthy_at":"$(iso $((T0-900)))","schema":2,"consecutive_failures":1}
J
mode 200 200 0 - $((T0-40000)); o=$(C "$D" $((T0+900)) $((M0+900))); echo "$o"
check "legacy tick-only DOWN (old semantics) -> cleared silently: transition CLEARED, notify none" test "$(jf "$o" '["status"]')/$(jf "$o" '["transition"]')/$(jf "$o" '["notify"]')" = "UP/CLEARED/none"
check "no RECOVERED in outbox for a suppressed state" test "$(types "$D")" = ""
D="$W/r2"; mkdir -p "$D"
cat >"$D/uptime-state.json" <<J
{"status":"DOWN","last_check_at":"$(iso $T0)","lastCheck":"$(iso $T0)","lastDetail":"root http 000 (curl rc 7); scheduler/status http 000 (curl rc 7)","first_failed_at":"$(iso $T0)","last_healthy_at":"$(iso $((T0-900)))","schema":2,"consecutive_failures":1}
J
mode 200 200 0 - $((T0)); o=$(C "$D" $((T0+900)) $((M0+900)))
check "legacy real DOWN -> RECOVERED notify=recovery" test "$(jf "$o" '["status"]')/$(jf "$o" '["notify"]')" = "RECOVERED/recovery"

echo "== 6. voided entries remain respected"
D="$W/v"; mkdir -p "$D"; mode 200 200 0 0 $((T0-60)); C "$D" $T0 $M0 >/dev/null
mode 500 200 0 0 $((T0-60)); C "$D" $((T0+900)) $((M0+900)) >/dev/null
NO() { UPTIME_DIR="$D" "$REPO/scripts/notify-outbox.sh" "$@"; }
id=$(NO list-pending --json | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["id"])')
NO void "$id" --reason "test: void a generated DOWN" >/dev/null
vh=$(sha256sum <"$D/notify-outbox.voided.jsonl")
mode 200 200 0 0 $((T0-60)); C "$D" $((T0+1800)) $((M0+1800)) >/dev/null
check "voided DOWN excluded from list-pending; only the new recovery is pending" test "$(NO list-pending --json | python3 -c 'import json,sys;print(",".join(e["type"] for e in json.load(sys.stdin)))')" = recovery
check "mark-delivered refuses the voided entry" bash -c "! UPTIME_DIR='$D' '$REPO/scripts/notify-outbox.sh' mark-delivered '$id' x >/dev/null 2>&1"
check "uptime-check never rewrites the voided sidecar" test "$vh" = "$(sha256sum <"$D/notify-outbox.voided.jsonl")"
check "outbox lock file shared with notify-outbox.sh exists" test -e "$D/notify-outbox.jsonl.lock"

echo "== 7. probing is read-only; live state untouched"
check "mock saw only GET / and GET /api/scheduler/status" test "$(cut -d' ' -f1,2 "$M.requests" | sort -u | tr '\n' ';')" = "GET /;GET /api/scheduler/status;"
for d in "$W"/*/; do [ -f "$d/uptime-log.csv" ] && { python3 "$REPO/scripts/validate-uptime-log.py" "$d/uptime-log.csv" >/dev/null || ko "csv invalid in $d"; }; done
ok "all temp uptime-log.csv files validated (9 columns, status UP/DOWN/RECOVERED)"
check "live monitor/outbox files unchanged" test "$L0" = "$(livesum)"
echo "RESULT: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
