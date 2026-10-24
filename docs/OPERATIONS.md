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
scripts/notify-outbox.sh void <ID> --reason <REASON>     # retire an obsolete undelivered entry; appended to notify-outbox.voided.jsonl
scripts/notify-outbox.sh list-voided [--json]
```
Void: reason required; repeat void is a no-op (exit 0, first record kept); delivered/unknown ids refused (exit 1).
Voided entries never appear in `list-pending`, and `mark-delivered` refuses them. Entry lines are never rewritten.
Routines must read pending entries only via `list-pending` (the raw `"delivered": false` field in notify-outbox.jsonl
is not updated by delivery or void). Tests: `bash tests/test-notify-outbox-void.sh`.
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
`backup-db.py` covers the DB only. The monitor/notification state lives outside the repo (`/workspace/calibra-stabilization`);
any backup or restore of it must copy all three outbox files together, under the outbox lock
(`flock notify-outbox.jsonl.lock`): `notify-outbox.jsonl`, `notify-outbox.delivered.jsonl` **and**
`notify-outbox.voided.jsonl` (B1s4). Restoring the outbox without the voided sidecar would resurrect voided entries
as pending.

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

## Batch 2 additions (17 Oct 2026)

### Crypto intelligence job
* Scheduler job `crypto` (every ~6 h, ≤2 retries after ~1 h). Status and last error: `/settings/scheduler`, meta
  `scheduler.last.crypto` / `scheduler.error.crypto` / `scheduler.retry.crypto`. Source health: `/api/sources/health`.
* Manual equivalent of the first step only: `npx tsx scripts/sync-crypto-sources.ts` (do not run while the server's job is running).
* New additive tables (no existing table altered): `crypto_market_snapshots`, `crypto_price_history`, `crypto_contracts`,
  `crypto_categories`, `crypto_security_incidents`, `crypto_protocol_map`, `crypto_risk_scores` (append-only history,
  includes archived `research_v1` rows), `crypto_risk_latest` (derived pointer, rebuilt every run).
* Rollback: restore the previous `.next` build from `/workspace/calibra-backups/next-build-<BUILD_ID>.tgz` and restart via
  `scripts/ensure-prod.sh`; the new tables are ignored by the older build. Data rollback (only if needed): the verified backup
  taken before the deploy.

### New routes
`/crypto/high-risk`, `/crypto/methodology`, `/data-quality`, `/api/crypto/high-risk`; `/crypto/risk` now redirects (307) to
`/crypto/high-risk` with its query preserved. Methodology: `docs/crypto-risk-methodology.md`.

## Batch B2.1 — job-trigger auth (23 Oct 2026)
- All job-trigger endpoints (POST tick/refresh/events/market/instruments sync/forecasts/forecasts resolve/scenarios/
  risk/warnings/causal, PATCH scheduler/status) require `Authorization: Bearer $CALIBRA_JOB_TOKEN`; details in
  docs/SCHEDULER.md "Job-trigger auth".
- New env (documented, **not set in production by this change**): `CALIBRA_JOB_TOKEN` (≥ 32 chars, secret),
  optional `CALIBRA_JOB_MIN_INTERVAL_S` (default 30). Without the token every trigger returns 503 (fail closed).
- `scripts/ensure-prod.sh` and `scripts/uptime-check.sh` only use `GET /api/scheduler/status`; unaffected.
- Takes effect only after an approved rebuild + restart of the production server.

## B2 get-fix — read-only GET routes and pages (24 Oct 2026, committed, NOT deployed)

Every GET API route and server page is read-only: no table creation, seeding, provisioning, job, provider call,
timer or file write on a request. Guarded by `tests/unit/readonly-routes-{empty,populated}.test.ts` (all GET
routes and pages, empty and populated throwaway DBs, repeated requests, with/without valid/expired sessions).

### Schema step (versioned)
All DDL lives in pure schema modules applied once per DB open by `src/lib/db/schema.ts`
(`PRAGMA user_version`, `SCHEMA_VERSION = 2`). An up-to-date DB gets zero writes on open. The first open of an
existing (user_version 0) DB after deploy applies `CREATE ... IF NOT EXISTS` / additive `ALTER` once, in one
transaction. Any DDL change must bump `SCHEMA_VERSION`; `tests/unit/schema-version.test.ts` pins the schema.

Schema history: v1 = baseline; v2 = + `instrument_series_cache` (additive `CREATE TABLE IF NOT EXISTS`; a v1 DB is
upgraded in place on first open, existing rows untouched).

### Price series (DB-only GET, guarded prefetch)
- `GET /api/instruments/[id]/series?range=` serves `instrument_series_cache` only and never contacts Yahoo/CoinGecko.
  A cache miss returns `supported:false` with note "Awaiting first prefetch" (the instrument page shows "Data unavailable").
- The cache is filled only by `POST /api/instruments/[id]/series?range=` (Bearer `$CALIBRA_JOB_TOKEN`, refused while
  automation is disabled unless `?force=1`, single-flight + min interval per instrument/range via job-guard).
  Within `CALIBRA_SERIES_TTL_S` (default 900) the cached series is returned without a provider call; calls to the
  same provider closer than `CALIBRA_SERIES_PROVIDER_GAP_MS` (default 2000) get 429; the provider call times out after
  `CALIBRA_SERIES_TIMEOUT_MS` (default 10000). Timeout / provider error / empty result -> **503**, cache untouched.
- No scheduler job prefetches series yet; until an operator (or a later approved job) prefetches, instrument charts are empty.

### Intended writes on GET (public v1 API accounting)
The only writes any GET request performs, kept on purpose and tested separately (`tests/unit/v1-accounting.test.ts`):
- `GET /api/v1/*` with a valid, unrevoked key: `UPDATE api_keys SET last_used` (no other column changes).
- If the call is within the plan's per-minute limit: insert/increment that minute's `api_rate_limits` row.
  Over the limit -> 429, counter not incremented (only `last_used`). Missing/invalid/revoked key -> 401, no write.
- Old `api_rate_limits` windows are not pruned on request (one row per key per active minute); pruning, if wanted,
  belongs to a later approved maintenance job.
The read-only harness probes v1 without a key (401, zero writes).

### Auth data hygiene
- Demo accounts are never created or re-hashed on a request. Explicit, insert-only, opt-in:
  `CALIBRA_DEMO_USERS=1 npm run provision:demo-users`.
- Session lookup is read-only. Expired sessions resolve to "logged out" but their rows are **not** deleted on a
  request. Cleanup (`DELETE FROM sessions WHERE expires_at < now`) is deferred to a separately approved
  maintenance job; until then expired rows accumulate harmlessly (indexed by `idx_sessions_expires`).

### Seeding and the one-off legacy cleanup
- Server pages never seed or persist. On an unseeded DB they render an **"Awaiting first run"** panel
  (`src/components/ui/AwaitingFirstRun.tsx`) instead of creating demo/seed rows; a fresh deploy therefore needs
  `npm run seed` (or the first token-guarded refresh) before pages show data.
- `getRiskGauges()`, `getWarnings()` and `getCausalGraph()` are pure reads (empty list / empty graph when nothing is
  stored). They are computed and stored only by the derive step of the guarded refresh/scheduler jobs or the
  token-guarded `POST /api/risk`, `POST /api/warnings`, `POST /api/causal`.
- No GET route seeds. Seed rows (demo events if `events` is empty, scenarios, forecasts, country profiles, default
  alerts, `dataQuality` default) are written only by `npm run seed` or the token-guarded `POST /api/refresh`,
  `POST /api/scheduler/tick`, `PATCH /api/scheduler/status` and `POST /api/forecasts/resolve`. Seeding is
  idempotent: a second `npm run seed` writes nothing.
- Crypto read paths (overview, coverage, research, resolve, high-risk list/facets, risk profile, instrument
  evidence, `GET /api/crypto/risk`, `/crypto/categories`) no longer call `prepareCryptoStore()`. The source
  registry (`sources` rows) is seeded by `npm run seed` / the guarded refresh (`ensureSeedData`) and by the crypto
  and official-rates sync jobs. `seedSources()` is zero-write when rows are unchanged and never touches an
  operator's `enabled` flag.
- Country profiles carry a fixed dataset date (`COUNTRY_PROFILES_DATASET_DATE`, 2026-09-27) instead of the
  process start time, and `seedCountries()` rewrites a row only if its content differs. Bump the constant only
  when the profile figures are revised.
- The exact-title duplicate-event / duplicate-scenario cleanup (`eventDedupeCleanupV1`) and the legacy
  `forecasts.status / horizon_end` column backfill (`forecastColumnsBackfillV1`) no longer run implicitly. They are
  the explicit one-off `scripts/migrate-legacy-cleanup-v1.ts`:
  `npx tsx scripts/migrate-legacy-cleanup-v1.ts --db <app>/data/gfi.db` (dry run, opened read-only), and
  `CALIBRA_LEGACY_MIGRATION=1 ... --apply` to write. Both steps are meta-gated (`eventDedupeCleanupV1` already
  ran on the live DB on 15 Oct 2026). **Do not run `--apply` against production without a separate explicit
  approval and a verified backup** (`scripts/backup-db.py`).

### Scheduler opt-in
- The in-process loop is armed at boot only when `CALIBRA_SCHEDULER=1` (or `true`/`on`). Unset / `0` / anything else =
  off; `.env.example` now ships `CALIBRA_SCHEDULER=0`. Guarded job triggers answer 409 while automation is off unless
  `?force=1`; `PATCH /api/scheduler/status {enabled:true}` answers 409 without the env opt-in.
- `GET /api/scheduler/status` reports `enabled` (configuration: env opt-in AND soft toggle `scheduler.enabled`) and
  `started` (loop armed in this process) separately; `/settings/scheduler` shows both.

### Deploy sequence (prepared, NOT executed — needs separate explicit approval)
1. `python3 scripts/backup-db.py --label pre-b2-getfix` + copy of the outbox triplet (above) + copy of the live `.next`.
2. Set `CALIBRA_JOB_TOKEN` (>= 32 chars) in the prod env; leave `CALIBRA_SCHEDULER` unset unless automation is approved.
3. Build + restart via `scripts/ensure-prod.sh --build --override-maintenance` inside a maintenance window.
4. First DB open applies the schema step once (user_version 0 -> 2, additive only). Production already has seed data;
   `npm run seed` is needed only on a fresh DB. Do **not** run `migrate-legacy-cleanup-v1.ts --apply`.
5. Rollback: stop prod, restore the saved `.next` (or check out 6f9d484 and rebuild), restart. The additive schema
   (`instrument_series_cache`, `user_version` 2) is harmless to the old build; restore the DB backup only if required.

