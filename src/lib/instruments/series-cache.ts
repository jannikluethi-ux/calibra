/**
 * DB-only price series (B2 get-fix P2). GET /api/instruments/[id]/series reads this cache and never contacts a
 * provider. The cache is filled only by the token-guarded POST on the same route (see prefetchSeries), which adds a
 * per-(instrument, range) single-flight + minimum interval (job-guard), a freshness TTL, a provider timeout and a
 * provider-level minimum gap. Provider errors are returned as 503 and never overwrite a cached series.
 */
import { getDb } from "../db";
import type { InstrumentRow } from "./store";
import { loadSeries, SERIES_RANGES, type SeriesRange, type SeriesResult } from "./series";

export interface CachedSeries extends SeriesResult {
  cached: boolean;
  fetchedAt: string | null;
}

const DEFAULT_TTL_S = 900;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_PROVIDER_GAP_MS = 2_000;

function envNum(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

export function isSeriesRange(r: string): r is SeriesRange {
  return (SERIES_RANGES as readonly string[]).includes(r);
}

/** Pure read. Never fetches. */
export function getCachedSeries(instrumentId: string, range: string): CachedSeries {
  if (!isSeriesRange(range)) {
    return { range, supported: false, points: [], source: null, note: "Data unavailable", cached: false, fetchedAt: null };
  }
  const row = getDb()
    .prepare(`SELECT fetched_at, source, note, points_json FROM instrument_series_cache WHERE instrument_id = ? AND range = ?`)
    .get(instrumentId, range) as { fetched_at: string; source: string | null; note: string; points_json: string } | undefined;
  if (!row) {
    return {
      range,
      supported: false,
      points: [],
      source: null,
      note: "Awaiting first prefetch (series are served from stored data only)",
      cached: false,
      fetchedAt: null,
    };
  }
  let points: SeriesResult["points"] = [];
  try {
    points = JSON.parse(row.points_json);
  } catch {
    points = [];
  }
  return { range, supported: points.length > 0, points, source: row.source, note: row.note, cached: true, fetchedAt: row.fetched_at };
}

type Loader = (inst: InstrumentRow, range: string, signal: AbortSignal) => Promise<SeriesResult>;

declare global {
  // eslint-disable-next-line no-var
  var __calibraSeriesProviderLast: Map<string, number> | undefined;
}
function providerLast(): Map<string, number> {
  if (!globalThis.__calibraSeriesProviderLast) globalThis.__calibraSeriesProviderLast = new Map();
  return globalThis.__calibraSeriesProviderLast;
}
/** Test helper. */
export function resetSeriesProviderGap(): void {
  globalThis.__calibraSeriesProviderLast = new Map();
}

export type PrefetchOutcome =
  | { status: 200; body: CachedSeries & { fetched: boolean } }
  | { status: 400 | 429 | 503; body: { error: string; retryAfterS?: number } };

/**
 * Fetch one series from its provider and store it. Called only from the guarded POST handler.
 * - fresh cache (younger than CALIBRA_SERIES_TTL_S, default 900 s) -> returned without a provider call
 * - provider gap (CALIBRA_SERIES_PROVIDER_GAP_MS, default 2000 ms per provider) -> 429
 * - timeout (CALIBRA_SERIES_TIMEOUT_MS, default 10 s), network error or "Data unavailable" -> 503, cache untouched
 */
export async function prefetchSeries(
  inst: InstrumentRow,
  range: string,
  opts: { loader?: Loader; now?: () => number } = {}
): Promise<PrefetchOutcome> {
  if (!isSeriesRange(range)) return { status: 400, body: { error: `Unknown range '${range}'.` } };
  const now = opts.now ?? Date.now;
  const ttlMs = envNum("CALIBRA_SERIES_TTL_S", DEFAULT_TTL_S) * 1000;
  const cur = getCachedSeries(inst.id, range);
  if (cur.cached && cur.fetchedAt && now() - Date.parse(cur.fetchedAt) < ttlMs) {
    return { status: 200, body: { ...cur, fetched: false } };
  }
  const provider = inst.data_source || "unknown";
  const gap = envNum("CALIBRA_SERIES_PROVIDER_GAP_MS", DEFAULT_PROVIDER_GAP_MS);
  const last = providerLast().get(provider);
  if (last !== undefined && gap > 0 && now() - last < gap) {
    const retry = Math.max(1, Math.ceil((gap - (now() - last)) / 1000));
    return { status: 429, body: { error: `Provider '${provider}' was called recently; retry later.`, retryAfterS: retry } };
  }
  providerLast().set(provider, now());
  const timeoutMs = envNum("CALIBRA_SERIES_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: SeriesResult;
  try {
    const loader: Loader = opts.loader ?? ((i, r, signal) => loadSeries(i, r, signal));
    res = await Promise.race([
      loader(inst, range, ac.signal),
      new Promise<never>((_, rej) => ac.signal.addEventListener("abort", () => rej(new Error("timeout")), { once: true })),
    ]);
  } catch (e) {
    const msg = e instanceof Error && e.message === "timeout" ? "Provider timed out." : "Provider request failed.";
    return { status: 503, body: { error: msg } };
  } finally {
    clearTimeout(timer);
  }
  if (!res.supported || !res.points.length) {
    return { status: 503, body: { error: "Provider returned no data for this range." } };
  }
  const fetchedAt = new Date(now()).toISOString();
  getDb()
    .prepare(
      `INSERT INTO instrument_series_cache (instrument_id, range, fetched_at, source, note, points_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(instrument_id, range) DO UPDATE SET
         fetched_at = excluded.fetched_at, source = excluded.source, note = excluded.note, points_json = excluded.points_json`
    )
    .run(inst.id, range, fetchedAt, res.source, res.note, JSON.stringify(res.points));
  return { status: 200, body: { ...getCachedSeries(inst.id, range), fetched: true } };
}
