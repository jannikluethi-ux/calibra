# Calibra — Design Brief v1 (competitive audit)
_Prepared 2026-10-16. Research + brief only; no UI code changed._

## Executive summary (2-minute read)
- **What winners have in common:** one clear promise above the fold, a single "hero object" that shows the product working (Metaculus: a live probability card; Glassnode: a regime answer "Risk On / Risk Off"; Polymarket: a % with a sparkline), proof numbers (Metaculus "4.46M predictions · 12+ years"; Glassnode "1,700+ metrics · 15+ yrs"), and press/customer logos. Craft leaders (Linear, Mercury, Stripe) win on restraint: one accent, big confident type, generous space, no chrome noise.
- **Where Calibra stands:** honest, distinctive *philosophy* (Observed → Interpreted → Estimated, "never invent data") that no competitor states as clearly. But the live app currently greets a first visitor with **"Quality INSUFFICIENT · Markets never · Events never · 0 snaps"**, a 24-link sidebar, and stacked panels of equal weight. It reads like an internal research terminal, not a product someone pays for.
- **The opportunity to EXCEED peers:** be the only product that makes *uncertainty itself beautiful and legible* — calibrated ranges, scenario weights, a public track record (Brier/calibration plot), and provenance on every number. Prediction markets show a single %; terminals show raw data; nobody shows "how sure, why, and how often we've been right."
- **Top 3 moves:** (1) a real landing/home with one hero "Today's probability picture" + track-record proof, (2) a calm 5-section shell replacing the 24-link sidebar, (3) a unified "uncertainty component kit" (range bars, scenario weight stacks, confidence chips, provenance footnotes) used everywhere.
- **Blocker before any visual work:** the data pipeline must show non-empty, fresh data in demo/prod; an "INSUFFICIENT/never" state on first load kills conversion regardless of design. Design a proper honest empty/stale state, but don't ship the first impression in it.

## 1. Competitive landscape
| # | Product | URL (fetched) | Category | Steal | Avoid |
|---|---|---|---|---|---|
| 1 | **Metaculus** | https://www.metaculus.com | Forecasting | Question cards: title → big % → "4% today" delta → forecaster count. Multi-outcome distributions as simple % rows. Proof stats strip + press logos. | Emoji-heavy topic chips; dense infinite feed |
| 2 | **Polymarket** | https://polymarket.com | Prediction market | Probability as the hero number; card grid w/ sparkline; topic tabs; very fast scan. | "Profit from your knowledge" / buy-sell buttons — the exact advisory framing Calibra must not have |
| 3 | **Glassnode** | https://glassnode.com | Crypto intel | Proof numbers ("1,700+ metrics, 1,500+ assets, 15+ yrs"); metric glossary cards with one-line definitions; one daily regime answer; "data layer → Studio/Research/API" product architecture story. | "Know when to step aside" = borderline advice; marketing-heavy repetition |
| 4 | **Koyfin** | https://www.koyfin.com | Bloomberg-lite | Persona sections (Advisors / Research teams / Individuals); testimonials w/ titles ("used Bloomberg… Koyfin comparable"); theme choice; macro dashboards as curated presets. | Generic copy, carousel of asset classes |
| 5 | **TradingView** | https://www.tradingview.com | Charting / social | Huge confident H1 ("Where the world does markets"); product screenshots as the hero; social proof at scale. | Trading-first framing |
| 6 | **MacroMicro** | https://en.macromicro.me | Macro data | Chart-of-the-day storytelling; cycle framing; country/indicator nav. | Visual clutter, ads-like density |
| 7 | **Visual Capitalist** | https://www.visualcapitalist.com | Data storytelling | One striking visual per story; shareable editorial cards — model for Digest share images. | Infographic maximalism |
| 8 | **Quiver Quant** | https://www.quiverquant.com | Alt-data retail | Unique-dataset hero ("Trade like an insider") — differentiation by dataset. | Hype headline, advisory tone |
| 9 | **Unusual Whales** | https://unusualwhales.com | Flow data | Fluid clamp() display type, fade-up motion, AI assistant ("Mr. Whale") positioning. | Retail hype; "spot institutional moves" |
| 10 | **Arkham / Nansen** | https://www.arkhamintelligence.com · https://www.nansen.ai | On-chain intel | Entity labels + proof ("500M+ labeled addresses"); dark, high-contrast data UI. | "Trade everything onchain" execution framing |
| 11 | **Linear** | https://linear.app | Craft bar | Restraint, tight type, subtle gradients, keyboard-first shell, ⌘K. | — |
| 12 | **Mercury / Stripe** | https://mercury.com · https://stripe.com | Fintech craft bar | Trust via calm: whitespace, one accent, precise numerals, clear security/compliance footers. | — |

