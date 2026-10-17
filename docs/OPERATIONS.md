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

## Box monitor loop + notification outbox (2026-10-16, not started by default)
Root cause of irregular monitor timing: server-side routine dispatch latency (median +6.4 min, max +8.2 min, gaps up to
20.4 min; box-side check runtime < 1 s). Evidence: /workspace/calibra-scheduler-*/scheduler-root-cause.md.
```
scripts/monitor-loop.sh start    # creates MONITOR_LOOP_ENABLED, launches detached loop (setsid/nohup, flock single instance)
scripts/monitor-loop.sh status   # rc 0 running; prints heartbeat + last scheduler-runs rows
scripts/monitor-loop.sh stop     # stops loop, removes enable flag (boot-hook will not restart it)
```
* Slots :07/:22/:37/:52 (epoch % 900 == 420), each run `timeout 60 uptime-check.sh` with UPTIME_CALLER=loop.
* `scheduler-runs.csv`: expected_ts,actual_start,end,duration_s,lateness_s,exit,result,notify. Skipped slots -> `MISSED`
  rows on the next iteration; hung check -> `TIMEOUT` (exit 124), next slot unaffected.
* Boot-hook restarts the loop in any new shell only if `MONITOR_LOOP_ENABLED` exists and it is not running.
* While enabled, `uptime-check.sh` (any caller, e.g. the routine) exits 0 with `SKIPPED-RECENT` and writes nothing if a
  check completed < 5 min ago (`UPTIME_MIN_INTERVAL_S`), and appends every notify≠none to `notify-outbox.jsonl`.
  Flag absent = previous behaviour exactly (no guard, no outbox).
* Loop flags `heartbeat_routine_stale` in the outbox if `.heartbeat-routine-last` (written by every monitor-heartbeat run)
  is > 40 min old; `heartbeat_routine_recovered` when it resumes.
* `monitor-heartbeat.sh` kinds: normal, monitor_stale, heartbeat_recovery, loop_dead (loop enabled but pid dead or
  heartbeat file > 5 min old), loop_recovered.

Outbox (routines deliver; box cannot message chat):
```
scripts/notify-outbox.sh list-pending [--json]
scripts/notify-outbox.sh mark-delivered <ID> <MSGREF>    # after chat delivery confirmed; appended to notify-outbox.delivered.jsonl
```
Routine contract once enabled: run the check/heartbeat, then `list-pending --json`, deliver each `message`, then
`mark-delivered`. Deliver from the outbox only (not also from the JSON `notify` field) to avoid duplicates.

Heartbeat test mode (never touches live state; refuses the live dir; messages tagged [TEST]):
```
HEARTBEAT_TEST=1 HEARTBEAT_STATE_DIR=/tmp/hb-test scripts/monitor-heartbeat.sh
```
Uses <dir>/uptime-state.json, .heartbeat-dedupe.json, notify-outbox-test.jsonl, loop files in <dir>.
Threshold: keep HEARTBEAT_STALE_MIN 25 while the routine is the only caller; 20 is justified once the loop runs
(15 min cadence + 5 min slack vs loop lateness < 2 s).
Tests: `bash tests/test-monitor-loop.sh`.

## Batch 1 additions (17 Oct 2026)

### Boot race guard
* `scripts/ensure-prod.sh` waits up to `CALIBRA_RESTORE_WAIT_S` (default 300 s) while the platform restore status file
  (`CALIBRA_RESTORE_STATUS`, default `/tmp/sand-copy-in-status.json`; `none` disables) exists without `"phase":"done"`;
  if still unfinished it exits 4 without starting. If `scripts/lib-maintenance.sh` is missing or fails to load it exits 1
  (fail safe, logged to `prod.log`). `boot-hook.sh` returns early in both cases.
* Paths derive from the script location (`CALIBRA_HOME` overrides).

### Verified database backup
```
python3 scripts/backup-db.py --label before-change   # -> ../calibra-backups/gfi-<UTC>-<label>.db(.gz) + .json manifest
```
Exit 0 only when integrity_check = ok and row counts are consistent. Always take one before schema/ingestion changes or deploys.

### Deploy (used for Batch 1)
```
python3 scripts/backup-db.py --label pre-deploy
scripts/maintenance.sh on --reason "deploy" --ttl 20
scripts/ensure-prod.sh --build --override-maintenance
scripts/maintenance.sh off
```
Rollback: `git checkout <previous commit>` and repeat the build, or stop prod and restore a saved `.next` copy, then `--start`.

### Data quality and source health
* `GET /api/data-quality`: overall label (live / degraded / stale / demo / insufficient), reasons, failing sources, coverage,
  stale/invalid values, affected outputs, skipped calculations, corroboration with official rates, cluster metrics.
* `GET /api/sources/health`: per-source registry. Tables: `source_health`, `source_fetch_log`, `data_quality_flags`,
  `event_clusters`, `event_cluster_history` (all additive).
* Event clustering backfill (idempotent, additive): `node_modules/.bin/tsx scripts/cluster-events-backfill.ts`.

### Tests
`npm run test:unit` (node:test via tsx, temp databases only) and `npm test` (maintenance bash tests + unit tests).
