#!/usr/bin/env python3
"""Mock Calibra HTTP server for tests. Behaviour read per-request from MODE file (argv[2]):
  up | stale | sched404 | weird (500 with commas/quotes/newlines in body)
  or a JSON object (B2.3 state-model tests), e.g.
    {"root":200,"sched":200,"enabled":true,"started":true,"tick_at":"2026-10-24T08:00:00Z","dataQuality":"live"}
  keys: root/sched (HTTP codes), enabled/started (omitted -> field absent, like a pre-B2.2 build),
  tick_at (absolute ISO, deterministic with a fake clock) or tick_age_min (relative to real now) or
  tick_at=null (lastTick missing), body (raw scheduler body override).
Every request is appended to <MODE>.requests ("METHOD path") so tests can assert read-only probing."""
import http.server, json, sys, os
from datetime import datetime, timezone, timedelta
port, modef = int(sys.argv[1]), sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self): self._rec(); self._s(405, "")
    def do_PATCH(self): self._rec(); self._s(405, "")
    def _rec(self):
        with open(modef + ".requests", "a") as f: f.write(f"{self.command} {self.path}\n")
    def do_GET(self):
        self._rec()
        mode = open(modef).read().strip()
        if mode.startswith("{"):
            c = json.loads(mode)
            if self.path == "/": return self._s(int(c.get("root", 200)), "<html>ok</html>")
            if self.path == "/api/scheduler/status":
                if "body" in c: return self._s(int(c.get("sched", 200)), c["body"])
                j = {"dataQuality": c.get("dataQuality", "live")}
                for k in ("enabled", "started"):
                    if k in c: j[k] = c[k]
                if "tick_at" in c: j["lastTick"] = c["tick_at"]
                else:
                    j["lastTick"] = (datetime.now(timezone.utc) - timedelta(minutes=float(c.get("tick_age_min", 1)))).isoformat().replace("+00:00", "Z")
                return self._s(int(c.get("sched", 200)), json.dumps(j))
            return self._s(404, "")
        if self.path == "/": return self._s(200, "<html>ok</html>")
        if self.path == "/api/scheduler/status":
            if mode == "sched404": return self._s(404, "")
            if mode == "weird": return self._s(500, 'boom, "quoted", and\nnewline, error')
            age = 45 if mode == "stale" else 1
            lt = (datetime.now(timezone.utc) - timedelta(minutes=age)).isoformat().replace("+00:00", "Z")
            return self._s(200, json.dumps({"dataQuality": "live", "lastTick": lt}))
        self._s(404, "")
    def _s(self, c, b):
        b = b.encode(); self.send_response(c); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