Not fetched: **Kalshi** (Vercel checkpoint 429), **GeoQuant** (403). Glassnode/Metaculus blocked curl (403) but fetched OK via WebFetch. Predata (acquired, no live marketing) not reviewed. Visual/motion notes on JS-rendered pages are inferred from HTML/markup, not screenshots.

### Patterns across the field
- **Information hierarchy:** promise → hero object → proof numbers → use cases/personas → logos/testimonials → pricing CTA. Apps: one primary number per card, delta, context line, source.
- **Trust:** quantified history (years, counts), named testimonials, press logos, methodology/glossary pages. **No one publishes calibration publicly as a hero** — Calibra's opening.
- **Uncertainty visuals:** mostly single % (Polymarket/Metaculus), distributions as % rows, binary regime answers (Glassnode). Ranges/intervals are rare.
- **CTAs:** one primary ("Get started/Sign up free"), one secondary ("See pricing"/"Book demo"). Calibra currently has none on home.
- **Mobile:** card grids collapse to single column; sticky top bar; nav in a sheet. Calibra's sidebar becomes a 38vh scroll box on mobile — a debt.

## 2. "Good enough" vs "wins first customers"
| Good enough (parity) | Wins first customers (exceed) |
|---|---|
| Dark UI, panels, badges | A signature visual language for uncertainty (range bars, scenario stacks) instantly recognisable as Calibra |
| Methodology page exists | **Public track record above the fold**: calibration plot + Brier score + "N forecasts resolved" |
| Data shows with timestamps | Every number has a provenance chip (Observed/Interpreted/Model/Estimate + source tier + age) on hover |
| Lists of events/warnings | One daily narrative: "What changed overnight, what it shifts, how confident" — shareable |
| Empty states exist | Honest *and* attractive empty/stale states, never as first impression |
| Pricing page | Persona-framed value + one primary CTA + sample digest by email |

