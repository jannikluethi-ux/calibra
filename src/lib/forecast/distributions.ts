import { randomUUID } from "crypto";
import type { Forecast, MarketSnapshot, TimeHorizon } from "../types";
import { getDb, upsertJson, getJsonAll, getMeta, setMeta } from "../db";
import { getMarketSnapshots } from "../market/fetch";
import { findClosestObservation, getHistoryForSymbol } from "../market/history";
import {
  buildBuckets,
  brierScore,
  directionalHit,
  horizonDurationMs,
  pickBucket,
  thresholdDocs,
} from "./buckets";
import { MARKET_UNIVERSE } from "../market/universe";

export function persistForecast(f: Forecast) {
  upsertJson("forecasts", "id", f.id, f, {
    asset_symbol: f.assetSymbol,
    created_at: f.createdAt,
    is_seed: f.isSeed ? 1 : 0,
    status: f.status,
    horizon_end: f.horizonEnd,
    resolved_at: f.outcome?.resolvedAt ?? null,
    brier_score: f.outcome?.brierScore ?? f.outcome?.brierContribution ?? null,
  });
}

function tiltWeights(snap: MarketSnapshot): number[] {
  const chg = snap.change1m ?? snap.change1w ?? 0;
  const vol = snap.volatilityEst ?? 20;
  let w = [12, 22, 30, 22, 14];
  if (chg > 5) w = [18, 28, 28, 16, 10];
  else if (chg < -5) w = [8, 16, 28, 28, 20];
  if (vol > 35) {
    w[0] += 4;
    w[4] += 6;
    w[2] -= 5;
  }
  return w;
}

export function buildLiveForecast(
  snap: MarketSnapshot,
  horizon: TimeHorizon = "1-4w",
  opts?: {
    createdAt?: string;
    originPrice?: number;
    resolutionNote?: string;
    id?: string;
  }
): Forecast {
  const createdAt = opts?.createdAt ?? new Date().toISOString();
  const origin = opts?.originPrice ?? snap.price;
  const horizonEnd = new Date(new Date(createdAt).getTime() + horizonDurationMs(horizon)).toISOString();
  const dist = buildBuckets(tiltWeights(snap), horizon);
  const item = MARKET_UNIVERSE.find((u) => u.symbol === snap.symbol);

  return {
    id: opts?.id ?? randomUUID(),
    assetSymbol: snap.symbol,
    assetName: snap.name,
    horizon,
    horizonEnd,
    createdAt,
    asOfPrice: origin,
    originPrice: origin,
    distribution: dist,
    rationale: `SCENARIO ESTIMATE (not a prediction product): Distribution tilted by recent realized momentum and vol. ${thresholdDocs(horizon)}. Method: heuristic_v1. Prefer uncertainty over false precision.`,
    invalidators: [
      "Regime break in liquidity or policy path",
      "Gap move >1.5σ overnight without mean reversion within horizon",
      "Contradictory tier-1 data release",
    ],
    dataThatWouldChange: [
      "Next CB decision / inflation print / labor report",
      "Sustained move in DXY and real yields",
      "Credit spread impulse",
    ],
    evidenceSnapshot: [
      `Price=${snap.price}`,
      `1d=${snap.change1d}% 1w=${snap.change1w}% 1m=${snap.change1m}%`,
      `VolEst=${snap.volatilityEst}`,
      `Provenance=${snap.provenance.source} @ ${snap.provenance.fetchedAt} (${snap.provenance.quality})`,
      `horizonEnd=${horizonEnd}`,
      `originPrice=${origin}`,
    ],
    isSeed: false,
    status: "open",
    assetClass: item?.category,
    resolutionNote: opts?.resolutionNote,
    provenance: {
      source: "GFI heuristic_v1",
      sourceTier: 4,
      fetchedAt: createdAt,
      quality: snap.price != null ? snap.provenance.quality : "insufficient",
      note: "Probabilities are model estimates, not market-implied or surveyed forecasts.",
    },
  };
}

