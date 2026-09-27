/**
 * Outcome resolution engine
 * -------------------------
 * Resolves open LIVE forecasts whose horizon_end has passed against stored
 * market_history observations. Never invents prices.
 *
 * SEED forecasts are left alone (they already carry synthetic outcomes).
 */

import { getDb, setMeta, getMeta } from "../db";
import type { Forecast, ForecastOutcome, ForecastStatus } from "../types";
import { findClosestObservation } from "../market/history";
import { brierScore, directionalHit, pickBucket, resolutionToleranceMs } from "./buckets";
import { getForecasts, persistForecast } from "./distributions";

export interface ResolveResult {
  ranAt: string;
  examined: number;
  newlyResolved: number;
  newlyUnresolvable: number;
  skippedSeed: number;
  stillOpen: number;
  details: { id: string; symbol: string; status: ForecastStatus; note: string }[];
}

function normalizeForecast(f: Forecast): Forecast {
  // Back-compat for forecasts written before resolution fields existed
  const origin = f.originPrice ?? f.asOfPrice ?? null;
  let status: ForecastStatus = f.status ?? (f.outcome ? "resolved" : "open");
  if (f.isSeed && f.outcome) status = "resolved";
  let horizonEnd = f.horizonEnd;
  if (!horizonEnd && f.createdAt) {
    // Legacy live forecasts without horizonEnd: treat as 21d from createdAt
    horizonEnd = new Date(new Date(f.createdAt).getTime() + 21 * 86400_000).toISOString();
  }
  return {
    ...f,
    originPrice: origin,
    asOfPrice: f.asOfPrice ?? origin,
    status,
    horizonEnd: horizonEnd ?? f.createdAt,
  };
}

function writeForecast(f: Forecast) {
  persistForecast(f);
}

function resolveOne(f: Forecast, now: Date): { forecast: Forecast; detail: string } {
  const origin = f.originPrice ?? f.asOfPrice;
  if (origin == null || !Number.isFinite(origin) || origin === 0) {
    const updated: Forecast = {
      ...f,
      status: "expired_unresolvable",
      outcome: {
        resolvedAt: now.toISOString(),
        outcomeValue: NaN,
        outcomeSource: "none",
        outcomeAsof: now.toISOString(),
        realizedReturnPct: 0,
        hitBucket: "range",
        outcomeBucket: "range",
        directionalCorrect: null,
        directionalHit: null,
        absoluteError: 0,
        brierContribution: 0,
        brierScore: 0,
        notes: "Insufficient evidence: missing origin price at forecast creation.",
        resolutionMethod: "insufficient_evidence",
        resolutionBadge: "unresolvable",
        forecastErrorNotes: "Cannot compute return without originPrice.",
      },
    };
    // Don't store NaN in JSON — strip outcomeValue sensibly
    updated.outcome!.outcomeValue = 0;
    return { forecast: updated, detail: "unresolvable: missing origin price" };
  }

  const tol = resolutionToleranceMs(f.horizon);
  const obs = findClosestObservation(f.assetSymbol, f.horizonEnd, tol);

  if (!obs) {
    const updated: Forecast = {
      ...f,
      status: "expired_unresolvable",
      outcome: {
        resolvedAt: now.toISOString(),
        outcomeValue: 0,
        outcomeSource: "none",
        outcomeAsof: f.horizonEnd,
        realizedReturnPct: 0,
        hitBucket: "range",
        outcomeBucket: "range",
        directionalCorrect: null,
        directionalHit: null,
        absoluteError: 0,
        brierContribution: 0,
        brierScore: 0,
        notes: `Insufficient evidence to resolve: no market observation for ${f.assetSymbol} within ±${Math.round(tol / 3600_000)}h of horizon_end ${f.horizonEnd}. Prefer unresolvable over fabricating a close.`,
        resolutionMethod: "insufficient_evidence",
        resolutionBadge: "unresolvable",
        forecastErrorNotes: "No stored snapshot/bar near horizon_end.",
      },
    };
    return { forecast: updated, detail: "expired_unresolvable: no observation in tolerance" };
  }

  const realizedReturnPct = ((obs.price - origin) / Math.abs(origin)) * 100;
  const hitBucket = pickBucket(realizedReturnPct, f.distribution);
  const brier = brierScore(f.distribution, hitBucket);
  const dir = directionalHit(f.distribution, realizedReturnPct, hitBucket);
  const maxProb = Math.max(...f.distribution.map((b) => b.probability));
  const predicted = f.distribution.find((b) => b.probability === maxProb)?.label ?? "?";

  const isHist = obs.barKind === "yahoo_historical_bar";
  const method = isHist ? "yahoo_historical_bar_close" : "closest_snapshot_within_tolerance";
  const badge = isHist ? "historical_bars" : "live_snapshot";

  const outcome: ForecastOutcome = {
    resolvedAt: now.toISOString(),
    outcomeValue: obs.price,
    outcomeSource: `${obs.source} [${obs.barKind}]`,
    outcomeAsof: obs.ts,
    realizedReturnPct: Math.round(realizedReturnPct * 1000) / 1000,
    hitBucket,
    outcomeBucket: hitBucket,
    directionalCorrect: dir,
    directionalHit: dir,
    absoluteError: Math.round(Math.abs(realizedReturnPct) * 1000) / 1000,
    brierContribution: brier,
    brierScore: brier,
    notes: [
      `Observed ${f.assetSymbol} @ ${obs.price} (asof ${obs.ts}) vs origin ${origin}.`,
      `Return ${realizedReturnPct.toFixed(3)}% → bucket ${hitBucket}.`,
      `Brier=${brier}. Modal forecast bucket was ${predicted}.`,
      isHist
        ? "Resolved via historical bars (Yahoo OHLC backfill) — labeled for calibration pipeline transparency."
        : "Resolved via live snapshot log.",
      f.resolutionNote ?? "",
    ]
      .filter(Boolean)
      .join(" "),
    resolutionMethod: method,
    resolutionBadge: badge,
    forecastErrorNotes:
      hitBucket === predicted
        ? `Matched modal bucket (${predicted}).`
        : `Missed modal bucket: predicted ${predicted}, observed ${hitBucket}.`,
  };

  return {
    forecast: { ...f, status: "resolved", outcome },
    detail: `resolved → ${hitBucket} brier=${brier} via ${badge}`,
  };
}

