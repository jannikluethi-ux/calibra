import { randomUUID } from "crypto";
import { getDb } from "../db";
import { prepareCryptoStore } from "../sources/prepare";
import { CONFIDENCE_FORMULA_TEXT, DISAGREEMENT_THRESHOLDS, RELIABILITY_WEIGHTS } from "../sources/weights";
import { RISK_BAND_TEXT } from "./risk";

export interface CoveragePayload {
  computed_at: string;
  indexed_crypto: number;
  live_quotes: number;
  live_market_cap: number;
  historical_points_btc_eth: number;
  historical_note: string;
  on_chain_tvl_instruments: number;
  tokenomics_instruments_nonnull: number;
  tokenomics_note: string;
  security_observations: number;
  project_descriptions: number;
  verified_project_claims: number;
  reported_descriptions: number;
  news_links: number;
  news_instruments: number;
  risk_scores: number;
  full_research_profiles: number;
  full_research_note: string;
  multi_source_price: number;
  category_instruments: number;
  equity_filing_coverage: number;
  claims_missing_source_id: number;
  sources: {
    id: string;
    name: string;
    category: string;
    source_class: string;
    reliability_weight: number;
    enabled: number;
    last_http_status: number | null;
    last_checked_at: string | null;
    status_note: string | null;
    legal_notes: string | null;
  }[];
  disagreement_thresholds: Record<string, number>;
  reliability_weights: Record<string, number>;
  confidence_formula: string;
  risk_bands: string;
}

export function computeCoverage(): CoveragePayload {
  prepareCryptoStore();
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const indexed = one(`SELECT COUNT(*) AS c FROM instruments WHERE asset_type = 'crypto'`);
  const live = one(
    `SELECT COUNT(*) AS c FROM instruments WHERE asset_type = 'crypto' AND quote_status = 'live' AND price IS NOT NULL`
  );
  const liveMcap = one(
    `SELECT COUNT(*) AS c FROM instruments WHERE asset_type = 'crypto' AND quote_status = 'live' AND market_cap IS NOT NULL`
  );
  const hist = one(`SELECT COUNT(*) AS c FROM market_history WHERE symbol IN ('BTC', 'ETH')`);
  const tvl = one(
    `SELECT COUNT(DISTINCT instrument_id) AS c FROM source_observations WHERE field = 'tvl_usd' AND instrument_id IS NOT NULL`
  );
  const tokenomics = one(
    `SELECT COUNT(*) AS c FROM instruments
     WHERE asset_type = 'crypto'
       AND (circulating_supply IS NOT NULL OR total_supply IS NOT NULL OR max_supply IS NOT NULL)`
  );
  const security = one(
    `SELECT COUNT(*) AS c FROM source_observations WHERE field IN ('audit', 'security') OR source_id = 'audits'`
  );
  const descriptions = one(
    `SELECT COUNT(DISTINCT instrument_id) AS c FROM source_observations WHERE field = 'description' AND instrument_id IS NOT NULL`
  );
  const verified = one(
    `SELECT COUNT(*) AS c FROM source_observations WHERE claim_type = 'verified_fact'`
  );
  const reported = one(
    `SELECT COUNT(*) AS c FROM source_observations WHERE field = 'description' AND claim_type = 'reported_claim'`
  );
  const newsLinks = one(`SELECT COUNT(*) AS c FROM instrument_event_links WHERE match_kind IN ('contract_address','coingecko_id')`);
  const newsInst = one(`SELECT COUNT(DISTINCT instrument_id) AS c FROM instrument_event_links WHERE match_kind IN ('contract_address','coingecko_id')`);
  const risk = one(`SELECT COUNT(*) AS c FROM crypto_risk_assessments`);
  const multi = one(
    `SELECT COUNT(*) AS c FROM canonical_fields WHERE field = 'price' AND n_sources >= 2`
  );
  const full = one(
    `SELECT COUNT(*) AS c FROM instruments i
     WHERE EXISTS (
       SELECT 1 FROM source_observations o
       WHERE o.instrument_id = i.id AND o.field = 'description'
     )
     AND EXISTS (SELECT 1 FROM crypto_risk_assessments r WHERE r.instrument_id = i.id)
     AND EXISTS (
       SELECT 1 FROM canonical_fields cf
       WHERE cf.instrument_id = i.id AND cf.field = 'price' AND cf.n_sources >= 2
     )`
  );
  const categories = one(
    `SELECT COUNT(DISTINCT instrument_id) AS c FROM source_observations WHERE field = 'categories' AND instrument_id IS NOT NULL`
  );
  const missingSource = one(
    `SELECT COUNT(*) AS c FROM source_observations WHERE source_id IS NULL OR TRIM(source_id) = ''`
  );
  const sources = db
    .prepare(
      `SELECT id, name, category, source_class, reliability_weight, enabled, last_http_status, last_checked_at, status_note, legal_notes
       FROM sources ORDER BY enabled DESC, category, id`
    )
    .all() as CoveragePayload["sources"];

  return {
    computed_at: new Date().toISOString(),
    indexed_crypto: indexed,
    live_quotes: live,
    live_market_cap: liveMcap,
    historical_points_btc_eth: hist,
    historical_note:
      "market_history rows whose symbol is BTC or ETH. Those series come from the existing Yahoo tracked universe, not from a CoinGecko OHLCV backfill. No other crypto has stored history in this pass.",
    on_chain_tvl_instruments: tvl,
    tokenomics_instruments_nonnull: tokenomics,
    tokenomics_note:
      "Count of crypto instruments where circulating, total, or max supply is already non-null on the instrument row from the prior CoinGecko markets sync. This is not a new tokenomics source, and unlock schedules were not fetched.",
    security_observations: security,
    project_descriptions: descriptions,
    verified_project_claims: verified,
    reported_descriptions: reported,
    news_links: newsLinks,
    news_instruments: newsInst,
    risk_scores: risk,
    full_research_profiles: full,
    full_research_note:
      "Full research means a stored description observation AND a research score AND a canonical price with at least two enabled sources. It does not mean founders, audits, or a bull/bear case exist.",
    multi_source_price: multi,
    category_instruments: categories,
    equity_filing_coverage: 0,
    claims_missing_source_id: missingSource,
    sources,
    disagreement_thresholds: DISAGREEMENT_THRESHOLDS,
    reliability_weights: RELIABILITY_WEIGHTS,
    confidence_formula: CONFIDENCE_FORMULA_TEXT,
    risk_bands: RISK_BAND_TEXT,
  };
}

export function writeCoverageSnapshot(): string {
  const payload = computeCoverage();
  const id = randomUUID();
  getDb()
    .prepare(`INSERT INTO coverage_snapshots (id, computed_at, payload_json) VALUES (?, ?, ?)`)
    .run(id, payload.computed_at, JSON.stringify(payload));
  return id;
}
