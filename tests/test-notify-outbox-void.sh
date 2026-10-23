#!/usr/bin/env bash
# Tests for notify-outbox.sh void / list-voided and the voided-entry guards on list-pending and mark-delivered.
# Uses temp fixture outboxes only (NOTIFY_OUTBOX=<tmp>); never touches /workspace/calibra-stabilization, prod or chat.
# Optional: OUTBOX_LIVE_COPY_DIR=<dir with a COPY of notify-outbox.jsonl + .delivered.jsonl> adds a copy-run check
# that voids every pending entry in that copy (never point it at the live dir; refused).
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"; LIVE=/workspace/calibra-stabilization
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "PASS: $*"; }; ko() { FAIL=$((FAIL+1)); echo "FAIL: $*"; }
check() { local d="$1"; shift; if "$@"; then ok "$d"; else ko "$d"; fi; }
livesum() { [ -d "$LIVE" ] && (cd "$LIVE" && sha256sum notify-outbox.jsonl notify-outbox.delivered.jsonl notify-outbox.voided.jsonl 2>/dev/null) | sha256sum; }
L0="$(livesum)"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
unset UPTIME_DIR MONITOR_DIR
S="$REPO/scripts/notify-outbox.sh"
F="$W/o/notify-outbox.jsonl"; mkdir -p "$W/o"
NO() { NOTIFY_OUTBOX="$F" OUTBOX_SOURCE=test "$S" "$@"; }
npend() { NO list-pending --json | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))'; }
pend_ids() { NO list-pending --json | python3 -c 'import json,sys;print(" ".join(e["id"] for e in json.load(sys.stdin)))'; }

echo "== fixture"
A=$(NO add down "Calibra DOWN: fixture a" DOWN); B=$(NO add recovery "Calibra RECOVERED: fixture b" RECOVERED)
C=$(NO add heartbeat "fixture c"); D=$(NO add down "fixture d")
check "4 pending" test "$(npend)" -eq 4
NO mark-delivered "$C" chat:t-fixture >/dev/null
check "3 pending after delivering C" test "$(npend)" -eq 3
H0=$(sha256sum <"$F"); HD0=$(sha256sum <"${F%.jsonl}.delivered.jsonl")
ORIG_A=$(grep -F "\"$A\"" "$F")

echo "== reason required"
NO void "$A" >/dev/null 2>"$W/e1"; rc=$?; check "void without --reason rejected (rc!=0)" test $rc -ne 0
check "...stderr has usage" grep -q "non-empty --reason required" "$W/e1"
NO void "$A" --reason "" >/dev/null 2>&1; check "empty reason rejected" test $? -ne 0
NO void "$A" --reason "   " >/dev/null 2>&1; check "whitespace-only reason rejected" test $? -ne 0
NO void "$A" --reason >/dev/null 2>&1; check "--reason without value rejected" test $? -ne 0
NO void "$A" --bogus x --reason r >/dev/null 2>&1; check "unexpected argument rejected" test $? -ne 0
NO void >/dev/null 2>&1; check "void without id rejected" test $? -ne 0
check "no void file created by rejected calls" test ! -e "${F%.jsonl}.voided.jsonl"
check "still 3 pending" test "$(npend)" -eq 3

echo "== unknown id"
NO void nope --reason "x" >/dev/null 2>"$W/e2"; rc=$?
check "unknown id rejected (rc!=0)" bash -c "[ $rc -ne 0 ] && grep -q 'unknown id nope' '$W/e2'"

echo "== delivered protection"
NO void "$C" --reason "obsolete" >/dev/null 2>"$W/e3"; rc=$?
check "voiding delivered entry refused (rc!=0)" bash -c "[ $rc -ne 0 ] && grep -q 'refusing to void delivered entry' '$W/e3'"
check "no void record for delivered entry" bash -c "! grep -qsF '\"$C\"' '${F%.jsonl}.voided.jsonl'"

