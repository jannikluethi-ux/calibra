#!/usr/bin/env bash
# B2.3 deterministic tests: pause-aware monitor-of-the-monitor (monitor-heartbeat.sh, test mode, fake clocks)
# and monitor-loop.sh pause detection / slot epoch / heartbeat-routine staleness (temp dirs, stub check command,
# fake clock via MONITOR_CLOCK_CMD). No HTTP at all; never touches live state or prod.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"; LIVE=/workspace/calibra-stabilization
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "PASS: $*"; }; ko() { FAIL=$((FAIL+1)); echo "FAIL: $*"; }
check() { local d="$1"; shift; if "$@"; then ok "$d"; else ko "$d"; fi; }
jf() { python3 -c "import json,sys;d=json.loads(sys.argv[1]);print(d$2)" "$1"; }
livesum() { [ -d "$LIVE" ] && (cd "$LIVE" && sha256sum uptime-log.csv uptime-state.json uptime-transitions.jsonl .heartbeat-dedupe.json \
  notify-outbox.jsonl notify-outbox.delivered.jsonl notify-outbox.voided.jsonl scheduler-runs.csv monitor-loop.heartbeat.json \
  monitor-loop.log .heartbeat-routine-last 2>/dev/null; ls -la) | sha256sum; }
L0="$(livesum)"
W="$(mktemp -d)"; SP=
cleanup() { for d in "$W"/*/; do [ -f "$d/monitor-loop.pid" ] && kill "$(cat "$d/monitor-loop.pid")" 2>/dev/null; done; [ -n "$SP" ] && kill $SP 2>/dev/null; rm -rf "$W"; }
trap cleanup EXIT
unset UPTIME_DIR MONITOR_DIR
N0=1792800000; BA=boot-a
T="$W/hb"; mkdir -p "$T"
state() { printf '{"status":"UP","last_check_at":"%s","last_check_epoch":%s%s,"schema":3}\n' "$(date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ)" "$1" "${2:-}" >"$T/uptime-state.json"; }
HT() { HEARTBEAT_TEST=1 HEARTBEAT_STATE_DIR="$T" HEARTBEAT_NOW_EPOCH="$1" HEARTBEAT_MONO_S="$2" HEARTBEAT_BOOT_ID="${3:-$BA}" "$REPO/scripts/monitor-heartbeat.sh"; }
K() { echo "$(jf "$1" '["notify"]')/$(jf "$1" '["kind"]')/$(jf "$1" '["observation"]')"; }

echo "== heartbeat: monitor_stale judged on monotonic age"
state $N0 ',"last_check_mono_s":1000,"last_check_boot_id":"boot-a"'
o=$(HT $((N0+36000)) 1600); echo "$o"
check "10 h wall gap, 10 min monotonic -> no alert, HOST_PAUSED" test "$(K "$o")/$(jf "$o" '["age_min"]')" = "none/normal/HOST_PAUSED/10.0"
o=$(HT $((N0+36000)) 2500); check "25 min monotonic -> heartbeat/monitor_stale (genuine)" test "$(K "$o")" = "heartbeat/monitor_stale/NORMAL"
o=$(HT $((N0+36100)) 2600); check "deduped" test "$(jf "$o" '["notify"]')" = none
state $((N0+36500)) ',"last_check_mono_s":3000,"last_check_boot_id":"boot-a"'
o=$(HT $((N0+36600)) 3100); check "check resumes -> recovery/heartbeat_recovery" test "$(K "$o")" = "recovery/heartbeat_recovery/NORMAL"
state $N0
o=$(HT $((N0+1500)) 99999); check "legacy state (no mono fields): wall age 25 min -> monitor_stale" test "$(jf "$o" '["kind"]')/$(jf "$o" '["age_basis"]')" = "monitor_stale/wall"
rm -f "$T/.heartbeat-dedupe.json"
state $N0 ',"last_check_mono_s":9000,"last_check_boot_id":"boot-old"'
o=$(HT $((N0+3*3600)) 300 boot-b); check "after reboot (uptime 5 min) -> age capped at uptime, no alert" test "$(K "$o")/$(jf "$o" '["age_basis"]')" = "none/normal/REBOOTED/rebooted"
o=$(HT $((N0+3*3600)) 1800 boot-b); check "after reboot, uptime 30 min and still no check -> monitor_stale" test "$(jf "$o" '["kind"]')" = monitor_stale
rm -f "$T/.heartbeat-dedupe.json"

echo "== heartbeat: loop_dead judged on monotonic heartbeat age"
state $N0 ',"last_check_mono_s":1000,"last_check_boot_id":"boot-a"'
touch "$T/MONITOR_LOOP_ENABLED"; sleep 600 & SP=$!; echo $SP >"$T/monitor-loop.pid"
hb() { printf '{"pid":%s,"updated_epoch":%s,"mono_s":%s,"boot_id":"%s"}\n' "$SP" "$1" "$2" "$3" >"$T/monitor-loop.heartbeat.json"; }
for a in 5.2 5.6 8.1; do   # 18 Oct false loop_dead alerts: heartbeat wall age a min while pid alive (box paused)
  hb $N0 1000 boot-a; o=$(HT $(python3 -c "print(int($N0+$a*60))") 1060)
  [ "$(K "$o")" = "none/normal/HOST_PAUSED" ] || { ko "replay wall age $a: $(K "$o") $(jf "$o" '["loop"]')"; continue; }; ok "replay 18 Oct loop heartbeat wall age $a min, monotonic 1 min -> no loop_dead"
done
hb $N0 1000 boot-a; o=$(HT $((N0+600)) 1400); echo "$o"
check "monotonic heartbeat age 6.7 min > 5 -> loop_dead (genuine hang)" test "$(K "$o")" = "heartbeat/loop_dead/NORMAL"
hb $N0 1000 boot-a; o=$(HT $((N0+120)) 1120); check "fresh -> loop_recovered" test "$(jf "$o" '["kind"]')" = loop_recovered
hb $N0 1000 boot-old; o=$(HT $((N0+120)) 100 boot-a)
check "heartbeat from a previous boot (pid may be reused) -> loop_dead" test "$(jf "$o" '["kind"]')/$(jf "$o" '["loop"]["detail"]')" = "loop_dead/loop heartbeat from a previous boot"
read -r e m b <"$T/.heartbeat-routine-last"
check ".heartbeat-routine-last = 'epoch mono boot'" test "$e/$m/$b" = "$((N0+120))/100.00/boot-a"
check "test outbox only" test ! -e "$T/notify-outbox.jsonl"
kill $SP 2>/dev/null; SP=; rm -f "$T/MONITOR_LOOP_ENABLED"

echo "== loop: pause detection, MISSED-PAUSED, UPTIME_SLOT_EPOCH"
cat >"$W/mockcheck.sh" <<'M'
#!/usr/bin/env bash
echo "${UPTIME_SLOT_EPOCH:-none} $UPTIME_CALLER" >>"$UPTIME_DIR/mock-calls"
echo '{"ok":true,"status":"UP","notify":"none"}'
M
cat >"$W/clock.sh" <<M
#!/usr/bin/env bash
echo "\$(( \$(date +%s) + \$(cat $W/skew 2>/dev/null || echo 0) )) \$(cut -d' ' -f1 /proc/uptime) \$(cat /proc/sys/kernel/random/boot_id)"
M
chmod +x "$W/mockcheck.sh" "$W/clock.sh"; echo 0 >"$W/skew"
D="$W/lp"; mkdir -p "$D"
MONITOR_DIR="$D" MONITOR_CHECK_CMD="$W/mockcheck.sh" MONITOR_TICK_S=1 MONITOR_PERIOD_S=5 MONITOR_PHASE_S=0 MONITOR_MAX_RUNS=2 \
  MONITOR_CLOCK_CMD="$W/clock.sh" timeout 40 "$REPO/scripts/monitor-loop.sh" --loop & LP=$!
for _ in $(seq 100); do [ -s "$D/mock-calls" ] && break; sleep 0.1; done
echo 22 >"$W/skew"     # wall clock jumps 22 s while /proc/uptime does not: simulated whole-box pause
wait $LP; cat "$D/scheduler-runs.csv"; grep -E "pause|MISSED" "$D/monitor-loop.log"
check "loop logged the host pause" grep -q "host pause ~2[0-9]s detected" "$D/monitor-loop.log"
check "slots inside the pause are MISSED-PAUSED (no plain MISSED)" bash -c "cut -d, -f7 '$D/scheduler-runs.csv' | grep -q '^MISSED-PAUSED$' && ! cut -d, -f7 '$D/scheduler-runs.csv' | grep -qx MISSED"
check "2 runs executed" test "$(cut -d, -f7 "$D/scheduler-runs.csv" | grep -cx UP)" -eq 2
python3 - "$D" <<'PY' && ok "heartbeat JSON carries mono_s, boot_id, last_pause_s>=10" || ko "heartbeat JSON fields"
import json,sys; h=json.load(open(sys.argv[1]+"/monitor-loop.heartbeat.json")); print(h)
sys.exit(0 if isinstance(h["mono_s"],(int,float)) and h["boot_id"] and h["last_pause_s"]>=10 else 1)
PY
python3 - "$D" <<'PY' && ok "each check got UPTIME_SLOT_EPOCH = its expected slot" || ko "slot epoch"
import csv,sys
from datetime import datetime
rows=[r for r in csv.DictReader(open(sys.argv[1]+"/scheduler-runs.csv")) if r["result"]=="UP"]
calls=[l.split()[0] for l in open(sys.argv[1]+"/mock-calls")]
exp=[str(int(datetime.fromisoformat(r["expected_ts"]).timestamp())) for r in rows]; print(calls, exp)
sys.exit(0 if calls==exp else 1)
PY

echo "== loop: heartbeat-routine staleness is monotonic and respects ROUTINES_PAUSED"
RL() { MONITOR_DIR="$1" MONITOR_CHECK_CMD="$W/mockcheck.sh" MONITOR_TICK_S=1 MONITOR_PERIOD_S=2 MONITOR_PHASE_S=0 MONITOR_MAX_RUNS=1 timeout 20 "$REPO/scripts/monitor-loop.sh" --loop; }
MN=$(cut -d' ' -f1 /proc/uptime); BN=$(cat /proc/sys/kernel/random/boot_id)
D="$W/r1"; mkdir -p "$D"; echo "$(( $(date +%s) - 41*60 )) $(python3 -c "print($MN-60)") $BN" >"$D/.heartbeat-routine-last"; RL "$D"
check "41 min wall but 1 min monotonic (box paused) -> no heartbeat_routine_stale" test ! -e "$D/notify-outbox.jsonl"
D="$W/r2"; mkdir -p "$D"; echo "$(( $(date +%s) - 41*60 )) $(python3 -c "print($MN-41*60)") $BN" >"$D/.heartbeat-routine-last"; RL "$D"
check "41 min monotonic -> heartbeat_routine_stale (genuine)" grep -q heartbeat_routine_stale "$D/notify-outbox.jsonl"
D="$W/r3"; mkdir -p "$D"; echo "$(( $(date +%s) - 41*60 ))" >"$D/.heartbeat-routine-last"; touch "$D/ROUTINES_PAUSED" "$D/.monitor-loop.hbroutine-flag"; RL "$D"
check "ROUTINES_PAUSED: no alert, old flag cleared silently" bash -c "[ ! -e '$D/notify-outbox.jsonl' ] && [ ! -e '$D/.monitor-loop.hbroutine-flag' ] && grep -q 'cleared silently' '$D/monitor-loop.log'"
D="$W/r4"; mkdir -p "$D"; echo "$(( $(date +%s) - 41*60 )) 5 boot-old" >"$D/.heartbeat-routine-last"; RL "$D"
if python3 -c "import sys;sys.exit(0 if $MN/60>41 else 1)"; then
  check "record from previous boot: age=min(wall,uptime)=41 min -> stale" grep -q heartbeat_routine_stale "$D/notify-outbox.jsonl"
else check "record from previous boot, uptime <= 41 min -> not stale" test ! -e "$D/notify-outbox.jsonl"; fi
check "live monitor files unchanged" test "$L0" = "$(livesum)"
echo "RESULT: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
