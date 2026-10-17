# Crypto risk methodology: `crypto_risk_v2`

Status: introduced in Batch 2 (October 2026). Code: `src/lib/crypto/risk-v2.ts` (pure model),
`src/lib/crypto/risk-store.ts` (inputs, persistence, queries), `src/lib/crypto/market-sync.ts` (data).
The constants in the code are the source of truth. This document is kept in sync with them, and the
in-app page `/crypto/methodology` renders the factor table straight from the code.

> **Not advice.** The score describes risk characteristics that the data supports, and how uncertain
> they are. It is **not** a buy, sell or hold recommendation, **not** a trading signal, and **not** a
> validated predictor of losses or failure. The weights and thresholds are **expert-designed and not
> validated** against outcomes.

## 1. Purpose and scope

The model answers one question: *what ways can this asset fail, or be hard to exit, according to the
data we actually have?* A high score means more structural fragility. It does not mean the price will fall.

It covers all crypto instruments with a live CoinGecko quote and a positive price, about 1,000 assets
(the top 1,000 by market cap). The 20,830 list-only rows are not scored.

## 2. Inputs, sources and basis labels

| Input | Source (free, keyless) | Basis label |
|---|---|---|
| Price, market cap, FDV, 24h volume, 24h high/low, 24h/7d/30d change, supplies, ATH, rank, provider timestamp | CoinGecko `/coins/markets` (4 pages × 250, every ~6 h) | reported |
| Daily closes (90 d) | CoinGecko `/coins/{id}/market_chart` (BTC and ETH every run, then up to 6 more coins per run by staleness and market cap) | measured (the stored closes); volatility, drawdown and correlation derived from them are model-derived |
| Network and contract per coin | CoinGecko `/coins/list?include_platform=true` (daily) | reported |
| Category membership | CoinGecko `/coins/markets?category=…` for stablecoins, meme-token, layer-1, decentralized-finance-defi, wrapped-tokens, liquid-staking-tokens (top 250 each, daily) | reported (absence means unknown) |
| Protocol to coin mapping | DefiLlama `/protocols` (`gecko_id` field, existing adapter) | reported |
| Security incidents | DefiLlama `/hacks` (daily) | reported |
| Price corroboration | existing consensus (`canonical_fields`: CoinGecko and Coinbase) | corroborated when 2+ sources agree |

Every factor carries one of these labels: **measured**, **reported**, **corroborated**,
**model-derived**, **qualitative** or **unknown**. `qualitative` is reserved and no v2 factor uses it yet.
The detail page shows the label, the evidence, an as-of time and the source for each factor.

**Identity.** Assets are keyed by CoinGecko id (`crypto:coingecko:<id>`), plus network and contract
where known. A ticker is never used as an identifier. Ticker collisions are counted and shown, for
example JPYC ×3, XAI, VELO, USDX and SAFE. Security incidents attach only through DefiLlama protocol
`gecko_id`, never through a ticker.

## 3. Factors, normalisation and weights

Each factor yields an integer from 0 to 100 (higher means riskier) or **UNKNOWN**. The thresholds are
step functions, chosen for readability rather than fitted to data.

