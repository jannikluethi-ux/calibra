#!/usr/bin/env bash
# Deterministic Calibra uptime check. READ-ONLY toward prod: never starts/stops/restarts anything.
#   scripts/uptime-check.sh            -> probe, append exactly ONE 9-column RFC4180 row to uptime-log.csv,
#                                         atomically update uptime-state.json, append transitions to
#                                         uptime-transitions.jsonl, print ONE JSON line on stdout.
# JSON line fields: ok, status (UP|DOWN|RECOVERED), notify (none|down|recovery|heartbeat), transition,
#   timestamp, row fields, outage (duration report on recovery).
# notify=heartbeat: check is healthy but the previous completed check is older than UPTIME_STALE_MIN
# (default 20) -> monitoring had a gap. Missing responses: http=000, dataQuality=unavailable,
# lastTick='' tick_age_min=''.
# Env: UPTIME_DIR (default /workspace/calibra-stabilization), CALIBRA_BASE_URL (http://127.0.0.1:3456),
#   CALIBRA_STATE_DIR (repo tmp; CRASHLOOP + restart-events.log + prod.log, read-only), UPTIME_CURL_MAX (10s),
#   UPTIME_LOCK_WAIT (60s), UPTIME_TICK_STALE_MIN (30), UPTIME_STALE_MIN (20).
# Box scheduler integration (scripts/monitor-loop.sh), active only when $UPTIME_DIR/MONITOR_LOOP_ENABLED
# exists (or forced via env), so committing this changes nothing until the loop is enabled:
#   * recent-check guard: if the last completed check is < UPTIME_MIN_INTERVAL_S (300 when enabled, else 0)
#     old, exit 0 with status SKIPPED-RECENT, writing NO row/state/transition (routine = backup caller).
#   * notify outbox: every notify!=none is appended to notify-outbox.jsonl (UPTIME_OUTBOX=1|0 forces).
#   UPTIME_CALLER (loop|routine|manual) is recorded in state as last_check_caller.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
UPTIME_DIR="${UPTIME_DIR:-/workspace/calibra-stabilization}"
BASE="${CALIBRA_BASE_URL:-http://127.0.0.1:3456}"
SD="${CALIBRA_STATE_DIR:-$REPO/tmp}"
MAXT="${UPTIME_CURL_MAX:-10}"
mkdir -p "$UPTIME_DIR"
exec 7>"$UPTIME_DIR/.uptime-check.lock"
if ! flock -w "${UPTIME_LOCK_WAIT:-60}" 7; then
  printf '{"ok":false,"status":"SKIPPED","notify":"none","error":"another uptime-check held the lock > %ss; no row written"}\n' "${UPTIME_LOCK_WAIT:-60}"
  exit 75
fi
ENABLED=0; [ -f "$UPTIME_DIR/MONITOR_LOOP_ENABLED" ] && ENABLED=1
MININT="${UPTIME_MIN_INTERVAL_S:-$([ $ENABLED = 1 ] && echo 300 || echo 0)}"
if [ "$MININT" -gt 0 ] 2>/dev/null; then
  RECENT="$(python3 - "$UPTIME_DIR/uptime-state.json" "$MININT" <<'PY'
import json,sys,time
from datetime import datetime
try:
    s=json.load(open(sys.argv[1])); t=s.get("last_check_at") or s.get("lastCheck")
    age=time.time()-datetime.fromisoformat(t.replace("Z","+00:00")).timestamp()
    print(f"{age:.0f}|{t}|{s.get('last_check_caller','')}" if 0<=age<float(sys.argv[2]) else "")
except Exception: print("")
PY
)"
  if [ -n "$RECENT" ]; then
    IFS='|' read -r AGE LAST LC <<<"$RECENT"
    printf '{"ok":true,"status":"SKIPPED-RECENT","notify":"none","last_check_at":"%s","age_s":%s,"last_check_caller":"%s","min_interval_s":%s,"detail":"check completed %ss ago; no row written"}\n' "$LAST" "$AGE" "$LC" "$MININT" "$AGE"
    exit 0
  fi
