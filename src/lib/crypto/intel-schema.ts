/**
 * Crypto intelligence tables (Batch 2). All additive. Market snapshots, price history, risk scores and
 * incident records are append-only; crypto_risk_latest is a derived pointer table rebuilt by the scorer.
 */
import type Database from "better-sqlite3";

/** Pure DDL; applied only by the schema step (db/schema.ts). */
export function ensureCryptoIntelTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crypto_market_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id TEXT NOT NULL,
      retrieved_at TEXT NOT NULL,
      observed_at TEXT,
      price REAL, market_cap REAL, fdv REAL, volume_24h REAL,
      high_24h REAL, low_24h REAL,
      change_24h_pct REAL, change_7d_pct REAL, change_30d_pct REAL, mcap_change_24h_pct REAL,
      circulating_supply REAL, total_supply REAL, max_supply REAL,
      ath REAL, ath_change_pct REAL, ath_date TEXT, rank INTEGER,
      source TEXT NOT NULL,
      source_url TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cms_inst_time ON crypto_market_snapshots(instrument_id, retrieved_at DESC);

    CREATE TABLE IF NOT EXISTS crypto_price_history (
      instrument_id TEXT NOT NULL,
      day TEXT NOT NULL,
      price REAL NOT NULL,
      market_cap REAL,
      volume REAL,
      source TEXT NOT NULL,
      retrieved_at TEXT NOT NULL,
      PRIMARY KEY (instrument_id, day, source)
    );

    CREATE TABLE IF NOT EXISTS crypto_contracts (
      instrument_id TEXT NOT NULL,
      network TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      source TEXT NOT NULL,
      retrieved_at TEXT NOT NULL,
      PRIMARY KEY (instrument_id, network)
    );
    CREATE INDEX IF NOT EXISTS idx_crypto_contracts_addr ON crypto_contracts(contract_address);

    CREATE TABLE IF NOT EXISTS crypto_categories (
      instrument_id TEXT NOT NULL,
      category_slug TEXT NOT NULL,
      category_name TEXT,
      source TEXT NOT NULL,
      retrieved_at TEXT NOT NULL,
      PRIMARY KEY (instrument_id, category_slug)
    );

    CREATE TABLE IF NOT EXISTS crypto_security_incidents (
      id TEXT PRIMARY KEY,
      instrument_id TEXT,
      defillama_id TEXT,
      name TEXT NOT NULL,
      incident_date TEXT NOT NULL,
      amount_usd REAL,
      returned_usd REAL,
      classification TEXT,
      technique TEXT,
      chains_json TEXT,
      target_type TEXT,
      source TEXT NOT NULL,
      source_url TEXT,
      retrieved_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_csi_inst ON crypto_security_incidents(instrument_id);

    CREATE TABLE IF NOT EXISTS crypto_protocol_map (
      defillama_id TEXT PRIMARY KEY,
      protocol_name TEXT,
      gecko_id TEXT,
      instrument_id TEXT,
      retrieved_at TEXT NOT NULL
    );

    -- Append-only, versioned risk history (never rewritten). research_v1 rows archive the legacy table.
    CREATE TABLE IF NOT EXISTS crypto_risk_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id TEXT NOT NULL,
      model_version TEXT NOT NULL,
      computed_at TEXT NOT NULL,
      score REAL,
      band TEXT NOT NULL,
      risk_type TEXT,
      confidence REAL,
      confidence_label TEXT,
      high_risk INTEGER NOT NULL DEFAULT 0,
      structural_keys TEXT,
      factors_json TEXT NOT NULL,
      flags_json TEXT,
      reasons_json TEXT,
      market_data_at TEXT,
      detail_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_crs_inst_model ON crypto_risk_scores(instrument_id, model_version, id DESC);

    -- Derived pointer to the newest score per instrument for the current model (rebuilt each run).
    CREATE TABLE IF NOT EXISTS crypto_risk_latest (
      instrument_id TEXT PRIMARY KEY,
      score_id INTEGER NOT NULL,
      model_version TEXT NOT NULL,
      computed_at TEXT NOT NULL,
      score REAL,
      band TEXT NOT NULL,
      risk_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      confidence_label TEXT NOT NULL,
      high_risk INTEGER NOT NULL,
      structural_keys TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      market_data_at TEXT
    );
  `);
  return db;
}
