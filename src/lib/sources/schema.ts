import type Database from "better-sqlite3";

/**
 * Source layer. Observations are append-only.
 * canonical_fields is a derived cache and may be recomputed.
 * The view instrument_evidence is the forecasting join (no new model).
 */
export function ensureSourceTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      source_class TEXT NOT NULL,
      reliability_weight REAL NOT NULL,
      legal_notes TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_http_status INTEGER,
      last_checked_at TEXT,
      status_note TEXT
    );

    CREATE TABLE IF NOT EXISTS source_observations (
      id TEXT PRIMARY KEY,
      instrument_id TEXT,
      field TEXT NOT NULL,
      value_json TEXT NOT NULL,
      unit TEXT,
      currency TEXT,
      observed_at TEXT,
      retrieved_at TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_url TEXT,
      raw_hash TEXT NOT NULL,
      claim_type TEXT,
      FOREIGN KEY (source_id) REFERENCES sources(id)
    );

    CREATE TABLE IF NOT EXISTS canonical_fields (
      instrument_id TEXT NOT NULL,
      field TEXT NOT NULL,
      consensus_value_json TEXT,
      method TEXT NOT NULL,
      confidence REAL,
      n_sources INTEGER NOT NULL,
      disagreement INTEGER NOT NULL DEFAULT 0,
      spread REAL,
      as_of TEXT,
      stale INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (instrument_id, field)
    );

    CREATE TABLE IF NOT EXISTS coverage_snapshots (
      id TEXT PRIMARY KEY,
      computed_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crypto_risk_assessments (
      instrument_id TEXT PRIMARY KEY,
      computed_at TEXT NOT NULL,
      total REAL NOT NULL,
      band TEXT NOT NULL,
      components_json TEXT NOT NULL,
      factors_scored INTEGER NOT NULL,
      factors_possible INTEGER NOT NULL DEFAULT 10,
      market_factors_scored INTEGER NOT NULL,
      band_capped INTEGER NOT NULL DEFAULT 0,
      cap_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS instrument_event_links (
      instrument_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      match_kind TEXT NOT NULL,
      source_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (instrument_id, event_id),
      FOREIGN KEY (instrument_id) REFERENCES instruments(id),
      FOREIGN KEY (event_id) REFERENCES events(id)
    );

    CREATE TABLE IF NOT EXISTS crypto_risk_events (
      id TEXT PRIMARY KEY,
      instrument_id TEXT,
      event_type TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      payload_json TEXT,
      fired INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_obs_inst_field ON source_observations(instrument_id, field);
    CREATE INDEX IF NOT EXISTS idx_obs_source ON source_observations(source_id);
    CREATE INDEX IF NOT EXISTS idx_obs_hash ON source_observations(source_id, raw_hash);
    CREATE INDEX IF NOT EXISTS idx_links_inst ON instrument_event_links(instrument_id);
    CREATE INDEX IF NOT EXISTS idx_risk_total ON crypto_risk_assessments(total DESC);
    CREATE INDEX IF NOT EXISTS idx_risk_events_type ON crypto_risk_events(event_type);

    DROP VIEW IF EXISTS instrument_evidence;
    CREATE VIEW instrument_evidence AS
    SELECT
      i.id AS instrument_id,
      i.symbol,
      i.name,
      i.asset_type,
      i.quote_status,
      i.rank,
      i.price AS instrument_price,
      i.market_cap AS instrument_market_cap,
      i.volume_24h AS instrument_volume_24h,
      i.change_24h_pct AS instrument_change_24h_pct,
      i.data_source,
      i.last_updated AS instrument_last_updated,
      cf.consensus_value_json AS canonical_price_json,
      cf.method AS price_method,
      cf.confidence AS price_confidence,
      cf.n_sources AS price_n_sources,
      cf.disagreement AS price_disagreement,
      cf.spread AS price_spread,
      cf.as_of AS price_as_of,
      cf.stale AS price_stale,
      r.total AS risk_total,
      r.band AS risk_band,
      r.factors_scored AS risk_factors_scored,
      r.market_factors_scored AS risk_market_factors_scored,
      r.band_capped AS risk_band_capped,
      (
        SELECT COUNT(*) FROM instrument_event_links l WHERE l.instrument_id = i.id
      ) AS linked_events
    FROM instruments i
    LEFT JOIN canonical_fields cf
      ON cf.instrument_id = i.id AND cf.field = 'price'
    LEFT JOIN crypto_risk_assessments r
      ON r.instrument_id = i.id;
  `);
}