/** Seed resolved forecasts so calibration dashboard is non-empty — clearly labeled SEED */
export function seedHistoricalForecasts(): Forecast[] {
  const seeds: Forecast[] = [
    {
      id: "seed-btc-2024-q1",
      assetSymbol: "BTC",
      assetName: "Bitcoin",
      horizon: "1-3m",
      horizonEnd: "2024-04-15T12:00:00.000Z",
      createdAt: "2024-01-15T12:00:00.000Z",
      asOfPrice: 42000,
      originPrice: 42000,
      distribution: buildBuckets([25, 30, 20, 15, 10], "1-3m"),
      rationale: "SEED (historical resolved): ETF-flow optimism vs positioning risk. Marked as seed for calibration demo.",
      invalidators: ["ETF flow reversal", "Macro risk-off"],
      dataThatWouldChange: ["Spot ETF net flows", "Real yields"],
      evidenceSnapshot: ["SEED evidence snapshot — illustrative archive"],
      isSeed: true,
      status: "resolved",
      assetClass: "crypto",
      outcome: {
        resolvedAt: "2024-04-15T12:00:00.000Z",
        outcomeValue: 63840,
        outcomeSource: "SEED synthetic",
        outcomeAsof: "2024-04-15T12:00:00.000Z",
        realizedReturnPct: 52,
        hitBucket: "strong_up",
        outcomeBucket: "strong_up",
        directionalCorrect: true,
        directionalHit: true,
        absoluteError: 0,
        brierContribution: 0,
        brierScore: 0,
        notes: "SEED outcome for calibration UI. Not a live track record claim.",
        resolutionMethod: "seed_synthetic",
        resolutionBadge: "seed_synthetic",
      },
      provenance: {
        source: "GFI seed archive",
        sourceTier: 4,
        fetchedAt: "2024-01-15T12:00:00.000Z",
        quality: "demo",
        note: "Seed forecast for calibration dashboard — clearly labeled.",
      },
    },
    {
      id: "seed-spx-2024-h1",
      assetSymbol: "SPX",
      assetName: "S&P 500",
      horizon: "3-12m",
      horizonEnd: "2024-07-01T12:00:00.000Z",
      createdAt: "2024-01-02T12:00:00.000Z",
      asOfPrice: 4700,
      originPrice: 4700,
      distribution: buildBuckets([15, 35, 25, 15, 10], "3-12m"),
      rationale: "SEED: Soft-landing base vs recession left tail. Seed only.",
      invalidators: ["Recession prints", "Credit event"],
      dataThatWouldChange: ["NFP", "CPI", "Fed path"],
      evidenceSnapshot: ["SEED"],
      isSeed: true,
      status: "resolved",
      assetClass: "equity_index",
      outcome: {
        resolvedAt: "2024-07-01T12:00:00.000Z",
        outcomeValue: 5358,
        outcomeSource: "SEED synthetic",
        outcomeAsof: "2024-07-01T12:00:00.000Z",
        realizedReturnPct: 14,
        hitBucket: "strong_up",
        outcomeBucket: "strong_up",
        directionalCorrect: true,
        directionalHit: true,
        absoluteError: 0,
        brierContribution: 0,
        brierScore: 0,
        notes: "SEED outcome.",
        resolutionMethod: "seed_synthetic",
        resolutionBadge: "seed_synthetic",
      },
      provenance: {
        source: "GFI seed archive",
        sourceTier: 4,
        fetchedAt: "2024-01-02T12:00:00.000Z",
        quality: "demo",
        note: "Seed",
      },
    },
    {
      id: "seed-us10y-2023",
      assetSymbol: "US10Y",
      assetName: "US 10Y Yield",
      horizon: "1-3m",
      horizonEnd: "2023-12-01T12:00:00.000Z",
      createdAt: "2023-09-01T12:00:00.000Z",
      asOfPrice: 4.2,
      originPrice: 4.2,
      distribution: buildBuckets([20, 25, 20, 20, 15], "1-3m"),
      rationale: "SEED: Term-premium / supply debate. Direction measured on yield level change approximation.",
      invalidators: ["Sudden dovish pivot"],
      dataThatWouldChange: ["Auction demand", "CPI"],
      evidenceSnapshot: ["SEED"],
      isSeed: true,
      status: "resolved",
      assetClass: "rates",
      outcome: {
        resolvedAt: "2023-12-01T12:00:00.000Z",
        outcomeValue: 3.864,
        outcomeSource: "SEED synthetic",
        outcomeAsof: "2023-12-01T12:00:00.000Z",
        realizedReturnPct: -8,
        hitBucket: "mod_down",
        outcomeBucket: "mod_down",
        directionalCorrect: false,
        directionalHit: false,
        absoluteError: 5,
        brierContribution: 0,
        brierScore: 0,
        notes: "SEED: example of miss — calibration requires recording errors.",
        resolutionMethod: "seed_synthetic",
        resolutionBadge: "seed_synthetic",
      },
      provenance: {
        source: "GFI seed archive",
        sourceTier: 4,
        fetchedAt: "2023-09-01T12:00:00.000Z",
        quality: "demo",
        note: "Seed",
      },
    },
    {
      id: "seed-eurusd-2024",
      assetSymbol: "EURUSD",
      assetName: "EUR/USD",
      horizon: "1-4w",
      horizonEnd: "2024-07-01T12:00:00.000Z",
      createdAt: "2024-06-01T12:00:00.000Z",
      asOfPrice: 1.08,
      originPrice: 1.08,
      distribution: buildBuckets([10, 25, 35, 20, 10], "1-4w"),
      rationale: "SEED: Relative CB path range-bound base.",
      invalidators: ["Policy surprise"],
      dataThatWouldChange: ["ECB/Fed dots"],
      evidenceSnapshot: ["SEED"],
      isSeed: true,
      status: "resolved",
      assetClass: "fx",
      outcome: {
        resolvedAt: "2024-07-01T12:00:00.000Z",
        outcomeValue: 1.0854,
        outcomeSource: "SEED synthetic",
        outcomeAsof: "2024-07-01T12:00:00.000Z",
        realizedReturnPct: 0.5,
        hitBucket: "range",
        outcomeBucket: "range",
        directionalCorrect: true,
        directionalHit: true,
        absoluteError: 0.2,
        brierContribution: 0,
        brierScore: 0,
        notes: "SEED hit range bucket.",
        resolutionMethod: "seed_synthetic",
        resolutionBadge: "seed_synthetic",
      },
      provenance: {
        source: "GFI seed archive",
        sourceTier: 4,
        fetchedAt: "2024-06-01T12:00:00.000Z",
        quality: "demo",
        note: "Seed",
      },
    },
  ];

  for (const f of seeds) {
    if (f.outcome) {
      f.outcome.hitBucket = pickBucket(f.outcome.realizedReturnPct, f.distribution);
      f.outcome.outcomeBucket = f.outcome.hitBucket;
      f.outcome.brierContribution = brierScore(f.distribution, f.outcome.hitBucket);
      f.outcome.brierScore = f.outcome.brierContribution;
      f.outcome.directionalCorrect = directionalHit(
        f.distribution,
        f.outcome.realizedReturnPct,
        f.outcome.hitBucket
      );
      f.outcome.directionalHit = f.outcome.directionalCorrect;
    }
  }
  return seeds;
}