fi
export UPTIME_OUTBOX="${UPTIME_OUTBOX:-$ENABLED}" UPTIME_CALLER="${UPTIME_CALLER:-unknown}"
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
TS="$(date -Is)"
ROOT_HTTP="$(curl -s -o /dev/null --connect-timeout 5 --max-time "$MAXT" -w '%{http_code}' "$BASE/" 2>/dev/null)"; ROOT_RC=$?
SCHED_HTTP="$(curl -s -o "$TMPD/sched.body" --connect-timeout 5 --max-time "$MAXT" -w '%{http_code}' "$BASE/api/scheduler/status" 2>/dev/null)"; SCHED_RC=$?
CRASH=no; [ -f "$SD/CRASHLOOP" ] && CRASH=yes
export TS ROOT_HTTP ROOT_RC SCHED_HTTP SCHED_RC CRASH UPTIME_DIR SD REPO
export BODY_FILE="$TMPD/sched.body"
exec python3 - <<'PY'
import csv, io, json, os, sys, importlib.util
from datetime import datetime, timezone
E = os.environ
spec = importlib.util.spec_from_file_location("od", os.path.join(E["REPO"], "scripts", "outage-duration.py"))
od = importlib.util.module_from_spec(spec); spec.loader.exec_module(od)
HEADER = ["timestamp","status","root_http","scheduler_http","dataQuality","lastTick","tick_age_min","crashloop","detail"]
U = E["UPTIME_DIR"]; LOG = os.path.join(U, "uptime-log.csv"); STATE = os.path.join(U, "uptime-state.json")
TR = os.path.join(U, "uptime-transitions.jsonl")
ts = E["TS"]; now = datetime.fromisoformat(ts)
def code(v, rc):
    v = (v or "").strip()
    return v if len(v) == 3 and v.isdigit() else "000"
root, sched = code(E["ROOT_HTTP"], E["ROOT_RC"]), code(E["SCHED_HTTP"], E["SCHED_RC"])
body = ""
try: body = open(E["BODY_FILE"], encoding="utf-8", errors="replace").read()
except FileNotFoundError: pass
dq, last_tick, age = "unavailable", "", ""
problems = []
if sched == "200":
    try:
        j = json.loads(body)
        dq = str(j.get("dataQuality") or "unavailable")
        lt = j.get("lastTick")
        if isinstance(lt, dict): lt = lt.get("at") or lt.get("finishedAt") or lt.get("startedAt")
        if lt:
            last_tick = str(lt)
            t = od.P(last_tick)
            if t: age = f"{max(0.0, (now - t).total_seconds()/60):.1f}"
    except Exception as e:
        problems.append(f"scheduler/status body not JSON ({type(e).__name__})")
if root != "200": problems.append(f"root http {root}" + (f" (curl rc {E['ROOT_RC']})" if root == "000" else ""))
if sched != "200":
    snip = body.strip()[:200]
    problems.append(f"scheduler/status http {sched}" + (f" (curl rc {E['SCHED_RC']})" if sched == "000" else "") + (f" body: {snip}" if snip else ""))
elif not last_tick: problems.append("lastTick missing")
elif age and float(age) > float(E.get("UPTIME_TICK_STALE_MIN", "30")): problems.append(f"lastTick stale ({age} min)")
if E["CRASH"] == "yes": problems.append("CRASHLOOP marker present")
healthy = not problems

