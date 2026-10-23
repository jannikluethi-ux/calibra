import { refreshMarketData, getMarketSnapshots } from "../market/fetch";
import { backfillHistoricalBars, countHistory } from "../market/history";
import { ingestRssFeeds, ensureDemoEventsIfEmpty, getEvents, reclassifyEventsV2 } from "../ingestion/rss";
import { rebuildScenariosFromEvents, ensureScenarios, getScenarios } from "../scenarios/engine";
import { runEventIntelligence } from "../intel/store";
import {
  refreshForecasts,
  ensureForecasts,
  getForecasts,
  bootstrapShortHorizonForecasts,
} from "../forecast/distributions";
import { resolveDueForecasts, getResolvePipelineStatus } from "../forecast/resolve";
import { computeCalibration } from "../forecast/calibration";
import { persistRiskGauges } from "../risk/gauges";
import { persistCausalGraph } from "../causal/graph";
import { seedCountries, getCountries } from "../countries/profiles";
import { persistWarnings } from "../warnings/detect";
import { ensureDefaultAlerts, evaluateAlerts } from "../alerts/store";
import type { FiredAlert } from "../types";
import { getMeta, setMeta, getDb } from "../db";
import { computeDataQualityLabel } from "../quality/summary";
import { flagInvalidHistoryPrices } from "../quality/flags";
import { runEventClustering } from "../ingestion/cluster";
import { runOfficialRates } from "../sources/adapters/official-rates";
import {
  cleanupExactTitleDuplicateEvents,
  cleanupDuplicateScenariosByEventId,
} from "../ingestion/dedupe";

export interface RefreshResult {
  ok: boolean;
  marketCount: number;
  marketLive: number;
  historyPoints: number;
  historyBackfillInserted: number;
  eventsLive: number;
  eventsDemo: number;
  scenarios: number;
  forecasts: number;
  warnings: number;
  firedAlerts: number;
  firedAlertDetails: FiredAlert[];
  resolve: {
    newlyResolved: number;
    newlyUnresolvable: number;
    examined: number;
    stillOpen: number;
  };
  calibrationLive: {
    resolved: number;
    avgBrier: number | null;
    dirAcc: number | null;
  };
  lastMarketUpdate: string | null;
  lastEventUpdate: string | null;
  dataQuality: string;
  errors: string[];
  changed: { markets: boolean; events: boolean; derive: boolean; maintenance: boolean };
}

export interface MarketsRefreshResult {
  marketCount: number;
  marketLive: number;
  errors: string[];
  changed: boolean;
}

export interface EventsRefreshResult {
  eventsLive: number;
  eventsDemo: number;
  errors: string[];
  changed: boolean;
}

export interface DeriveResult {
  scenarios: number;
  forecasts: number;
  warnings: number;
  firedAlerts: number;
  firedAlertDetails: FiredAlert[];
  resolve: RefreshResult["resolve"];
  calibrationLive: RefreshResult["calibrationLive"];
  dataQuality: string;
  errors: string[];
}

export interface MaintenanceResult {
  historyBackfillInserted: number;
  historyPoints: number;
  errors: string[];
}

function emptyResolve() {
  return { newlyResolved: 0, newlyUnresolvable: 0, examined: 0, stillOpen: 0 };
}

