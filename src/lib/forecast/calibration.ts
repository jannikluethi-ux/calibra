/**
 * Calibration metrics — Live cohort by default; Seed kept separate.
 * SEED and LIVE must never be conflated in marketed accuracy numbers.
 */

import type { Forecast } from "../types";
import { getForecasts } from "./distributions";
import { normalizeForecast } from "./resolve";

export type CohortFilter = "live" | "seed" | "all";

export interface CalibrationCurvePoint {
  /** Midpoint of predicted-probability bin */
  predicted: number;
  /** Empirical frequency of the event in that bin */
  empirical: number;
  n: number;
  label: string;
}

export interface CalibrationReport {
  cohort: CohortFilter;
  totalResolved: number;
  seedCount: number;
  liveResolved: number;
  openCount: number;
  unresolvableCount: number;
  avgBrier: number | null;
  directionalAccuracy: number | null;
  severeDownFalsePositives: number;
  severeDownFalseNegatives: number;
  strongUpFalsePositives: number;
  strongUpFalseNegatives: number;
  byAsset: { symbol: string; n: number; avgBrier: number; dirAcc: number; assetClass?: string }[];
  byHorizon: { horizon: string; n: number; avgBrier: number; dirAcc: number }[];
  byAssetClass: { assetClass: string; n: number; avgBrier: number; dirAcc: number }[];
  /** Reliability diagram for modal (max-prob) bucket */
  calibrationCurve: CalibrationCurvePoint[];
  /** Per-outcome-bucket predicted vs empirical (when enough N) */
  perBucketCalibration: {
    bucket: string;
    avgPredicted: number;
    empiricalFreq: number;
    n: number;
  }[];
  notes: string[];
}

function selectCohort(all: Forecast[], cohort: CohortFilter): Forecast[] {
  if (cohort === "live") return all.filter((f) => !f.isSeed);
  if (cohort === "seed") return all.filter((f) => f.isSeed);
  return all;
}

function reliabilityCurve(resolved: Forecast[]): CalibrationCurvePoint[] {
  // Bin by predicted probability of the modal bucket; outcome = whether that bucket hit
  const bins = [
    { lo: 0, hi: 20, label: "0-20%" },
    { lo: 20, hi: 30, label: "20-30%" },
    { lo: 30, hi: 40, label: "30-40%" },
    { lo: 40, hi: 50, label: "40-50%" },
    { lo: 50, hi: 70, label: "50-70%" },
    { lo: 70, hi: 100.01, label: "70-100%" },
  ];
  return bins
    .map((bin) => {
      const items = resolved.filter((f) => {
        const maxP = Math.max(...f.distribution.map((b) => b.probability));
        return maxP >= bin.lo && maxP < bin.hi;
      });
      if (!items.length) return null;
      const hits = items.filter((f) => {
        const maxP = Math.max(...f.distribution.map((b) => b.probability));
        const modal = f.distribution.find((b) => b.probability === maxP)?.label;
        return modal != null && modal === f.outcome?.outcomeBucket;
      }).length;
      return {
        predicted: (bin.lo + bin.hi) / 2,
        empirical: hits / items.length,
        n: items.length,
        label: bin.label,
      };
    })
    .filter((x): x is CalibrationCurvePoint => x != null);
}

function perBucket(resolved: Forecast[]) {
  const buckets = ["strong_up", "mod_up", "range", "mod_down", "severe_down"];
  return buckets.map((bucket) => {
    const preds = resolved.map((f) => f.distribution.find((b) => b.label === bucket)?.probability ?? 0);
    const avgPredicted = preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length / 100 : 0;
    const empiricalFreq =
      resolved.length > 0
        ? resolved.filter((f) => f.outcome?.outcomeBucket === bucket).length / resolved.length
        : 0;
    return { bucket, avgPredicted, empiricalFreq, n: resolved.length };
  });
}

function extremeErrors(resolved: Forecast[]) {
  // Severe downside: FP = predicted severe_down as modal but not observed; FN = observed but not predicted
  let severeDownFalsePositives = 0;
  let severeDownFalseNegatives = 0;
  let strongUpFalsePositives = 0;
  let strongUpFalseNegatives = 0;

  for (const f of resolved) {
    const maxP = Math.max(...f.distribution.map((b) => b.probability));
    const modal = f.distribution.find((b) => b.probability === maxP)?.label;
    const hit = f.outcome?.outcomeBucket;
    const severePred = modal === "severe_down" || (f.distribution.find((b) => b.label === "severe_down")?.probability ?? 0) >= 25;
    const strongPred = modal === "strong_up" || (f.distribution.find((b) => b.label === "strong_up")?.probability ?? 0) >= 25;

    if (severePred && hit !== "severe_down") severeDownFalsePositives++;
    if (!severePred && hit === "severe_down") severeDownFalseNegatives++;
    if (strongPred && hit !== "strong_up") strongUpFalsePositives++;
    if (!strongPred && hit === "strong_up") strongUpFalseNegatives++;
  }

  return {
    severeDownFalsePositives,
    severeDownFalseNegatives,
    strongUpFalsePositives,
    strongUpFalseNegatives,
  };
}

