#!/usr/bin/env bash
# Tests for monitor-loop.sh, notify-outbox.sh, recent-check guard, heartbeat test mode / loop detection.
# Temp dirs, short mock periods (MONITOR_PERIOD_S), mock check commands. Never touches live files or prod.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"; LIVE=/workspace/calibra-stabilization
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "PASS: $*"; }; ko() { FAIL=$((FAIL+1)); echo "FAIL: $*"; }
check() { local d="$1"; shift; if "$@"; then ok "$d"; else ko "$d"; fi; }
jf() { python3 -c "import json,sys;d=json.loads(sys.argv[1]);print(d$2)" "$1"; }
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
livesum() { [ -d "$LIVE" ] && (cd "$LIVE" && sha256sum uptime-log.csv uptime-state.json .heartbeat-dedupe.json 2>/dev/null) | sha256sum; }
L0="$(livesum)"
W="$(mktemp -d)"; P="$(free_port)"; echo up >"$W/mode"
python3 "$REPO/tests/mock_calibra.py" "$P" "$W/mode" & MOCK=$!
cleanup() { for d in "$W"/*/; do [ -f "$d/monitor-loop.pid" ] && kill "$(cat "$d/monitor-loop.pid")" 2>/dev/null; done; kill $MOCK 2>/dev/null; rm -rf "$W"; }
trap cleanup EXIT
for _ in $(seq 20); do curl -s -o /dev/null "http://127.0.0.1:$P/" && break; sleep 0.2; done
unset UPTIME_DIR MONITOR_DIR
cat >"$W/mockcheck.sh" <<'M'
#!/usr/bin/env bash
echo "$(date +%s.%N) $UPTIME_CALLER" >>"$UPTIME_DIR/mock-calls"
if [ -f "$UPTIME_DIR/hang-once" ]; then rm -f "$UPTIME_DIR/hang-once"; sleep 30; fi
echo '{"ok":true,"status":"UP","notify":"none"}'
M
chmod +x "$W/mockcheck.sh"
L() { MONITOR_DIR="$1" MONITOR_CHECK_CMD="$W/mockcheck.sh" MONITOR_TICK_S=1 "$REPO/scripts/monitor-loop.sh" --loop; }
rows() { python3 - "$1" <<'PY'
import csv,sys; r=list(csv.DictReader(open(sys.argv[1]))); print(len(r))
PY
}

echo "== alignment (period 3s, phase 1s)"
mkdir -p "$W/a"; MONITOR_PERIOD_S=3 MONITOR_PHASE_S=1 MONITOR_MAX_RUNS=3 timeout 30 bash -c "$(declare -f L); W=$W REPO=$REPO; L $W/a"
python3 - "$W/a/scheduler-runs.csv" <<'PY' && ok "3 runs on slots (epoch%3==1), lateness <1.5s, caller=loop" || ko "alignment"
import csv,sys
from datetime import datetime
r=list(csv.DictReader(open(sys.argv[1]))); print(r)
good=len(r)==3 and all(int(datetime.fromisoformat(x["expected_ts"]).timestamp())%3==1 and 0<=float(x["lateness_s"])<1.5 and x["result"]=="UP" for x in r)
sys.exit(0 if good else 1)
PY
check "mock got UPTIME_CALLER=loop" bash -c "awk '{print \$2}' $W/a/mock-calls | sort -u | grep -qx loop"
check "loop heartbeat file written" test -s "$W/a/monitor-loop.heartbeat.json"

echo "== hung check is killed by timeout and does not block next slot"
mkdir -p "$W/t"; touch "$W/t/hang-once"
t0=$(date +%s); MONITOR_PERIOD_S=4 MONITOR_PHASE_S=0 MONITOR_CHECK_TIMEOUT=2 MONITOR_MAX_RUNS=2 timeout 40 bash -c "$(declare -f L); W=$W REPO=$REPO; L $W/t"
cat "$W/t/scheduler-runs.csv"
check "first slot TIMEOUT (exit 124), second UP" test "$(tail -n +2 "$W/t/scheduler-runs.csv" | cut -d, -f6,7 | tr '\n' ' ')" = "124,TIMEOUT 0,UP "
check "finished within ~2 periods+timeout" test $(( $(date +%s) - t0 )) -le 16

echo "== missed slots detected"
mkdir -p "$W/m"; now=$(date +%s); echo $(( (now/5)*5 - 15 )) >"$W/m/.monitor-loop.last-slot"
MONITOR_PERIOD_S=5 MONITOR_PHASE_S=0 MONITOR_MAX_RUNS=1 timeout 20 bash -c "$(declare -f L); W=$W REPO=$REPO; L $W/m"
cat "$W/m/scheduler-runs.csv"
check "2 MISSED rows then 1 run" test "$(tail -n +2 "$W/m/scheduler-runs.csv" | cut -d, -f7 | tr '\n' ' ')" = "MISSED MISSED UP "

echo "== heartbeat-routine self-failure flagged by loop (once), recovery flagged"
mkdir -p "$W/h"; echo $(( $(date +%s) - 41*60 )) >"$W/h/.heartbeat-routine-last"
MONITOR_PERIOD_S=2 MONITOR_PHASE_S=0 MONITOR_MAX_RUNS=2 timeout 20 bash -c "$(declare -f L); W=$W REPO=$REPO; L $W/h"
check "heartbeat_routine_stale outbox entry" grep -q heartbeat_routine_stale "$W/h/notify-outbox.jsonl"
check "...exactly one line" test "$(wc -l <"$W/h/notify-outbox.jsonl")" -eq 1
date +%s >"$W/h/.heartbeat-routine-last"
MONITOR_PERIOD_S=2 MONITOR_PHASE_S=0 MONITOR_MAX_RUNS=1 timeout 20 bash -c "$(declare -f L); W=$W REPO=$REPO; L $W/h"
check "heartbeat_routine_recovered entry" grep -q heartbeat_routine_recovered "$W/h/notify-outbox.jsonl"

echo "== single instance + start/stop/status"
mkdir -p "$W/s"; export MONITOR_DIR="$W/s" MONITOR_CHECK_CMD="$W/mockcheck.sh" MONITOR_PERIOD_S=600
"$REPO/scripts/monitor-loop.sh" start; check "status rc0 after start" "$REPO/scripts/monitor-loop.sh" status
check "enable flag created" test -f "$W/s/MONITOR_LOOP_ENABLED"
p1=$(cat "$W/s/monitor-loop.pid"); "$REPO/scripts/monitor-loop.sh" --loop 2>/dev/null; check "second --loop exits (flock), pid unchanged" test "$(cat "$W/s/monitor-loop.pid")" = "$p1"
"$REPO/scripts/monitor-loop.sh" stop; ! "$REPO/scripts/monitor-loop.sh" status >/dev/null; check "stopped + flag removed" bash -c "[ $? -eq 0 ] && [ ! -f $W/s/MONITOR_LOOP_ENABLED ]"
echo "== boot-hook autostarts loop only when enabled"
touch "$W/s/MONITOR_LOOP_ENABLED"
CALIBRA_HOME="$REPO" CALIBRA_PORT="$P" CALIBRA_STATE_DIR="$W/s/sd" bash --norc --noprofile -c ". $REPO/scripts/boot-hook.sh"; sleep 1
check "boot-hook started loop" "$REPO/scripts/monitor-loop.sh" status
"$REPO/scripts/monitor-loop.sh" stop >/dev/null
CALIBRA_HOME="$REPO" CALIBRA_PORT="$P" CALIBRA_STATE_DIR="$W/s/sd" bash --norc --noprofile -c ". $REPO/scripts/boot-hook.sh"; sleep 1
check "boot-hook does not start loop when disabled" bash -c "! '$REPO/scripts/monitor-loop.sh' status >/dev/null"
unset MONITOR_DIR MONITOR_CHECK_CMD MONITOR_PERIOD_S

echo "== recent-check guard (no duplicate rows) + outbox from uptime-check"
U="$W/u"; mkdir -p "$U"; export CALIBRA_STATE_DIR="$W/sd" CALIBRA_BASE_URL="http://127.0.0.1:$P"; mkdir -p "$W/sd"
o=$(UPTIME_DIR=$U "$REPO/scripts/uptime-check.sh"); o2=$(UPTIME_DIR=$U "$REPO/scripts/uptime-check.sh")
check "flag absent: guard off (2 rows, live behaviour unchanged)" test "$(rows "$U/uptime-log.csv")" -eq 2
check "flag absent: no outbox" test ! -e "$U/notify-outbox.jsonl"
touch "$U/MONITOR_LOOP_ENABLED"
o=$(UPTIME_DIR=$U UPTIME_MIN_INTERVAL_S=0 UPTIME_CALLER=loop "$REPO/scripts/uptime-check.sh")
o=$(UPTIME_DIR=$U UPTIME_CALLER=routine "$REPO/scripts/uptime-check.sh"); echo "$o"
check "routine within 5 min -> SKIPPED-RECENT rc0" test "$(jf "$o" '["status"]')/$(jf "$o" '["last_check_caller"]')" = "SKIPPED-RECENT/loop"
check "no extra row" test "$(rows "$U/uptime-log.csv")" -eq 3
st1=$(sha256sum <"$U/uptime-state.json"); UPTIME_DIR=$U "$REPO/scripts/uptime-check.sh" >/dev/null
check "state untouched by skipped call" test "$st1" = "$(sha256sum <"$U/uptime-state.json")"
echo down >"$W/mode"; echo sched404 >"$W/mode"
o=$(UPTIME_DIR=$U UPTIME_MIN_INTERVAL_S=0 UPTIME_CALLER=loop "$REPO/scripts/uptime-check.sh")
check "DOWN -> outbox entry type=down" test "$(python3 -c "import json;print([json.loads(l)['type'] for l in open('$U/notify-outbox.jsonl')])")" = "['down']"
echo up >"$W/mode"; UPTIME_DIR=$U UPTIME_MIN_INTERVAL_S=0 UPTIME_CALLER=loop "$REPO/scripts/uptime-check.sh" >/dev/null
python3 "$REPO/scripts/validate-uptime-log.py" "$U/uptime-log.csv" >/dev/null; check "all rows valid 9-col" test $? -eq 0
echo "== notify-outbox.sh"
NO() { UPTIME_DIR=$U "$REPO/scripts/notify-outbox.sh" "$@"; }
check "2 pending (down, recovery)" test "$(NO list-pending --json | python3 -c 'import json,sys;print(",".join(e["type"] for e in json.load(sys.stdin)))')" = "down,recovery"
id=$(NO list-pending --json | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["id"])')
h=$(sha256sum <"$U/notify-outbox.jsonl"); NO mark-delivered "$id" chat:t-test-1
check "1 pending after mark" test "$(NO list-pending --json | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))')" -eq 1
check "outbox entries file not rewritten" test "$h" = "$(sha256sum <"$U/notify-outbox.jsonl")"
check "mark again idempotent" bash -c "UPTIME_DIR=$U '$REPO/scripts/notify-outbox.sh' mark-delivered '$id' x | grep -q already"
check "unknown id rejected" bash -c "! UPTIME_DIR=$U '$REPO/scripts/notify-outbox.sh' mark-delivered nope x 2>/dev/null"

echo "== heartbeat test mode"
o=$(HEARTBEAT_TEST=1 HEARTBEAT_STATE_DIR="$LIVE" "$REPO/scripts/monitor-heartbeat.sh"); rc=$?
check "test mode refuses live dir" bash -c "[ $rc -eq 2 ] && echo '$o' | grep -q refuses"
check "test mode requires dir" bash -c "! HEARTBEAT_TEST=1 '$REPO/scripts/monitor-heartbeat.sh' >/dev/null"
T="$W/hbt"; mkdir -p "$T"; cp "$U/uptime-state.json" "$T/"
NOW=$(date +%s); MONO0=$(cut -d' ' -f1 /proc/uptime)
# fake clock advances wall AND monotonic time together (a running box); pause cases are in test-monitor-pause.sh
HT() { HEARTBEAT_TEST=1 HEARTBEAT_STATE_DIR="$T" HEARTBEAT_NOW_EPOCH="$1" HEARTBEAT_MONO_S="$(python3 -c "print($MONO0+$1-$NOW)")" "$REPO/scripts/monitor-heartbeat.sh"; }
o=$(HT $NOW); check "fresh -> normal" test "$(jf "$o" '["kind"]')" = normal
o=$(HT $((NOW+25*60))); echo "$o"; check "stale -> heartbeat/monitor_stale [TEST]" bash -c "[ '$(jf "$o" '["kind"]')' = monitor_stale ] && grep -q '\[TEST\] Calibra heartbeat' '$T/notify-outbox-test.jsonl'"
o=$(HT $((NOW+30*60))); check "stale again -> deduped" test "$(jf "$o" '["notify"]')" = none
o=$(HT $((NOW+60))); check "fresh again -> heartbeat_recovery" test "$(jf "$o" '["kind"]')" = heartbeat_recovery
touch "$T/MONITOR_LOOP_ENABLED"; echo 999999 >"$T/monitor-loop.pid"
o=$(HT $((NOW+90))); check "loop enabled but dead -> loop_dead" test "$(jf "$o" '["kind"]')" = loop_dead
o=$(HT $((NOW+100))); check "loop_dead deduped" test "$(jf "$o" '["notify"]')" = none
sleep 300 & SP=$!; echo $SP >"$T/monitor-loop.pid"; printf '{"updated_epoch":%s}\n' "$NOW" >"$T/monitor-loop.heartbeat.json"
o=$(HT $((NOW+110))); check "loop alive -> loop_recovered" test "$(jf "$o" '["kind"]')" = loop_recovered; kill $SP
check "test outbox only; no notify-outbox.jsonl in test dir" test ! -e "$T/notify-outbox.jsonl"
check "heartbeat-routine-last recorded" test -s "$T/.heartbeat-routine-last"
check "live files untouched by whole suite" test "$L0" = "$(livesum)"
echo "RESULT: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
