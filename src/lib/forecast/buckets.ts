/**
 * Forecast outcome bucket thresholds
 * ==================================
 * Buckets are defined as percent return from originPrice → observed price at horizon_end.
 *
 * Base (1-4w / weekly-scale) thresholds:
 *   strong_up:    ret >= +8%
 *   mod_up:       +2% <= ret < +8%
 *   range:        -2% <  ret < +2%   (deadzone for flat / range-bound)
 *   mod_down:     -8% <  ret <= -2%
 *   severe_down:  ret <= -8%
 *
 * Short-horizon forecasts use the SAME labels but scaled ranges so most
 * 1d/2d moves are not forced into "range". Scale factors are documented
 * per horizon below and baked into each forecast's distribution[].
 *
 * Directional accuracy uses the range deadzone: |ret| within range band ⇒ flat.
 */

import type { ForecastBucket, OutcomeBucketLabel, TimeHorizon } from "../types";

export const BUCKET_LABELS: OutcomeBucketLabel[] = [
  "strong_up",
  "mod_up",
  "range",
  "mod_down",
  "severe_down",
];

/** Base weekly-scale absolute thresholds (pct) */
export const BASE_THRESHOLDS = {
  strongUp: 8,
  modUp: 2,
  rangeAbs: 2,
  modDown: -2,
  severeDown: -8,
} as const;

/**
 * Horizon scale relative to 1-4w base.
 * 1h≈0.15, 1d≈0.25, 2d≈0.35, 1-7d≈0.5, 1-4w=1, longer >1.
 */
export function horizonScale(horizon: TimeHorizon): number {
  switch (horizon) {
    case "1h":
    case "intraday":
      return 0.15;
    case "1d":
      return 0.25;
    case "2d":
      return 0.35;
    case "1-7d":
      return 0.5;
    case "1-4w":
      return 1;
    case "1-3m":
      return 1.5;
    case "3-12m":
      return 2.5;
    case "1-5y":
      return 4;
    default:
      return 1;
  }
}

export function horizonDurationMs(horizon: TimeHorizon): number {
  const hour = 3600_000;
  const day = 24 * hour;
  switch (horizon) {
    case "1h":
      return hour;
    case "intraday":
      return 6 * hour;
    case "1d":
      return day;
    case "2d":
      return 2 * day;
    case "1-7d":
      return 7 * day;
    case "1-4w":
      return 21 * day; // mid of 1-4w
    case "1-3m":
      return 60 * day;
    case "3-12m":
      return 180 * day;
    case "1-5y":
      return 730 * day;
    default:
      return 21 * day;
  }
}

/** Tolerance window for matching a market observation to horizon_end */
export function resolutionToleranceMs(horizon: TimeHorizon): number {
  const hour = 3600_000;
  const day = 24 * hour;
  switch (horizon) {
    case "1h":
    case "intraday":
      return 2 * hour;
    case "1d":
    case "2d":
      return day;
    default:
      return day;
  }
}

export function buildBuckets(weights: number[], horizon: TimeHorizon = "1-4w"): ForecastBucket[] {
  const s = horizonScale(horizon);
  const strong = BASE_THRESHOLDS.strongUp * s;
  const mod = BASE_THRESHOLDS.modUp * s;
  const labels: { label: OutcomeBucketLabel; rangeMinPct: number; rangeMaxPct: number }[] = [
    { label: "strong_up", rangeMinPct: strong, rangeMaxPct: strong * 3 },
    { label: "mod_up", rangeMinPct: mod, rangeMaxPct: strong },
    { label: "range", rangeMinPct: -mod, rangeMaxPct: mod },
    { label: "mod_down", rangeMinPct: -strong, rangeMaxPct: -mod },
    { label: "severe_down", rangeMinPct: -strong * 3, rangeMaxPct: -strong },
  ];
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return labels.map((l, i) => ({
    ...l,
    probability: Math.round((weights[i] / sum) * 1000) / 10,
  }));
}

/** Map realized % return to bucket using the forecast's own thresholds */
export function pickBucket(ret: number, dist: ForecastBucket[]): string {
  for (const b of dist) {
    if (b.label === "strong_up" && ret >= b.rangeMinPct) return b.label;
    if (b.label === "severe_down" && ret <= b.rangeMaxPct) return b.label;
    if (b.label === "mod_up" && ret >= b.rangeMinPct && ret < b.rangeMaxPct) return b.label;
    if (b.label === "mod_down" && ret > b.rangeMinPct && ret <= b.rangeMaxPct) return b.label;
    if (b.label === "range" && ret > b.rangeMinPct && ret < b.rangeMaxPct) return b.label;
  }
  // Fallback using base weekly if dist incomplete
  if (ret >= 8) return "strong_up";
  if (ret <= -8) return "severe_down";
  if (ret >= 2) return "mod_up";
  if (ret <= -2) return "mod_down";
  return "range";
}

/** Multinomial Brier: mean over categories of (p - o)^2. Lower is better. */
export function brierScore(dist: ForecastBucket[], hit: string): number {
  let s = 0;
  for (const b of dist) {
    const o = b.label === hit ? 1 : 0;
    const p = b.probability / 100;
    s += (p - o) ** 2;
  }
  return Math.round((s / Math.max(dist.length, 1)) * 1000) / 1000;
}

/**
 * Directional accuracy vs realized return.
 * Uses the forecast's "range" deadzone: if hit bucket is range ⇒ flat (correct iff
 * model also put max mass on range OR up/down masses were roughly balanced).
 */
export function directionalHit(
  dist: ForecastBucket[],
  realizedReturnPct: number,
  hitBucket: string
): boolean {
  const upMass = dist.filter((b) => b.label.includes("up")).reduce((a, b) => a + b.probability, 0);
  const downMass = dist.filter((b) => b.label.includes("down")).reduce((a, b) => a + b.probability, 0);
  const rangeMass = dist.find((b) => b.label === "range")?.probability ?? 0;
  const rangeBand = dist.find((b) => b.label === "range");
  const dead = rangeBand ? Math.abs(rangeBand.rangeMaxPct) : 2;

  if (Math.abs(realizedReturnPct) <= dead || hitBucket === "range") {
    // Flat outcome: hit if range was modal or up≈down
    const maxMass = Math.max(upMass, downMass, rangeMass);
    return rangeMass >= maxMass - 0.5 || Math.abs(upMass - downMass) < 5;
  }
  if (realizedReturnPct > dead) return upMass >= downMass;
  return downMass >= upMass;
}

export function thresholdDocs(horizon: TimeHorizon): string {
  const s = horizonScale(horizon);
  const strong = (BASE_THRESHOLDS.strongUp * s).toFixed(2);
  const mod = (BASE_THRESHOLDS.modUp * s).toFixed(2);
  return `horizon=${horizon} scale=${s}: strong_up≥${strong}% · mod_up ${mod}–${strong}% · range ±${mod}% · mod_down −${strong}–−${mod}% · severe_down≤−${strong}%`;
}
