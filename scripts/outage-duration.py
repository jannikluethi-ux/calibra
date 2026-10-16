#!/usr/bin/env python3
"""Outage duration from monitor observations + process logs.

Exact duration only when process/restart logs give BOTH a stop time and a (re)start time inside the
outage window; otherwise bounds:
  min = first_failed_at -> last_failed_at   (span the monitor actually observed DOWN; 0 for one sample)
  max = last_healthy_at -> service_restored_at (last good obs -> first good obs after failure)
Process start events come from tmp/restart-events.log (caller-attributed) and tmp/prod.log
("starting server" / "supervisor stopping"). Note: "exact" is stop->server-process-start; Next.js
needs a few extra seconds to listen, so the true user-visible outage is slightly longer.

CLI:
  outage-duration.py --log uptime-log.csv [--restart-events tmp/restart-events.log] [--prod-log tmp/prod.log]
    -> reports every DOWN episode in the log (tolerant of historical malformed rows: uses fields 1-2 only)
  outage-duration.py --state uptime-state.json [...]   -> report for the last outage recorded in state
"""
import argparse, csv, json, re, sys
from datetime import datetime

def P(s):
    if not s: return None
    s = s.strip().replace("Z", "+00:00")
    try: return datetime.fromisoformat(s)
    except ValueError: return None

def fmt(sec):
    if sec is None: return None
    sec = int(round(sec)); return f"{sec//3600}h{(sec%3600)//60:02d}m{sec%60:02d}s"

def load_events(restart_events=None, prod_log=None):
    """Return list of dicts {ts, kind: stop|start, caller, source}."""
    ev = []
    if restart_events:
        try:
            with open(restart_events, encoding="utf-8", errors="replace") as fh:
              for line in fh:
                  d = dict(re.findall(r'(\w+)=("[^"]*"|\S+)', line))
                  d = {k: v.strip('"') for k, v in d.items()}
                  t = P(d.get("ts")); a = d.get("action", "")
                  if not t: continue
                  if a == "stop": kind = "stop"
                  elif a in ("server-start",): kind = "start"
                  else: continue
                  caller = d.get("caller")
                  m = re.search(r"launched by ([\w-]+)", d.get("detail", ""))
                  if kind == "start" and m: caller = m.group(1)
                  ev.append({"ts": t, "kind": kind, "caller": caller, "source": "restart-events.log"})
        except FileNotFoundError: pass
    if prod_log:
        try:
            with open(prod_log, encoding="utf-8", errors="replace") as fh:
              for line in fh:
                  m = re.match(r"\[([^\]]+)\] (.*)", line)
                  if not m: continue
                  t = P(m.group(1)); msg = m.group(2)
                  if not t: continue
                  if msg.startswith("starting server"): kind = "start"
                  elif msg.startswith("supervisor stopping") or re.match(r"server exited rc=", msg): kind = "stop"
                  else: continue
                  ev.append({"ts": t, "kind": kind, "caller": None, "source": "prod.log"})
        except FileNotFoundError: pass
    return sorted(ev, key=lambda e: e["ts"])

def compute(last_healthy_at, first_failed_at, last_failed_at, service_restored_at, events=()):
    lh, ff, lf, sr = map(P, (last_healthy_at, first_failed_at, last_failed_at, service_restored_at))
    lf = lf or ff
    out = {"last_healthy_at": last_healthy_at, "first_failed_at": first_failed_at,
           "last_failed_at": lf.isoformat() if lf else None, "service_restored_at": service_restored_at,
           "detection_delay_max_s": (ff - lh).total_seconds() if lh and ff else None,
           "recovery_detection_delay_max_s": (sr - lf).total_seconds() if sr and lf else None}
    stop = start = None
    if lh and ff:
        stops = [e for e in events if e["kind"] == "stop" and lh <= e["ts"] <= ff]
        stop = stops[0] if stops else None
    if stop and sr:
        starts = [e for e in events if e["kind"] == "start" and stop["ts"] < e["ts"] <= sr]
        # prefer caller-attributed source when two sources report the same start
        if starts:
            first_ts = starts[0]["ts"]
            same = [e for e in starts if abs((e["ts"] - first_ts).total_seconds()) <= 5]
            start = next((e for e in same if e.get("caller")), same[0])
    out["process_stop_at"] = stop["ts"].isoformat() if stop else None
    out["process_start_at"] = start["ts"].isoformat() if start else None
    out["restart_caller"] = (start or {}).get("caller") or ("unknown (no caller-attributed restart event)" if start else None)
    out["restart_source"] = (start or {}).get("source")
    if stop and start:
        d = (start["ts"] - stop["ts"]).total_seconds()
        out.update(kind="exact", duration_s=d, duration=fmt(d),
                   uncertainty="exact stop->process-start from process logs; +server warm-up (seconds) not included")
    else:
        mn = (lf - ff).total_seconds() if ff and lf else None
        mx = (sr - lh).total_seconds() if sr and lh else None
        missing = []
        if not stop: missing.append("stop time")
        if not start: missing.append("start time")
        out.update(kind="bounds", min_s=mn, max_s=mx, min=fmt(mn), max=fmt(mx),
                   uncertainty=f"bounded by monitor cadence; process log lacks {' and '.join(missing)}")
    return out

def episodes_from_log(path):
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        r = csv.reader(f); next(r, None)
        for row in r:
            if len(row) >= 2 and P(row[0]): rows.append((P(row[0]), row[1].strip().upper(), row))
    eps, cur, last_ok = [], None, None
    for t, st, row in rows:
        healthy = st in ("UP", "RECOVERED")
        if not healthy:
            if cur is None: cur = {"last_healthy_at": last_ok, "first_failed_at": t, "last_failed_at": t}
            else: cur["last_failed_at"] = t
        else:
            if cur is not None:
                cur["service_restored_at"] = t; eps.append(cur); cur = None
            last_ok = t
    if cur: cur["service_restored_at"] = None; eps.append(cur)
    iso = lambda x: x.isoformat() if x else None
    return [{k: iso(v) for k, v in e.items()} for e in eps]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--log"); ap.add_argument("--state")
    ap.add_argument("--restart-events"); ap.add_argument("--prod-log")
    a = ap.parse_args()
    ev = load_events(a.restart_events, a.prod_log)
    res = []
    if a.log:
        for e in episodes_from_log(a.log):
            res.append(compute(e["last_healthy_at"], e["first_failed_at"], e["last_failed_at"], e["service_restored_at"], ev))
    if a.state:
        s = json.load(open(a.state))
        res.append(compute(s.get("last_healthy_before_outage_at") or s.get("last_healthy_at"), s.get("first_failed_at"),
                           s.get("last_failed_at"), s.get("service_restored_at"), ev))
    if not (a.log or a.state): ap.error("need --log or --state")
    print(json.dumps(res, indent=2))

if __name__ == "__main__":
    main()