echo "== successful void"
o=$(NO void "$A" --reason "false alert: box pause"); rc=$?
check "void rc0 + message" bash -c "[ $rc -eq 0 ] && [ '$o' = 'voided $A reason=false alert: box pause' ]"
check "A excluded from list-pending" bash -c "! echo '$(pend_ids)' | grep -qF '$A'"
check "2 pending" test "$(npend)" -eq 2
o=$(NO void "$B" --reason="superseded"); check "--reason=VALUE form accepted" test $? -eq 0
check "1 pending (D)" test "$(pend_ids)" = "$D"
check "voided file has 2 records" test "$(wc -l <"${F%.jsonl}.voided.jsonl")" -eq 2
python3 - "$F" "$A" <<'PY' && ok "void record fields (status voided, reason, at, source, voided:true)" || ko "void record fields"
import json,sys
F,A=sys.argv[1],sys.argv[2]
r=[json.loads(l) for l in open(F[:-6]+".voided.jsonl")]
v=[x for x in r if x["id"]==A][0]
assert v["status"]=="voided" and v["voided"] is True and v["reason"]=="false alert: box pause" and v["at"] and v["source"]=="test", v
PY

echo "== original fields preserved byte-for-byte"
check "outbox entries file byte-identical (sha256)" test "$H0" = "$(sha256sum <"$F")"
check "delivered file byte-identical (sha256)" test "$HD0" = "$(sha256sum <"${F%.jsonl}.delivered.jsonl")"
check "entry A line unchanged" test "$ORIG_A" = "$(grep -F "\"$A\"" "$F")"
python3 - "$F" "$A" "$(NO list-all --json)" <<'PY' && ok "list-all overlay: original id/type/kind/created/message/source kept + voided_at/void_reason/status" || ko "list-all overlay"
import json,sys
F,A,js=sys.argv[1],sys.argv[2],sys.argv[3]
orig=[json.loads(l) for l in open(F) if json.loads(l)["id"]==A][0]
e=[x for x in json.loads(js) if x["id"]==A][0]
for k,v in orig.items():
    if k!="delivered": assert e[k]==v,(k,e[k],v)
assert e["delivered"] is False and e["voided"] is True and e["status"]=="voided" and e["void_reason"]=="false alert: box pause" and e["voided_at"]
PY

echo "== idempotent repeat void"
V0=$(sha256sum <"${F%.jsonl}.voided.jsonl")
o=$(NO void "$A" --reason "different reason"); rc=$?
check "repeat void rc0 'already voided'" bash -c "[ $rc -eq 0 ] && echo '$o' | grep -q '^already voided'"
check "repeat void did not alter void file" test "$V0" = "$(sha256sum <"${F%.jsonl}.voided.jsonl")"
check "original reason kept" bash -c "NOTIFY_OUTBOX='$F' '$S' list-voided --json | grep -q 'false alert: box pause'"

echo "== mark-delivered refuses voided"
NO mark-delivered "$A" chat:t-should-not >/dev/null 2>"$W/e4"; rc=$?
check "mark-delivered voided rc!=0" bash -c "[ $rc -ne 0 ] && grep -q 'refusing to mark voided entry' '$W/e4'"
check "delivered file unchanged" test "$HD0" = "$(sha256sum <"${F%.jsonl}.delivered.jsonl")"
check "mark-delivered still works for pending D" bash -c "NOTIFY_OUTBOX='$F' '$S' mark-delivered '$D' chat:t-d | grep -q 'marked $D delivered'"
check "mark-delivered idempotent for delivered C" bash -c "NOTIFY_OUTBOX='$F' '$S' mark-delivered '$C' x | grep -q already"
check "0 pending" test "$(npend)" -eq 0

echo "== list-voided"
check "list-voided --json lists A,B" test "$(NO list-voided --json | python3 -c 'import json,sys;print(" ".join(e["id"] for e in json.load(sys.stdin)))')" = "$A $B"
check "list-voided text 2 rows" test "$(NO list-voided 2>/dev/null | wc -l)" -eq 2
check "list-all text marks voided" bash -c "NOTIFY_OUTBOX='$F' '$S' list-all 2>/dev/null | grep -F '$A' | grep -q 'voided='"

echo "== restart/resume simulation: fresh process sees voided state from disk only"
check "fresh list-pending --json is []" test "$(NOTIFY_OUTBOX="$F" "$S" list-pending --json)" = "[]"
check "fresh list-pending text empty" test -z "$(NOTIFY_OUTBOX="$F" "$S" list-pending 2>/dev/null)"
check "default cmd (no args) excludes voided" test -z "$(NOTIFY_OUTBOX="$F" "$S" 2>/dev/null)"

