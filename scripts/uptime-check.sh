#!/usr/bin/env bash
# Deterministic Calibra uptime check. READ-ONLY toward prod: never starts/stops/restarts anything.
#   scripts/uptime-check.sh            -> probe, append exactly ONE 9-column RFC4180 row to uptime-log.csv,
#                                         atomically update uptime-state.json, append transitions to
#                                         uptime-transitions.jsonl, print ONE JSON line on stdout.
# JSON line fields: ok, status (UP|DOWN|RECOVERED), notify, transition, timestamp, row fields, outage
#   (duration report on recovery), plus the B2.3 state model (docs/OPERATIONS.md "Monitoring states"):
#   app_state        UP | APP_DOWN | RECOVERED   (HTTP/crashloop evidence only; the ONLY source of DOWN)
#   scheduler_state  FRESH | STALE | IDLE_DISABLED | IDLE_NOT_STARTED | UNKNOWN | UNVERIFIED_RESUME | NO_DATA
#   observation      FIRST | ON_TIME | DELAYED | HOST_PAUSED | REBOOTED | GAP
# notify: none | down | recovery (only after a real APP_DOWN) | heartbeat (unexplained monitoring gap) |
#   scheduler_stale / scheduler_resumed (warning pair; only when the status endpoint reports enabled AND
#   started). A stale or missing lastTick is NEVER DOWN. Suppressed states never produce RECOVERED; a legacy
#   DOWN that was caused only by lastTick staleness is cleared silently (transition CLEARED, notify none).
# Pause detection: each check records wall epoch, monotonic seconds (/proc/uptime, which does not advance
#   while the VM is paused) and the kernel boot_id. paused_s = wall gap - monotonic gap (same boot).
#   The monitoring-gap judgement uses the monotonic gap, so a whole-box pause is not a gap; on the first
#   check after a detected pause/reboot a stale tick is UNVERIFIED_RESUME (re-judged next run).
# Missing responses: http=000, dataQuality=unavailable, lastTick='' tick_age_min=''.
# Env: UPTIME_DIR (default /workspace/calibra-stabilization), CALIBRA_BASE_URL (http://127.0.0.1:3456),
#   CALIBRA_STATE_DIR (repo tmp; CRASHLOOP + restart-events.log + prod.log, read-only), UPTIME_CURL_MAX (10s),
#   UPTIME_LOCK_WAIT (60s), UPTIME_TICK_STALE_MIN (30), UPTIME_STALE_MIN (20), UPTIME_PAUSE_TOL_S (10),
#   UPTIME_DELAY_TOL_S (60 = loop wake granularity MONITOR_TICK_S), UPTIME_SLOT_EPOCH (set by monitor-loop).
#   Test clocks: UPTIME_NOW_EPOCH, UPTIME_MONO_S, UPTIME_BOOT_ID (never set in production).
#   Threshold justifications: docs/OPERATIONS.md "Monitoring states".
# Box scheduler integration (scripts/monitor-loop.sh), active only when $UPTIME_DIR/MONITOR_LOOP_ENABLED
# exists (or forced via env), so committing this changes nothing until the loop is enabled:
#   * recent-check guard: if the last completed check is < UPTIME_MIN_INTERVAL_S (300 when enabled, else 0)
#     old, exit 0 with status SKIPPED-RECENT, writing NO row/state/transition (routine = backup caller).
#   * notify outbox: every event is appended to notify-outbox.jsonl under the same lock file as
#     scripts/notify-outbox.sh (UPTIME_OUTBOX=1|0 forces). The voided sidecar is never touched.
#   UPTIME_CALLER (loop|routine|manual) is recorded in state as last_check_caller.
# WARNING: builds before 6f9d484 (B2.2) have a side-effecting GET /api/scheduler/status; do not run this
# script against such a build.
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
  RECENT="$(python3 - "$UPTIME_DIR/uptime-state.json" "$MININT" "${UPTIME_NOW_EPOCH:-}" <<'PY'