export function resolveDueForecasts(): ResolveResult {
  getDb();
  const now = new Date();
  const all = getForecasts().map(normalizeForecast);
  const details: ResolveResult["details"] = [];
  let newlyResolved = 0;
  let newlyUnresolvable = 0;
  let skippedSeed = 0;
  let examined = 0;

  for (const raw of all) {
    const f = normalizeForecast(raw);

    // Never re-process SEED — keep seed cohort intact
    if (f.isSeed) {
      skippedSeed++;
      // Ensure seed status/columns are consistent
      if (f.outcome && f.status !== "resolved") {
        const fixed = { ...f, status: "resolved" as const };
        if (fixed.outcome) {
          fixed.outcome.resolutionMethod = fixed.outcome.resolutionMethod ?? "seed_synthetic";
          fixed.outcome.resolutionBadge = "seed_synthetic";
          fixed.outcome.outcomeBucket = fixed.outcome.outcomeBucket ?? fixed.outcome.hitBucket;
          fixed.outcome.brierScore = fixed.outcome.brierScore ?? fixed.outcome.brierContribution;
          fixed.outcome.directionalHit =
            fixed.outcome.directionalHit ?? fixed.outcome.directionalCorrect;
          fixed.outcome.outcomeValue = fixed.outcome.outcomeValue ?? fixed.asOfPrice ?? 0;
          fixed.outcome.outcomeSource = fixed.outcome.outcomeSource ?? "SEED synthetic";
          fixed.outcome.outcomeAsof = fixed.outcome.outcomeAsof ?? fixed.outcome.resolvedAt;
        }
        writeForecast(fixed);
      }
      continue;
    }

    if (f.status === "resolved" || f.status === "expired_unresolvable") continue;
    if (!f.horizonEnd) continue;

    const end = new Date(f.horizonEnd).getTime();
    if (!Number.isFinite(end) || now.getTime() < end) continue;

    examined++;
    const { forecast, detail } = resolveOne(f, now);
    writeForecast(forecast);
    details.push({
      id: forecast.id,
      symbol: forecast.assetSymbol,
      status: forecast.status,
      note: detail,
    });
    if (forecast.status === "resolved") newlyResolved++;
    else if (forecast.status === "expired_unresolvable") newlyUnresolvable++;
  }

  const stillOpen = getForecasts().filter((f) => !f.isSeed && (f.status ?? "open") === "open").length;
  const ranAt = now.toISOString();
  setMeta("lastResolveRun", ranAt);
  setMeta(
    "lastResolveSummary",
    JSON.stringify({ newlyResolved, newlyUnresolvable, examined, stillOpen })
  );

  return {
    ranAt,
    examined,
    newlyResolved,
    newlyUnresolvable,
    skippedSeed,
    stillOpen,
    details,
  };
}

export function getResolvePipelineStatus() {
  const forecasts = getForecasts().map(normalizeForecast);
  const live = forecasts.filter((f) => !f.isSeed);
  const open = live.filter((f) => f.status === "open");
  const resolved = live.filter((f) => f.status === "resolved");
  const unresolvable = live.filter((f) => f.status === "expired_unresolvable");
  const nextDue = open
    .map((f) => f.horizonEnd)
    .filter(Boolean)
    .sort()[0] ?? null;

  return {
    lastRun: getMeta("lastResolveRun"),
    lastSummary: getMeta("lastResolveSummary"),
    openCount: open.length,
    resolvedCount: resolved.length,
    unresolvableCount: unresolvable.length,
    seedResolved: forecasts.filter((f) => f.isSeed && f.outcome).length,
    nextDue,
  };
}

/** Re-export normalize for calibration / UI */
export { normalizeForecast };
