import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { ensureInstrumentTables } from "../instruments/schema";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "gfi.db");

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  dbInstance = new Database(DB_PATH);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");
  dbInstance.pragma("busy_timeout = 10000");
  migrate(dbInstance);
  return dbInstance;
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function migrate(db: Database.Database) {
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

  // Indexes that depend on migrated columns
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_forecasts_status ON forecasts(status);
    CREATE INDEX IF NOT EXISTS idx_forecasts_horizon_end ON forecasts(horizon_end);
  `);

  // One scenario per event: collapse any legacy duplicates (keep newest), then enforce uniqueness
  // on the JSON eventId so fresh and existing DBs both get the constraint.
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

  ensureInstrumentTables(db);
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string) {
  getDb()
    .prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function upsertJson(table: string, idCol: string, id: string, data: unknown, extra?: Record<string, unknown>) {
  const db = getDb();
  const cols = [idCol, "data", ...(extra ? Object.keys(extra) : [])];
  const placeholders = cols.map(() => "?").join(",");
  const updates = cols
    .filter((c) => c !== idCol)
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  const values = [id, JSON.stringify(data), ...(extra ? Object.values(extra) : [])];
  db.prepare(
    `INSERT INTO ${table}(${cols.join(",")}) VALUES(${placeholders}) ON CONFLICT(${idCol}) DO UPDATE SET ${updates}`
  ).run(...values);
}

export function getJsonAll<T>(table: string, orderBy?: string): T[] {
  const sql = orderBy ? `SELECT data FROM ${table} ORDER BY ${orderBy}` : `SELECT data FROM ${table}`;
  const rows = getDb().prepare(sql).all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as T);
}

export function getJsonById<T>(table: string, idCol: string, id: string): T | null {
  const row = getDb().prepare(`SELECT data FROM ${table} WHERE ${idCol} = ?`).get(id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as T) : null;
}

export function deleteById(table: string, idCol: string, id: string) {
  getDb().prepare(`DELETE FROM ${table} WHERE ${idCol} = ?`).run(id);
}