import json,sys,time
from datetime import datetime
try:
    s=json.load(open(sys.argv[1])); t=s.get("last_check_at") or s.get("lastCheck")
    now=float(sys.argv[3]) if len(sys.argv)>3 and sys.argv[3] else time.time()
    age=now-datetime.fromisoformat(t.replace("Z","+00:00")).timestamp()
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
if [ -n "${UPTIME_NOW_EPOCH:-}" ]; then TS="$(date -d "@${UPTIME_NOW_EPOCH%.*}" -Is)"; else TS="$(date -Is)"; fi
MONO="${UPTIME_MONO_S:-$(cut -d' ' -f1 /proc/uptime 2>/dev/null)}"
BOOT="${UPTIME_BOOT_ID:-$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)}"
ROOT_HTTP="$(curl -s -o /dev/null --connect-timeout 5 --max-time "$MAXT" -w '%{http_code}' "$BASE/" 2>/dev/null)"; ROOT_RC=$?
SCHED_HTTP="$(curl -s -o "$TMPD/sched.body" --connect-timeout 5 --max-time "$MAXT" -w '%{http_code}' "$BASE/api/scheduler/status" 2>/dev/null)"; SCHED_RC=$?
CRASH=no; [ -f "$SD/CRASHLOOP" ] && CRASH=yes
export TS MONO BOOT ROOT_HTTP ROOT_RC SCHED_HTTP SCHED_RC CRASH UPTIME_DIR SD REPO
export BODY_FILE="$TMPD/sched.body"
exec python3 - <<'PY'
import csv, io, json, os, sys, importlib.util, fcntl, uuid
from datetime import datetime
E = os.environ
spec = importlib.util.spec_from_file_location("od", os.path.join(E["REPO"], "scripts", "outage-duration.py"))
od = importlib.util.module_from_spec(spec); spec.loader.exec_module(od)
HEADER = ["timestamp","status","root_http","scheduler_http","dataQuality","lastTick","tick_age_min","crashloop","detail"]
U = E["UPTIME_DIR"]; LOG = os.path.join(U, "uptime-log.csv"); STATE = os.path.join(U, "uptime-state.json")
TR = os.path.join(U, "uptime-transitions.jsonl")
ts = E["TS"]; now = datetime.fromisoformat(ts)
def fnum(v):
    try: return float(v)
    except (TypeError, ValueError): return None
now_e = fnum(E.get("UPTIME_NOW_EPOCH")) or now.timestamp()
mono = fnum(E.get("MONO")); boot = (E.get("BOOT") or "").strip() or None
TICK_STALE = float(E.get("UPTIME_TICK_STALE_MIN", "30")); GAP_MIN = float(E.get("UPTIME_STALE_MIN", "20"))
PAUSE_TOL = float(E.get("UPTIME_PAUSE_TOL_S", "10")); DELAY_TOL = float(E.get("UPTIME_DELAY_TOL_S", "60"))
def code(v, rc):
    v = (v or "").strip()
    return v if len(v) == 3 and v.isdigit() else "000"
root, sched = code(E["ROOT_HTTP"], E["ROOT_RC"]), code(E["SCHED_HTTP"], E["SCHED_RC"])
body = ""
try: body = open(E["BODY_FILE"], encoding="utf-8", errors="replace").read()
except FileNotFoundError: pass
dq, last_tick, age = "unavailable", "", ""
app_problems = []; j = None
if sched == "200":
    try:
        j = json.loads(body)
        if not isinstance(j, dict): raise ValueError("not an object")
        dq = str(j.get("dataQuality") or "unavailable")
        lt = j.get("lastTick")
        if isinstance(lt, dict): lt = lt.get("at") or lt.get("finishedAt") or lt.get("startedAt")
        if lt:
            last_tick = str(lt)
            t = od.P(last_tick)
            if t: age = f"{max(0.0, (now - t).total_seconds()/60):.1f}"
            else: last_tick = ""
    except Exception as e:
        j = None
        app_problems.append(f"scheduler/status body not JSON ({type(e).__name__})")
if root != "200": app_problems.append(f"root http {root}" + (f" (curl rc {E['ROOT_RC']})" if root == "000" else ""))
if sched != "200":
    snip = body.strip()[:200]
    app_problems.append(f"scheduler/status http {sched}" + (f" (curl rc {E['SCHED_RC']})" if sched == "000" else "") + (f" body: {snip}" if snip else ""))
if E["CRASH"] == "yes": app_problems.append("CRASHLOOP marker present")
app_failed = bool(app_problems)

try: state = json.load(open(STATE))
except Exception: state = {}
prev = (state.get("status") or "UP").upper()
prev_healthy = prev in ("UP", "RECOVERED")
prev_check = od.P(state.get("last_check_at") or state.get("lastCheck"))
wall_gap_s = (now - prev_check).total_seconds() if prev_check else None
prev_mono = fnum(state.get("last_check_mono_s")); prev_boot = state.get("last_check_boot_id")

# ---- observation: was the previous->current interval observed normally? (never a failure by itself)
paused_s = None; mono_gap_s = wall_gap_s
if prev_check is None:
    observation = "FIRST"
elif boot and prev_boot and boot != prev_boot:
    observation = "REBOOTED"   # monotonic clock restarted; only time since boot is observable
    if mono is not None and wall_gap_s is not None: mono_gap_s = min(wall_gap_s, mono)
