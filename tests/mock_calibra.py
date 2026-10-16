#!/usr/bin/env python3
"""Mock Calibra HTTP server for tests. Behaviour read per-request from MODE file (argv[2]):
  up | stale | sched404 | weird (500 with commas/quotes/newlines in body)"""
import http.server, json, sys, os
from datetime import datetime, timezone, timedelta
port, modef = int(sys.argv[1]), sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        mode = open(modef).read().strip()
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
