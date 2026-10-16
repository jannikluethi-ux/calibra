#!/usr/bin/env python3
"""Validate uptime-log.csv against its header. READ-ONLY: prints a report, never modifies the file.
Checks per row: field count == header (9), ISO timestamp, status in {UP,DOWN,RECOVERED},
http codes 3 digits, crashloop in {yes,no}, tick_age_min numeric or empty, lastTick ISO or empty.
Exit 0 if all rows valid, 1 if malformed rows found (historical rows are reported, not fixed).
Usage: validate-uptime-log.py [path] [--json]"""
import csv, json, re, sys
from datetime import datetime
HEADER = ["timestamp","status","root_http","scheduler_http","dataQuality","lastTick","tick_age_min","crashloop","detail"]
def iso(s):
    try: datetime.fromisoformat(s.replace("Z", "+00:00")); return True
    except ValueError: return False
def check(row):
    errs = []
    if len(row) != len(HEADER): return [f"field count {len(row)} != {len(HEADER)}"]
    d = dict(zip(HEADER, row))
    if not iso(d["timestamp"]): errs.append(f"timestamp not ISO: {d['timestamp']!r}")
    if d["status"] not in ("UP", "DOWN", "RECOVERED"): errs.append(f"bad status {d['status']!r}")
    for k in ("root_http", "scheduler_http"):
        if not re.fullmatch(r"\d{3}", d[k]): errs.append(f"{k} not 3-digit: {d[k]!r}")
    if d["crashloop"] not in ("yes", "no"): errs.append(f"crashloop not yes/no: {d['crashloop']!r}")
    if d["tick_age_min"] and not re.fullmatch(r"\d+(\.\d+)?", d["tick_age_min"]): errs.append(f"tick_age_min not numeric: {d['tick_age_min']!r}")
    if d["lastTick"] and not iso(d["lastTick"]): errs.append(f"lastTick not ISO: {d['lastTick']!r}")
    if not d["lastTick"] and d["tick_age_min"]: errs.append("tick_age_min set without lastTick")
    return errs
def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    path = args[0] if args else "/workspace/calibra-stabilization/uptime-log.csv"
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    rep = {"file": path, "header_ok": bool(rows) and rows[0] == HEADER, "rows": 0, "valid": 0, "malformed": []}
    # csv.reader record numbers; physical line tracked approximately via reader
    for i, row in enumerate(rows[1:], start=2):
        if not row: continue
        rep["rows"] += 1
        e = check(row)
        if e: rep["malformed"].append({"record": i, "errors": e, "raw": row})
        else: rep["valid"] += 1
    if "--json" in sys.argv: print(json.dumps(rep, indent=2))
    else:
        print(f"file: {path}\nheader_ok: {rep['header_ok']}\nrows: {rep['rows']} valid: {rep['valid']} malformed: {len(rep['malformed'])}")
        for m in rep["malformed"]:
            print(f"  record {m['record']}: {'; '.join(m['errors'])}\n    raw={m['raw']}")
    sys.exit(0 if rep["header_ok"] and not rep["malformed"] else 1)
if __name__ == "__main__": main()
