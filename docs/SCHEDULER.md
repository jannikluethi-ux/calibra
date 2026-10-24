# Calibra layered auto-refresh scheduler

In-app scheduler that runs while the Next.js server is up. A ~60s interval only **decides** which jobs are due — it does **not** pull Yahoo every minute.

All “session hours” and weekday/weekend logic use **Europe/Zurich**.

## Jobs (cron-equivalent)

| Job | When (Europe/Zurich) | What |
|-----|----------------------|------|
| `markets-fast` | Every **~10 min**, weekdays **08:00–22:00** | Yahoo quotes via `refreshMarketData` + append `market_history` (~0.45s/symbol pacing). Demo quotes never enter history. |
| `events` | Every **~20 min** weekdays; **hourly** weekends | RSS ingest + classify v2 (`ingestRssFeeds`). |
| `derive` | After markets and/or events **changed in that tick** | event intelligence (assessments, mappings, conflicts; Batch 3) → scenarios (v2 for new material events) → forecasts → resolve → calibration → risk → causal → warnings → evaluate alerts. **No** Yahoo history backfill. |
| `markets-slow` | **Hourly** outside the fast window (overnight / weekend) | Light market pull (same Yahoo path, no backfill). Mutually exclusive with `markets-fast`. |
| `daily-maintenance` | **Once** in the Zurich **06:xx** hour | History backfill if thin (`countHistory < 40`), reclassify leftovers, hygiene seeds. Not every tick. |
| `crypto` | Every **~6 h** (after a failed / CoinGecko-429 run: retry after ~1 h, at most 2 times) | Batch 2. Existing crypto source adapters + consensus + research_v1 (archived first), paced CoinGecko market sync (~7 s between calls, ~20 calls), daily-gated platforms/categories/DefiLlama hacks, rotating price history, then `crypto_risk_v2` scoring, then crypto risk events / event factor / outcome log (Batch 3). Runs last in the tick; **never** triggers `derive`. Health in `/api/sources/health` (`coingecko`, `defillama_hacks`). |

## API

```bash
# Run due jobs now (external cron / manual). Needs the job token (see "Job-trigger auth").
# While automation is disabled this returns 409 unless ?force=1 is added.
curl -X POST -H "Authorization: Bearer $CALIBRA_JOB_TOKEN" http://localhost:3456/api/scheduler/tick

# Status: next due, last runs, enable flag, Zurich clock (public, read-only)
curl http://localhost:3456/api/scheduler/status

# Soft disable / enable (persisted in SQLite meta). Needs the job token.
curl -X PATCH http://localhost:3456/api/scheduler/status \
  -H "Authorization: Bearer $CALIBRA_JOB_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}'
```

### Job-trigger auth (Batch B2.1, 23 Oct 2026)

Every endpoint that starts a fetch / derive / maintenance job or flips the scheduler goes through
`src/lib/security/job-guard.ts`:

| Route | Method |
|---|---|
| `/api/scheduler/tick` | POST |
| `/api/scheduler/status` | PATCH |
| `/api/refresh` | POST |
| `/api/events`, `/api/market`, `/api/instruments/sync` | POST (external fetches) |
| `/api/forecasts/resolve` (may backfill Yahoo history), `/api/forecasts`, `/api/scenarios`, `/api/risk`, `/api/warnings`, `/api/causal` | POST |

- Header `Authorization: Bearer <CALIBRA_JOB_TOKEN>`; constant-time compare (sha256 + `timingSafeEqual`).
- **Fails closed**: env `CALIBRA_JOB_TOKEN` unset, blank or < 32 chars → `503`, nothing runs.
  Missing / malformed header → `401`; wrong token → `403`.
- While automation is disabled (`scheduler.enabled=0` or `CALIBRA_SCHEDULER=0`) POST triggers return `409`
  unless `?force=1`. `PATCH /api/scheduler/status` is exempt (it is the switch).
