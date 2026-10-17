/**
 * Data-quality summary: is the data current, which sources fail, which asset classes lack valid
 * quotes, which values are stale/carried forward/invalid, which outputs are affected, which
 * calculations were skipped, and which scenarios run on degraded inputs.
 * The overall label is never "live" when a critical input (markets, events) is stale.
 * Reads the DB only; no provider calls.
 */
import { getDb, getMeta } from "../db";
import { listSourceHealth, type SourceHealthRow } from "../sources/health";
import type { MarketSnapshot } from "../types";

export type OverallQuality = "live" | "degraded" | "stale" | "demo" | "insufficient";

const H = 3600_000;
export const FRESHNESS = {
  marketsRetrievalMaxAgeMs: 3 * H, // scheduler pulls hourly off-session and faster in session
  marketsMinValidQuotes: 12,
  eventsIngestMaxAgeMs: 6 * H,
  eventsNewestPublishedMaxAgeMs: 48 * H,
  cryptoMaxAgeMs: 24 * H,
};

function ageH(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.round(((now - t) / H) * 10) / 10 : null;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export interface DataQualitySummary {
  generatedAt: string;
  overall: OverallQuality;
  reasons: string[];
  inputs: {
    markets: { status: "fresh" | "stale" | "missing"; lastSuccessAt: string | null; ageHours: number | null; valid: number; carriedForward: number; missingOrInvalid: number; total: number };
    events: { status: "fresh" | "stale" | "demo_only" | "missing"; lastLiveIngestAt: string | null; ingestAgeHours: number | null; newestPublishedAt: string | null; newestAgeHours: number | null; liveLast48h: number; topSourceShare30d: { source: string; share: number } | null };
    crypto: { status: "fresh" | "stale" | "missing"; lastObservationAt: string | null; ageHours: number | null; riskScoresComputedAt: string | null };
  };
  failingSources: Pick<SourceHealthRow, "sourceId" | "name" | "status" | "errorClass" | "consecutiveFailures" | "lastSuccessAt" | "dataAgeHours" | "lastError" | "downstream" | "critical">[];
  assetClassCoverage: Record<string, { total: number; valid: number; carriedForward: number; missingOrInvalid: number }>;
  staleValues: { symbol: string; state: "carried_forward" | "missing" | "invalid"; lastValidAt: string | null; note: string | null }[];
  invalidHistoryRows: { symbol: string; rows: number; flagged: boolean }[];
  affectedOutputs: string[];
  skippedCalculations: string[];
  scenariosReducedConfidence: { count: number; examined: number; sample: { id: string; title: string; degradedAssets: string[] }[] };
  corroboration: { pair: string; primary: string | null; secondary: string | null; note: string }[];
}

export function computeDataQualitySummary(nowIso = new Date().toISOString()): DataQualitySummary {
  const db = getDb();
  const now = Date.parse(nowIso);
  const reasons: string[] = [];

  // ---- markets
  const snaps = safe(
    () => (db.prepare(`SELECT data FROM market_snapshots`).all() as { data: string }[]).map((r) => JSON.parse(r.data) as MarketSnapshot),
    [] as MarketSnapshot[]
  );
  const isValid = (s: MarketSnapshot) => typeof s.price === "number" && Number.isFinite(s.price) && s.price > 0;
  const fresh = snaps.filter((s) => isValid(s) && !s.provenance.carriedForward && s.provenance.quality === "live");
  const carried = snaps.filter((s) => isValid(s) && (s.provenance.carriedForward || s.provenance.quality === "cached"));
  const bad = snaps.filter((s) => !isValid(s) || s.provenance.quality === "demo");
  const lastMarket = getMeta("lastMarketUpdate");
  const mAge = ageH(lastMarket, now);
  const marketsStatus: "fresh" | "stale" | "missing" =
    !snaps.length || fresh.length === 0
      ? "missing"
      : mAge != null && mAge * H <= FRESHNESS.marketsRetrievalMaxAgeMs && fresh.length >= FRESHNESS.marketsMinValidQuotes
        ? "fresh"
        : "stale";
  if (marketsStatus !== "fresh") reasons.push(`markets ${marketsStatus}: last successful pull ${lastMarket ?? "never"}, ${fresh.length}/${snaps.length} fresh valid quotes`);

  const coverage: DataQualitySummary["assetClassCoverage"] = {};
  const staleValues: DataQualitySummary["staleValues"] = [];
  for (const s of snaps) {
    const c = (coverage[s.category] ??= { total: 0, valid: 0, carriedForward: 0, missingOrInvalid: 0 });
    c.total++;
    if (fresh.includes(s)) c.valid++;
    else if (carried.includes(s)) {
      c.carriedForward++;
      staleValues.push({ symbol: s.symbol, state: "carried_forward", lastValidAt: s.provenance.fetchedAt, note: s.provenance.note ?? null });
    } else {
      c.missingOrInvalid++;
      const invalid = s.provenance.errorClass === "invalid_data" || s.price === 0;
      staleValues.push({ symbol: s.symbol, state: invalid ? "invalid" : "missing", lastValidAt: null, note: s.provenance.note ?? (s.price === 0 ? "price 0 from source (invalid)" : null) });
    }
  }
  if (staleValues.length) reasons.push(`${staleValues.length} market value(s) not fresh: ${staleValues.map((v) => `${v.symbol}=${v.state}`).join(", ")}`);

  const invalidHistoryRows = safe(() => {
    const rows = db.prepare(`SELECT symbol, COUNT(*) AS n FROM market_history WHERE price <= 0 GROUP BY symbol`).all() as { symbol: string; n: number }[];
    const hasFlags = !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='data_quality_flags'`).get();
    return rows.map((r) => ({
      symbol: r.symbol,
      rows: r.n,
      flagged: hasFlags ? ((db.prepare(`SELECT COUNT(*) AS c FROM data_quality_flags WHERE record_table='market_history' AND flag='invalid_price' AND symbol = ?`).get(r.symbol) as { c: number }).c >= r.n) : false,
    }));
  }, [] as DataQualitySummary["invalidHistoryRows"]);

  // ---- events
  const lastLive = getMeta("lastEventUpdate");
  const newest = safe(() => (db.prepare(`SELECT MAX(published_at) AS m FROM events WHERE quality = 'live'`).get() as { m: string | null }).m, null);
  const live48 = safe(
    () => (db.prepare(`SELECT COUNT(*) AS c FROM events WHERE quality = 'live' AND published_at >= ?`).get(new Date(now - 48 * H).toISOString()) as { c: number }).c,
    0
  );
  const nonDemo = safe(() => (db.prepare(`SELECT COUNT(*) AS c FROM events WHERE quality != 'demo'`).get() as { c: number }).c, 0);
  const iAge = ageH(lastLive, now);
  const nAge = ageH(newest, now);
  const eventsStatus: DataQualitySummary["inputs"]["events"]["status"] =
    nonDemo === 0
      ? safe(() => ((db.prepare(`SELECT COUNT(*) AS c FROM events`).get() as { c: number }).c > 0 ? "demo_only" : "missing"), "missing")
      : iAge != null && iAge * H <= FRESHNESS.eventsIngestMaxAgeMs && nAge != null && nAge * H <= FRESHNESS.eventsNewestPublishedMaxAgeMs
        ? "fresh"
        : "stale";
  if (eventsStatus !== "fresh") reasons.push(`events ${eventsStatus}: last live ingest ${lastLive ?? "never"}, newest live item ${newest ?? "none"}`);
  const top = safe(() => {
    const rows = db
      .prepare(`SELECT json_extract(data, '$.sourceName') AS s, COUNT(*) AS n FROM events WHERE quality='live' AND published_at >= ? GROUP BY s ORDER BY n DESC`)
      .all(new Date(now - 30 * 24 * H).toISOString()) as { s: string; n: number }[];
    const tot = rows.reduce((a, r) => a + r.n, 0);
    return rows.length && tot ? { source: rows[0].s, share: Math.round((rows[0].n / tot) * 1000) / 1000 } : null;
  }, null);
  if (top && top.share > 0.8) reasons.push(`event source concentration: ${Math.round(top.share * 100)}% of live events in 30 days from ${top.source}`);

  // ---- crypto
  const lastObs = safe(() => (db.prepare(`SELECT MAX(retrieved_at) AS m FROM source_observations WHERE instrument_id NOT LIKE 'rates:%'` /* official rates are not crypto inputs */).get() as { m: string | null }).m, null);
  const riskAt = safe(() => (db.prepare(`SELECT MAX(computed_at) AS m FROM crypto_risk_assessments`).get() as { m: string | null }).m, null);
  const cAge = ageH(lastObs, now);
  const cryptoStatus: "fresh" | "stale" | "missing" = !lastObs ? "missing" : cAge != null && cAge * H <= FRESHNESS.cryptoMaxAgeMs ? "fresh" : "stale";
  if (cryptoStatus !== "fresh") reasons.push(`crypto source data ${cryptoStatus}: last provider observation ${lastObs ?? "never"} (${cAge ?? "?"} h old)`);

  // ---- sources
  const health = safe(() => listSourceHealth(nowIso), [] as SourceHealthRow[]);
  const failingSources = health
    .filter((h) => ["failing", "degraded", "stale", "disabled"].includes(h.status))
    .map((h) => ({ sourceId: h.sourceId, name: h.name, status: h.status, errorClass: h.errorClass, consecutiveFailures: h.consecutiveFailures, lastSuccessAt: h.lastSuccessAt, dataAgeHours: h.dataAgeHours, lastError: h.lastError, downstream: h.downstream, critical: h.critical }));
  const failingActive = failingSources.filter((f) => f.status !== "disabled");
  if (failingActive.length) reasons.push(`${failingActive.length} source(s) failing/stale: ${failingActive.map((f) => `${f.sourceId}=${f.status}/${f.errorClass}`).join(", ")}`);

  // ---- affected outputs & skipped calculations
  const affected = new Set<string>();
  const skipped: string[] = [];
  for (const v of staleValues) {
    affected.add(`market snapshot ${v.symbol}`);
    if (v.state !== "carried_forward") skipped.push(`${v.symbol}: no valid quote → excluded from movers ranking, new forecast origin prices and outcome resolution (no value substituted)`);
  }
  if (marketsStatus !== "fresh") ["movers", "risk gauges", "forecast origin prices", "forecast resolution"].forEach((o) => affected.add(o));
  if (eventsStatus !== "fresh") ["scenarios", "warnings", "digest"].forEach((o) => affected.add(o));
  if (cryptoStatus !== "fresh") {
    ["crypto canonical prices", "crypto risk scores", "crypto coverage"].forEach((o) => affected.add(o));
    skipped.push(`crypto risk scores not recomputed since ${riskAt ?? "never"} (crypto source sync is manual: scripts/sync-crypto-sources.ts)`);
  }
  for (const f of failingActive) f.downstream.forEach((d) => affected.add(`${d} (via ${f.sourceId})`));
  for (const r of invalidHistoryRows) skipped.push(`market_history ${r.symbol}: ${r.rows} non-positive price rows ignored by history reads and resolution (rows kept; flagged=${r.flagged})`);

  // ---- scenarios on degraded inputs
  const degradedSyms = new Set(staleValues.map((v) => v.symbol));
  if (marketsStatus !== "fresh") snaps.forEach((s) => degradedSyms.add(s.symbol));
  const scen = safe(() => {
    const rows = db
      .prepare(
        `SELECT id, json_extract(data,'$.title') AS title, json_extract(data,'$.affectedAssets') AS aa FROM scenarios
         WHERE COALESCE((SELECT e.quality FROM events e WHERE e.id = json_extract(scenarios.data,'$.eventId')),'') != 'demo'
         ORDER BY created_at DESC LIMIT 200`
      )
      .all() as { id: string; title: string; aa: string | null }[];
    const hit = rows
      .map((r) => {
        let aa: string[] = [];
        try {
          aa = JSON.parse(r.aa ?? "[]");
        } catch {
          /* ignore */
        }
        return { id: r.id, title: r.title, degradedAssets: aa.filter((a) => degradedSyms.has(a)) };
      })
      .filter((r) => r.degradedAssets.length);
    return { count: hit.length, examined: rows.length, sample: hit.slice(0, 8) };
  }, { count: 0, examined: 0, sample: [] });

  // ---- corroboration (official rates vs market proxies)
  const corroboration = safe(() => {
    const latest = (inst: string, field: string) =>
      db.prepare(`SELECT value_json, observed_at FROM source_observations WHERE instrument_id = ? AND field = ? ORDER BY observed_at DESC, retrieved_at DESC LIMIT 1`).get(inst, field) as
        | { value_json: string; observed_at: string }
        | undefined;
    const snap = (sym: string) => snaps.find((s) => s.symbol === sym);
    const out: DataQualitySummary["corroboration"] = [];
    const u10 = latest("rates:UST10Y", "yield_pct");
    const u2 = latest("rates:UST2Y", "yield_pct");
    const de = latest("rates:DE10Y", "yield_pct");
    const y10 = snap("US10Y");
    const y2 = snap("US2Y");
    if (u10) out.push({ pair: "US10Y: Yahoo ^TNX vs U.S. Treasury 10Y par yield", primary: `${JSON.parse(u10.value_json)}% (${u10.observed_at})`, secondary: y10?.price != null ? `${y10.price}` : null, note: y10?.price != null ? `difference ${Math.round((y10.price - Number(JSON.parse(u10.value_json))) * 100) / 100} pp` : "no Yahoo value" });
    if (u2) out.push({ pair: "US2Y: Yahoo ^IRX (13-week bill proxy) vs U.S. Treasury 2Y par yield", primary: `${JSON.parse(u2.value_json)}% (${u2.observed_at})`, secondary: y2?.price != null ? `${y2.price}` : null, note: "proxy is a 13-week bill rate, not a 2Y yield; the official 2Y value is shown for context only" });
    if (de) out.push({ pair: "DE10Y: Yahoo BUND.DE ETF proxy vs Bundesbank 10Y Bund yield", primary: `${JSON.parse(de.value_json)}% (${de.observed_at})`, secondary: snap("DE10Y")?.price != null ? `${snap("DE10Y")!.price}` : "no valid proxy quote", note: "different units (ETF price vs yield); official yield is the authoritative series" });
    return out;
  }, [] as DataQualitySummary["corroboration"]);

  // ---- overall label
  let overall: OverallQuality;
  if (marketsStatus === "missing" && (eventsStatus === "missing" || eventsStatus === "demo_only")) overall = eventsStatus === "demo_only" ? "demo" : "insufficient";
  else if (marketsStatus !== "fresh" || eventsStatus !== "fresh") overall = "stale";
  else if (reasons.length) overall = "degraded";
  else overall = "live";

  return {
    generatedAt: nowIso,
    overall,
    reasons,
    inputs: {
      markets: { status: marketsStatus, lastSuccessAt: lastMarket, ageHours: mAge, valid: fresh.length, carriedForward: carried.length, missingOrInvalid: bad.length, total: snaps.length },
      events: { status: eventsStatus, lastLiveIngestAt: lastLive, ingestAgeHours: iAge, newestPublishedAt: newest, newestAgeHours: nAge, liveLast48h: live48, topSourceShare30d: top },
      crypto: { status: cryptoStatus, lastObservationAt: lastObs, ageHours: cAge, riskScoresComputedAt: riskAt },
    },
    failingSources,
    assetClassCoverage: coverage,
    staleValues,
    invalidHistoryRows,
    affectedOutputs: Array.from(affected),
    skippedCalculations: skipped,
    scenariosReducedConfidence: scen,
    corroboration,
  };
}

/** The single label stored in meta.dataQuality and shown in the status bar. */
export function computeDataQualityLabel(nowIso?: string): OverallQuality {
  return safe(() => computeDataQualitySummary(nowIso).overall, "insufficient" as OverallQuality);
}
