/** Source health tables. Pure DDL; applied only by the schema step (db/schema.ts). */
import type Database from "better-sqlite3";

export function ensureHealthTables(db: Database.Database): void {
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
