import { getDb } from "../db";
import type { InstrumentRow } from "../instruments/store";

export interface ResolveCandidate {
  id: string;
  symbol: string;
  name: string;
  asset_type: string;
  data_source: string;
  provider_id: string;
  quote_status: string;
  rank: number | null;
  market_cap: number | null;
  exchange: string | null;
}

/**
 * Returns candidates. Never collapses Yahoo and CoinGecko into one instrument.
 * cryptoSectionLinkId is only a link hint inside Crypto Intelligence when the
 * query clearly names one CoinGecko row. It is not a cross-venue resolution.
 */
export function resolveCryptoQuery(raw: string): {
  query: string;
  normalized: string;
  status: "resolved" | "ambiguous" | "unresolved";
  candidates: ResolveCandidate[];
  cryptoSectionLinkId: string | null;
} {
  const query = raw.trim().slice(0, 80);
  const normalized = query
    .replace(/\b(price|quote|market|usd)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return { query, normalized, status: "unresolved", candidates: [], cryptoSectionLinkId: null };
  }
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, symbol, name, asset_type, data_source, provider_id, quote_status, rank, market_cap, exchange
       FROM instruments
       WHERE symbol = ? COLLATE NOCASE
          OR name = ? COLLATE NOCASE
          OR IFNULL(legacy_symbol, '') = ? COLLATE NOCASE
          OR IFNULL(raw_symbol_key, '') = ? COLLATE NOCASE
          OR provider_id = ? COLLATE NOCASE
       ORDER BY (data_source = 'coingecko') DESC, (market_cap IS NULL), market_cap DESC, name COLLATE NOCASE`
    )
    .all(normalized, normalized, normalized, normalized, normalized) as ResolveCandidate[];

  const seen = new Set<string>();
  const candidates = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));

  const exactName = candidates.filter(
    (c) => c.data_source === "coingecko" && c.asset_type === "crypto" && c.name.toLowerCase() === normalized.toLowerCase()
  );
  let cryptoSectionLinkId: string | null = null;
  if (exactName.length === 1) cryptoSectionLinkId = exactName[0].id;
  else if (!normalized.includes(" ")) {
    const liveSym = candidates.filter(
      (c) =>
        c.data_source === "coingecko" &&
        c.asset_type === "crypto" &&
        c.quote_status === "live" &&
        c.symbol.toLowerCase() === normalized.toLowerCase()
    );
    if (liveSym.length === 1) cryptoSectionLinkId = liveSym[0].id;
  }

  const status = candidates.length === 0 ? "unresolved" : candidates.length === 1 ? "resolved" : "ambiguous";
  return { query, normalized, status, candidates, cryptoSectionLinkId };
}

export function relatedInstruments(row: InstrumentRow, limit = 8): { items: InstrumentRow[]; total: number } {
  const db = getDb();
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM instruments
         WHERE id != ? AND asset_type = 'crypto'
           AND (symbol = ? COLLATE NOCASE OR name = ? COLLATE NOCASE)`
      )
      .get(row.id, row.symbol, row.name) as { c: number }
  ).c;
  const items = db
    .prepare(
      `SELECT * FROM instruments
       WHERE id != ? AND asset_type = 'crypto'
         AND (symbol = ? COLLATE NOCASE OR name = ? COLLATE NOCASE)
       ORDER BY (quote_status = 'live') DESC, (market_cap IS NULL), market_cap DESC, name COLLATE NOCASE
       LIMIT ?`
    )
    .all(row.id, row.symbol, row.name, limit) as InstrumentRow[];
  return { items, total };
}
