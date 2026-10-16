#!/usr/bin/env bash
# Monitor-of-the-monitor. Read-only toward prod; never restarts anything. Prints one JSON line.
# Detects (kind):
#   normal                 last check fresh, loop OK (or loop not enabled)
#   monitor_stale          last completed check (uptime-state.json last_check_at) older than HEARTBEAT_STALE_MIN
#                          (20) -> notify=heartbeat ONCE per episode
#   heartbeat_recovery     checks resumed after a notified episode -> notify=recovery ONCE
#   loop_dead              box loop enabled (MONITOR_LOOP_ENABLED) but pid dead or monitor-loop.heartbeat.json
#                          older than HEARTBEAT_LOOP_STALE_MIN (5) -> notify=heartbeat ONCE
#   loop_recovered         loop alive again after loop_dead -> notify=recovery ONCE
# Heartbeat-routine self-failure is detected by the loop: every run here records its time in
# .heartbeat-routine-last; monitor-loop.sh flags in the outbox if that is > 40 min old.
# Outbox: notifications are appended to notify-outbox.jsonl when the loop is enabled (live), always in test mode.
# Live dir: UPTIME_DIR (default /workspace/calibra-stabilization); dedupe .heartbeat-dedupe.json.
# TEST MODE: HEARTBEAT_TEST=1 HEARTBEAT_STATE_DIR=<isolated dir> -> identical detection, but state, loop files,
#   dedupe and outbox (notify-outbox-test.jsonl) all come from that dir, messages tagged [TEST].
#   Refuses to run against the live dir. Never touches live state.
# Env: HEARTBEAT_NOW_EPOCH (tests), HEARTBEAT_STALE_MIN, HEARTBEAT_LOOP_STALE_MIN.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LIVE="/workspace/calibra-stabilization"
if [ "${HEARTBEAT_TEST:-0}" = 1 ]; then
  [ -n "${HEARTBEAT_STATE_DIR:-}" ] || { echo '{"ok":false,"error":"HEARTBEAT_TEST=1 requires HEARTBEAT_STATE_DIR"}'; exit 2; }
  mkdir -p "$HEARTBEAT_STATE_DIR"
  D="$(cd "$HEARTBEAT_STATE_DIR" && pwd -P)"
  for L in "$LIVE" "${UPTIME_DIR:-$LIVE}"; do
    [ -d "$L" ] && [ "$D" = "$(cd "$L" && pwd -P)" ] && { echo '{"ok":false,"error":"test mode refuses the live uptime dir"}'; exit 2; }
  done
  export HB_DIR="$D" HB_TEST=1 HB_OUTBOX="$D/notify-outbox-test.jsonl"
else
  export HB_DIR="${UPTIME_DIR:-$LIVE}" HB_TEST=0 HB_OUTBOX="${UPTIME_DIR:-$LIVE}/notify-outbox.jsonl"
fi
mkdir -p "$HB_DIR"
exec 6>"$HB_DIR/.heartbeat.lock"; flock -w 30 6 || { echo '{"ok":false,"notify":"none","error":"lock busy"}'; exit 75; }
export REPO
exec python3 - <<'PY'
import json, os, time, uuid
from datetime import datetime, timezone
E = os.environ; U = E["HB_DIR"]; TEST = E["HB_TEST"] == "1"
S = os.path.join(U, "uptime-state.json"); D = os.path.join(U, ".heartbeat-dedupe.json")
lim = float(E.get("HEARTBEAT_STALE_MIN", "20")); llim = float(E.get("HEARTBEAT_LOOP_STALE_MIN", "5"))
nowe = float(E.get("HEARTBEAT_NOW_EPOCH", time.time()))
now = datetime.fromtimestamp(nowe, timezone.utc).astimezone()
try: st = json.load(open(S)); last = st.get("last_check_at") or st.get("lastCheck")
except Exception: st, last = {}, None
lt = datetime.fromisoformat(last.replace("Z", "+00:00")) if last else None
age = (now - lt).total_seconds()/60 if lt else None
try: dd = json.load(open(D))
except Exception: dd = {}
events = []
stale = age is None or age > lim
if stale and not dd.get("stale_notified"):
    events.append(("heartbeat", "monitor_stale", f"no completed uptime check for {'?' if age is None else round(age,1)} min (last {last})"))
    dd.update(stale_notified=True, episode_started_seen_at=now.isoformat(), last_check_at=last)
elif not stale and dd.get("stale_notified"):
    events.append(("recovery", "heartbeat_recovery", f"uptime checks resumed (last {last})"))
    prev = {k: dd.pop(k) for k in list(dd) if k in ("stale_notified", "episode_started_seen_at", "last_check_at")}
    dd.update(stale_notified=False, recovered_at=now.isoformat(), previous_episode=prev)
loop_enabled = os.path.exists(os.path.join(U, "MONITOR_LOOP_ENABLED")); loop = None
if loop_enabled:
    alive, why = True, "ok"
    try: pid = int(open(os.path.join(U, "monitor-loop.pid")).read().strip()); os.kill(pid, 0)
    except Exception: alive, why = False, "pid not running"
    try:
        hb = json.load(open(os.path.join(U, "monitor-loop.heartbeat.json"))); hage = (nowe - float(hb["updated_epoch"]))/60
        if hage > llim: alive, why = False, f"loop heartbeat {hage:.1f} min old"
    except Exception: alive, why = False, "no loop heartbeat file"
    loop = {"alive": alive, "detail": why}
    if not alive and not dd.get("loop_dead_notified"):
        events.append(("heartbeat", "loop_dead", f"box monitor loop not running ({why})")); dd["loop_dead_notified"] = True
    elif alive and dd.get("loop_dead_notified"):
        events.append(("recovery", "loop_recovered", "box monitor loop running again")); dd["loop_dead_notified"] = False
tmp = D + f".tmp.{os.getpid()}"; json.dump(dd, open(tmp, "w"), indent=2); os.replace(tmp, D)
open(os.path.join(U, ".heartbeat-routine-last"), "w").write(f"{int(nowe)}\n")
tag = "[TEST] " if TEST else ""
outboxed = []
if events and (TEST or loop_enabled):
    with open(E["HB_OUTBOX"], "a") as f:
        for n, k, msg in events:
            i = f"{now.isoformat(timespec='seconds').replace(':','')}-{k}-{uuid.uuid4().hex[:6]}"
            f.write(json.dumps({"id": i, "type": n, "kind": k, "created": now.isoformat(timespec="seconds"), "delivered": False,
                                "source": "monitor-heartbeat", "test": TEST, "message": f"{tag}Calibra heartbeat: {msg}"}) + "\n")
            outboxed.append(i)
notify, kind = (events[0][0], events[0][1]) if events else ("none", "normal")
print(json.dumps({"ok": True, "test": TEST, "notify": notify, "kind": kind, "events": [{"notify": n, "kind": k, "message": tag + m} for n, k, m in events],
                  "now": now.isoformat(), "last_check_at": last, "age_min": round(age, 1) if age is not None else None,
                  "stale_threshold_min": lim, "status": st.get("status"), "loop_enabled": loop_enabled, "loop": loop,
                  "outbox_ids": outboxed}, separators=(",", ":")))
PY
