#!/usr/bin/env bash
# Monitor-of-the-monitor. Read-only toward prod; never restarts anything.
# Reads last completed check time from $UPTIME_DIR/uptime-state.json (last_check_at|lastCheck).
# If older than HEARTBEAT_STALE_MIN (default 20): notify=heartbeat ONCE per stale episode;
# when checks resume after a notified episode: notify=recovery (kind=heartbeat_recovery) ONCE.
# Dedupe file: $UPTIME_DIR/.heartbeat-dedupe.json. Prints one JSON line.
set -uo pipefail
UPTIME_DIR="${UPTIME_DIR:-/workspace/calibra-stabilization}"
exec 6>"$UPTIME_DIR/.heartbeat.lock"; flock -w 30 6 || { echo '{"ok":false,"notify":"none","error":"lock busy"}'; exit 75; }
export UPTIME_DIR
exec python3 - <<'PY'
import json, os, time
from datetime import datetime, timezone
U = os.environ["UPTIME_DIR"]; S = os.path.join(U, "uptime-state.json"); D = os.path.join(U, ".heartbeat-dedupe.json")
lim = float(os.environ.get("HEARTBEAT_STALE_MIN", "20"))
now = datetime.fromtimestamp(float(os.environ.get("HEARTBEAT_NOW_EPOCH", time.time())), timezone.utc).astimezone()
try: st = json.load(open(S)); last = st.get("last_check_at") or st.get("lastCheck")
except Exception: st, last = {}, None
lt = datetime.fromisoformat(last.replace("Z", "+00:00")) if last else None
age = (now - lt).total_seconds()/60 if lt else None
try: dd = json.load(open(D))
except Exception: dd = {}
stale = age is None or age > lim
notify, kind = "none", None
if stale:
    if not dd.get("stale_notified"):
        notify, kind = "heartbeat", "monitor_stale"
        dd = {"stale_notified": True, "episode_started_seen_at": now.isoformat(), "last_check_at": last}
else:
    if dd.get("stale_notified"):
        notify, kind = "recovery", "heartbeat_recovery"
        dd = {"stale_notified": False, "recovered_at": now.isoformat(), "previous_episode": dd}
tmp = D + f".tmp.{os.getpid()}"
json.dump(dd, open(tmp, "w"), indent=2); os.replace(tmp, D)
print(json.dumps({"ok": True, "notify": notify, "kind": kind, "now": now.isoformat(), "last_check_at": last,
                  "age_min": round(age, 1) if age is not None else None, "stale_threshold_min": lim,
                  "status": st.get("status")}, separators=(",", ":")))
PY
