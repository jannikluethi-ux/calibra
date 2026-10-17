# Data-source inventory

Status verified by live probes on 17 Oct 2026 12:13 and (Batch 3 feeds) ~13:40 Zurich time (UTC+2) and by the source-health registry after deploy.
Live state: `GET /api/sources/health`. All sources are free and keyless. No paid service is used.

| Source id | What | Endpoint | Class | Used for | Verified 17 Oct | Freshness budget | Notes |
|---|---|---|---|---|---|---|---|
| yahoo_markets | Yahoo Finance chart API, 21 symbols | query1.finance.yahoo.com/v8/finance/chart | established market data (unofficial API) | market snapshots, history, movers, forecasts, resolution | 200; **BUND.DE returns price 0** | 80 h (weekends) | Rate-limits rapid calls (empty body / 429). Critical input |
| rss_cnbc | CNBC Top News RSS | search.cnbc.com …id=100003114 | reputable news | events, scenarios | 200 | 24 h | ≈95 % of events before Batch 3; concentration now measured on `/data-quality` (7 d / 30 d share, HHI) |
| rss_federal_reserve | Fed press releases | federalreserve.gov/feeds/press_all.xml | official | events | 200 | 7 d | |
| rss_ecb | ECB press | ecb.europa.eu/rss/press.html | official | events | 200 | 7 d | |
| rss_imf | IMF news | imf.org/en/News/RSS | institutional | events | **403** | 14 d | Kept enabled; circuit breaker backs off (owner decision) |
| rss_reuters | Reuters business | feeds.reuters.com | news | events | **DNS fails** | — | **Disabled** 17 Oct (retired host, 0 events ever stored) |
| ust_yield_curve | U.S. Treasury daily par yield curve CSV | home.treasury.gov …daily_treasury_yield_curve | primary official (public domain) | corroboration of US10Y; official 2Y context | 200 (16 Oct: 2Y 4.74, 10Y 5.09) | 5 d | **New in Batch 1** |
| bundesbank_yields | Bundesbank 10Y Bund yield (BBSIS …R10XX) | api.statistiken.bundesbank.de | primary official (attribution required) | official DE10Y yield; corroboration | 200 (16 Oct: 3.45 %) | 5 d | **New in Batch 1** |
| coinbase | Coinbase Exchange public ticker | api.exchange.coinbase.com | established market data | crypto prices (corroboration) | 200 | 24 h | Scheduled `crypto` job (~6 h) since Batch 2 |
| coingecko | CoinGecko simple/price, global; **Batch 2:** `/coins/markets` top 1,000 (FDV, ATH, 7d/30d), `/coins/list?include_platform=true` (contracts, daily), category markets for 6 categories (daily), `/coins/{id}/market_chart` 90 d (rotating) | api.coingecko.com | secondary aggregator | crypto profiles, crypto_risk_v2, high-risk list | 200 (17 Oct: 19 calls, no 429) | 24 h | Scheduled `crypto` job (~6 h), ~7 s pacing, 429 stops the run, ≤2 retries |
| coingecko_project | CoinGecko coin detail | api.coingecko.com | secondary aggregator | project metadata | 200 | 7 d | Runs inside the `crypto` job (few ids) |
| defillama | DefiLlama protocols | api.llama.fi/protocols | secondary aggregator | TVL; protocol → CoinGecko id map (Batch 2) | 200 | 24 h | `crypto` job; 9 MB response |
| defillama_hacks | DefiLlama hacks database | api.llama.fi/hacks | secondary aggregator | crypto security incidents (crypto_risk_v2 security factor) | 200 (17 Oct: 1,306 records) | 3 d | **New in Batch 2.** Attached only via protocol `gecko_id`, never by ticker; absence of a record is not evidence of safety |
| rss_snb | SNB press releases | snb.ch/public/en/rss/pressrel | primary official | events, assessments (region CH) | 200, 20 items | 45 d | **New in Batch 3** |
| rss_bis | BIS press releases (incl. Basel Committee) | bis.org/doclist/all_pressrels.rss | primary official (international) | events (GLOBAL) | 200, 10 items | 21 d | **New in Batch 3** |
| rss_sec | SEC press releases | sec.gov/news/pressreleases.rss | primary official (regulator) | events, crypto regulatory-action category (identifier only) | 200, 25 items | 14 d | **New in Batch 3.** SEC fair-access policy asks for a contact in the User-Agent; the app UA has none (owner decision) |
| rss_boe | Bank of England news | bankofengland.co.uk/rss/news | primary official | events (UK) | 200, 50 items | 14 d | **New in Batch 3** |
| rss_boj | Bank of Japan what's new | boj.or.jp/en/rss/whatsnew.xml | primary official | events (JP) | 200, 51 items | 14 d | **New in Batch 3** |
| rss_boc | Bank of Canada press releases | bankofcanada.ca/content_type/press-releases/feed/ | primary official | events (CA) | 200, 10 items | 60 d | **New in Batch 3** (publishes rarely) |
| rss_cftc | CFTC general press releases | cftc.gov/RSS/RSSGP/rssgp.xml | primary official (regulator) | events, crypto regulatory-action category | 200, 10 items | 30 d | **New in Batch 3** |
| rss_fsb | Financial Stability Board | fsb.org/feed/ | primary official (international) | events (GLOBAL) | 200, 10 items | 30 d | **New in Batch 3** |
| (probed, not added) BLS, BEA, Eurostat, Treasury/OFAC, Destatis, OECD, World Bank, SNB news | — | — | — | — | 403 / 406 / 404 | — | Not reachable from this host with a non-browser client (17 Oct ~13:40) |
| (probed, not added) BIS speeches, Fed monetary, ECB statistics, ONS, ESMA | — | — | — | — | 200 | — | Speeches (not decisions), duplicates of existing feeds, calendar notices, or no publish dates |
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

## Batch 3 official feeds
All eight feeds were checked with the app's own parser (item count, publish dates, titles) before being added. Evidence is in
`calibra-dev-batch3-*/evidence/feed-probe.txt`. Each is tier 1, health-tracked in `source_health` with a per-feed freshness
budget (14–60 d, because official feeds publish rarely), and capped at 8 items per run like the other feeds. Events carry
provenance (feed URL, retrieval time). Region tagging uses the issuer (see `docs/event-intelligence-methodology.md`).
