#!/usr/bin/env bash
# Box-side notification outbox. The box cannot message chat; producers (uptime-check.sh, monitor-loop.sh,
# monitor-heartbeat.sh) append entries here and the server-side routines deliver them.
#   scripts/notify-outbox.sh list-pending [--json]      undelivered entries (oldest first)
#   scripts/notify-outbox.sh mark-delivered ID MSGREF   record delivery confirmation (MSGREF = chat message ref)
#   scripts/notify-outbox.sh add TYPE MESSAGE [KIND]    append an entry (used by box scripts)
#   scripts/notify-outbox.sh list-all [--json]
#   scripts/notify-outbox.sh void ID --reason REASON    retire an obsolete undelivered entry (never delivered)
#   scripts/notify-outbox.sh list-voided [--json]
# File: $NOTIFY_OUTBOX (default $UPTIME_DIR/notify-outbox.jsonl). Append-only: deliveries are appended to
# <outbox>.delivered.jsonl; entries are never rewritten. Routine contract: run list-pending, deliver each
# message, then mark-delivered with the message ref. An entry stays pending until marked.
# Void: appended to <outbox>.voided.jsonl ({"id","voided":true,"status":"voided","reason","at","source"}); the
# entry line itself is never rewritten. Voided entries are excluded from list-pending and mark-delivered refuses
# them (exit 1). Void needs a non-empty --reason; repeat void of a voided entry is a no-op (exit 0, original
# void record kept); voiding a delivered or unknown entry is refused (exit 1). No un-void command (see docs).
set -uo pipefail
UPTIME_DIR="${UPTIME_DIR:-/workspace/calibra-stabilization}"
export OB="${NOTIFY_OUTBOX:-$UPTIME_DIR/notify-outbox.jsonl}"
mkdir -p "$(dirname "$OB")"
exec 5>"$OB.lock"; flock -w 30 5 || { echo "outbox lock busy" >&2; exit 75; }
exec python3 - "$@" <<'PY'
import json, os, sys, uuid
from datetime import datetime
OB = os.environ["OB"]; DL = OB[:-6] + ".delivered.jsonl" if OB.endswith(".jsonl") else OB + ".delivered"
VD = OB[:-6] + ".voided.jsonl" if OB.endswith(".jsonl") else OB + ".voided"
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
vd = {}
for v in rd(VD):
    if "id" in v and v["id"] not in vd: vd[v["id"]] = v  # first void record wins
for e in ent:
    if e.get("id") in dl: e["delivered"] = True; e["delivered_at"] = dl[e["id"]].get("at"); e["msgref"] = dl[e["id"]].get("msgref")
    if e.get("id") in vd: e["voided"] = True; e["status"] = "voided"; e["voided_at"] = vd[e["id"]].get("at"); e["void_reason"] = vd[e["id"]].get("reason")
if cmd in ("list-pending", "list-all", "list-voided"):
    if cmd == "list-voided": sel = [e for e in ent if e.get("voided")]
    else: sel = [e for e in ent if cmd == "list-all" or not (e.get("delivered") or e.get("voided"))]
    if "--json" in a: print(json.dumps(sel))
    else:
        for e in sel:
            vs = f'\tvoided={e.get("voided_at")}' if e.get("voided") else ""
            print(f'{e["id"]}\t{e.get("type")}\t{e.get("created")}\tdelivered={e.get("delivered")}{vs}\t{e.get("message","")}')
        print(f"# {len(sel)} {dict(zip(('list-pending','list-all','list-voided'),('pending','total','voided')))[cmd]}", file=sys.stderr)
elif cmd == "mark-delivered":
    if len(a) < 3: sys.exit("usage: mark-delivered ID MSGREF")
    ids = {e.get("id") for e in ent}
    if a[1] not in ids: sys.exit(f"unknown id {a[1]}")
    if a[1] in dl: print(f"already delivered {a[1]} ({dl[a[1]].get('msgref')})"); sys.exit(0)
    if a[1] in vd: sys.exit(f"refusing to mark voided entry {a[1]} delivered (voided {vd[a[1]].get('at')}: {vd[a[1]].get('reason')})")
    with open(DL, "a") as f: f.write(json.dumps({"id": a[1], "delivered": True, "msgref": a[2], "at": now}) + "\n")
    print(f"marked {a[1]} delivered msgref={a[2]}")
elif cmd == "add":
    if len(a) < 3: sys.exit("usage: add TYPE MESSAGE [KIND]")
    e = {"id": f"{now.replace(':','')}-{a[1]}-{uuid.uuid4().hex[:6]}", "type": a[1], "kind": a[3] if len(a) > 3 else a[1],
         "created": now, "delivered": False, "source": os.environ.get("OUTBOX_SOURCE", "manual"), "message": a[2]}
    with open(OB, "a") as f: f.write(json.dumps(e) + "\n")
    print(e["id"])
elif cmd == "void":
    usage = "usage: void ID --reason REASON"
    if len(a) < 2 or a[1].startswith("--"): sys.exit(usage)
    vid, reason, rest = a[1], None, a[2:]
    while rest:
        if rest[0] == "--reason" and len(rest) > 1: reason, rest = rest[1], rest[2:]
        elif rest[0].startswith("--reason="): reason, rest = rest[0][9:], rest[1:]
        else: sys.exit(f"{usage} (unexpected argument {rest[0]!r})")
    if reason is None or not reason.strip(): sys.exit(f"{usage} (non-empty --reason required)")
    if vid not in {e.get("id") for e in ent}: sys.exit(f"unknown id {vid}")
    if vid in vd: print(f"already voided {vid} (at {vd[vid].get('at')}: {vd[vid].get('reason')}); unchanged"); sys.exit(0)
    if vid in dl: sys.exit(f"refusing to void delivered entry {vid} (delivered {dl[vid].get('at')} msgref={dl[vid].get('msgref')})")
    rec = {"id": vid, "voided": True, "status": "voided", "reason": reason.strip(), "at": now, "source": os.environ.get("OUTBOX_SOURCE", "manual")}
    with open(VD, "a") as f: f.write(json.dumps(rec) + "\n"); f.flush(); os.fsync(f.fileno())
    print(f"voided {vid} reason={reason.strip()}")
else: sys.exit(f"unknown command {cmd}")
PY