echo "== backward compatibility vs pre-void script (OUTBOX_OLD_REF, default 696e114; no voids): identical output"
G="$W/g/notify-outbox.jsonl"; mkdir -p "$W/g"; git -C "$REPO" show "${OUTBOX_OLD_REF:-696e114}":scripts/notify-outbox.sh >"$W/old.sh"; chmod +x "$W/old.sh"
for i in 1 2 3; do NOTIFY_OUTBOX="$G" "$S" add down "m$i" >/dev/null; done
i1=$(NOTIFY_OUTBOX="$G" "$S" list-pending --json | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["id"])'); NOTIFY_OUTBOX="$G" "$S" mark-delivered "$i1" r >/dev/null
for c in "list-pending" "list-pending --json" "list-all" "list-all --json"; do
  check "old==new: $c (stdout+stderr)" test "$(NOTIFY_OUTBOX="$G" "$W/old.sh" $c 2>&1)" = "$(NOTIFY_OUTBOX="$G" "$S" $c 2>&1)"
done

echo "== concurrency (flock): parallel voids"
K="$W/k/notify-outbox.jsonl"; mkdir -p "$W/k"
for i in $(seq 20); do NOTIFY_OUTBOX="$K" "$S" add down "c$i" >/dev/null; done
ids=$(NOTIFY_OUTBOX="$K" "$S" list-pending --json | python3 -c 'import json,sys;print(" ".join(e["id"] for e in json.load(sys.stdin)))')
first=${ids%% *}
for i in $(seq 10); do NOTIFY_OUTBOX="$K" "$S" void "$first" --reason "r$i" >/dev/null 2>&1 & done; wait
check "10 parallel voids of one id -> exactly 1 record" test "$(grep -cF "\"$first\"" "${K%.jsonl}.voided.jsonl")" -eq 1
for id in $ids; do NOTIFY_OUTBOX="$K" "$S" void "$id" --reason "bulk" >/dev/null 2>&1 & done; wait
check "20 ids voided in parallel -> 20 records, all valid JSON, unique ids" python3 -c "
import json;r=[json.loads(l) for l in open('${K%.jsonl}.voided.jsonl')];assert len(r)==20 and len({x['id'] for x in r})==20"
check "0 pending after parallel voids" test "$(NOTIFY_OUTBOX="$K" "$S" list-pending --json)" = "[]"
R="$W/r/notify-outbox.jsonl"; mkdir -p "$W/r"; rid=$(NOTIFY_OUTBOX="$R" "$S" add down race)
NOTIFY_OUTBOX="$R" "$S" void "$rid" --reason race >/dev/null 2>&1 & NOTIFY_OUTBOX="$R" "$S" mark-delivered "$rid" race >/dev/null 2>&1 & wait
nv=$(cat "${R%.jsonl}.voided.jsonl" 2>/dev/null | grep -cF "\"$rid\""); nd=$(cat "${R%.jsonl}.delivered.jsonl" 2>/dev/null | grep -cF "\"$rid\"")
check "void vs mark-delivered race -> exactly one wins (voided=$nv delivered=$nd)" test $((nv + nd)) -eq 1

if [ -n "${OUTBOX_LIVE_COPY_DIR:-}" ]; then
  echo "== copy-run on $OUTBOX_LIVE_COPY_DIR"
  CD="$(cd "$OUTBOX_LIVE_COPY_DIR" && pwd)"
  if [ "$CD" = "$LIVE" ]; then ko "refusing to run copy-run against live dir"; else
    CF="$CD/notify-outbox.jsonl"; h1=$(sha256sum <"$CF"); h2=$(sha256sum <"$CD/notify-outbox.delivered.jsonl")
    cids=$(NOTIFY_OUTBOX="$CF" "$S" list-pending --json | python3 -c 'import json,sys;print(" ".join(e["id"] for e in json.load(sys.stdin)))')
    echo "pending before: $(echo $cids | wc -w)"
    for id in $cids; do NOTIFY_OUTBOX="$CF" OUTBOX_SOURCE=copy-run "$S" void "$id" --reason "copy-run test" || ko "void $id"; done
    check "copy: list-pending empty" test "$(NOTIFY_OUTBOX="$CF" "$S" list-pending --json)" = "[]"
    check "copy: entries file unchanged" test "$h1" = "$(sha256sum <"$CF")"
    check "copy: delivered file unchanged" test "$h2" = "$(sha256sum <"$CD/notify-outbox.delivered.jsonl")"
  fi
fi

check "live outbox files untouched by whole suite" test "$L0" = "$(livesum)"
echo "RESULT: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