const SHORT_FOCUS = ["BTC", "SPX", "EURUSD", "GOLD", "VIX"] as const;
const SHORT_HORIZONS: TimeHorizon[] = ["1d", "2d"];

/**
 * Bootstrap short-horizon LIVE forecasts (some backdated against historical bars)
 * so the resolution loop is demonstrable without waiting weeks.
 * Transparent labeling via resolutionNote — NOT a silent production track record.
 */
export function bootstrapShortHorizonForecasts(): Forecast[] {
  if (getMeta("shortHorizonBootstrapped") === "1") {
    return getForecasts().filter((f) => !f.isSeed && (f.horizon === "1d" || f.horizon === "2d"));
  }

  // Only fresh, valid, live quotes may become forecast origin prices (no demo, no carried-forward, no zero).
  const snaps = getMarketSnapshots().filter(
    (s) => s.price != null && Number.isFinite(s.price) && s.price > 0 && s.provenance.quality === "live" && !s.provenance.carriedForward
  );
  const created: Forecast[] = [];

  // A) Forward-looking short horizons from NOW (will resolve as time passes / on refresh)
  for (const sym of SHORT_FOCUS) {
    const snap = snaps.find((s) => s.symbol === sym);
    if (!snap || snap.price == null) continue;
    for (const horizon of SHORT_HORIZONS) {
      const f = buildLiveForecast(snap, horizon, {
        id: `live-short-${sym}-${horizon}-forward`,
        resolutionNote: undefined,
      });
      // Avoid duplicates on re-run
      const existing = getJsonAll<Forecast>("forecasts").find((x) => x.id === f.id);
      if (existing) continue;
      persistForecast(f);
      created.push(f);
    }
  }

  // B) Intentionally backdated LIVE forecasts that can resolve against Yahoo historical bars
  // Origin = bar at T0, horizon_end = T0 + horizon, both within backfilled history.
  for (const sym of SHORT_FOCUS) {
    const history = getHistoryForSymbol(sym).filter((h) => h.barKind === "yahoo_historical_bar");
    if (history.length < 4) continue;
    // Use older bar as origin, later bar near horizon_end
    for (const horizon of ["1d", "2d"] as TimeHorizon[]) {
      const id = `live-backdated-${sym}-${horizon}-demo`;
      if (getJsonAll<Forecast>("forecasts").some((x) => x.id === id)) continue;

      const originBar = history[Math.max(0, history.length - 4)];
      const createdAt = originBar.ts;
      const horizonEnd = new Date(
        new Date(createdAt).getTime() + horizonDurationMs(horizon)
      ).toISOString();

      // Build a pseudo-snap at origin for evidence
      const snap = snaps.find((s) => s.symbol === sym);
      if (!snap) continue;
      const pseudo: MarketSnapshot = {
        ...snap,
        price: originBar.price,
        provenance: {
          ...snap.provenance,
          fetchedAt: createdAt,
          quality: "cached",
          note: "Origin price taken from Yahoo historical bar at T0 for calibration pipeline demo",
        },
      };

      const f = buildLiveForecast(pseudo, horizon, {
        id,
        createdAt,
        originPrice: originBar.price,
        resolutionNote:
          "backfilled for calibration pipeline demo — origin/evidence as of T0. is_seed=false but NOT a silent production track record. UI must show 'Resolved via historical bars'.",
      });
      // Ensure horizonEnd matches intended (buildLiveForecast already sets it from createdAt)
      f.horizonEnd = horizonEnd;
      // Verify we will have an observation near horizon_end
      const near = findClosestObservation(sym, horizonEnd, 86400_000);
      if (!near) {
        // Still write open — may become unresolvable honestly
      }
      persistForecast(f);
      created.push(f);
    }
  }

  setMeta("shortHorizonBootstrapped", "1");
  return created;
}

