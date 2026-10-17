# Event intelligence methodology (Batch 3)

Updated 17 Oct 2026, Zurich time (UTC+2). Model versions: `event_intel_v1` (assessment), `mech_rules_2026-10-17` (mechanism
rules), `event_map_v1` (instrument map), `conflict_v1` (conflicts), `scenario_v2` (scenarios), `crypto_event_factor_v1`.
Code: `src/lib/intel/`. Everything here is **rule-based and deterministic**. No language model writes analysis text.
Interpretation is always labelled **"interpretation (rule-based)"**. Nothing here is investment advice, and nothing claims that an
event causes, or will cause, a price move.

## 1. Observation vs interpretation
Each assessed event (`event_assessments`, append-only, unique on event + model version + input hash) has three separate parts:

| Part | Content | Source |
|---|---|---|
| **Observation** | Source name/tier, item URL, feed URL, publish and retrieval time, provenance fields, duplicate-group members | Stored event record (`events`, `event_cluster_*`). Missing fields are shown as "not recorded". They are not inferred |
| **Verified / uncertain** | Verified means the source published this headline at this time (UTC). Uncertain covers anything the text alone cannot establish: classifier sentiment, magnitude, whether a figure is preliminary | Fixed rules |
| **Interpretation (rule-based)** | Mechanisms, regions, industries, asset classes, why it may matter, competing interpretations, invalidation | Pattern rules below |

Every assessment carries the same disclaimer. It lists channels through which events of this kind are commonly discussed as
affecting markets, and it does not claim that the event caused or will cause a move. A unit test checks that interpretation and
scenario text contain none of "will cause", "caused the", "guarantee", "certainly", "buy", "sell".

## 2. Materiality rule
An event is **material** when **all** of these hold:
* it is live, not demo;
* it is the canonical member of its duplicate group;
* at least one mechanism matched in the text itself (classifier event type alone is not enough);

and **at least one** of these holds:
* the source is an official/primary feed (tier 1);
* 2 or more distinct sources are in its duplicate group;
* the impact composite is 50 or higher.

Non-material events still get an assessment that gives the reasons. They get **no scenario**, so no probabilities are made up.

## 3. Transmission mechanisms (13)
The mechanisms are inflation, rate expectations, growth, fiscal, trade, energy, supply chain, FX, credit, liquidity, risk appetite,
regulation and capital flows. Each one has:
* text patterns (case-sensitive for acronyms such as `Fed`, `US`, `ECB`; case-insensitive for words);
* exclusion guards. Examples:
  * "former employees" and "termination of enforcement action" don't count as regulation;
  * "euro banknotes" doesn't count as FX, because FX needs exchange-rate context;
  * "credit card" doesn't count as credit, because credit needs "credit spreads/markets/conditions".

Each mechanism also stores why it matters, its typical asset classes, its competing mechanisms, invalidation conditions,
indicators to monitor and its assumptions.

Regions come from text patterns, plus the issuing region of an official feed (SNB → CH, Fed/SEC/CFTC → US, and so on). "SNB
Bancshares" is excluded. Industries are tagged from a fixed keyword list.

## 4. Event → instrument mapping (`event_mapping`, table `event_instrument_mappings`)
**Audit of the legacy mapping.** `inferAssets` in the scenario engine attached instruments from keywords and sentiment alone. It is
no longer used for scenario v2. Pre-v2 rows keep the instruments they were stored with.

**Curated map (34 entries).** Each entry has: mechanism, regions, instrument, relation, horizon, confidence, and an optional
direction by sentiment. It also has requirements, assumptions, evidence limits and competing mechanisms.

Mapping rules:
* Only mechanisms matched in the text are used.
* The event's regions must overlap the entry's regions.
* A direction is given only when the classifier sentiment is directional with confidence ≥ 0.5, or the text states an explicit
  supply disruption. Otherwise the direction is "none (not supportable)".
* DE10Y and US2Y are mapped with their known data limits (DE10Y has no valid market value; US2Y is a 13-week-bill proxy).

**Crypto.**
* BTC is mapped only under US liquidity, by CoinGecko id `bitcoin`, at low confidence.
* Asset-specific links need an EVM contract address in the text that matches `crypto_contracts`, or an explicit CoinGecko id
  (a coingecko.com/coins/<id> URL or "coingecko id: <id>").
* A headline that mentions "Bitcoin" or a ticker is **not** a link and not a Bitcoin scenario.
* The older name/symbol news linker (`instrument_event_links`) now writes identifier links only. Its earlier name-based rows are
  kept in the table but not shown.

## 5. Conflicting evidence (`conflict_v1`, table `event_conflicts`)
**Factual conflicts** are different reported figures for the same metric:
* metrics: inflation rate, GDP growth, unemployment, policy-rate level, rate move in bp, deficit;
* both items must be in the same duplicate group, or share the same mechanism and region within 24 h;
* both figures must use the same period basis (YoY/MoM/QoQ) and the same core/headline flag;
* forward-looking figures and ambiguous figures are dropped;
* these conflicts are marked **verifiable** against the primary release.