- In-process guard per job: one run at a time (`409`), and min interval between accepted runs
  `CALIBRA_JOB_MIN_INTERVAL_S` (default 30; `0` disables) → `429` + `Retry-After`.
- The browser UI has no token: StatusBar **Refresh data** and `/settings/scheduler` Enable/Disable/Run tick
  show the server's refusal message. Use curl with the token for manual runs.
- Not implemented: localhost-only filtering (app-router handlers do not see the peer address; forwarded headers
  are spoofable). To restrict exposure, bind the server to loopback (`next start -H 127.0.0.1`) — a deploy change.
- Generate the token out of band (e.g. `openssl rand -hex 32`) and put it only in the server's environment;
  never commit it. Code changes take effect only after an approved rebuild + restart.

### Tick response shape

```json
{
  "ran": ["markets-slow", "events", "derive"],
  "skipped": ["markets-fast", "daily-maintenance"],
  "quality": "live",
  "firedAlerts": 0,
  "noteworthy": false,
  "summary": "Ran [markets-slow, events, derive] — quality=live",
  "details": { "...": "zurich clock, job results, skip reasons, noteworthy reasons" }
}
```

**`noteworthy: true`** only if:

1. `dataQuality` **degraded from `live`**, or  
2. any job returned **refresh errors**, or  
3. a new **high-impact** alert fired — metrics `high_impact_event` (composite ≥ 70), `risk_gauge` (≥ 70), or `vix_level` (≥ 25).

A second tick within the interval window should **skip** recently-run jobs (idempotent last-run meta).

## Enable / disable

| Mechanism | Effect |
|-----------|--------|
| Default | **On** (dev and prod) when env unset |
| `CALIBRA_SCHEDULER=0` | Hard-disable auto-loop (restart required). Unset or `=1` to allow. |
| UI `/settings/scheduler` or `PATCH … {enabled:false}` (token required) | Soft-disable (SQLite `scheduler.enabled`). Auto-loop no-ops; `POST /api/scheduler/tick` is refused (409) unless `?force=1`. |

## Boot

`src/instrumentation.ts` starts the interval on Node server boot. The token-guarded `POST /tick` and `PATCH … {enabled:true}` also ensure the loop is alive (HMR-safe).

Since B2.2 (23 Oct 2026) `GET /api/scheduler/status` and `GET /api/refresh` are **read-only**: no seed upserts, no
dedupe cleanup, no `dataQuality` default, no `startScheduler()` re-arm, no jobs. They return 200 on an empty/unseeded
DB (zero counts, `dataQuality: "insufficient"`). Seeding happens only in authorised `POST /api/refresh`,
`POST /api/scheduler/tick`, `PATCH /api/scheduler/status`, `POST /api/forecasts/resolve` or `npm run seed` (`scripts/seed.ts`, added in B2.2 — the npm script previously pointed at a missing file). Since the B2 get-fix no other GET route or page seeds either, and the legacy dedupe cleanup is the explicit `scripts/migrate-legacy-cleanup-v1.ts` (see docs/OPERATIONS.md). (Opening the DB in a new process
runs the versioned schema step once — see `src/lib/db/schema.ts`.)

## Files

- `src/lib/scheduler/jobs.ts` — named runners + last-run meta keys  
- `src/lib/scheduler/runner.ts` — Zurich due logic, lock, tick, status  
- `src/lib/scheduler/boot.ts` — 60s interval  
- `src/lib/bootstrap/refresh.ts` — `refreshMarketsOnly` / `refreshEventsOnly` / `runDeriveOnly` / `runDailyMaintenance` / `fullRefresh`  
- `src/app/api/scheduler/tick/route.ts`  
- `src/app/api/scheduler/status/route.ts`  
- `src/app/settings/scheduler/page.tsx`  

## Manual full refresh

`POST /api/refresh` remains “run everything now” (markets + optional thin history backfill + events + derive). Since B2.1 it requires the job token, so the StatusBar **Refresh data** button shows the refusal instead of running it.
