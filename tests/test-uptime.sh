#!/usr/bin/env bash
# Tests for uptime-check.sh, monitor-heartbeat.sh, validate-uptime-log.py, outage-duration.py.
# Mock HTTP server on a spare port + temp dirs. Never touches real prod or the real uptime files.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "PASS: $*"; }; ko() { FAIL=$((FAIL+1)); echo "FAIL: $*"; }
check() { local d="$1"; shift; if "$@"; then ok "$d"; else ko "$d"; fi; }
jf() { python3 -c "import json,sys;d=json.loads(sys.argv[1]);print(d$2)" "$1"; }
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
W="$(mktemp -d)"; P="$(free_port)"; DEAD="$(free_port)"
echo up >"$W/mode"
python3 "$REPO/tests/mock_calibra.py" "$P" "$W/mode" & MOCK=$!
trap 'kill $MOCK 2>/dev/null; rm -rf "$W"' EXIT
for _ in $(seq 20); do curl -s -o /dev/null "http://127.0.0.1:$P/" && break; sleep 0.2; done
export UPTIME_DIR="$W/u" CALIBRA_STATE_DIR="$W/sd" CALIBRA_BASE_URL="http://127.0.0.1:$P" UPTIME_CURL_MAX=3
mkdir -p "$W/u" "$W/sd"
# seed a log containing a historical malformed row: must survive byte-for-byte
printf 'timestamp,status,root_http,scheduler_http,dataQuality,lastTick,tick_age_min,crashloop,detail\n2026-10-16T11:56:43+02:00,DOWN,legacy 3-field row\n' >"$W/u/uptime-log.csv"
cp "$W/u/uptime-log.csv" "$W/seed.csv"
V() { python3 "$REPO/scripts/validate-uptime-log.py" "$@"; }

