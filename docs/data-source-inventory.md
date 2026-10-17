# Data-source inventory

Status verified by live probes on 17 Oct 2026 12:13 Zurich time (UTC+2) and by the source-health registry after deploy.
Live state: `GET /api/sources/health`. All sources are free and keyless. No paid service is used.

| Source id | What | Endpoint | Class | Used for | Verified 17 Oct | Freshness budget | Notes |
|---|---|---|---|---|---|---|---|
| yahoo_markets | Yahoo Finance chart API, 21 symbols | query1.finance.yahoo.com/v8/finance/chart | established market data (unofficial API) | market snapshots, history, movers, forecasts, resolution | 200; **BUND.DE returns price 0** | 80 h (weekends) | Rate-limits rapid calls (empty body / 429). Critical input |
| rss_cnbc | CNBC Top News RSS | search.cnbc.com …id=100003114 | reputable news | events, scenarios | 200 | 24 h | ≈95 % of events: source concentration flagged |
| rss_federal_reserve | Fed press releases | federalreserve.gov/feeds/press_all.xml | official | events | 200 | 7 d | |
| rss_ecb | ECB press | ecb.europa.eu/rss/press.html | official | events | 200 | 7 d | |
| rss_imf | IMF news | imf.org/en/News/RSS | institutional | events | **403** | 14 d | Kept enabled; circuit breaker backs off (owner decision) |
| rss_reuters | Reuters business | feeds.reuters.com | news | events | **DNS fails** | — | **Disabled** 17 Oct (retired host, 0 events ever stored) |
| ust_yield_curve | U.S. Treasury daily par yield curve CSV | home.treasury.gov …daily_treasury_yield_curve | primary official (public domain) | corroboration of US10Y; official 2Y context | 200 (16 Oct: 2Y 4.74, 10Y 5.09) | 5 d | **New in Batch 1** |
| bundesbank_yields | Bundesbank 10Y Bund yield (BBSIS …R10XX) | api.statistiken.bundesbank.de | primary official (attribution required) | official DE10Y yield; corroboration | 200 (16 Oct: 3.45 %) | 5 d | **New in Batch 1** |
| coinbase | Coinbase Exchange public ticker | api.exchange.coinbase.com | established market data | crypto prices | 200 | 24 h | Manual sync only |
| coingecko | CoinGecko simple/price, global | api.coingecko.com | secondary aggregator | crypto prices, market caps | 200 | 24 h | Manual sync; public rate limits |
| coingecko_project | CoinGecko coin detail | api.coingecko.com | secondary aggregator | project metadata | 200 | 7 d | Manual sync |
| defillama | DefiLlama protocols | api.llama.fi/protocols | secondary aggregator | TVL | 200 | 24 h | Manual sync; 9 MB response |
| kraken, binance | public tickers | — | — | — | not called | — | Disabled fallbacks |
| edgar, github, audits | — | — | — | — | not connected | — | Disabled stubs; data shown as insufficient |
| (probed, not added) FRED CSV | fred.stlouisfed.org | — | — | — | **no response** from this host | — | Not added: unreachable here |
| (probed, not added) ECB euro reference rates | ecb.europa.eu eurofxref-daily.xml | primary official | — | 200 | — | Candidate for Batch 2 (EUR FX corroboration); not needed to fix a current gap |

## Why the two new sources (item 9)
* **Gap 1 – DE10Y has no valid value.** The Yahoo proxy `BUND.DE` (an ETF, renamed "PIMCO GR GV BN EUR") returns price 0
  and has produced 1,312 zero rows. The Bundesbank publishes the actual 10-year Bund yield daily, keyless, with reuse
  allowed under attribution. It is stored as `rates:DE10Y` `yield_pct` observations for corroboration and display in the
  data-quality summary; the DE10Y market series is **not** silently replaced (that is an owner decision, see roadmap).
* **Gap 2 – US rates have a single unofficial source and US2Y is a proxy.** `US2Y` is the 13-week bill (`^IRX`), not a 2-year
  yield. The Treasury par-yield CSV provides the official 2Y and 10Y. It shows Yahoo `^TNX` within 0.01 pp of the official 10Y
  (17 Oct) and makes the US2Y proxy gap visible. Forecast resolution still uses the existing series.

## Reliability controls (item 10)
Every tracked source has a health record (`source_health`) with status, last attempt/success/failure, data age,
consecutive failures, rate-limit cooldown, error class (unavailable / invalid_data / stale / rate_limited /
no_relevant_update / disabled), last valid observation, last error, downstream outputs; each attempt is logged in
`source_fetch_log` (capped at 20,000 rows). Fetches use timeouts (15–20 s), at most 1 retry with exponential back-off for
network/5xx/429 only, a circuit breaker (3 failures → 5 min, doubling, cap 6 h), a 15 min cooldown after 429, and
concurrency limits (RSS 3 parallel; Yahoo sequential with pacing). Failing sources never block others and are never
replaced by synthetic data.
