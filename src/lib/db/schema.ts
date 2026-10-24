/**
 * Centralized, idempotent schema step (B2 get-fix P5). Runs once per DB open from getDb(); request paths never
 * create, alter or drop anything. Tracked by PRAGMA user_version (not a table, so data hashes are unaffected):
 *   user_version < SCHEMA_VERSION  -> apply every CREATE ... IF NOT EXISTS / additive ALTER in one transaction,
 *                                     then set user_version = SCHEMA_VERSION.
 *   user_version >= SCHEMA_VERSION -> no-op (zero writes on open).
 * Any DDL change MUST bump SCHEMA_VERSION; tests/unit/schema-version.test.ts pins the resulting schema fingerprint.
 * All DDL modules imported here are pure (take a db handle, never call getDb) to avoid import cycles.
 */
import type Database from "better-sqlite3";
import { ensureInstrumentTables } from "../instruments/schema";
import { ensureSourceTables } from "../sources/schema";
import { ensureCryptoIntelTables } from "../crypto/intel-schema";
import { ensureIntelTables } from "../intel/schema";
import { ensureHealthTables } from "../sources/health-schema";
import { ensureAuthTables } from "../auth/schema";
import { ensureFlagTable } from "../quality/schema";

/**
 * History: 1 = B2 get-fix baseline (all pre-existing DDL).
 *          2 = + instrument_series_cache (DB-only series GET, guarded prefetch).
 */
export const SCHEMA_VERSION = 2;

export function getSchemaVersion(db: Database.Database): number {
  return (db.pragma("user_version", { simple: true }) as number) ?? 0;
}

/** Every table/index/view the app uses. Idempotent. */
export function applySchema(db: Database.Database): void {
  coreTables(db);
  ensureInstrumentTables(db);
  ensureAuthTables(db);
  ensureSourceTables(db);
  ensureCryptoIntelTables(db);
  ensureIntelTables(db);
  ensureHealthTables(db);
  ensureFlagTable(db);
}

export interface SchemaStepResult {
  from: number;
  to: number;
  applied: boolean;
}

/** Bring the DB to SCHEMA_VERSION. Called once per process on DB open. */
export function runSchemaStep(db: Database.Database): SchemaStepResult {
  const from = getSchemaVersion(db);
  if (from >= SCHEMA_VERSION) {
    if (from > SCHEMA_VERSION) {
      console.warn(`[db] schema user_version ${from} is newer than this build (${SCHEMA_VERSION}); not touching it`);
    }
    return { from, to: from, applied: false };
  }
  db.transaction(() => {
    applySchema(db);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
  return { from, to: SCHEMA_VERSION, applied: true };
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function coreTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Latest quote cache (one row per symbol)
    CREATE TABLE IF NOT EXISTS market_snapshots (
      symbol TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Append-only price history for honest outcome resolution
    CREATE TABLE IF NOT EXISTS market_history (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      price REAL NOT NULL,
      ts TEXT NOT NULL,
      source TEXT NOT NULL,
      quality TEXT NOT NULL,
      bar_kind TEXT NOT NULL,
      note TEXT,
      data TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      published_at TEXT NOT NULL,
      data TEXT NOT NULL,
      quality TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scenarios (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS forecasts (
      id TEXT PRIMARY KEY,
      asset_symbol TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_seed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      horizon_end TEXT,
      resolved_at TEXT,
      brier_score REAL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS warnings (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS risk_gauges (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS causal_graph (
      id TEXT PRIMARY KEY DEFAULT 'current',
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS countries (
      code TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fired_alerts (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      fired_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS portfolio (
      id TEXT PRIMARY KEY DEFAULT 'default',
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_published ON events(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_forecasts_asset ON forecasts(asset_symbol);
    CREATE INDEX IF NOT EXISTS idx_market_history_symbol_ts ON market_history(symbol, ts);

    -- event_cluster_v1: links same-story events to a canonical event. Originals are never deleted.
    CREATE TABLE IF NOT EXISTS event_clusters (
      event_id TEXT PRIMARY KEY,
      canonical_event_id TEXT NOT NULL,
      method TEXT NOT NULL,
      score REAL,
      reasons_json TEXT,
      linked_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_clusters_canonical ON event_clusters(canonical_event_id);
    -- Append-only audit trail of every link / relink / unlink decision.
    CREATE TABLE IF NOT EXISTS event_cluster_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      canonical_event_id TEXT,
      action TEXT NOT NULL,
      method TEXT NOT NULL,
      score REAL,
      reasons_json TEXT,
      at TEXT NOT NULL
    );
  `);

  // Additive migrations for DBs created before resolution columns existed
  const forecastCols = columnNames(db, "forecasts");
  if (!forecastCols.includes("status")) {
    db.exec(`ALTER TABLE forecasts ADD COLUMN status TEXT NOT NULL DEFAULT 'open'`);
  }
  if (!forecastCols.includes("horizon_end")) {
    db.exec(`ALTER TABLE forecasts ADD COLUMN horizon_end TEXT`);
  }
  if (!forecastCols.includes("resolved_at")) {
    db.exec(`ALTER TABLE forecasts ADD COLUMN resolved_at TEXT`);
  }
  if (!forecastCols.includes("brier_score")) {
    db.exec(`ALTER TABLE forecasts ADD COLUMN brier_score REAL`);
  }

  // Batch 3: scenario schema version. Additive and nullable: NULL = written before scenario_v2 ("pre-v2");
  // existing rows keep their data untouched.
  if (!columnNames(db, "scenarios").includes("schema_version")) {
    db.exec(`ALTER TABLE scenarios ADD COLUMN schema_version INTEGER`);
  }

  // Indexes that depend on migrated columns
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_forecasts_status ON forecasts(status);
    CREATE INDEX IF NOT EXISTS idx_forecasts_horizon_end ON forecasts(horizon_end);
  `);

  // One scenario per event: on a DB that does not have the unique index yet, collapse legacy duplicates
  // (keep newest) and create the index. Once the index exists duplicates are impossible, so this never
  // touches rows again (and does not run at all on DBs that already have the index, e.g. production).
  const hasUx = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'ux_scenarios_event_id'`)
    .get();
  if (!hasUx) {
    try {
      db.exec(`
        DELETE FROM scenarios WHERE json_extract(data, '$.eventId') IS NOT NULL AND rowid NOT IN (
          SELECT rowid FROM (
            SELECT rowid, ROW_NUMBER() OVER (
              PARTITION BY json_extract(data, '$.eventId') ORDER BY created_at DESC, rowid DESC
            ) AS rn FROM scenarios WHERE json_extract(data, '$.eventId') IS NOT NULL
          ) WHERE rn = 1
        );
        CREATE UNIQUE INDEX IF NOT EXISTS ux_scenarios_event_id ON scenarios(json_extract(data, '$.eventId'));
      `);
    } catch (e) {
      console.error("[db] ux_scenarios_event_id migration failed:", e);
    }
  }
}