/** Create/update standard live 1-4w forecasts without wiping open short-horizon ones */
export function refreshForecasts(): Forecast[] {
  getDb();
  const existing = getJsonAll<Forecast>("forecasts");
  if (!existing.some((f) => f.isSeed)) {
    for (const s of seedHistoricalForecasts()) {
      persistForecast(s);
    }
  }

  // Only fresh, valid, live quotes may become forecast origin prices (no demo, no carried-forward, no zero).
  const snaps = getMarketSnapshots().filter(
    (s) => s.price != null && Number.isFinite(s.price) && s.price > 0 && s.provenance.quality === "live" && !s.provenance.carriedForward
  );
  const focus = ["BTC", "SPX", "ETH", "GOLD", "US10Y", "EURUSD", "VIX", "OIL"];

  for (const sym of focus) {
    const snap = snaps.find((s) => s.symbol === sym);
    if (!snap) continue;

    // Idempotent id per symbol+horizon+day so we don't spam duplicates every refresh
    const day = new Date().toISOString().slice(0, 10);
    const id = `live-${sym}-1-4w-${day}`;
    const already = existing.find((f) => f.id === id);
    if (already) continue;

    const f = buildLiveForecast(snap, "1-4w", { id });
    persistForecast(f);
  }

  // Ensure short-horizon bootstrap once history exists
  try {
    bootstrapShortHorizonForecasts();
  } catch {
    // history may be empty on first run before backfill
  }

  return getForecasts();
}

export function getForecasts(): Forecast[] {
  const rows = getJsonAll<Forecast>("forecasts", "created_at DESC");
  // Normalize legacy rows missing new fields
  return rows.map((f) => ({
    ...f,
    originPrice: f.originPrice ?? f.asOfPrice ?? null,
    status: f.status ?? (f.outcome ? "resolved" : "open"),
    horizonEnd:
      f.horizonEnd ??
      (f.createdAt
        ? new Date(new Date(f.createdAt).getTime() + horizonDurationMs(f.horizon || "1-4w")).toISOString()
        : new Date().toISOString()),
  }));
}

/**
 * Seed step (npm run seed / guarded refresh only — never a GET): build forecasts on an empty table.
 * The former legacy status/horizon_end column backfill is the explicit one-off migration
 * scripts/migrate-legacy-cleanup-v1.ts.
 */
export function ensureForecasts() {
  const row = getDb().prepare(`SELECT 1 AS ok FROM forecasts LIMIT 1`).get();
  if (!row) refreshForecasts();
}