## 3. Calibra current state (from code + live :3456)
**Strengths**
- Distinctive, honest principles in copy: "Observed → Interpreted → Estimated", "Prefer uncertainty over false precision", empty states that refuse to invent signals.
- Coherent dark palette (`terminal.*` tokens: bg #101614, teal #3dbeab, amber #e4b15c), display/UI/mono font split, `num` class for numerals, card/glow shadows.
- Scenario framing (Base/Bull/Bear/Tail %), source tier badges (T1..), quality badges — good primitives.

**Design debts (ranked by impact)**
1. **First load shows INSUFFICIENT / "never" / 0 snaps** in status bar and gauges (seen on every route). Fatal for conversion.
2. **No landing / value proposition**: `/` is the dashboard; hero is a dense paragraph + "research terminal" badge; no CTA, no proof.
3. **Sidebar has 24 links in 5 groups** (incl. two "Assets", Scheduler, API Docs in primary nav). Cognitive overload; mobile becomes 38vh scroll box.
4. **Flat hierarchy**: RiskGauges → MoversBoard → MarketCards → 3 equal panels; nothing is "the answer of the day".
5. **Probabilities rendered as text strings** ("Base 40% · Bull 25% · …") — no visual encoding of weight or uncertainty.
6. **No visible track record** on home; methodology buried in Reference group.
7. Jargon labels ("Elevated Prob.", "Derive", "T2", "conf 62%") without inline explanation.
8. Small type dominance (2xs/xs everywhere), low contrast muted (#7d8b84 on #101614 ≈ 4.6:1 OK but dim-on-panel borderline).
9. Status bar/terminal cosplay elements compete with content.

## 4. Visual system
**Type** (UI: Inter/var(--font-ui); display: current display font; numerals: tabular `font-variant-numeric: tabular-nums` in UI font, mono only for codes/IDs)
| Token | Size/LH | Use |
|---|---|---|
| display-xl | 48/52, -0.02em, 600 | Landing H1 (clamp 32→48) |
| display-l | 32/38, 600 | Page titles |
| title | 20/28, 600 | Section / card hero |
| body-l | 16/26 | Narrative (Digest) |
| body | 14/22 | Default UI |
| caption | 12/16 | Meta, provenance |
| micro | 11/16, uppercase 0.06em | Labels only — max 1 per card |
| metric-xl | 40/44 tabular, 600 | The hero probability |
| metric | 24/28 tabular | Card numbers |

**Color tokens** (keep base, add semantics; one accent)
- Surfaces: `bg #0E1412`, `surface-1 #141C19`, `surface-2 #1A2420`, `border #26332E`, `border-strong #34443D`
- Text: `text #E9F0EB`, `text-2 #B0BDB6`, `text-3 #83918A` (≥4.5:1 on surface-1)
- Accent (brand, interactive only): `teal #3DBEAB`
- Epistemic layer (Calibra signature, used for provenance not sentiment): `observed #A8C7FA` (blue), `interpreted #C3B5F0` (lilac), `model #E4B15C` (amber), `estimate #8FD0C4` (teal-light, dashed outlines)
- Scenario weights: `base #8FA39A`, `upside #3DCC9A`, `downside #F07167` at 70% saturation, `tail #B07CE0`. **Downside red = scenario weight, never a "sell" signal** — always paired with the word "Downside scenario".
- Data quality: `fresh`, `stale` (amber), `insufficient` (neutral grey — not red; honesty isn't an error).
**Spacing:** 4-pt base; scale 4/8/12/16/24/32/48/64. Card padding 20 (desktop) / 16 (mobile); section gap 32; page max-width 1280 content, 720 for narrative.
**Elevation:** 0 = flat bg; 1 = surface-1 + 1px border; 2 = surface-2 + inset highlight + shadow `0 8px 24px rgba(0,0,0,.28)` (popovers, hero card); 3 = modal + backdrop blur. Drop glow shadows except focus rings.
**Radius:** 6 (chips), 10 (cards), 14 (hero/modals).
**Motion:** 120ms (hover), 200ms (expand), 320ms ease-out (page/section enter, opacity+4px rise). Number changes tween ≤400ms. No pulsing "live" dots, no ticker scroll. Respect `prefers-reduced-motion`.
**Signature components (build once, use everywhere)**
- `ProbabilityRange` — point estimate + interval bar (e.g. 34% [22–47]).
- `ScenarioStack` — 100% horizontal stacked bar Base/Upside/Downside/Tail with labels.
- `ProvenanceChip` — O/I/M/E letter + source tier + age; hover shows source and chain.
- `CalibrationPlot` — reliability diagram + Brier, only from resolved real forecasts.
- `DeltaSince` — "▲ 6 pts since yesterday" with reason link.
- `HonestEmpty` — illustration-free, explains what's missing and when it'll fill.

## 5. Page-by-page priorities
1. **Shell (P0):** 5 top-level sections — Today (Dashboard+Digest), Scenarios, Markets (Explorer, Assets, Countries, Crypto), Alerts, Track record. Everything else (Scheduler, API docs, Simulator, Portfolio, Analyst) in ⌘K palette + account menu. Slim top bar with global data-freshness pill (single, calm) instead of status-bar dump. Mobile: bottom tab bar (5 items).
2. **Home (P0):** Logged-out = landing: H1 promise ("Probabilities, not predictions. Calibrated, traceable, never certain."), hero object = live "Today's probability picture" (3 ScenarioStacks on top macro questions), proof strip (resolved forecasts, Brier, sources, years), "How we know" O→I→M→E diagram, persona row, sample digest signup, pricing CTA, non-advisory footer. Logged-in = "Today": one lead card "What changed overnight", then 3–5 elevated scenarios, then watch items; gauges demoted to a compact strip.
3. **Digest (P0):** editorial layout (720px), headline + 3 changes, each with DeltaSince + ScenarioStack + provenance; share card image (Visual Capitalist-style) and email version.
4. **Methodology / Track record (P1, conversion-critical):** promote to top nav. Calibration plot, resolved forecast log (with misses shown), glossary of every badge. Only real resolved data; if N is small, say so ("12 resolved — too few to judge calibration").
5. **Alerts (P1):** frame as "Notify me when the probability of X crosses Y" — threshold on a scenario, not on price. Clear cadence, preview of message, quiet design.
6. **Market Explorer (P2):** table-first with ScenarioStack column, filters as chips, row → side sheet detail (not new page). No candlestick charts.
7. **Crypto (P2):** merge 5 sub-pages into one page with tabs; "High-risk research" renamed "Higher-uncertainty assets" with explanation; borrow Glassnode's metric-definition cards.

## 6. Explicit DO NOTs
- No fake, placeholder, or "illustrative" charts/numbers anywhere, including marketing. Hero must use live or clearly-labelled real historical data.
- No advisory language: no buy/sell/trade/profit/"act now"/"smart money"/"know when to step aside". Use "scenario weight", "probability shifted", "worth watching".
- No green/red as good/bad verdicts on assets; no price tickers scrolling; no order-book or candlestick cosplay.
- No Bloomberg cosplay: no amber-on-black monospace walls, no 6-pane grids, no blinking "LIVE".
- No single-point probabilities without uncertainty context where an interval exists.
- No hiding misses in the track record. No testimonials or logos we don't actually have.
- Don't show "INSUFFICIENT / never" as the first thing a new visitor sees — fix data, then design the honest empty state.