/** Yahoo quotes + append market_history (demo never enters history). */
export async function refreshMarketsOnly(): Promise<MarketsRefreshResult> {
  getDb();
  const errors: string[] = [];
  let marketCount = 0;
  let marketLive = 0;
  try {
    const markets = await refreshMarketData();
    marketCount = markets.length;
    marketLive = markets.filter((m) => m.provenance.quality === "live" && m.price != null).length;
  } catch (e) {
    errors.push(`market: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Official keyless rate sources (corroboration only), at most every 6 h; isolated from Yahoo.
  try {
    const last = Date.parse(getMeta("officialRatesLastRun") ?? "");
    if (!Number.isFinite(last) || Date.now() - last > 6 * 3600_000) {
      setMeta("officialRatesLastRun", new Date().toISOString());
      await runOfficialRates();
    }
  } catch (e) {
    errors.push(`official-rates: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { marketCount, marketLive, errors, changed: marketCount > 0 || errors.length > 0 };
}

/** RSS ingest + classify v2. */
export async function refreshEventsOnly(): Promise<EventsRefreshResult> {
  getDb();
  const errors: string[] = [];
  let eventsLive = 0;
  let eventsDemo = 0;
  try {
    const ing = await ingestRssFeeds();
    eventsLive = ing.live;
    eventsDemo = ing.demo;
    // Per-feed failures are recorded in the source-health registry (source_health), not as job errors.
    ensureDemoEventsIfEmpty();
    reclassifyEventsV2({ limit: 120, onlyOutdated: true });
  } catch (e) {
    errors.push(`events: ${e instanceof Error ? e.message : String(e)}`);
    ensureDemoEventsIfEmpty();
    try {
      reclassifyEventsV2({ limit: 120, onlyOutdated: true });
    } catch (e2) {
      errors.push(`reclassify: ${e2 instanceof Error ? e2.message : String(e2)}`);
    }
  }
  // Link same-story duplicates to a canonical event (originals kept; audited).
  try {
    runEventClustering({ sinceDays: 3 });
  } catch (e) {
    errors.push(`clustering: ${e instanceof Error ? e.message : String(e)}`);
  }
  return {
    eventsLive,
    eventsDemo,
    errors,
    changed: eventsLive > 0 || eventsDemo > 0 || errors.length === 0,
  };
}

/**
 * Derive chain (no Yahoo history backfill):
 * scenarios → forecasts → resolve → calibration → risk → causal → warnings → evaluate alerts
 */
export async function runDeriveOnly(opts?: {
  seedCountries?: boolean;
}): Promise<DeriveResult> {
  getDb();
  const errors: string[] = [];
  let scenarios = 0;
  let forecasts = 0;
  let warnings = 0;
  let firedAlerts = 0;
  let firedAlertDetails: FiredAlert[] = [];
  let resolveSummary = emptyResolve();

  // Event intelligence (Batch 3): assessments, conflicts, documented instrument mappings. Feeds scenario_v2.
  try {
    runEventIntelligence({ sinceDays: 21 });
  } catch (e) {
    errors.push(`event-intel: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    scenarios = rebuildScenariosFromEvents(15).length;
  } catch (e) {
    errors.push(`scenarios: ${e instanceof Error ? e.message : String(e)}`);
    ensureScenarios();
    scenarios = getScenarios().length;
  }

  try {
    forecasts = refreshForecasts().length;
    bootstrapShortHorizonForecasts();
    forecasts = getForecasts().length;
  } catch (e) {
    errors.push(`forecasts: ${e instanceof Error ? e.message : String(e)}`);
    ensureForecasts();
    forecasts = getForecasts().length;
  }

  try {
    const r = resolveDueForecasts();
    resolveSummary = {
      newlyResolved: r.newlyResolved,
      newlyUnresolvable: r.newlyUnresolvable,
      examined: r.examined,
      stillOpen: r.stillOpen,
    };
  } catch (e) {
    errors.push(`resolve: ${e instanceof Error ? e.message : String(e)}`);
  }

  const cal = computeCalibration(undefined, "live");
  try {
    setMeta(
      "lastCalibrationCache",
      JSON.stringify({
        at: new Date().toISOString(),
        liveResolved: cal.liveResolved,
        avgBrier: cal.avgBrier,
        dirAcc: cal.directionalAccuracy,
      })
    );
  } catch (e) {
    errors.push(`calibration: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    persistRiskGauges();
  } catch (e) {
    errors.push(`risk: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    persistCausalGraph();
  } catch (e) {
    errors.push(`causal: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (opts?.seedCountries !== false) {
    try {
      seedCountries();
      getCountries();
    } catch (e) {
      errors.push(`countries: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    warnings = persistWarnings().length;
  } catch (e) {
    errors.push(`warnings: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    ensureDefaultAlerts();
    firedAlertDetails = evaluateAlerts();
    firedAlerts = firedAlertDetails.length;
  } catch (e) {
    errors.push(`alerts: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Recompute quality from current store (freshness, failing sources, invalid values; see quality/summary.ts)
  try {
    flagInvalidHistoryPrices();
  } catch (e) {
    errors.push(`quality-flags: ${e instanceof Error ? e.message : String(e)}`);
  }
  const dq = computeDataQualityLabel();
  setMeta("dataQuality", dq);

  return {
    scenarios,
    forecasts,
    warnings,
    firedAlerts,
    firedAlertDetails,
    resolve: resolveSummary,
    calibrationLive: {
      resolved: cal.totalResolved,
      avgBrier: cal.avgBrier,
      dirAcc: cal.directionalAccuracy,
    },
    dataQuality: dq,
    errors,
  };
}

/** Morning hygiene: history backfill if thin, reclassify leftovers, country seed. */
export async function runDailyMaintenance(): Promise<MaintenanceResult> {
  getDb();
  const errors: string[] = [];
  let historyBackfillInserted = 0;

  try {
    if (countHistory() < 40) {
      const bf = await backfillHistoricalBars();
      historyBackfillInserted = bf.inserted;
      if (bf.errors.length) errors.push(...bf.errors.map((e) => `history: ${e}`));
    }
  } catch (e) {
    errors.push(`historyBackfill: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    reclassifyEventsV2({ limit: 200, onlyOutdated: true });
  } catch (e) {
    errors.push(`reclassify: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    seedCountries();
    getCountries();
  } catch (e) {
    errors.push(`countries: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    ensureDemoEventsIfEmpty();
    ensureScenarios();
    ensureForecasts();
    ensureDefaultAlerts();
  } catch (e) {
    errors.push(`hygiene: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    historyBackfillInserted,
    historyPoints: countHistory(),
    errors,
  };
}

export async function fullRefresh(): Promise<RefreshResult> {
  getDb();
  const priorQuality = getMeta("dataQuality");

  const markets = await refreshMarketsOnly();

  // Backfill Yahoo historical bars once (or if history is thin) so short forecasts can resolve
  let historyBackfillInserted = 0;
  const maintErrors: string[] = [];
  try {
    if (countHistory() < 40) {
      const bf = await backfillHistoricalBars();
      historyBackfillInserted = bf.inserted;
      if (bf.errors.length) maintErrors.push(...bf.errors.map((e) => `history: ${e}`));
    }
  } catch (e) {
    maintErrors.push(`historyBackfill: ${e instanceof Error ? e.message : String(e)}`);
  }

  const events = await refreshEventsOnly();
  const derive = await runDeriveOnly({ seedCountries: true });

  const errors = [...markets.errors, ...maintErrors, ...events.errors, ...derive.errors];

  // Preserve prior quality awareness for callers (noteworthy uses this elsewhere)
  void priorQuality;

  return {
    ok: errors.length === 0,
    marketCount: markets.marketCount,
    marketLive: markets.marketLive,
    historyPoints: countHistory(),
    historyBackfillInserted,
    eventsLive: events.eventsLive,
    eventsDemo: events.eventsDemo,
    scenarios: derive.scenarios,
    forecasts: derive.forecasts,
    warnings: derive.warnings,
    firedAlerts: derive.firedAlerts,
    firedAlertDetails: derive.firedAlertDetails,
    resolve: derive.resolve,
    calibrationLive: derive.calibrationLive,
    lastMarketUpdate: getMeta("lastMarketUpdate"),
    lastEventUpdate: getMeta("lastEventUpdate"),
    dataQuality: derive.dataQuality,
    errors,
    changed: {
      markets: markets.changed,
      events: events.changed,
      derive: true,
      maintenance: historyBackfillInserted > 0,
    },
  };
}

export function ensureSeedData() {
  getDb();
  ensureDemoEventsIfEmpty();
  // One-shot light cleanup of exact title-duplicate events (re-ingest noise). Meta gate.
  if (getMeta("eventDedupeCleanupV1") !== "done") {
    try {
      const ev = cleanupExactTitleDuplicateEvents();
      const sc = cleanupDuplicateScenariosByEventId();
      setMeta("eventDedupeCleanupV1", "done");
      setMeta(
        "eventDedupeCleanupV1Detail",
        JSON.stringify({ at: new Date().toISOString(), ...ev, scenariosCollapsed: sc.deleted })
      );
    } catch {
      /* non-fatal: ingestion dedupe still prevents new dupes */
    }
  }
  ensureScenarios();
  ensureForecasts();
  seedCountries();
  ensureDefaultAlerts();
  if (!getMeta("dataQuality")) setMeta("dataQuality", "demo");
}

/**
 * Data status snapshot. Read-only (B2.2): no seeding — callers that need seed data
 * (POST /api/refresh, scheduler tick, `npm run seed`) call ensureSeedData() themselves.
 * Works on an empty / unseeded DB (zero counts, dataQuality "insufficient").
 */
export function getStatus() {
  const pipeline = getResolvePipelineStatus();
  return {
    lastMarketUpdate: getMeta("lastMarketUpdate"),
    lastEventUpdate: getMeta("lastEventUpdate"),
    lastRiskUpdate: getMeta("lastRiskUpdate"),
    lastResolveRun: pipeline.lastRun,
    dataQuality: (getMeta("dataQuality") as "live" | "degraded" | "stale" | "cached" | "demo" | "insufficient") || "insufficient",
    marketCount: getMarketSnapshots().length,
    historyPoints: countHistory(),
    eventCount: getEvents(500).length,
    resolvePipeline: pipeline,
  };
}
