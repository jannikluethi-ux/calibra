# Calibra operations

Prod: `next start` on :3456, supervised by `scripts/ensure-prod.sh` (no systemd/cron on the box).
`scripts/boot-hook.sh` is sourced by `~/.bashrc` and `~/.profile`: **every new bash shell** checks
:3456 and, if nothing listens, launches `ensure-prod.sh` (caller=boot-hook). That is how prod comes
back after a box restart, and also why an intended stop gets "undone" by the next shell anyone opens
(happened in the 2026-10-16 outage test: stop 11:51:46, boot-hook restart 11:56:57, ~14 s after the
monitor's own shell ran its DOWN check at 11:56:43).

## Maintenance guard
```
scripts/maintenance.sh on --reason "db migration" --ttl 45   # default 60 min, max 240
scripts/maintenance.sh status                                 # rc 0 active, rc 1 inactive
scripts/maintenance.sh off
```
* Guard file `tmp/MAINTENANCE` (start, expires, ttl, reason, user, pid, host).
* While active and unexpired: boot-hook does not start prod and prints one line to stderr:
  `[calibra] MAINTENANCE active until ... (reason: ...) - prod auto-start suppressed ...`
  `ensure-prod.sh` (no args / `--start` / boot-hook) refuses with rc 3; a supervisor loop that sees
  the server exit does not restart it.
* The guard never stops a running server by itself. Stop with `scripts/ensure-prod.sh --stop`.
* Expired or unparseable guard = inactive; it is logged (`maintenance-expired-cleanup`) and deleted
  by whichever check sees it first, so a forgotten/killed session cannot keep prod down past the TTL.
* `off` does not start prod. Start explicitly (see below).

Typical maintenance session:
```
scripts/maintenance.sh on --reason "rebuild" --ttl 30
scripts/ensure-prod.sh --stop
... work ...
scripts/maintenance.sh off
scripts/ensure-prod.sh --start
```

## Intended (manual) restart command
```
scripts/ensure-prod.sh --stop && scripts/ensure-prod.sh --start --override-maintenance
```
`--override-maintenance` is only needed while a guard is active. Plain start: `scripts/ensure-prod.sh --start`.
Rebuild + restart (20-30 s downtime): `scripts/ensure-prod.sh --build`.

## Restart events log
`tmp/restart-events.log`, one line per event:
`ts=<iso> caller=<boot-hook|supervisor-manual|supervisor-loop|maintenance> action=<...> pid=<n> detail="..."`
Actions: `start-requested` (boot-hook), `supervisor-start`, `server-start` (detail says `launched by <caller>`),
`stop`, `start-blocked-maintenance`, `start-override-maintenance`, `maintenance-on|off|expired-cleanup`.
Set `CALIBRA_CALLER=<name>` to attribute a start from other automation.
Note: the supervisor process running at the time of commit 2026-10-16 was started from the old script;
its in-loop crash-restart only honours the guard after the next (re)start of the supervisor.

## Uptime monitoring
* `scripts/uptime-check.sh` — one deterministic check: root + `/api/scheduler/status` with
  `curl --max-time` (10 s), `flock -w 60` against overlap (rc 75 + `SKIPPED`, no row), appends exactly
  one 9-column RFC 4180-quoted row to `uptime-log.csv` (append-only, history untouched), atomically
  replaces `uptime-state.json`, appends transitions to `uptime-transitions.jsonl`, prints ONE JSON line:
  `status` UP|DOWN|RECOVERED, `notify` none|down|recovery|heartbeat. Never restarts anything.
  Missing responses: `root_http/scheduler_http=000`, `dataQuality=unavailable`, `lastTick=''`, `tick_age_min=''`.
  Unhealthy = root≠200, scheduler≠200, lastTick missing or >30 min old, or CRASHLOOP marker.
  `notify=heartbeat` = healthy but previous check older than 20 min (monitor gap).
  Env: `UPTIME_DIR` (default /workspace/calibra-stabilization), `CALIBRA_BASE_URL`, `CALIBRA_STATE_DIR`.
* `scripts/monitor-heartbeat.sh` — monitor-of-the-monitor: last completed check older than
  `HEARTBEAT_STALE_MIN` (20) → `notify=heartbeat` once per stale episode; when checks resume →
  `notify=recovery kind=heartbeat_recovery` once. Dedupe: `.heartbeat-dedupe.json`.
  Caveat: with the current routine (15 min ± 7 min jitter) 4 of 27 historical gaps exceeded 20 min;
  use 35 min while checks run from the jittery routine, 20 min once on a fixed box timer.
* `scripts/validate-uptime-log.py [file] [--json]` — read-only report of malformed rows (rc 1 if any).
* `scripts/outage-duration.py --log uptime-log.csv --prod-log tmp/prod.log --restart-events tmp/restart-events.log`
  — exact duration only when process logs give both stop and start inside the window; otherwise
  bounds (min = first_failed→last_failed, max = last_healthy→first healthy) with an uncertainty label.
* State keys (schema 2): `last_check_at`, `last_healthy_at`, `last_healthy_before_outage_at`,
  `first_failed_at`, `last_failed_at`, `down_transition_at`, `service_restored_at`, `process_start_at`,
  `recovery_transition_at`, `consecutive_failures`, `last_outage` (legacy `status/since/lastCheck/lastDetail` kept).

Heartbeat scheduling: the box has no cron, crontab or systemd (PID 1 is `tini`), so a box timer is not
available without installing one. Options: (a) separate server-side routine running only
`monitor-heartbeat.sh` on an offset cadence; (b) a `while sleep 300; do monitor-heartbeat.sh; done`
loop launched like the supervisor (setsid, pidfile) — survives only as long as the box process tree.

## Tests
```
tests/test-maintenance.sh   # boot-hook / guard / ensure-prod gating (temp dirs, mocked start, spare port)
tests/test-uptime.sh        # uptime-check, heartbeat, validator, outage-duration (mock HTTP server)
```