elif boot and prev_boot == boot and mono is not None and prev_mono is not None and wall_gap_s is not None:
    mono_gap_s = max(0.0, mono - prev_mono); paused_s = max(0.0, wall_gap_s - mono_gap_s)
    observation = "HOST_PAUSED" if paused_s >= PAUSE_TOL else "ON_TIME"
else:
    observation = "ON_TIME"    # legacy state without monotonic fields: wall gap only (old behaviour)
if mono_gap_s is not None and mono_gap_s / 60 > GAP_MIN:
    observation = "GAP"        # box was running but no check completed for > UPTIME_STALE_MIN
slot = fnum(E.get("UPTIME_SLOT_EPOCH")); delay_s = round(now_e - slot, 1) if slot is not None else None
if delay_s is not None and delay_s > DELAY_TOL and observation in ("ON_TIME", "FIRST"):
    observation = "DELAYED"    # loop started the check later than its own wake granularity, not explained by a pause

# ---- scheduler freshness (warning level only; never DOWN)
sched_enabled = j.get("enabled") if j else None; sched_started = j.get("started") if j else None
stale_reason = None
if j is None: sstate = "NO_DATA"
elif sched_enabled is False: sstate = "IDLE_DISABLED"
elif sched_started is False: sstate = "IDLE_NOT_STARTED"
elif sched_enabled is not True or sched_started is not True: sstate = "UNKNOWN"   # pre-B2.2 build: fields absent
else:
    if not last_tick: stale_reason = "lastTick missing"
    elif age and float(age) > TICK_STALE: stale_reason = f"lastTick {age} min old (> {TICK_STALE:g})"
    resumed = observation == "REBOOTED" or (paused_s is not None and paused_s >= PAUSE_TOL)
    if stale_reason and resumed: sstate = "UNVERIFIED_RESUME"
    else: sstate = "STALE" if stale_reason else "FRESH"
events = []   # (notify, kind, message)
sched_note = None
if sstate == "STALE" and not state.get("scheduler_stale_notified"):
    events.append(("scheduler_stale", "SCHEDULER_STALE", f"Calibra scheduler stale (warning; app UP): enabled and started but {stale_reason}"))
    state["scheduler_stale_notified"] = True; state["scheduler_stale_since"] = ts
elif sstate == "FRESH" and state.get("scheduler_stale_notified"):
    events.append(("scheduler_resumed", "SCHEDULER_RESUMED", f"Calibra scheduler ticking again (lastTick {age} min old; stale since {state.get('scheduler_stale_since')})"))
    state["scheduler_stale_notified"] = False
elif sstate in ("IDLE_DISABLED", "IDLE_NOT_STARTED") and state.get("scheduler_stale_notified"):
    state["scheduler_stale_notified"] = False; state["scheduler_stale_cleared_at"] = ts   # disabled by design: silent
if sstate != "FRESH" and sstate != "NO_DATA":
    why = {"IDLE_DISABLED": "disabled by configuration, not a failure", "IDLE_NOT_STARTED": "loop not started in this process, not a failure",
           "UNKNOWN": "status lacks enabled/started (pre-B2.2 build), tick age not judged",
           "UNVERIFIED_RESUME": f"{stale_reason}, re-checked next run after host resume",
           "STALE": stale_reason}[sstate]
    sched_note = f"scheduler {sstate} ({why}" + (f"; lastTick {age} min old" if age and sstate not in ("STALE", "UNVERIFIED_RESUME") else "") + ")"

# ---- application state (the only source of DOWN / RECOVERED)
transition, outage, app_state = None, None, None
notes = []
if paused_s is not None and paused_s >= PAUSE_TOL: notes.append(f"host paused ~{paused_s:.0f} s since previous check")
if observation == "REBOOTED": notes.append("box rebooted since previous check")
if observation == "DELAYED": notes.append(f"check started {delay_s:.0f} s after its slot")
if not app_failed:
    if not prev_healthy:
        dc = state.get("down_class")
        legacy_tick_only = dc is None and all(p.startswith("lastTick stale") or p == "lastTick missing"
                                               for p in (state.get("lastDetail") or "").split("; ") if p)
        if dc == "app" or (dc is None and not legacy_tick_only):
            status, app_state, transition = "RECOVERED", "RECOVERED", "RECOVERED"
            events.insert(0, ("recovery", "RECOVERED", None))
            state["service_restored_at"] = ts
            ev = od.load_events(os.path.join(E["SD"], "restart-events.log"), os.path.join(E["SD"], "prod.log"))
            outage = od.compute(state.get("last_healthy_before_outage_at"), state.get("first_failed_at"),
                                state.get("last_failed_at"), ts, ev)
            state["process_start_at"] = outage.get("process_start_at")
            state["recovery_transition_at"] = ts
            state["last_outage"] = outage
        else:   # legacy DOWN caused only by scheduler staleness: clear silently, never RECOVERED
            status, app_state, transition = "UP", "UP", "CLEARED"
            state["cleared_suppressed_down_at"] = ts
        state["since"] = ts
    else:
        status, app_state = "UP", "UP"
        if observation == "GAP":
            events.insert(0, ("heartbeat", "heartbeat", None))
    if prev_check is None: state["since"] = ts
    state["last_healthy_at"] = ts
    state["consecutive_failures"] = 0
    state.pop("down_class", None)
    detail = "ok" if status == "UP" else f"RECOVERED (DOWN since {state.get('first_failed_at')})"
    if observation == "GAP": detail += f"; previous check {mono_gap_s/60:.1f} min ago (monitor gap)"
