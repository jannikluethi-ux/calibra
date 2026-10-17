/**
 * Source-health registry (SQLite). One row per source in `source_health` (current state) and an
 * append-only, size-capped `source_fetch_log` (one row per attempt). Additive tables only.
 */
import type Database from "better-sqlite3";
import { getDb } from "../db";
import {
  emptyHealth,
  nextHealthState,
  shouldSkip,
  dataAgeMs,
  type AttemptOutcome,
  type HealthState,
} from "./health-core";

export interface TrackedSource {
  id: string;
  name: string;
  kind: "news" | "market_data" | "crypto" | "official_rates";
  /** Freshness budget for the newest observation (ms). */
  maxAgeMs: number;
  /** Critical inputs drive the overall "live" label. */
  critical: boolean;
  downstream: string[];
}

const H = 3600_000;
export const TRACKED_SOURCES: TrackedSource[] = [
  { id: "rss_federal_reserve", name: "Federal Reserve Press (RSS)", kind: "news", maxAgeMs: 7 * 24 * H, critical: false, downstream: ["events", "scenarios", "warnings", "digest"] },
  { id: "rss_ecb", name: "ECB Press (RSS)", kind: "news", maxAgeMs: 7 * 24 * H, critical: false, downstream: ["events", "scenarios", "warnings", "digest"] },
  { id: "rss_imf", name: "IMF News (RSS)", kind: "news", maxAgeMs: 14 * 24 * H, critical: false, downstream: ["events", "scenarios"] },
  { id: "rss_reuters", name: "Reuters Business (RSS)", kind: "news", maxAgeMs: 24 * H, critical: false, downstream: ["events", "scenarios"] },
  { id: "rss_cnbc", name: "CNBC Top News (RSS)", kind: "news", maxAgeMs: 24 * H, critical: false, downstream: ["events", "scenarios", "warnings", "digest"] },
  { id: "yahoo_markets", name: "Yahoo Finance chart (21-symbol market universe)", kind: "market_data", maxAgeMs: 80 * H, critical: true, downstream: ["market snapshots", "movers", "forecast origin prices", "forecast resolution", "risk gauges", "alerts"] },
  { id: "ust_yield_curve", name: "U.S. Treasury daily par yield curve (CSV)", kind: "official_rates", maxAgeMs: 5 * 24 * H, critical: false, downstream: ["rates corroboration (data-quality summary)"] },
  { id: "bundesbank_yields", name: "Deutsche Bundesbank 10Y Bund yield (SDMX CSV)", kind: "official_rates", maxAgeMs: 5 * 24 * H, critical: false, downstream: ["rates corroboration (data-quality summary)"] },
  { id: "coingecko", name: "CoinGecko (markets top 1,000, simple/price, global, categories, contracts, daily charts)", kind: "crypto", maxAgeMs: 24 * H, critical: false, downstream: ["crypto asset profiles", "crypto canonical prices", "crypto risk scores (v2)", "crypto high-risk list", "crypto coverage"] },
  { id: "coingecko_project", name: "CoinGecko coin detail", kind: "crypto", maxAgeMs: 7 * 24 * H, critical: false, downstream: ["crypto research pages"] },
  { id: "coinbase", name: "Coinbase Exchange ticker", kind: "crypto", maxAgeMs: 24 * H, critical: false, downstream: ["crypto canonical prices", "crypto risk scores"] },
  { id: "defillama", name: "DefiLlama protocols", kind: "crypto", maxAgeMs: 24 * H, critical: false, downstream: ["crypto TVL observations", "protocol id -> CoinGecko id map"] },
  { id: "defillama_hacks", name: "DefiLlama hacks database", kind: "crypto", maxAgeMs: 3 * 24 * H, critical: false, downstream: ["crypto security factor (risk v2)", "crypto detail pages"] },
];

export function trackedSource(id: string): TrackedSource | undefined {
  return TRACKED_SOURCES.find((s) => s.id === id);
}

export function ensureHealthTables(db: Database.Database = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_health (
      source_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_fetch_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      attempted_at TEXT NOT NULL,
      ok INTEGER NOT NULL,
      error_class TEXT NOT NULL,
      http_status INTEGER,
      latency_ms INTEGER,
      items INTEGER,
      newest_observation_at TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_fetch_log_source ON source_fetch_log(source_id, attempted_at);
  `);
}

export function getHealth(sourceId: string): HealthState | null {
  ensureHealthTables();
  const row = getDb().prepare(`SELECT state_json FROM source_health WHERE source_id = ?`).get(sourceId) as { state_json: string } | undefined;
  return row ? (JSON.parse(row.state_json) as HealthState) : null;
}

const LOG_CAP = 20000;

/** Record one attempt; returns the new state. Never throws (health tracking must not break ingestion). */
export function recordAttempt(sourceId: string, outcome: AttemptOutcome, nowIso = new Date().toISOString()): HealthState | null {
  try {
    const db = getDb();
    ensureHealthTables(db);
    const prev = getHealth(sourceId) ?? emptyHealth(sourceId);
    const maxAge = trackedSource(sourceId)?.maxAgeMs ?? 24 * H;
    const next = nextHealthState(prev, outcome, nowIso, maxAge);
    db.prepare(
      `INSERT INTO source_health(source_id, state_json, updated_at) VALUES(?, ?, ?)
       ON CONFLICT(source_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
    ).run(sourceId, JSON.stringify(next), nowIso);
    db.prepare(
      `INSERT INTO source_fetch_log(source_id, attempted_at, ok, error_class, http_status, latency_ms, items, newest_observation_at, error)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sourceId,
      nowIso,
      outcome.ok ? 1 : 0,
      next.errorClass ?? outcome.errorClass,
      outcome.httpStatus ?? null,
      outcome.latencyMs != null ? Math.round(outcome.latencyMs) : null,
      outcome.items ?? null,
      outcome.newestObservationAt ?? null,
      outcome.error ? outcome.error.slice(0, 300) : null
    );
    const n = (db.prepare(`SELECT COUNT(*) AS c FROM source_fetch_log`).get() as { c: number }).c;
    if (n > LOG_CAP) db.prepare(`DELETE FROM source_fetch_log WHERE id IN (SELECT id FROM source_fetch_log ORDER BY id ASC LIMIT ?)`).run(n - LOG_CAP);
    return next;
  } catch {
    return null;
  }
}

export function skipCheck(sourceId: string, nowIso = new Date().toISOString()) {
  return shouldSkip(getHealth(sourceId), nowIso);
}

export interface SourceHealthRow extends HealthState {
  name: string;
  kind: TrackedSource["kind"];
  critical: boolean;
  downstream: string[];
  maxAgeHours: number;
  dataAgeHours: number | null;
}

/** Current health for every tracked source (sources never attempted show status "unknown"). */
export function listSourceHealth(nowIso = new Date().toISOString()): SourceHealthRow[] {
  return TRACKED_SOURCES.map((t) => {
    const st = getHealth(t.id) ?? emptyHealth(t.id);
    // Re-evaluate staleness at read time: a healthy source with an old last observation is stale now.
    const age = dataAgeMs(st, nowIso);
    const status = st.status === "healthy" && age != null && age > t.maxAgeMs ? "stale" : st.status;
    return {
      ...st,
      status,
      errorClass: status === "stale" && st.errorClass === "ok" ? "stale" : st.errorClass,
      name: t.name,
      kind: t.kind,
      critical: t.critical,
      downstream: t.downstream,
      maxAgeHours: Math.round(t.maxAgeMs / H),
      dataAgeHours: age != null ? Math.round((age / H) * 10) / 10 : null,
    };
  });
}
