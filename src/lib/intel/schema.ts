/**
 * Event-intelligence tables (Batch 3). All additive; nothing here rewrites events or old scenarios.
 *  - event_assessments: append-only, one row per (event, model version, input hash).
 *  - event_instrument_mappings: append-only per (event, instrument, mechanism, model version, input hash).
 *  - event_conflicts: one row per detected disagreement; never resolved or deleted by code.
 *  - scenario_v2_revisions: append-only history of each v2 scenario set.
 *  - crypto_risk_event_log / crypto_event_factor_scores / crypto_outcome_log: crypto risk-event taxonomy,
 *    the separate qualitative factor (history kept), and the outcome log used for later validation.
 */
import type Database from "better-sqlite3";

/** Pure DDL; applied only by the schema step (db/schema.ts). */
export function ensureIntelTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      model_version TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      material INTEGER NOT NULL,
      assessed_at TEXT NOT NULL,
      assessment_json TEXT NOT NULL,
      UNIQUE (event_id, model_version, input_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_event_assess_event ON event_assessments(event_id, id DESC);

    CREATE TABLE IF NOT EXISTS event_instrument_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      assessment_id INTEGER NOT NULL,
      instrument_id TEXT,
      symbol TEXT NOT NULL,
      mechanism TEXT NOT NULL,
      link_basis TEXT NOT NULL,
      direction TEXT,
      horizon TEXT NOT NULL,
      confidence TEXT NOT NULL,
      rationale TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      model_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (assessment_id, symbol, mechanism)
    );
    CREATE INDEX IF NOT EXISTS idx_eim_event ON event_instrument_mappings(event_id);
    CREATE INDEX IF NOT EXISTS idx_eim_symbol ON event_instrument_mappings(symbol);

    CREATE TABLE IF NOT EXISTS event_conflicts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      topic_key TEXT NOT NULL,
      event_a TEXT NOT NULL,
      event_b TEXT NOT NULL,
      claim_a TEXT NOT NULL,
      claim_b TEXT NOT NULL,
      verifiable INTEGER NOT NULL,
      detected_by TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      detected_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conflicts_a ON event_conflicts(event_a);
    CREATE INDEX IF NOT EXISTS idx_conflicts_b ON event_conflicts(event_b);

    CREATE TABLE IF NOT EXISTS scenario_v2_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL,
      UNIQUE (scenario_id, input_hash)
    );

    CREATE TABLE IF NOT EXISTS crypto_risk_event_log (
      id TEXT PRIMARY KEY,
      instrument_id TEXT NOT NULL,
      category TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      link_basis TEXT NOT NULL,
      source TEXT NOT NULL,
      source_url TEXT,
      evidence_json TEXT NOT NULL,
      detected_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crel_inst ON crypto_risk_event_log(instrument_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS crypto_event_factor_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id TEXT NOT NULL,
      model_version TEXT NOT NULL,
      computed_at TEXT NOT NULL,
      level TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cefs_inst ON crypto_event_factor_scores(instrument_id, id DESC);

    CREATE TABLE IF NOT EXISTS crypto_outcome_log (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      logged_at TEXT NOT NULL,
      source TEXT NOT NULL,
      detail_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_col_kind ON crypto_outcome_log(kind, observed_at DESC);
  `);
  return db;
}
