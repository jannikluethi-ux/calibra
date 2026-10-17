# Development roadmap

Updated 17 Oct 2026 (end of Batch 2), Zurich time (UTC+2). Commits are local only; pushing is the owner's decision.

## Priorities
1. **Data quality and source reliability** (Batch 1, done except items listed under "In progress").
2. **Crypto intelligence** (Batch 2, done; see below).
3. Forecast/scenario quality and evaluation (larger resolved sample before any performance statement).
3a. **Event intelligence** (proposed Batch 3, see end).
4. Product/UX: provenance shown on event and asset pages (data-quality page done in Batch 2).
5. Hosting migration (deferred, see checklist below).

## Completed in Batch 1
| Item | Commit(s) |
|---|---|
| Verified SQLite backup tool (backup API, integrity + row-count check, sha256 manifest) | 54cdd81 |
| Boot race: wait for unfinished restore (bounded, rc 4), fail safe if lib-maintenance.sh is missing, derived paths | c1f3f34 |
| `/crypto/coverage` page restored and deployed (404 → 200) | file restored from HEAD; deployed with a86e2df+ |
| Source-health registry, error classes, retry/back-off, breaker, isolation | 7fdc2f6 |
| Data-quality summary + non-destructive invalid-price flags | c962084 |
| Markets: zero price rejected, no demo substitution, carry-forward labeled cached, history only fresh valid quotes | 72a8c5f |
| RSS: isolated ingestion, provenance on new events, no demo top-up, Reuters disabled | ac3cefc |
| Official keyless sources (Treasury, Bundesbank) + crypto sync health/isolation | b1403d9 |
| Conservative event clustering (event_cluster_v1), scenario inputs skip duplicates | e8d4b99, a565f3b |
| Jobs wired; `GET /api/data-quality`, `GET /api/sources/health`; UI shows degraded/stale in amber | 160e157, a86e2df |
| 32 unit tests (`npm run test:unit`) | across the above |

## Completed in Batch 2 (crypto intelligence)
| Item | Commit(s) |
|---|---|
| Additive crypto tables, paced CoinGecko/DefiLlama market sync (FDV, ATH, contracts, categories, hacks, daily history), time-bounded 429 guard | 52bf21a |
| `crypto_risk_v2`: transparent 10-factor model, basis labels, unknown ≠ safe, score vs confidence, structural vs volatility, append-only history, research_v1 archived | 12b58dd |
| Scheduler job `crypto` (~6 h, ≤2 retries, never triggers derive) | 1aadfcf |
| `/crypto/high-risk` (views, data-backed filters, sort, search, URL state), explainable `/crypto/[id]` profile, `/crypto/methodology`, `/data-quality`, `/api/crypto/high-risk`, separate Crypto nav | bb903a0 |
| Data-quality summary uses crypto snapshots and v2 scores | 851ce81 |
| 27 new unit tests (59 total) | 7c1d5f0 |
| Methodology and docs | docs commit |

Crypto development plan and verified gaps: `docs/crypto-risk-methodology.md` §11.

## In progress / not done in Batch 1
* ~~Data-quality page in the UI~~ (done in Batch 2: `/data-quality`).
* Provenance is stored on new events but not yet shown on event pages.
* Existing (pre-Batch 1) events have no provenance block; it is not back-filled because original retrieval times are unknown.

## Owner decisions needed (blockers)
1. Push the local commits to GitHub (`main`)?
2. DE10Y: the 1,312 zero-price history rows are kept and flagged. Quarantine/delete them? Replace the `BUND.DE` proxy with the
   Bundesbank yield as the DE10Y series (changes units from ETF price to yield %)?
3. ~~Schedule the crypto source sync~~ Decided 17 Oct: in-app scheduler job `crypto` (done in Batch 2).
4. IMF RSS returns 403 to this host: keep with back-off, or remove?
5. US2Y is a 13-week bill proxy: switch to the official Treasury 2Y for display and resolution (affects open forecasts)?
6. The 15 Oct one-shot dedupe deleted 19,543 events; Batch 1 keeps that history as is (no restore attempted).

## Deferred hosting work
The Grok Bot box hibernates when idle (32 resumes, 7,561 s paused on 16–17 Oct; root-cause report in
`/workspace/calibra-hosting-rootcause-20261017T114723/`). The scheduler cannot run while the box is paused, so freshness gaps
are expected and are now reported honestly by the data-quality label. No keep-awake traffic, hosting changes or migration were
done. Readiness: **AMBER**.

### Migration checklist (from owner-host-migration-readiness.md, updated)
- [ ] Always-on host (VM/container), Node 20, persistent disk for SQLite (2 vCPU / 2–4 GB likely enough; validate).
- [ ] Process manager (systemd / pm2 / container restart policy) replacing `boot-hook.sh` + `ensure-prod.sh`.
- [x] Boot race fixed in repo (restore wait, fail-safe guard load), so it is not carried across (c1f3f34).
- [~] Hard-coded `/workspace` paths: boot-hook, ensure-prod and lib-maintenance now derive paths; monitor/uptime scripts still hard-code.
- [ ] Secrets re-created as env vars on the target (names in `.env.example`); never copied through chat or logs.
- [ ] Domain + TLS (reverse proxy or named tunnel) instead of the quick tunnel.
- [ ] Alerts through a real channel and an external uptime monitor (replace chat-based outbox and Grok Bot routines).
- [~] Backups: `scripts/backup-db.py` produces verified backups; still on the same disk. Needs off-host schedule + restore test.
- [ ] Remove platform-only pieces (`/tmp/sand-copy-in-status.json` wait becomes a no-op off the platform; `SAND_*` vars).
- [ ] Packaging/CI (Dockerfile or deploy script, run `npm run test:unit` + bash tests).
- [ ] Cut-over: freeze writes, online backup, verify integrity + row counts, switch DNS, keep the box as dev/test.

## Risks
* Single dominant news source (CNBC ≈96 % of 30-day events) biases scenarios.
* Yahoo is an unofficial API; rate limits or schema changes would make markets stale (now detected, not hidden).
* Event clustering may still miss same-story pairs (false negatives are preferred) or link related follow-ups; links are reversible.
* 20 resolved forecasts are not enough to judge skill; do not market performance.

## Next tasks (proposed Batch 3: Priority 3 event intelligence)
* Show stored event provenance (source, retrieval time, claim type) and cluster membership on event pages.
* Contract/CoinGecko-id verified crypto ↔ event linking (replace name/unique-symbol matching; ticker collisions never link).
* Event taxonomy for crypto risk events (exploit, de-peg, delisting, regulatory action, unlock) feeding a *qualitative* factor with
  evidence links, kept separate from the measured factors.
* Source diversification to reduce the ≈96 % CNBC share (free, keyless official/institutional feeds only).
* Event freshness and duplicate-rate metrics on `/data-quality`.
* Start the crypto_risk_v2 validation log (record de-pegs/exploits/delistings as outcomes for the planned backtest).
