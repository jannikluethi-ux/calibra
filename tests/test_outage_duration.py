"""Unit tests for scripts/outage-duration.py (delayed detection, delayed recovery detection,
restart by an unintended process attributed via restart-events.log caller=boot-hook)."""
import importlib.util, os, tempfile, unittest, json, subprocess, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("od", os.path.join(R, "scripts", "outage-duration.py"))
od = importlib.util.module_from_spec(spec); spec.loader.exec_module(od)
def tf(text):
    f = tempfile.NamedTemporaryFile("w", delete=False, suffix=".log"); f.write(text); f.close(); return f.name
class T(unittest.TestCase):
    def test_delayed_detection_bounds(self):
        # down at ~10:02, monitor only notices at 10:15 (no process logs) -> bounds only
        r = od.compute("2026-10-16T10:00:00+02:00", "2026-10-16T10:15:00+02:00", "2026-10-16T10:30:00+02:00", "2026-10-16T10:45:00+02:00")
        self.assertEqual(r["kind"], "bounds"); self.assertEqual(r["min_s"], 900); self.assertEqual(r["max_s"], 2700)
        self.assertEqual(r["detection_delay_max_s"], 900); self.assertIn("lacks stop time and start time", r["uncertainty"])
    def test_delayed_detection_exact_with_logs(self):
        pl = tf("[2026-10-16T10:02:00+02:00] supervisor stopping (signal)\n[2026-10-16T10:20:00+02:00] starting server on :3456\n")
        ev = od.load_events(None, pl)
        r = od.compute("2026-10-16T10:00:00+02:00", "2026-10-16T10:15:00+02:00", "2026-10-16T10:15:00+02:00", "2026-10-16T10:30:00+02:00", ev)
        self.assertEqual(r["kind"], "exact"); self.assertEqual(r["duration_s"], 18*60)
    def test_delayed_recovery_detection(self):
        # process back at 10:20 but monitor sees healthy only at 10:44 -> exact uses process start, delay reported
        pl = tf("[2026-10-16T10:05:00+02:00] server exited rc=1 after 99s; restart 1/5 in 5s\n[2026-10-16T10:20:00+02:00] starting server on :3456\n")
        r = od.compute("2026-10-16T10:00:00+02:00", "2026-10-16T10:14:00+02:00", "2026-10-16T10:14:00+02:00", "2026-10-16T10:44:00+02:00", od.load_events(None, pl))
        self.assertEqual(r["duration_s"], 15*60); self.assertEqual(r["recovery_detection_delay_max_s"], 30*60)
    def test_stop_only_gives_bounds(self):
        pl = tf("[2026-10-16T10:05:00+02:00] supervisor stopping (signal)\n")
        r = od.compute("2026-10-16T10:00:00+02:00", "2026-10-16T10:14:00+02:00", None, "2026-10-16T10:30:00+02:00", od.load_events(None, pl))
        self.assertEqual(r["kind"], "bounds"); self.assertEqual(r["min_s"], 0); self.assertIn("lacks start time", r["uncertainty"])
    def test_restart_by_boot_hook_attributed(self):
        re_ = tf('ts=2026-10-16T11:51:46+02:00 caller=supervisor-manual action=stop pid=1 detail="ensure-prod --stop"\n'
                 'ts=2026-10-16T11:56:57+02:00 caller=supervisor-loop action=server-start pid=2 detail="next start -p 3456 (launched by boot-hook)"\n')
        pl = tf("[2026-10-16T11:51:46+02:00] supervisor stopping (signal)\n[2026-10-16T11:56:57+02:00] starting server on :3456\n")
        r = od.compute("2026-10-16T11:43:51+02:00", "2026-10-16T11:56:43+02:00", "2026-10-16T11:56:43+02:00", "2026-10-16T12:11:28+02:00", od.load_events(re_, pl))
        self.assertEqual(r["kind"], "exact"); self.assertEqual(r["duration_s"], 311)
        self.assertEqual(r["restart_caller"], "boot-hook"); self.assertEqual(r["restart_source"], "restart-events.log")
    def test_cli_on_legacy_log(self):
        log = tf("timestamp,status,root_http,scheduler_http,dataQuality,lastTick,tick_age_min,crashloop,detail\n"
                 "2026-10-16T11:43:51+02:00,UP,200,200,live,x,0,no,ok\n2026-10-16T11:56:43+02:00,DOWN,legacy\n"
                 "2026-10-16T12:11:28+02:00,UP,200,200,live,x,0,no,ok\n")
        out = json.loads(subprocess.check_output([sys.executable, os.path.join(R, "scripts", "outage-duration.py"), "--log", log]))
        self.assertEqual(len(out), 1); self.assertEqual(out[0]["max_s"], 1657); self.assertEqual(out[0]["kind"], "bounds")
if __name__ == "__main__":
    unittest.main(verbosity=2)
