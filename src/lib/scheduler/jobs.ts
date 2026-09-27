/**
 * Named scheduler job runners. Each records last-run meta in SQLite.
 * Never invents market/event data; demo quotes never enter market_history
 * (enforced inside refreshMarketData / persistSnapshotsToHistory).
 */
import {
  refreshMarketsOnly,
  refreshEventsOnly,
  runDeriveOnly,
  runDailyMaintenance,
  type MarketsRefreshResult,
  type EventsRefreshResult,
  type DeriveResult,
  type MaintenanceResult,
} from "../bootstrap/refresh";
import { getMeta, setMeta } from "../db";
import { getAlerts } from "../alerts/store";
import type { FiredAlert } from "../types";

export const JOB_NAMES = [
  "markets-fast",
  "markets-slow",
  "events",
  "derive",
  "daily-maintenance",
] as const;

export type JobName = (typeof JOB_NAMES)[number];

export const META_LAST: Record<JobName, string> = {
  "markets-fast": "scheduler.last.markets-fast",
  "markets-slow": "scheduler.last.markets-slow",
  events: "scheduler.last.events",
  derive: "scheduler.last.derive",
  "daily-maintenance": "scheduler.last.daily-maintenance",
};

export const META_LAST_ERROR: Record<JobName, string> = {
  "markets-fast": "scheduler.error.markets-fast",
  "markets-slow": "scheduler.error.markets-slow",
  events: "scheduler.error.events",
  derive: "scheduler.error.derive",
  "daily-maintenance": "scheduler.error.daily-maintenance",
};

export interface JobRunResult {
  job: JobName;
  ok: boolean;
  errors: string[];
  detail: Record<string, unknown>;
  firedAlertDetails?: FiredAlert[];
  dataQuality?: string;
  changed?: boolean;
}

function stamp(job: JobName, errors: string[]) {
  const now = new Date().toISOString();
  setMeta(META_LAST[job], now);
  if (errors.length) setMeta(META_LAST_ERROR[job], JSON.stringify({ at: now, errors }));
  else setMeta(META_LAST_ERROR[job], "");
  return now;
}

export function getLastRun(job: JobName): string | null {
  return getMeta(META_LAST[job]);
}

export function getAllLastRuns(): Record<JobName, string | null> {
  const out = {} as Record<JobName, string | null>;
  for (const j of JOB_NAMES) out[j] = getLastRun(j);
  return out;
}

/** Fast session market pull (Yahoo + history append). */
export async function runMarketsFast(): Promise<JobRunResult> {
  const r: MarketsRefreshResult = await refreshMarketsOnly();
  stamp("markets-fast", r.errors);
  // Also stamp markets-slow so overnight hourly doesn't double-pull right after a session tick
  if (r.errors.length === 0) setMeta(META_LAST["markets-slow"], getMeta(META_LAST["markets-fast"])!);
  return {
    job: "markets-fast",
    ok: r.errors.length === 0,
    errors: r.errors,
    detail: { marketCount: r.marketCount, marketLive: r.marketLive },
    changed: r.changed,
  };
}

/** Light / off-hours market pull (same Yahoo path; no history backfill). */
export async function runMarketsSlow(): Promise<JobRunResult> {
  const r: MarketsRefreshResult = await refreshMarketsOnly();
  stamp("markets-slow", r.errors);
  if (r.errors.length === 0) setMeta(META_LAST["markets-fast"], getMeta(META_LAST["markets-slow"])!);
  return {
    job: "markets-slow",
    ok: r.errors.length === 0,
    errors: r.errors,
    detail: { marketCount: r.marketCount, marketLive: r.marketLive, mode: "slow" },
    changed: r.changed,
  };
}

export async function runEvents(): Promise<JobRunResult> {
  const r: EventsRefreshResult = await refreshEventsOnly();
  stamp("events", r.errors);
  return {
    job: "events",
    ok: r.errors.length === 0,
    errors: r.errors,
    detail: { eventsLive: r.eventsLive, eventsDemo: r.eventsDemo },
    changed: r.changed,
  };
}

export async function runDerive(): Promise<JobRunResult> {
  const r: DeriveResult = await runDeriveOnly({ seedCountries: true });
  stamp("derive", r.errors);
  return {
    job: "derive",
    ok: r.errors.length === 0,
    errors: r.errors,
    detail: {
      scenarios: r.scenarios,
      forecasts: r.forecasts,
      warnings: r.warnings,
      firedAlerts: r.firedAlerts,
      resolve: r.resolve,
      calibrationLive: r.calibrationLive,
    },
    firedAlertDetails: r.firedAlertDetails,
    dataQuality: r.dataQuality,
    changed: true,
  };
}

export async function runDailyMaintenanceJob(): Promise<JobRunResult> {
  const r: MaintenanceResult = await runDailyMaintenance();
  stamp("daily-maintenance", r.errors);
  return {
    job: "daily-maintenance",
    ok: r.errors.length === 0,
    errors: r.errors,
    detail: {
      historyBackfillInserted: r.historyBackfillInserted,
      historyPoints: r.historyPoints,
    },
    changed: r.historyBackfillInserted > 0,
  };
}

/**
 * High-impact alert threshold for noteworthy ticks:
 * - metric `high_impact_event` (default rule threshold ≥ 70 composite)
 * - metric `risk_gauge` (default ≥ 70)
 * - metric `vix_level` (default ≥ 25)
 */
export const HIGH_IMPACT_METRICS = new Set(["high_impact_event", "risk_gauge", "vix_level"]);

export function isHighImpactFired(fa: FiredAlert): boolean {
  const rules = getAlerts();
  const rule = rules.find((r) => r.id === fa.ruleId);
  if (!rule) {
    return /high-impact event|risk gauge .+ ≥ 7\d|vix .+ ≥ 2[5-9]|vix .+ ≥ [3-9]/i.test(fa.message);
  }
  if (rule.metric === "high_impact_event" && rule.threshold >= 70) return true;
  if (rule.metric === "risk_gauge" && rule.threshold >= 70) return true;
  if (rule.metric === "vix_level" && rule.threshold >= 25) return true;
  return false;
}

export async function runNamedJob(name: JobName): Promise<JobRunResult> {
  switch (name) {
    case "markets-fast":
      return runMarketsFast();
    case "markets-slow":
      return runMarketsSlow();
    case "events":
      return runEvents();
    case "derive":
      return runDerive();
    case "daily-maintenance":
      return runDailyMaintenanceJob();
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown job: ${_exhaustive}`);
    }
  }
}