export function computeCalibration(
  forecasts?: Forecast[],
  cohort: CohortFilter = "live"
): CalibrationReport {
  const all = (forecasts ?? getForecasts()).map(normalizeForecast);
  const cohortAll = selectCohort(all, cohort);
  const resolved = cohortAll.filter((f) => f.status === "resolved" && f.outcome);
  const openCount = cohortAll.filter((f) => f.status === "open").length;
  const unresolvableCount = cohortAll.filter((f) => f.status === "expired_unresolvable").length;

  const seedCount = all.filter((f) => f.isSeed && f.outcome).length;
  const liveResolved = all.filter((f) => !f.isSeed && f.status === "resolved" && f.outcome).length;

  const avgBrier =
    resolved.length > 0
      ? resolved.reduce((a, f) => a + (f.outcome?.brierScore ?? f.outcome?.brierContribution ?? 0), 0) /
        resolved.length
      : null;

  const withDir = resolved.filter((f) => f.outcome?.directionalHit != null || f.outcome?.directionalCorrect != null);
  const dirAcc =
    withDir.length > 0
      ? withDir.filter((f) => f.outcome?.directionalHit ?? f.outcome?.directionalCorrect).length /
        withDir.length
      : null;

  const byAssetMap = new Map<string, Forecast[]>();
  for (const f of resolved) {
    const arr = byAssetMap.get(f.assetSymbol) || [];
    arr.push(f);
    byAssetMap.set(f.assetSymbol, arr);
  }
  const byAsset = Array.from(byAssetMap.entries()).map(([symbol, fs]) => ({
    symbol,
    n: fs.length,
    avgBrier: fs.reduce((a, f) => a + (f.outcome?.brierScore ?? 0), 0) / fs.length,
    dirAcc: fs.filter((f) => f.outcome?.directionalHit ?? f.outcome?.directionalCorrect).length / fs.length,
    assetClass: fs[0]?.assetClass,
  }));

  const byHorizonMap = new Map<string, Forecast[]>();
  for (const f of resolved) {
    const arr = byHorizonMap.get(f.horizon) || [];
    arr.push(f);
    byHorizonMap.set(f.horizon, arr);
  }
  const byHorizon = Array.from(byHorizonMap.entries()).map(([horizon, fs]) => ({
    horizon,
    n: fs.length,
    avgBrier: fs.reduce((a, f) => a + (f.outcome?.brierScore ?? 0), 0) / fs.length,
    dirAcc: fs.filter((f) => f.outcome?.directionalHit ?? f.outcome?.directionalCorrect).length / fs.length,
  }));

  const byClassMap = new Map<string, Forecast[]>();
  for (const f of resolved) {
    const cls = f.assetClass || "unknown";
    const arr = byClassMap.get(cls) || [];
    arr.push(f);
    byClassMap.set(cls, arr);
  }
  const byAssetClass = Array.from(byClassMap.entries()).map(([assetClass, fs]) => ({
    assetClass,
    n: fs.length,
    avgBrier: fs.reduce((a, f) => a + (f.outcome?.brierScore ?? 0), 0) / fs.length,
    dirAcc: fs.filter((f) => f.outcome?.directionalHit ?? f.outcome?.directionalCorrect).length / fs.length,
  }));

  const extremes = extremeErrors(resolved);

  return {
    cohort,
    totalResolved: resolved.length,
    seedCount,
    liveResolved,
    openCount,
    unresolvableCount,
    avgBrier,
    directionalAccuracy: dirAcc,
    ...extremes,
    byAsset,
    byHorizon,
    byAssetClass,
    calibrationCurve: reliabilityCurve(resolved),
    perBucketCalibration: perBucket(resolved),
    notes: [
      `Cohort filter: ${cohort.toUpperCase()}. Default marketed view = Live only.`,
      "Brier score: lower is better (0 = perfect). Multi-category mean of (p−o)².",
      "Seed forecasts are labeled and exist so the dashboard is not empty — they are NOT a live track record.",
      "Live outcomes use only stored market_history (live snapshots or Yahoo historical bars with provenance).",
      "Insufficient evidence ⇒ expired_unresolvable — never invent a close.",
      "Backdated short-horizon demos are labeled 'Resolved via historical bars' and must not be marketed as production track record.",
      "Insufficient sample size ⇒ treat metrics as illustrative.",
    ],
  };
}
