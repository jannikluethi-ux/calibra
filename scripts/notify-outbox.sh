#!/usr/bin/env bash
# Box-side notification outbox. The box cannot message chat; producers (uptime-check.sh, monitor-loop.sh,
# monitor-heartbeat.sh) append entries here and the server-side routines deliver them.
#   scripts/notify-outbox.sh list-pending [--json]      undelivered entries (oldest first)
#   scripts/notify-outbox.sh mark-delivered ID MSGREF   record delivery confirmation (MSGREF = chat message ref)
#   scripts/notify-outbox.sh add TYPE MESSAGE [KIND]    append an entry (used by box scripts)
#   scripts/notify-outbox.sh list-all [--json]
# File: $NOTIFY_OUTBOX (default $UPTIME_DIR/notify-outbox.jsonl). Append-only: deliveries are appended to
# <outbox>.delivered.jsonl; entries are never rewritten. Routine contract: run list-pending, deliver each
# message, then mark-delivered with the message ref. An entry stays pending until marked.
set -uo pipefail
UPTIME_DIR="${UPTIME_DIR:-/workspace/calibra-stabilization}"
export OB="${NOTIFY_OUTBOX:-$UPTIME_DIR/notify-outbox.jsonl}"
mkdir -p "$(dirname "$OB")"
exec 5>"$OB.lock"; flock -w 30 5 || { echo "outbox lock busy" >&2; exit 75; }
exec python3 - "$@" <<'PY'
import json, os, sys, uuid
from datetime import datetime
OB = os.environ["OB"]; DL = OB[:-6] + ".delivered.jsonl" if OB.endswith(".jsonl") else OB + ".delivered"
a = sys.argv[1:]
def rd(p):
    out = []
    try:
        for l in open(p):
            l = l.strip()
            if l:
                try: out.append(json.loads(l))
                except Exception: pass
    except FileNotFoundError: pass
    return out
now = datetime.now().astimezone().isoformat(timespec="seconds")
cmd = a[0] if a else "list-pending"
ent = rd(OB); dl = {d["id"]: d for d in rd(DL) if "id" in d}
for e in ent:
    if e.get("id") in dl: e["delivered"] = True; e["delivered_at"] = dl[e["id"]].get("at"); e["msgref"] = dl[e["id"]].get("msgref")
if cmd in ("list-pending", "list-all"):
    sel = [e for e in ent if cmd == "list-all" or not e.get("delivered")]
    if "--json" in a: print(json.dumps(sel))
    else:
        for e in sel: print(f'{e["id"]}\t{e.get("type")}\t{e.get("created")}\tdelivered={e.get("delivered")}\t{e.get("message","")}')
        print(f"# {len(sel)} {'pending' if cmd=='list-pending' else 'total'}", file=sys.stderr)
elif cmd == "mark-delivered":
    if len(a) < 3: sys.exit("usage: mark-delivered ID MSGREF")
    ids = {e.get("id") for e in ent}
    if a[1] not in ids: sys.exit(f"unknown id {a[1]}")
    if a[1] in dl: print(f"already delivered {a[1]} ({dl[a[1]].get('msgref')})"); sys.exit(0)
    with open(DL, "a") as f: f.write(json.dumps({"id": a[1], "delivered": True, "msgref": a[2], "at": now}) + "\n")
    print(f"marked {a[1]} delivered msgref={a[2]}")
elif cmd == "add":
    if len(a) < 3: sys.exit("usage: add TYPE MESSAGE [KIND]")
    e = {"id": f"{now.replace(':','')}-{a[1]}-{uuid.uuid4().hex[:6]}", "type": a[1], "kind": a[3] if len(a) > 3 else a[1],
         "created": now, "delivered": False, "source": os.environ.get("OUTBOX_SOURCE", "manual"), "message": a[2]}
    with open(OB, "a") as f: f.write(json.dumps(e) + "\n")
    print(e["id"])
else: sys.exit(f"unknown command {cmd}")
PY
