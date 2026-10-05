import type Database from "better-sqlite3";

/** Additive instrument universe. Does not touch forecasts, scenarios, or market_history. */
export function ensureInstrumentTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      display_name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS instruments (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      exchange TEXT,
      exchange_code TEXT,
      country TEXT,
      currency TEXT,
      sector TEXT,
      industry TEXT,
      blockchain TEXT,
      category TEXT,
      market_cap REAL,
      price REAL,
      change_24h_pct REAL,
      change_7d_pct REAL,
      change_30d_pct REAL,
      volume_24h REAL,
      circulating_supply REAL,
      total_supply REAL,
      max_supply REAL,
      rank INTEGER,
      volatility REAL,
      logo_url TEXT,
      data_source TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      quote_status TEXT NOT NULL,
      listed_status TEXT NOT NULL DEFAULT 'active',
      first_seen_at TEXT NOT NULL,
      last_updated TEXT,
      raw_symbol_key TEXT,
      legacy_symbol TEXT,
      volume_basis TEXT,
      UNIQUE(data_source, provider_id)
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      pages INTEGER,
      inserted INTEGER,
      updated INTEGER,
      rate_limited INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      detail TEXT
    );

    CREATE TABLE IF NOT EXISTS watchlists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS watchlist_items (
      watchlist_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (watchlist_id, instrument_id),
      FOREIGN KEY (watchlist_id) REFERENCES watchlists(id) ON DELETE CASCADE,
      FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_instr_symbol ON instruments(symbol);
    CREATE INDEX IF NOT EXISTS idx_instr_name ON instruments(name);
    CREATE INDEX IF NOT EXISTS idx_instr_asset_type ON instruments(asset_type);
    CREATE INDEX IF NOT EXISTS idx_instr_exchange ON instruments(exchange);
    CREATE INDEX IF NOT EXISTS idx_instr_country ON instruments(country);
    CREATE INDEX IF NOT EXISTS idx_instr_category ON instruments(category);
    CREATE INDEX IF NOT EXISTS idx_instr_mcap ON instruments(market_cap);
    CREATE INDEX IF NOT EXISTS idx_instr_rank ON instruments(rank);
    CREATE INDEX IF NOT EXISTS idx_instr_updated ON instruments(last_updated);
    CREATE INDEX IF NOT EXISTS idx_instr_legacy ON instruments(legacy_symbol);
    CREATE INDEX IF NOT EXISTS idx_instr_raw ON instruments(raw_symbol_key);
    CREATE INDEX IF NOT EXISTS idx_instr_quote_status ON instruments(quote_status);
    CREATE INDEX IF NOT EXISTS idx_watchlists_user ON watchlists(user_id);
    CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);
  `);
}
