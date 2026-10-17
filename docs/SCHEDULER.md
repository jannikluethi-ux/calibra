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
# Run due jobs now (external cron / manual)
curl -X POST http://localhost:3456/api/scheduler/tick

# Status: next due, last runs, enable flag, Zurich clock
curl http://localhost:3456/api/scheduler/status

# Soft disable / enable (persisted in SQLite meta)
curl -X PATCH http://localhost:3456/api/scheduler/status \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}'
```

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
| UI `/settings/scheduler` or `PATCH … {enabled:false}` | Soft-disable (SQLite `scheduler.enabled`). Auto-loop no-ops; `POST /api/scheduler/tick` still runs due jobs. |

## Boot

`src/instrumentation.ts` starts the interval on Node server boot. Hitting `/api/scheduler/status` or `/tick` also ensures the loop is alive (HMR-safe).

## Files

- `src/lib/scheduler/jobs.ts` — named runners + last-run meta keys  
- `src/lib/scheduler/runner.ts` — Zurich due logic, lock, tick, status  
- `src/lib/scheduler/boot.ts` — 60s interval  
- `src/lib/bootstrap/refresh.ts` — `refreshMarketsOnly` / `refreshEventsOnly` / `runDeriveOnly` / `runDailyMaintenance` / `fullRefresh`  
- `src/app/api/scheduler/tick/route.ts`  
- `src/app/api/scheduler/status/route.ts`  
- `src/app/settings/scheduler/page.tsx`  

## Manual full refresh

`POST /api/refresh` remains “run everything now” (markets + optional thin history backfill + events + derive). Unchanged for the StatusBar **Refresh data** button.
