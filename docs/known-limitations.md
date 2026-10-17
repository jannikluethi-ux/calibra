# Known limitations

Updated 17 Oct 2026 (Batch 2), Zurich time (UTC+2).

## Hosting
* The current host (Grok Bot box) hibernates when idle. While paused, no scheduler job runs, so markets/events can be hours old.
  The data-quality label (`/api/data-quality`) reports this as `stale` instead of `live`. Migration is deferred (see roadmap).

## Data
* **DE10Y** has no valid market value: Yahoo `BUND.DE` returns price 0. The snapshot shows "missing"; 1,312 historical zero rows
  are kept, flagged in `data_quality_flags`, and ignored by history reads and forecast resolution. The official Bundesbank yield
  is collected for corroboration only.
* **US2Y** is a proxy (13-week bill `^IRX`), not a 2-year yield. The official Treasury 2Y is shown for context in the data-quality summary.
* **Crypto** (Batch 2): the top 1,000 CoinGecko coins refresh about every 6 h via the in-app `crypto` job, only while the box is awake.
  About 55 coins that left the top 1,000 since the 4 Oct universe sync keep their last values; they are scored but marked **stale**
  (filter "stale" on `/crypto/high-risk`). The 20,830 list-only coins are not scored.
* **Crypto risk (crypto_risk_v2)**: weights and thresholds are expert-designed and **not validated**. About 43 % of the model
  weight (holder concentration, governance, regulatory, transparency) has no free source and is always UNKNOWN, plus security for
  assets not mapped to a DefiLlama protocol, so confidence is typically low/medium. Volume and market cap are aggregator-reported
  (no order-book depth; wash trading not detected). Category membership only covers the top 250 per category (absence = unknown).
  USD-stablecoin detection is a name/category heuristic. Daily price history accumulates gradually (BTC, ETH + ~6 coins per run),
  so volatility, drawdown and BTC/ETH correlation are UNKNOWN for most coins at first; the reported 30-day change is used as a
  labeled fallback. CoinGecko occasionally reports implausible values (e.g. +57,000 % 30-day change, FDV in the trillions for a
  $20M coin); they are shown as reported, not corrected.
* **Crypto events**: linked news still uses the existing name/unique-symbol matcher; contract-verified event linking is Batch 3.
* **Events**: ≈96 % of recent events come from CNBC; IMF returns 403; Reuters is disabled (host retired). Fed and ECB publish rarely.
* Event provenance exists only for events ingested after 17 Oct 2026 (pre-existing events have none; it is not invented).
* Event times: when an RSS item has no publish date, the retrieval time is used for sorting and the publish time is recorded as missing.
* Carried-forward market values (quality `cached`) are the last valid quote, unchanged; they are never written to history or used as forecast origins.

## Methods
* Event clustering (event_cluster_v1) is headline-based and conservative. It links only clear re-headlines within 48 h; it never
  merges or deletes events. It can link a story and its direct follow-up (e.g. "X to announce" / "X announces") and can miss
  paraphrases. Links can be audited in `event_cluster_history` and removed without data loss.
* Scenario weights express uncertainty, not trading instructions. Impact scores and transmission mechanisms are heuristic estimates.
* 20 resolved live forecasts (mean Brier 0.151, direction accuracy 0.65) are too few for any claim of predictive skill.

## Operations
* Monitor/uptime scripts still contain hard-coded `/workspace` paths.
* Backups are verified but stored on the same disk as the database.