try: state = json.load(open(STATE))
except Exception: state = {}
prev = (state.get("status") or "UP").upper()
prev_healthy = prev in ("UP", "RECOVERED")
prev_check = od.P(state.get("last_check_at") or state.get("lastCheck"))
gap_min = (now - prev_check).total_seconds()/60 if prev_check else None
notify, transition, outage = "none", None, None
if healthy:
    status = "RECOVERED" if not prev_healthy else "UP"
    if status == "RECOVERED":
        transition, notify = "RECOVERED", "recovery"
        state["service_restored_at"] = ts
        ev = od.load_events(os.path.join(E["SD"], "restart-events.log"), os.path.join(E["SD"], "prod.log"))
        outage = od.compute(state.get("last_healthy_before_outage_at"), state.get("first_failed_at"),
                            state.get("last_failed_at"), ts, ev)
        state["process_start_at"] = outage.get("process_start_at")
        state["recovery_transition_at"] = ts
        state["last_outage"] = outage
        state["since"] = ts
    elif gap_min is not None and gap_min > float(E.get("UPTIME_STALE_MIN", "20")):
        notify = "heartbeat"
    if prev_check is None: state["since"] = ts
    state["last_healthy_at"] = ts
    state["consecutive_failures"] = 0
    detail = "ok" if status == "UP" else f"RECOVERED (DOWN since {state.get('first_failed_at')})"
    if notify == "heartbeat": detail += f"; previous check {gap_min:.1f} min ago (monitor gap)"
else:
    status = "DOWN"
    if prev_healthy:
        transition, notify = "DOWN", "down"
        state["last_healthy_before_outage_at"] = state.get("last_healthy_at")
        state["first_failed_at"] = ts; state["down_transition_at"] = ts
        for k in ("service_restored_at", "recovery_transition_at", "process_start_at"): state[k] = None
        state["since"] = ts
    state["last_failed_at"] = ts
    state["consecutive_failures"] = int(state.get("consecutive_failures") or 0) + 1
    detail = "; ".join(problems)
row = [ts, status, root, sched, dq, last_tick, age, E["CRASH"], detail]
buf = io.StringIO(); csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n").writerow(row)
line = buf.getvalue()
new = not os.path.exists(LOG) or os.path.getsize(LOG) == 0
with open(LOG, "a", newline="", encoding="utf-8") as f:
    if new:
        f.write(",".join(HEADER) + "\n")
    else:
        with open(LOG, "rb") as rf:
            rf.seek(-1, 2)
            if rf.read(1) not in (b"\n",): f.write("\n")  # never glue onto a partial last line
    f.write(line); f.flush(); os.fsync(f.fileno())
state.update(status=status if status != "RECOVERED" else "UP", lastCheck=ts, last_check_at=ts,
             last_status_row=status, lastDetail=detail, schema=2, last_check_caller=E.get("UPTIME_CALLER","unknown"))
tmp = STATE + f".tmp.{os.getpid()}"
with open(tmp, "w") as f: json.dump(state, f, indent=2); f.write("\n"); f.flush(); os.fsync(f.fileno())
os.replace(tmp, STATE)
if transition:
    with open(TR, "a") as f:
        f.write(json.dumps({"at": ts, "transition": transition, "detail": detail, "outage": outage,
                            "last_healthy_at": state.get("last_healthy_before_outage_at"),
                            "first_failed_at": state.get("first_failed_at")}) + "\n")
if notify != "none" and E.get("UPTIME_OUTBOX") == "1":
    import uuid
    with open(os.path.join(U, "notify-outbox.jsonl"), "a") as f:
        f.write(json.dumps({"id": f"{ts.replace(':','')}-{notify}-{uuid.uuid4().hex[:6]}", "type": notify,
                            "kind": transition or notify, "created": ts, "delivered": False, "source": "uptime-check",
                            "caller": E.get("UPTIME_CALLER", "unknown"),
                            "message": f"Calibra {status}: {detail}"}) + "\n")
out = {"ok": True, "status": status, "notify": notify, "transition": transition, "timestamp": ts,
       "root_http": root, "scheduler_http": sched, "dataQuality": dq, "lastTick": last_tick,
       "tick_age_min": age, "crashloop": E["CRASH"], "detail": detail,
       "gap_since_prev_check_min": round(gap_min, 1) if gap_min is not None else None}
if outage: out["outage"] = outage
print(json.dumps(out, separators=(",", ":")))
PY
