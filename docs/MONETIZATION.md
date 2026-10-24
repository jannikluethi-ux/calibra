# Calibra Monetization Foundation

> Draft internal plan. Pricing bands below are **suggested starting points for design-partner conversations**, not market research claims or committed list prices.

Calibra is **probabilistic market intelligence** — calibrated scenario probabilities, event transmission chains, and forecast track records. It is an **intelligence / research tool**, never investment advice, and never buy/sell recommendations.

---

## 1. Ideal customer profile (ICP)

**Primary (institutional desks first)**

| Segment | Buyer | Job-to-be-done |
|--------|--------|----------------|
| Macro / multi-asset research desks | Head of research, senior PM | Faster event → scenario → probability workflow with audit trail |
| Risk / market-risk teams | Risk officer | Elevated-probability boards + alerts on threshold breaches |
| Quant / systematic research | Quant lead | API for events, scenarios, movers, calibration metrics |
| Family offices / multi-strat pods | CIO / analyst lead | Shared terminal + portfolio impact sketches |

**Secondary (later):** boutique research shops, advanced retail power users — only after institutional packaging and compliance language are stable.

**Non-goals for v1 packaging:** retail day-trading signals, auto-execution, personalized portfolio advice.

---

## 2. Packaging: Free / Pro / API

| Capability | Free | Pro | API |
|------------|------|-----|-----|
| Dashboard + risk gauges | ✓ | ✓ | ✓ |
| Elevated-prob board | Delayed / top-N limited | Full live board | Full |
| Events feed | Last ~20, teaser | Full history + filters | Full via API |
| Scenarios / causal map | Teaser (3) | Full | Full via API |
| Forecasts + live calibration detail | Methodology teaser | Full calibration + resolved table | Full via API |
| Alerts (in-app) | Basic rules | Full + email channel + webhook | Same as Pro |
| Portfolio impact | — | ✓ | ✓ |
| AI Analyst / Simulator | — | ✓ | ✓ |
| Exports (CSV/JSON) | — | ✓ | ✓ |
| API keys | — | Optional limited key | Full keys + higher rate limits |
| Rate limits (API) | n/a | ~60 req / min / key | ~600 req / min / key |

---

## 3. Suggested CHF pricing bands (draft suggestions)

> **Label: DRAFT SUGGESTIONS ONLY** — not validated by pricing research. Adjust after design-partner interviews.

| Plan | Suggested band (CHF) | Notes |
|------|----------------------|--------|
| **Free** | CHF 0 | Self-serve signup; conversion funnel |
| **Pro** (seat) | **CHF 149–249 / seat / month** | Annual option ~2 months free (e.g. ×10) |
| **API** add-on or tier | **CHF 399–799 / month** (org) | Includes Pro seat features for key owner + higher limits |
| **Enterprise / desk pack** | Custom (from ~CHF 2.5k–8k / month) | SSO, VPC, SLA, dedicated sources — out of scope for demo checkout |

Local demo checkout upgrades the SQLite `users.plan` field without Stripe. Replace with Stripe Checkout when keys exist (see §7).

---

## 4. What is gated vs free

**Always free (public or logged-in Free):**

- Landing / dashboard overview
- `/methodology` diligence page (live calibration from Live cohort; SEED separated)
- `/pricing`, `/docs/api` documentation
- Limited elevated-prob preview + event teaser
- In-app alert rules (basic metrics; no email/webhook)

**Pro-gated (upgrade CTAs, not broken empty pages):**

- Full events / scenarios / map / forecasts calibration detail
- Portfolio, Analyst, Simulator, exports
- Alert email channel + webhook URL
- Optional limited API key

**API-gated:**

- Issuing full API keys with elevated rate limits
- Programmatic `/api/v1/*` at API-plan quotas

---

## 5. Compliance positioning

- Product copy: **intelligence tool / research terminal**, not a broker, not a robo-advisor.
- Forbidden framing: buy/sell, “guaranteed”, personalized investment recommendations.
- Required framing: Observed → Interpreted → Estimated; **prefer uncertainty over false precision**.
- Calibration marketing must separate **Live** cohort from **SEED** bootstrap; never conflate.
- Disclaimers appear on pricing, movers, forecasts, alerts, and API docs.
- Users remain responsible for their own decisions; Calibra does not manage money.

---

## 6. Go-to-market

1. **Design partners** — 3–8 institutional desks; free Pro seats for feedback; methodology diligence via `/methodology`.
2. **Seat expansion** — champion buys Pro seats for the desk; alerts + portfolio stickiness.
3. **API SKU** — quant/research automation; keys from `/account/api-keys`; docs at `/docs/api`.
4. **Enterprise** — custom (later): SSO, data residency, contracted SLAs.

Funnel narrative: Methodology trust → Free activation → Pro (alerts + calibration) → API (data SKU).

---

## 7. Stripe / env vars (billing-ready, not live)

Demo path: `POST /api/billing/checkout-demo` upgrades the logged-in user in SQLite (`DEMO CHECKOUT`).

When ready for real Stripe Checkout, set:

```bash
STRIPE_SECRET_KEY=sk_live_or_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...          # CHF Pro seat price id
STRIPE_PRICE_API=price_...          # CHF API plan price id
STRIPE_SUCCESS_URL=https://.../account?billing=success
STRIPE_CANCEL_URL=https://.../pricing?billing=cancel
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
```

Optional email delivery for alerts:

```bash
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=alerts@calibra.example
```

Without SMTP, alert emails are queued to `data/alert_outbox.json` and shown on `/alerts` Outbox — **never pretend email was sent**.

Session / auth (local defaults work without secrets):

```bash
# Optional override; demo uses a local default if unset
CALIBRA_SESSION_SECRET=long-random-string
```

---

## 8. Success metrics

| Metric | Definition | Early target (directional) |
|--------|------------|----------------------------|
| **Activation** | Free user completes signup + views dashboard + opens Elevated Prob. within 24h | ≥ 60% of signups |
| **Alert engagement** | Rules created + ≥1 evaluation / week | ≥ 40% of Pro seats |
| **Calibration page views** | `/methodology` or Forecasts calibration panel / week | Leading indicator for diligence & trust |
| **API calls** | Authenticated `/api/v1/*` requests / day | Growth after first API design partner |
| **Conversion** | Free → Pro (demo or Stripe) | Track weekly; no vanity target until N≥50 Free actives |
| **Retention** | Pro seats active in week 4 | Desk-pack goal > seat churn |

Instrument in product analytics later; for this foundation, surface counts in account UI and API rate-limit counters.

---

## 9. Demo credentials (local)

| Email | Password | Plan |
|-------|----------|------|
| `pro@calibra.local` | `calibra-pro-demo` | Pro |
| `free@calibra.local` | `calibra-free-demo` | Free |

Demo accounts are **not** created automatically (no request path provisions or re-hashes them). Create them explicitly, insert-only, on a local/demo DB:

```bash
CALIBRA_DEMO_USERS=1 npm run provision:demo-users
```

Shown on `/login` and `/pricing` for local demos only; they work only after provisioning.

---

## 10. Related paths

- Plans code: `src/lib/billing/plans.ts`
- Auth: `src/lib/auth/*`
- API keys: `src/lib/api-keys/*`
- Demo checkout: `POST /api/billing/checkout-demo`