echo "== UP (first check)"
o="$("$REPO/scripts/uptime-check.sh")"; echo "$o"
check "status UP, notify none" test "$(jf "$o" '["status"]')/$(jf "$o" '["notify"]')" = "UP/none"
check "single JSON line" test "$(printf '%s\n' "$o" | wc -l)" -eq 1
echo "== DOWN (connection refused)"
o="$(CALIBRA_BASE_URL=http://127.0.0.1:$DEAD "$REPO/scripts/uptime-check.sh")"; echo "$o"
check "DOWN notify=down transition=DOWN" test "$(jf "$o" '["status"]')/$(jf "$o" '["notify"]')/$(jf "$o" '["transition"]')" = "DOWN/down/DOWN"
check "missing response: 000/000/unavailable/''/''" test "$(jf "$o" '["root_http"]'),$(jf "$o" '["scheduler_http"]'),$(jf "$o" '["dataQuality"]'),$(jf "$o" '["lastTick"]'),$(jf "$o" '["tick_age_min"]')" = "000,000,unavailable,,"
o="$(CALIBRA_BASE_URL=http://127.0.0.1:$DEAD "$REPO/scripts/uptime-check.sh")"
check "2nd DOWN: notify none (no re-alert)" test "$(jf "$o" '["notify"]')" = "none"
check "consecutive_failures=2" test "$(python3 -c "import json;print(json.load(open('$W/u/uptime-state.json'))['consecutive_failures'])")" = 2
echo "== RECOVERED"
o="$("$REPO/scripts/uptime-check.sh")"; echo "$o"
check "RECOVERED notify=recovery" test "$(jf "$o" '["status"]')/$(jf "$o" '["notify"]')" = "RECOVERED/recovery"
check "outage report present (bounds; no process logs)" test "$(jf "$o" '["outage"]["kind"]')" = "bounds"
python3 - "$W/u/uptime-state.json" <<'PY' && ok "state has all P4 timestamps" || ko "state has all P4 timestamps"
import json,sys; s=json.load(open(sys.argv[1]))
need=["last_healthy_at","first_failed_at","last_failed_at","down_transition_at","service_restored_at","recovery_transition_at","last_healthy_before_outage_at","last_outage"]
missing=[k for k in need if not s.get(k)]; print("state keys missing:",missing); sys.exit(1 if missing else 0)
PY
check "transitions file has DOWN then RECOVERED" test "$(python3 -c "import json;print(','.join(json.loads(l)['transition'] for l in open('$W/u/uptime-transitions.jsonl')))")" = "DOWN,RECOVERED"
o="$("$REPO/scripts/uptime-check.sh")"; check "next healthy: UP/none" test "$(jf "$o" '["status"]')/$(jf "$o" '["notify"]')" = "UP/none"
echo "== missing endpoint (scheduler 404) and stale tick"
echo sched404 >"$W/mode"; o="$("$REPO/scripts/uptime-check.sh")"; echo "$o"
check "sched 404 -> DOWN, scheduler_http=404, dataQuality=unavailable, lastTick ''" test "$(jf "$o" '["status"]'),$(jf "$o" '["scheduler_http"]'),$(jf "$o" '["dataQuality"]'),$(jf "$o" '["lastTick"]')" = "DOWN,404,unavailable,"
echo up >"$W/mode"; "$REPO/scripts/uptime-check.sh" >/dev/null
echo stale >"$W/mode"; o="$("$REPO/scripts/uptime-check.sh")"
check "stale tick (45 min) -> DOWN" test "$(jf "$o" '["status"]')" = "DOWN"
echo "== detail with commas/quotes/newlines"
echo weird >"$W/mode"; o="$("$REPO/scripts/uptime-check.sh")"; echo "$o"
python3 - "$W/u/uptime-log.csv" <<'PY' && ok "weird detail round-trips via csv module (9 fields)" || ko "weird detail round-trips"
import csv,sys; rows=list(csv.reader(open(sys.argv[1],newline=""))); r=rows[-1]
print(len(r), repr(r[8])); sys.exit(0 if len(r)==9 and '"quoted"' in r[8] and "\n" in r[8] and "," in r[8] else 1)
PY
echo up >"$W/mode"; "$REPO/scripts/uptime-check.sh" >/dev/null
echo "== CRASHLOOP marker"
touch "$W/sd/CRASHLOOP"; o="$("$REPO/scripts/uptime-check.sh")"; rm "$W/sd/CRASHLOOP"
check "CRASHLOOP -> DOWN crashloop=yes" test "$(jf "$o" '["status"]')/$(jf "$o" '["crashloop"]')" = "DOWN/yes"
"$REPO/scripts/uptime-check.sh" >/dev/null
echo "== history preserved + validator"
check "seed bytes preserved (prefix identical)" cmp -n "$(stat -c%s "$W/seed.csv")" "$W/seed.csv" "$W/u/uptime-log.csv"
V "$W/u/uptime-log.csv"; rc=$?
check "validator flags exactly the 1 legacy row (rc 1)" bash -c "[ $rc -eq 1 ] && [ \$(python3 '$REPO/scripts/validate-uptime-log.py' '$W/u/uptime-log.csv' --json | python3 -c 'import json,sys;print(len(json.load(sys.stdin)[\"malformed\"]))') -eq 1 ]"
tail -n +3 "$W/u/uptime-log.csv" | { echo 'timestamp,status,root_http,scheduler_http,dataQuality,lastTick,tick_age_min,crashloop,detail'; cat; } >"$W/new-only.csv"
V "$W/new-only.csv" >/dev/null; check "all rows written by uptime-check.sh are valid" test $? -eq 0
h1=$(sha256sum <"$W/u/uptime-log.csv"); V "$W/u/uptime-log.csv" >/dev/null; check "validator does not modify file" test "$h1" = "$(sha256sum <"$W/u/uptime-log.csv")"
echo "== flock overlap prevention"
( exec 7>"$W/u/.uptime-check.lock"; flock 7; sleep 4 ) & HOLDER=$!; sleep 0.5
n0=$(wc -l <"$W/u/uptime-log.csv"); o="$(UPTIME_LOCK_WAIT=1 "$REPO/scripts/uptime-check.sh")"; rc=$?; echo "$o"
check "overlap: rc 75, SKIPPED, no row" bash -c "[ $rc -eq 75 ] && [ '$(jf "$o" '["status"]')' = SKIPPED ] && [ $n0 -eq \$(wc -l <'$W/u/uptime-log.csv') ]"
wait $HOLDER
echo "== heartbeat notify in uptime-check after a gap"
python3 - "$W/u/uptime-state.json" <<'PY'
import json,sys; p=sys.argv[1]; s=json.load(open(p)); s["last_check_at"]=s["lastCheck"]="2026-01-01T00:00:00+01:00"; json.dump(s,open(p,"w"))
PY
o="$("$REPO/scripts/uptime-check.sh")"; check "UP after gap -> notify=heartbeat" test "$(jf "$o" '["notify"]')" = "heartbeat"
echo "== monitor-heartbeat.sh"
NOW=$(date +%s)
HB() { HEARTBEAT_NOW_EPOCH="$1" "$REPO/scripts/monitor-heartbeat.sh"; }
o="$(HB "$NOW")"; echo "$o"; check "fresh -> none" test "$(jf "$o" '["notify"]')" = none
o="$(HB $((NOW+25*60)))"; echo "$o"; check "stale 25min -> heartbeat" test "$(jf "$o" '["notify"]')" = heartbeat
o="$(HB $((NOW+40*60)))"; check "still stale -> deduped none" test "$(jf "$o" '["notify"]')" = none
"$REPO/scripts/uptime-check.sh" >/dev/null
o="$(HB $(( $(date +%s) + 60 )))"; echo "$o"; check "checks resumed -> recovery(heartbeat_recovery)" test "$(jf "$o" '["notify"]')/$(jf "$o" '["kind"]')" = recovery/heartbeat_recovery
o="$(HB $(( $(date +%s) + 120 )))"; check "after recovery -> none" test "$(jf "$o" '["notify"]')" = none
rm "$W/u/uptime-state.json"; o="$(HB "$NOW")"; check "missing state -> heartbeat" test "$(jf "$o" '["notify"]')" = heartbeat
echo "== outage-duration.py unit tests"
python3 "$REPO/tests/test_outage_duration.py"; check "outage-duration unit tests" test $? -eq 0
echo "RESULT: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