**Interpretive conflicts** are opposite directional readings (hawkish vs dovish, risk-on vs risk-off) at classifier confidence ≥ 0.5,
within 48 h, on the same mechanism and region. They are marked **not verifiable**.

Each conflict shows both sides with source, tier and publication time, plus the time gap. Source quality and timing are context
only. **Resolution is always "unresolved"**: the system never picks the side that agrees with an existing forecast.

**Effect on a scenario:**
* 25 % shrink of weights toward equal per conflict (max 2 steps);
* an interpretive conflict cancels the sentiment tilt;
* confidence −15 per factual conflict and −10 per interpretive conflict, capped at −30.

Pre-v2 scenario rows are never changed. Pages: `/events/conflicts` and the conflicts section of `/events/[id]`.

## 6. Scenario v2 (`scenario_v2`)
Each material event gets one set of four paths: **base, upside, downside, tail**. Every path has a name, description, weight,
horizon, evidence, assumptions, drivers, instruments, impact mechanisms, indicators to monitor and invalidation conditions.
The set also records confidence, last update, DQ status (ok / limited / conflicted / stale), input hash, and the weight and
confidence steps applied.

**Weight rules.** Weights are relative among the listed paths. They are **not probabilities of occurrence, not exhaustive, and
separate from any expected return**.

| Rule | |
|---|---|
| W1 | Prior 50 / 20 / 20 / 10 |
| W2 | Directional sentiment (confidence ≥ 0.5) moves 10 points between upside and downside |
| W3 | Tail +5 when composite ≥ 70, or credit/liquidity is matched with risk-off |
| W4 | Shrink 25 % toward equal per conflict (max 2) |
| W5 | Integer normalisation to 100 by largest remainder |

**Confidence rules:**

| Rule | |
|---|---|
| C1 | Cap by source tier: 70 / 60 / 50 / 40 |
| C2 | Conflict penalty |
| C3 | Uncorroborated tier-3 item capped at 40 |
| C4 | −10 if the event is older than 7 days; floor 10 |

All steps are stored with the set.

**Storage and pre-v2 policy.**
* `scenarios.schema_version` was added by an additive `ALTER TABLE`. NULL means pre-v2.
* v2 rows have id `scn2-<eventId>` and also fill the legacy base/bull/bear/tail fields, so old readers still work.
* A row whose stored event already has a pre-v2 scenario is **left as stored**. It is shown with a **PRE-V2** badge and gets no
  v2 set.
* Each recomputation with new inputs appends a row to `scenario_v2_revisions`.

## 7. Crypto risk events and the event factor (`crypto_risk_event_log`, `crypto_event_factor_scores`)
| Category | Source | Rule |
|---|---|---|
| exploit | DefiLlama hacks | Only incidents mapped to an asset via protocol `gecko_id` |
| de-peg | Stored daily price history / CoinGecko snapshots | USD stablecoins ≥ 2 % **below** $1. Snapshot must be ≤ 7 days old. Above-peg (yield-bearing) is ignored |
| regulatory action | SEC / CFTC press items | Only with a contract address or CoinGecko id in the text |
| delisting | none | No free, keyless source: empty, shown as "no source" |
| unlock | none | No free, keyless source: empty, shown as "no source" |

**Event factor levels.**
* **high**: an exploit ≥ $10M net within 365 d, a severe de-peg (≥ 5 %) within 90 d, or a regulatory action naming the asset
  (by identifier) within 180 d.
* **elevated**: a smaller exploit within 365 d, or a de-peg of 2–5 % within 90 d.
* **noted**: older events.

This is a qualitative factor shown on `/crypto/[id]` with evidence links. It is kept **separate from `crypto_risk_v2`** and does not
change that score. A row is appended when the inputs change, and history is kept.

## 8. Outcome log (`crypto_outcome_log`)
The log records de-pegs, exploits and top-1000 exits, with the crypto_risk_v2 band at the time of logging, for a later backtest.
* A top-1000 exit is logged only after two consecutive complete syncs (≥ 900 rows each).
* No outcome is back-dated.
* Nothing is claimed about predictive value until the log has enough cases.

## 9. Data-quality metrics (`/data-quality`)
* **Event freshness per source:** configured feeds with no stored items are listed.
* **Source concentration** over 7 d and 30 d: top-source share, HHI and official share.
* **Duplicates:** groups and linked items.
* **Intelligence counts:** assessments, material events, mappings, conflicts, and v2 vs pre-v2 scenarios.

## 10. Limits
* Most CNBC items are classified "neutral", so few sets have a tilt. Weights mostly stay at the documented prior.
* Interpretive conflicts depend on the heuristic classifier.
* Mechanism patterns can miss paraphrases (false negatives are preferred).
* Official feeds publish rarely, so CNBC still dominates by volume.
