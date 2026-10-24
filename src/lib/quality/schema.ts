/** Data-quality flag table. Pure DDL; applied only by the schema step (db/schema.ts). */
import type Database from "better-sqlite3";

export function ensureFlagTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS data_quality_flags (
      record_table TEXT NOT NULL,
      record_id TEXT NOT NULL,
      flag TEXT NOT NULL,
      symbol TEXT,
      reason TEXT NOT NULL,
      flagged_at TEXT NOT NULL,
      PRIMARY KEY (record_table, record_id, flag)
    );
    CREATE INDEX IF NOT EXISTS idx_dq_flags_symbol ON data_quality_flags(record_table, flag, symbol);
  `);
}