else:
    status, app_state = "DOWN", "APP_DOWN"
    if prev_healthy:
        transition = "DOWN"; events.insert(0, ("down", "DOWN", None))
        state["last_healthy_before_outage_at"] = state.get("last_healthy_at")
        state["first_failed_at"] = ts; state["down_transition_at"] = ts
        for k in ("service_restored_at", "recovery_transition_at", "process_start_at"): state[k] = None
        state["since"] = ts
    state["down_class"] = "app"
    state["last_failed_at"] = ts
    state["consecutive_failures"] = int(state.get("consecutive_failures") or 0) + 1
    detail = "; ".join(app_problems)
detail = "; ".join([detail] + ([sched_note] if sched_note else []) + notes)
events = [(n, k, m or f"Calibra {status}: {detail}") for n, k, m in events]
notify = events[0][0] if events else "none"

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
if paused_s is not None and paused_s >= PAUSE_TOL:
    state["last_paused_s"] = round(paused_s, 1); state["last_pause_detected_at"] = ts
state.update(status=status if status != "RECOVERED" else "UP", lastCheck=ts, last_check_at=ts,
             last_status_row=status, lastDetail=detail, schema=3, last_check_caller=E.get("UPTIME_CALLER","unknown"),
             last_check_epoch=round(now_e, 3), last_check_mono_s=mono, last_check_boot_id=boot,
             app_state=app_state, scheduler_state=sstate, observation=observation)
tmp = STATE + f".tmp.{os.getpid()}"
with open(tmp, "w") as f: json.dump(state, f, indent=2); f.write("\n"); f.flush(); os.fsync(f.fileno())
os.replace(tmp, STATE)
trs = ([transition] if transition else []) + [k for n, k, m in events if k.startswith("SCHEDULER_")]
if trs:
    with open(TR, "a") as f:
        for t in trs:
            f.write(json.dumps({"at": ts, "transition": t, "detail": detail,
                                "outage": outage if t == "RECOVERED" else None,
                                "last_healthy_at": state.get("last_healthy_before_outage_at"),
                                "first_failed_at": state.get("first_failed_at")}) + "\n")
outbox_ids = []
if events and E.get("UPTIME_OUTBOX") == "1":
    ob = os.path.join(U, "notify-outbox.jsonl")
    with open(ob + ".lock", "a") as lk:   # same lock file as scripts/notify-outbox.sh
        fcntl.flock(lk, fcntl.LOCK_EX)
        with open(ob, "a") as f:
            for n, k, m in events:
                i = f"{ts.replace(':','')}-{n}-{uuid.uuid4().hex[:6]}"
                f.write(json.dumps({"id": i, "type": n, "kind": k, "created": ts, "delivered": False,
                                    "source": "uptime-check", "caller": E.get("UPTIME_CALLER", "unknown"),
                                    "message": m}) + "\n")
                outbox_ids.append(i)
            f.flush(); os.fsync(f.fileno())
out = {"ok": True, "status": status, "notify": notify, "transition": transition, "timestamp": ts,
       "root_http": root, "scheduler_http": sched, "dataQuality": dq, "lastTick": last_tick,
       "tick_age_min": age, "crashloop": E["CRASH"], "detail": detail,
       "gap_since_prev_check_min": round(wall_gap_s/60, 1) if wall_gap_s is not None else None,
       "app_state": app_state, "scheduler_state": sstate, "observation": observation,
       "scheduler": {"enabled": sched_enabled, "started": sched_started},
       "paused_s": round(paused_s, 1) if paused_s is not None else None,
       "mono_gap_min": round(mono_gap_s/60, 1) if mono_gap_s is not None else None,
       "delay_s": delay_s, "events": [{"notify": n, "kind": k} for n, k, m in events], "outbox_ids": outbox_ids}
if outage: out["outage"] = outage
print(json.dumps(out, separators=(",", ":")))
PY
