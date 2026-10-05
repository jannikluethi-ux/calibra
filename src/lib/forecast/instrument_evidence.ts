/**
 * Forecasting compatibility
 * -------------------------
 * Scenario generation and forecast math are unchanged.
 * A later forecaster can read the SQL view `instrument_evidence`, which joins
 * the instrument row, the canonical price field (method, confidence, n_sources,
 * disagreement, stale), the crypto research score, and the count of linked
 * events. This module only selects that view. It does not score scenarios.
 */
import { getDb } from "../db";
import { prepareCryptoStore } from "../sources/prepare";

export interface InstrumentEvidenceRow {
  instrument_id: string;
  symbol: string;
  name: string;
  asset_type: string;
  quote_status: string;
  rank: number | null;
  instrument_price: number | null;
  instrument_market_cap: number | null;
  instrument_volume_24h: number | null;
  instrument_change_24h_pct: number | null;
  data_source: string;
  instrument_last_updated: string | null;
  canonical_price_json: string | null;
  price_method: string | null;
  price_confidence: number | null;
  price_n_sources: number | null;
  price_disagreement: number | null;
  price_spread: number | null;
  price_as_of: string | null;
  price_stale: number | null;
  risk_total: number | null;
  risk_band: string | null;
  risk_factors_scored: number | null;
  risk_market_factors_scored: number | null;
  risk_band_capped: number | null;
  linked_events: number;
}

export function getInstrumentEvidence(instrumentId: string): InstrumentEvidenceRow | null {
  prepareCryptoStore();
  const row = getDb()
    .prepare(`SELECT * FROM instrument_evidence WHERE instrument_id = ?`)
    .get(instrumentId) as InstrumentEvidenceRow | undefined;
  return row ?? null;
}
