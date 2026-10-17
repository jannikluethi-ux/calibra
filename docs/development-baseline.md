# Development baseline (Phase 0), 17 Oct 2026

Captured 12:09–12:20 Zurich time (UTC+2) before any Batch 1 code change. Evidence lives outside the repo in
`/workspace/calibra-dev-batch1-20261017T120949/evidence/` (db-before.json, routes-before.csv, baseline-*.log, source-probes.csv).

## Repository and build
| Item | Value |
|---|---|
| Branch / HEAD | `main` at `6155789`, in sync with the local `origin/main` ref (not fetched) |
| Working tree | one uncommitted deletion: `src/app/crypto/coverage/page.tsx` (restored from HEAD in Batch 1) |
| Deployed build | `.next/BUILD_ID` `lSTYyXzC2J5qxrdaJVATz`, built 17 Oct 02:54:55 Zurich time from the 6155789 tree **without** page.tsx, so `/crypto/coverage` returned 404 although it is linked in 4 places |
| Stack | Next.js 14.2.35, React 18, Node 20.19.2, better-sqlite3, SQLite `data/gfi.db` (WAL) |
| Typecheck | `tsc --noEmit` exit 0 |
| Tests | test-maintenance 31/31, test-uptime 28/28, test-monitor-loop 39/39, test_outage_duration 6 OK. No unit tests for app code |

## Routes (HTTP against prod, port 3456)
57 checked (33 pages, 24 APIs): 51 × 200; 401 on `/api/watchlists`, `/api/v1/events`, `/api/v1/calibration` (auth required, expected);
404 on `/crypto/coverage` (defect, see above) and on `/api/data-quality`, `/api/sources/health` (planned, not yet built).
Note: `/crypto/bitcoin` is not a real URL; asset links use the encoded instrument id (`/crypto/crypto%3Acoingecko%3Abitcoin`, 200).

## Database
`PRAGMA integrity_check` = ok, 28 tables. Row counts: events 1,092 (live 1,087, demo 5), scenarios 852, forecasts 216 (192 open live,
4 seed, 20 resolved live), instruments 22,038, market_history 27,624, market_snapshots 21, canonical_fields 1,195,
crypto_risk_assessments 1,002, source_observations 2,424, sources 15, users 3, sessions 7, api_keys 2, fired_alerts 236,
countries 20, warnings 3, alerts 3, coverage_snapshots 4, instrument_event_links 9, risk_gauges 10, meta 24, sync_runs 1,
watchlists 0, portfolio 0.

Historical note: a one-shot cleanup (`eventDedupeCleanupV1`, 15 Oct 2026 23:02 UTC) deleted 19,543 exact-title duplicate
events and 3,302 scenarios before this baseline. Batch 1 does not delete anything.

## Freshness and sources at baseline
* `meta.dataQuality` = **live** although: crypto source sync last ran 15 Oct 22:29 UTC (≈37 h old; sync is manual),
  IMF RSS returns 403, Reuters RSS host no longer resolves, and DE10Y (Yahoo `BUND.DE`) returns price **0**.
* market_history held **1,312 DE10Y rows with price 0 labeled live** (26 Sep → 17 Oct). No DE10Y forecasts exist.
* Events: 95 % from CNBC (1,042), ECB 26, Fed 19, IMF 0, Reuters 0. No exact-normalized duplicate groups.
* Fail-over code substituted **demo** markets/events when providers failed (removed in Batch 1).

## Performance (re-measured, not a validation claim)
20 resolved live forecasts (BTC, EURUSD, GOLD, SPX, VIX × 4): mean Brier 0.1508, direction accuracy 0.65.
The sample is far too small to support any claim of predictive skill.

## Inventory summary
* Pages: `/`, account, alerts, analyst, assets, countries, crypto (overview, assets, categories, risk, coverage, detail),
  digest, docs/api, events, explorer, forecasts, instruments, login, map, methodology, movers, portfolio, pricing,
  scenarios, settings/scheduler, signup, simulator, warnings.
* APIs: account, alerts, analyst, auth, billing, causal, countries, crypto, digest, events, forecasts, instruments, market,
  movers, portfolio, refresh, risk, scenarios, scheduler (status, tick), simulator, v1 (key-auth), warnings, watchlists.
* Jobs (in-app scheduler, `src/lib/scheduler`): markets-fast, markets-slow, events, derive, daily-maintenance.
  Crypto source sync (`scripts/sync-crypto-sources.ts`) is manual.
* Ingestion: Yahoo chart API (21 symbols), RSS (Fed, ECB, IMF, Reuters, CNBC), crypto adapters (Coinbase, CoinGecko,
  CoinGecko project, DefiLlama, Yahoo AAPL probe, rss_events linker).
