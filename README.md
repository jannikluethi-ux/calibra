# Calibra

**Calibra** is probabilistic market intelligence: event detection, transmission modeling, and scenario probabilities that update as evidence changes. It is a research / intelligence tool — **not** investment advice and not a prediction machine.

Prefer being uncertain over confidently wrong. Demo, cached, and proxy figures are labeled.

> **Private proprietary repository.** Do not redistribute. See [LICENSE](LICENSE).

## Quick start

```bash
npm install
npm run dev          # http://localhost:3456
```

If a machine reset removes `node_modules` (the app has gone down this way more than once), run `scripts/ensure-dev.sh`. It runs `npm install` only when `node_modules/next` is missing, then starts `npm run dev` on port 3456 if that port is free. It does not modify `data/` or product behavior.


Production:

```bash
npm run build
npm start            # port 3456
```

Copy [`.env.example`](.env.example) to `.env.local` if you need SMTP, Stripe, or scheduler overrides. Local demos run without secrets.

## First run / initialization (explicit)

GET routes and pages are read-only: they never create tables beyond the one-time versioned schema step, never seed,
never provision demo users and never start jobs. On a fresh DB the UI shows **"Awaiting first run"** until you initialize:

```bash
npm run seed                                   # idempotent: source registry, scenarios, forecasts, country profiles, default alerts
CALIBRA_DEMO_USERS=1 npm run provision:demo-users   # optional, local/demo DBs only (insert-only, never re-hashes)
```

- Data refresh / series prefetch are token-guarded POST jobs (`CALIBRA_JOB_TOKEN`, see docs/SCHEDULER.md); the scheduler loop
  is opt-in (`CALIBRA_SCHEDULER=1`).
- The legacy duplicate cleanup / forecast-column backfill is a one-off explicit migration
  (`npx tsx scripts/migrate-legacy-cleanup-v1.ts --db data/gfi.db`, dry run by default) — not for production without approval.
- Details: docs/OPERATIONS.md, "B2 get-fix".

## Demo accounts (local)

| Email | Password | Plan |
|-------|----------|------|
| `pro@calibra.local` | `calibra-pro-demo` | Pro |
| `free@calibra.local` | `calibra-free-demo` | Free |

Demo accounts are **not** created automatically (no request path provisions or re-hashes them). Create them explicitly, insert-only, on a local/demo DB:

```bash
CALIBRA_DEMO_USERS=1 npm run provision:demo-users
```

Shown on `/login` and `/pricing` for local demos only; they work only after provisioning.

## Data model

- **Yahoo Finance** public chart API → market snapshots / history (paced; demo fallback if rate-limited)
- **Public RSS** (Fed/ECB/IMF/Reuters/CNBC, etc.) → event ingest + heuristic classification
- Persistence in **SQLite** at `data/gfi.db` (gitignored; the file and its versioned schema are created on first DB open — no seed data)
- In-app **scheduler** (Europe/Zurich session hours): markets, events, derive, maintenance — **opt-in**: off unless `CALIBRA_SCHEDULER=1` at boot (status reports `enabled` and `started` separately; see docs/SCHEDULER.md)

Manual full refresh: `POST /api/refresh` with `Authorization: Bearer $CALIBRA_JOB_TOKEN` (see docs/SCHEDULER.md, "Job-trigger auth"). Without a configured token all job-trigger endpoints refuse (503).

## Docs

- [docs/SCHEDULER.md](docs/SCHEDULER.md) — job cadence, soft toggle, noteworthy rules
- [docs/MONETIZATION.md](docs/MONETIZATION.md) — Free / Pro / API packaging draft (internal)

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind · SQLite (`better-sqlite3`) · Recharts / force-graph · dark terminal UI

## Safety

Simulations ≠ forecasts ≠ facts. No buy/sell recommendations. Epistemic labels separate observed fact, interpretation, model assumption, and scenario estimate.

## License

Proprietary — All Rights Reserved (2026). Private commercial use of this repo by others without permission is forbidden.
