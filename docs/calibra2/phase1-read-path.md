# Calibra 2.0 Phase 1 — database read-path remediation

Status: branch `calibra2/phase1-read-path` (based on `main` 84a7f12, 25 Oct 2026). Scope: read paths must not mutate;
initialization, seeding and maintenance run only through explicit commands or token-guarded jobs. No new features.

## Starting point
The B2 GET audit (24 Oct 2026) found side effects on **32 of 40 GET API routes** (31 DB writes + 1 live provider call)
and **20 of 26 server pages**. The B2 get-fix (f4d92c5..a9a7ca8, on `main`) removed them. Phase 1 re-verified every
route and page against that audit, then closed the remaining initialization gaps.

## Root causes (from the audit) and disposition
| Code | Cause | Classification | Fix |
|---|---|---|---|
| F1 | `ensureSeedData()` called on GET; country profiles rewritten every call (timestamp = module load) | required mutation in the wrong path + unintended mutation | b2d73e0 |
| F2 | `rankMovers()` re-seeded countries | unintended mutation | b2d73e0 |
| F3 | Risk/warning/causal getters persisted a snapshot when empty | required mutation in the wrong path | bb46656 |
| F4 | `ensureDemoUsers()` on every authenticated call (bcrypt rehash + UPDATE) | unintended mutation + required mutation in the wrong path | cefb636 |
| F5 | `prepareCryptoStore()` (source registry DDL + upsert) on crypto reads | required mutation in the wrong path | a8d616e |
| F6 | Lazy `CREATE TABLE IF NOT EXISTS` on reads | required mutation in the wrong path | d827f0f |
| F7 | Live provider fetch on `GET /api/instruments/[id]/series` | required mutation (cache fill) in the wrong path | 85f30a9 |
| F8 | v1 API: `api_keys.last_used` + `api_rate_limits` with a valid key | **legitimate exception** (kept, tested) | 42ba370 |
| B1 | Schema created implicitly on first open | required; kept as an idempotent safety net + explicit `npm run migrate` | d827f0f, 7a22303 |
| B2 | Scheduler armed at boot | required mutation in the wrong path | ebdd257 (opt-in) |
| P1 | **New in Phase 1:** concurrent seed inserted duplicate demo events (5) and default alerts (4); concurrent first open failed with `SQLITE_BUSY` | unintended mutation + init failure | d2bd9a6, df0321a |

Per-route/page detail (all 40 routes, 26 audited pages + root layout + `/crypto/coverage`, client pages, boot rows):
[`phase1-disposition-matrix.csv`](phase1-disposition-matrix.csv).

## Phase 1 changes
- **d2bd9a6** — `ensureSeedData()` runs in one `BEGIN IMMEDIATE` transaction; the schema step takes the write lock up
  front and re-checks `user_version`; `busy_timeout` is set before `journal_mode = WAL`. Adds `init-concurrency.test.ts`.
- **7a22303** — `npm run migrate` / `npm run migrate:check` (`scripts/migrate.ts`). Adds `fresh-db-init.test.ts`
  (fresh DB without any HTTP request, re-run idempotency, v1 → v2 upgrade preserving rows, newer-DB refusal).
- **5ab7bbd** — concurrent GET/page burst over every discovered target on empty and populated DBs
  (`readonly-concurrent-{empty,populated}.test.ts`).
- **fbcdcb1** — the read-only harness probes `/crypto/coverage` when the page exists; the concurrent burst requires a
  probe for every discovered target.
- **df0321a** — retry the WAL switch on `SQLITE_BUSY` (SQLite can reject it without consulting `busy_timeout` while
  another process creates the same file).

## Behavior changes
- Seeding is atomic and serialized (also for the guarded POST refresh / scheduler tick / forecast resolve paths).
  Concurrent writers wait up to 10 s instead of failing or duplicating rows.
- New npm scripts `migrate`, `migrate:check`. No route, page, response shape, auth rule or job guard changed.

## Not changed (decisions for later phases)
- The schema step on DB open stays as a safety net (zero writes when current). A strict mode that refuses to open an
  un-migrated DB would change startup behavior and needs an explicit decision.
- `npm run seed` produces no scenarios; scenarios come from the refresh pipeline (pre-existing behavior).
