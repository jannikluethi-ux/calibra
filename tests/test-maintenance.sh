#!/usr/bin/env bash
# Tests for maintenance guard + boot-hook + ensure-prod auto-start gating.
# Uses temp dirs, a spare port and mocked start commands. NEVER touches real prod (:3456) or tmp/.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "PASS: $*"; }
ko() { FAIL=$((FAIL+1)); echo "FAIL: $*"; }
check() { local d="$1"; shift; if "$@"; then ok "$d"; else ko "$d"; fi; }
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }

# --- fake HOME for boot-hook: mocked ensure-prod records its invocation
mkfake() {
  T="$(mktemp -d)"; mkdir -p "$T/scripts" "$T/tmp"
  cp "$REPO/scripts/lib-maintenance.sh" "$REPO/scripts/maintenance.sh" "$T/scripts/"
  cat >"$T/scripts/ensure-prod.sh" <<'M'
#!/usr/bin/env bash
echo "called caller=${CALIBRA_CALLER:-} args=$*" >>"$(dirname "$0")/../tmp/mock-start.log"
M
  chmod +x "$T/scripts/ensure-prod.sh"
  export CALIBRA_HOME="$T" CALIBRA_STATE_DIR="$T/tmp" CALIBRA_PORT="$(free_port)"
}
run_hook() { ( . "$REPO/scripts/boot-hook.sh" ) 2>"$T/hook.err"; sleep 0.5; }

echo "== 1. inactive guard: boot-hook starts (mock) and logs caller=boot-hook"
mkfake; run_hook
check "mock ensure-prod invoked" grep -q "called caller=boot-hook" "$T/tmp/mock-start.log"
check "restart-events has caller=boot-hook start-requested" grep -q "caller=boot-hook action=start-requested" "$T/tmp/restart-events.log"
check "no stderr notice when inactive" test ! -s "$T/hook.err"

echo "== 2. active guard blocks boot-hook with one stderr line"
mkfake; "$T/scripts/maintenance.sh" on --reason "db migration" --ttl 30 >/dev/null
run_hook
check "mock ensure-prod NOT invoked" test ! -f "$T/tmp/mock-start.log"
check "exactly one stderr notice line" test "$(wc -l <"$T/hook.err")" -eq 1
check "notice mentions MAINTENANCE + reason" grep -q "MAINTENANCE active.*db migration" "$T/hook.err"
check "status reports ACTIVE (rc 0)" "$T/scripts/maintenance.sh" status >/dev/null
check "guard has start/expiry/reason/user/pid" bash -c "grep -q ^start= '$T/tmp/MAINTENANCE' && grep -q ^expires_epoch= '$T/tmp/MAINTENANCE' && grep -q '^reason=db migration' '$T/tmp/MAINTENANCE' && grep -q ^user= '$T/tmp/MAINTENANCE' && grep -q ^pid= '$T/tmp/MAINTENANCE'"

echo "== 3. off clears guard; boot-hook starts again"
"$T/scripts/maintenance.sh" off >/dev/null
check "guard removed" test ! -f "$T/tmp/MAINTENANCE"
check "status inactive (rc 1)" bash -c "! '$T/scripts/maintenance.sh' status >/dev/null"
run_hook
check "mock invoked after off" grep -q "called caller=boot-hook" "$T/tmp/mock-start.log"
check "maintenance-off event logged" grep -q "action=maintenance-off" "$T/tmp/restart-events.log"

echo "== 4. expired / interrupted session auto-recovers"
mkfake; "$T/scripts/maintenance.sh" on --reason "interrupted session" --ttl 5 >/dev/null
sed -i "s/^expires_epoch=.*/expires_epoch=$(( $(date +%s) - 10 ))/" "$T/tmp/MAINTENANCE"   # simulate session killed long ago
run_hook
check "expired guard auto-removed" test ! -f "$T/tmp/MAINTENANCE"
check "expiry cleanup logged" grep -q "action=maintenance-expired-cleanup" "$T/tmp/restart-events.log"
check "boot-hook started prod after expiry" grep -q "called caller=boot-hook" "$T/tmp/mock-start.log"
mkfake; echo "garbage" >"$T/tmp/MAINTENANCE"; run_hook
check "corrupt guard treated inactive + removed" bash -c "test ! -f '$T/tmp/MAINTENANCE' && grep -q 'called' '$T/tmp/mock-start.log'"

echo "== 5. ttl validation"
mkfake
check "ttl>240 capped to 240" bash -c "'$T/scripts/maintenance.sh' on --reason x --ttl 999 2>/dev/null | grep -q 'ttl 240m'"
check "missing reason rejected" bash -c "! '$T/scripts/maintenance.sh' on --ttl 5 2>/dev/null"
check "non-numeric ttl rejected" bash -c "! '$T/scripts/maintenance.sh' on --reason x --ttl abc 2>/dev/null"
"$T/scripts/maintenance.sh" on --reason d >/dev/null
check "default ttl 60" grep -q "^ttl_min=60" "$T/tmp/MAINTENANCE"

echo "== 6. real ensure-prod.sh (mocked server cmd, spare port, temp state dir)"
S="$(mktemp -d)"; P="$(free_port)"
export CALIBRA_HOME="$REPO" CALIBRA_STATE_DIR="$S" CALIBRA_PORT="$P" CALIBRA_SUPERVISE_CMD="echo mockserver >>$S/server-starts; sleep 60"
unset CALIBRA_CALLER
"$REPO/scripts/maintenance.sh" on --reason "ensure test" --ttl 10 >/dev/null 2>&1   # writes into $S via CALIBRA_STATE_DIR
check "guard written to temp state dir" test -f "$S/MAINTENANCE"
out="$("$REPO/scripts/ensure-prod.sh" 2>&1)"; rc=$?
check "auto-start refused (rc 3)" test "$rc" -eq 3
check "blocked event logged" grep -q "caller=supervisor-manual action=start-blocked-maintenance" "$S/restart-events.log"
sleep 1; check "no server start while blocked" test ! -f "$S/server-starts"
out="$("$REPO/scripts/ensure-prod.sh" --start --override-maintenance 2>&1)"; rc=$?
sleep 1.5
check "override start rc 0" test "$rc" -eq 0
check "override logged caller=supervisor-manual" grep -q "caller=supervisor-manual action=start-override-maintenance" "$S/restart-events.log"
check "supervisor-loop server-start logged" grep -q "caller=supervisor-loop action=server-start" "$S/restart-events.log"
check "mock server actually launched" test -s "$S/server-starts"
"$REPO/scripts/ensure-prod.sh" --stop >/dev/null 2>&1
check "stop logged" grep -q "action=stop" "$S/restart-events.log"
"$REPO/scripts/maintenance.sh" off >/dev/null
CALIBRA_CALLER=boot-hook "$REPO/scripts/ensure-prod.sh" >/dev/null 2>&1; sleep 1.5
check "inactive guard: start allowed, caller=boot-hook recorded" grep -q "caller=boot-hook action=supervisor-start" "$S/restart-events.log"
"$REPO/scripts/ensure-prod.sh" --stop >/dev/null 2>&1
check "real prod state dir untouched (no MAINTENANCE in repo tmp)" test ! -f "$REPO/tmp/MAINTENANCE"
echo "--- restart-events.log sample (temp):"; cat "$S/restart-events.log"
echo "RESULT: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