| Factor | Weight | Structural | Rule |
|---|---|---|---|
| Market / volatility | 0.15 | no | 30-day realised volatility, annualised, from at least 20 daily closes: <40% → 15, <70 → 35, <100 → 55, <150 → 75, otherwise 90. Without history, \|30d change\| is used: <10% → 20, <25 → 40, <50 → 60, <100 → 80, otherwise 90 (reported). Distance from ATH is context only. |
| Liquidity | 0.20 | yes | Turnover = 24h volume / market cap: ≥5% → 10, ≥1% → 30, ≥0.2% → 55, ≥0.05% → 75, otherwise 90. Small-volume floors: <$100k → at least 85, <$1M → at least 65, <$10M → at least 40. Deep-volume caps: ≥$1B → at most 15, ≥$100M → at most 30, ≥$25M → at most 45. With no market cap, only the small-volume floors apply. |
| Market size (fragility) | 0.10 | yes | Market cap <$10M → 85, <$50M → 65, <$250M → 45, <$1B → 30, otherwise 15. |
| Tokenomics / dilution | 0.15 | yes | Ratio = mcap/FDV, otherwise circulating/max, otherwise circulating/total: ≥0.9 → 10, ≥0.7 → 25, ≥0.5 → 45, ≥0.3 → 65, ≥0.15 → 80, otherwise 92. Unlock schedules are UNKNOWN. |
| Security / protocol incidents | 0.15 | yes | Only for assets mapped to a DefiLlama protocol. Incident ≤365 days ago → 85 (65 if the loss was fully returned); incident 1–3 years ago → 60. No record, or not mapped → UNKNOWN. **No record is not evidence of safety.** |
| Stablecoin peg | 0.15 | yes | Applies only to USD stablecoins (in CoinGecko's stablecoins list, with USD/dollar in the name or symbol). \|price − 1\|: <0.5% → 10, <1% → 30, <3% → 60, <10% → 85, otherwise 95. |
| Holder concentration | 0.10 | yes | Always UNKNOWN: no free, keyless source. |
| Governance | 0.05 | yes | Always UNKNOWN: not sourced. |
| Regulatory | 0.10 | yes | Always UNKNOWN: no structured free source. Absence is not clearance. |
| Transparency | 0.05 | yes | Always UNKNOWN: not sourced. |

**Aggregation.** score = round(Σ wᵢ·sᵢ / Σ wᵢ) over the applicable factors that have a score.
Unknown factors are left out of both sums, so they neither raise nor lower the score.
Coverage = scored applicable weight / applicable weight.

## 4. Bands, risk type and the high-risk list

- Bands: low 0–24, moderate 25–44, elevated 45–64, high 65–84, extreme 85–100. These are the same
  thresholds as research_v1.
- If coverage is below **0.35**, the band is **insufficient_data**.
- **Structural factor:** a structural factor with a score of 65 or more.
- **Risk type:** `structural` if any structural factor qualifies. `volatility_only` if only volatility is
  65 or more. Otherwise `none_flagged`, or `insufficient_data`.
- **Volatility alone never yields high or extreme:** without a structural factor, the band is capped at
  elevated.
- **High-risk list** (`high_risk = 1`): risk type is structural, and either the band is high or extreme,
  or there is a red flag (peg factor ≥ 60, or a security incident within the last year that was not
  fully returned).
- The list page also offers other views: any structural flag, volatility only, all scored assets, and
  insufficient data.

## 5. Confidence (separate from the score)

confidence = 100 × coverage × freshness × sources × history × identity, rounded. The parts are:

- **freshness:** market data ≤12 h old → 1, ≤36 h → 0.8, ≤72 h → 0.6, older → 0.3, no timestamp → 0.2.
- **sources:** price sources disagree → 0.7, 2 or more agreeing → 1, single source → 0.85.
- **history:** realised volatility available → 1, otherwise 0.85.
- **identity:** platform/contract list retrieved → 1, otherwise 0.9.
- **Labels:** high ≥ 70, medium ≥ 45, low below 45.

Because about 43% of the weight (holder concentration, governance, regulatory and transparency) is
always unknown, along with security for unmapped assets, typical confidence is **low to medium**. That
is intended.

## 6. Missing data policy

- Missing stays missing. A null input becomes UNKNOWN, with a reason. Nothing is imputed, defaulted or
  carried over from another asset.
- Warnings are raised when market cap, supply, FDV or volume is not reported, when the contract or
  platform is unknown, when the ticker is shared, when data is stale (>36 h), when there is only one
  price source, when sources disagree, and to give the share of model weight that is UNKNOWN.
- An unknown value is never displayed as safe or low.

## 7. Versioning and history

- `MODEL_VERSION = "crypto_risk_v2"`. Every run appends to `crypto_risk_scores`. A row is written when
  the score, band, type or confidence changes, and at least once every 24 h.
- `crypto_risk_latest` is a derived pointer to each asset's newest row, rebuilt every run.
- The earlier `crypto_risk_assessments` table (research_v1) is upsert-only. Before each v1 run, and after
  it, its rows are copied into `crypto_risk_scores` as `model_version = 'research_v1'`, which is
  idempotent per computed_at. Old assessments are therefore preserved and never rewritten.
- Any change to weights, thresholds or factors must bump `MODEL_VERSION`. Old rows stay as they are.

## 8. Update frequency

The in-app scheduler job **`crypto`** runs every ~6 h, inside the existing scheduler with its existing
lock and status page. It runs these steps in order:

1. The existing source adapters, consensus, research_v1 (archived) and coverage.
2. A paced CoinGecko sync, with about 7 s between calls and about 20 calls per run, well within the free tier.
3. Daily-gated steps: platforms, categories and DefiLlama hacks.
4. Rotating price history.
5. v2 scoring.

On a CoinGecko HTTP 429, CoinGecko calls stop for the rest of the run and are paused for 15 min. The
attempt is recorded as `rate_limited` in source health, and the job retries after ~1 h, at most twice,
before going back to the 6 h interval. Source back-off from the Batch 1 health registry also applies.
The job never triggers forecast derivation.

## 9. Known weaknesses

- The weights and thresholds are expert judgement and are **not validated**.
- Volume is aggregated and self-reported, and may include wash trading. There is no order-book depth
  or slippage data.
- Market cap depends on the circulating supply that projects report. FDV is unavailable for some coins.
- Category membership comes only from top-250 lists per category, so smaller assets show category UNKNOWN.
- Security coverage is limited to DefiLlama-listed protocols. CEX tokens, L1s and memecoins are
  usually unmapped and therefore UNKNOWN.
- No free sources exist for regulatory actions, holder concentration, audits, governance or unlocks,
  so these factors are always UNKNOWN.
- Price history builds up gradually, a few coins per run. Until 20 or more daily closes exist,
  volatility falls back to the reported 30-day change.
- The "market size" factor treats small caps as fragile. A small but healthy project can therefore
  score as structurally risky. Its evidence says why.

## 10. Validation approach (planned, not done)

No predictive validity is claimed. Planned checks, which need the stored history to accumulate first:

1. **Event backtest.** Do assets that later suffer a de-peg of more than 3%, an exploit in DefiLlama
   hacks, or delisting from the top 1,000 have higher prior v2 scores? Measure with AUC and precision
   at the high-risk cut-off, with confidence intervals.
2. **Stability.** Track band churn per run. Scores should not flip on noise.
3. **Sensitivity.** Perturb each weight by ±50% and report how many high-risk memberships change.
4. **Calibration of confidence.** Low-confidence rows should show larger score changes once more data arrives.
5. Any recalibration bumps the model version and is documented here.

## 11. Crypto development plan (from verified gaps, October 2026)

| Gap (verified in the Batch 2 audit) | Status in Batch 2 | Next step |
|---|---|---|
| Live crypto data was 13 days old: the universe sync was manual (last run 2026-10-04) | Scheduled `crypto` job refreshes the top 1,000 every ~6 h | Monitor rate limits; consider 6 pages if the budget allows |
| research_v1 overwrote history (PK instrument_id) | Archived to append-only `crypto_risk_scores` | — |
| v1 had 3 of 10 factors and no FDV, contracts, categories, incidents or history | v2 adds dilution, size, security, peg, volatility history, confidence and flags | Exchange-listing source (Coinbase products list is free) |
| No contract/network identity; ticker collisions | `crypto_contracts` from CoinGecko platforms; collisions shown | Contract-verified matching for news and events (Batch 3) |
| `blockchain` and `category` columns empty for all live coins | `crypto_categories` (6 categories) | More categories, if the rate budget allows |
| No security data | DefiLlama hacks via protocol `gecko_id` | Audit data (no free structured source known) |
| Watchlists: 0 rows; no crypto watchlist UX | Not changed | Crypto watchlist (later batch) |
| No regulatory, holder, governance or unlock data | Explicit UNKNOWN | Owner decision on any paid source (not allowed now) |
