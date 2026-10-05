import { randomUUID } from "crypto";
import { getDb } from "../db";

export type AssetType =
  | "crypto"
  | "stock"
  | "etf"
  | "index"
  | "commodity"
  | "forex"
  | "bond"
  | "future"
  | "option"
  | "fund"
  | "reit"
  | "other";

export interface InstrumentRow {
  id: string;
  symbol: string;
  name: string;
  asset_type: string;
  exchange: string | null;
  exchange_code: string | null;
  country: string | null;
  currency: string | null;
  sector: string | null;
  industry: string | null;
  blockchain: string | null;
  category: string | null;
  market_cap: number | null;
  price: number | null;
  change_24h_pct: number | null;
  change_7d_pct: number | null;
  change_30d_pct: number | null;
  volume_24h: number | null;
  circulating_supply: number | null;
  total_supply: number | null;
  max_supply: number | null;
  rank: number | null;
  volatility: number | null;
  logo_url: string | null;
  data_source: string;
  provider_id: string;
  quote_status: string;
  listed_status: string;
  first_seen_at: string;
  last_updated: string | null;
  raw_symbol_key: string | null;
  legacy_symbol: string | null;
  volume_basis: string | null;
}

export interface InstrumentUpsert {
  id: string;
  symbol: string;
  name: string;
  asset_type: string;
  exchange?: string | null;
  exchange_code?: string | null;
  country?: string | null;
  currency?: string | null;
  sector?: string | null;
  industry?: string | null;
  blockchain?: string | null;
  category?: string | null;
  market_cap?: number | null;
  price?: number | null;
  change_24h_pct?: number | null;
  change_7d_pct?: number | null;
  change_30d_pct?: number | null;
  volume_24h?: number | null;
  circulating_supply?: number | null;
  total_supply?: number | null;
  max_supply?: number | null;
  rank?: number | null;
  volatility?: number | null;
  logo_url?: string | null;
  data_source: string;
  provider_id: string;
  quote_status: string;
  listed_status?: string | null;
  last_updated?: string | null;
  raw_symbol_key?: string | null;
  legacy_symbol?: string | null;
  volume_basis?: string | null;
  /** When true, symbol + legacy_symbol are forced (tracked Yahoo aliases). */
  forceIdentity?: boolean;
}

const UPSERT_SQL = `
INSERT INTO instruments (
  id, symbol, name, asset_type, exchange, exchange_code, country, currency,
  sector, industry, blockchain, category,
  market_cap, price, change_24h_pct, change_7d_pct, change_30d_pct, volume_24h,
  circulating_supply, total_supply, max_supply, rank, volatility, logo_url,
  data_source, provider_id, quote_status, listed_status,
  first_seen_at, last_updated, raw_symbol_key, legacy_symbol, volume_basis
) VALUES (
  @id, @symbol, @name, @asset_type, @exchange, @exchange_code, @country, @currency,
  @sector, @industry, @blockchain, @category,
  @market_cap, @price, @change_24h_pct, @change_7d_pct, @change_30d_pct, @volume_24h,
  @circulating_supply, @total_supply, @max_supply, @rank, @volatility, @logo_url,
  @data_source, @provider_id, @quote_status, @listed_status,
  @first_seen_at, @last_updated, @raw_symbol_key, @legacy_symbol, @volume_basis
)
ON CONFLICT(id) DO UPDATE SET
  symbol = CASE
    WHEN @force_identity = 1 THEN excluded.symbol
    WHEN instruments.legacy_symbol IS NOT NULL THEN instruments.symbol
    ELSE excluded.symbol
  END,
  name = CASE WHEN @force_identity = 1 THEN excluded.name ELSE excluded.name END,
  asset_type = excluded.asset_type,
  exchange = COALESCE(excluded.exchange, instruments.exchange),
  exchange_code = COALESCE(excluded.exchange_code, instruments.exchange_code),
  country = COALESCE(excluded.country, instruments.country),
  currency = COALESCE(excluded.currency, instruments.currency),
  sector = COALESCE(excluded.sector, instruments.sector),
  industry = COALESCE(excluded.industry, instruments.industry),
  blockchain = COALESCE(excluded.blockchain, instruments.blockchain),
  category = COALESCE(excluded.category, instruments.category),
  market_cap = CASE WHEN @touch_quotes = 0 THEN instruments.market_cap ELSE excluded.market_cap END,
  price = CASE WHEN @touch_quotes = 0 THEN instruments.price ELSE excluded.price END,
  change_24h_pct = CASE WHEN @touch_quotes = 0 THEN instruments.change_24h_pct ELSE excluded.change_24h_pct END,
  change_7d_pct = CASE WHEN @touch_quotes = 0 THEN instruments.change_7d_pct ELSE excluded.change_7d_pct END,
  change_30d_pct = CASE WHEN @touch_quotes = 0 THEN instruments.change_30d_pct ELSE excluded.change_30d_pct END,
  volume_24h = CASE WHEN @touch_quotes = 0 THEN instruments.volume_24h ELSE excluded.volume_24h END,
  circulating_supply = CASE WHEN @touch_quotes = 0 THEN instruments.circulating_supply ELSE excluded.circulating_supply END,
  total_supply = CASE WHEN @touch_quotes = 0 THEN instruments.total_supply ELSE excluded.total_supply END,
  max_supply = CASE WHEN @touch_quotes = 0 THEN instruments.max_supply ELSE excluded.max_supply END,
  rank = CASE WHEN @touch_quotes = 0 THEN instruments.rank ELSE excluded.rank END,
  volatility = CASE WHEN @touch_quotes = 0 THEN instruments.volatility ELSE COALESCE(excluded.volatility, instruments.volatility) END,
  logo_url = COALESCE(excluded.logo_url, instruments.logo_url),
  quote_status = CASE
    WHEN @touch_quotes = 0 AND instruments.quote_status = 'live' THEN instruments.quote_status
    ELSE excluded.quote_status
  END,
  listed_status = excluded.listed_status,
  last_updated = CASE
    WHEN @touch_quotes = 0 AND instruments.last_updated IS NOT NULL THEN instruments.last_updated
    ELSE excluded.last_updated
  END,
  raw_symbol_key = COALESCE(excluded.raw_symbol_key, instruments.raw_symbol_key),
  legacy_symbol = CASE
    WHEN @force_identity = 1 THEN excluded.legacy_symbol
    ELSE COALESCE(instruments.legacy_symbol, excluded.legacy_symbol)
  END,
  volume_basis = CASE WHEN @touch_quotes = 0 THEN instruments.volume_basis ELSE COALESCE(excluded.volume_basis, instruments.volume_basis) END
`;

function n(v: number | null | undefined): number | null {
  if (v == null) return null;
  return Number.isFinite(v) ? v : null;
}

function s(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t : null;
}

export function existingInstrumentIds(): Set<string> {
  const rows = getDb().prepare(`SELECT id FROM instruments`).all() as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

export function upsertInstrument(row: InstrumentUpsert, nowIso: string): "inserted" | "updated" {
  const db = getDb();
  const existed = db.prepare(`SELECT 1 AS x FROM instruments WHERE id = ?`).get(row.id) as { x: number } | undefined;
  const touchQuotes = row.quote_status === "list_only" ? 0 : 1;
  db.prepare(UPSERT_SQL).run({
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    asset_type: row.asset_type,
    exchange: s(row.exchange),
    exchange_code: s(row.exchange_code),
    country: s(row.country),
    currency: s(row.currency),
    sector: s(row.sector),
    industry: s(row.industry),
    blockchain: s(row.blockchain),
    category: s(row.category),
    market_cap: n(row.market_cap),
    price: n(row.price),
    change_24h_pct: n(row.change_24h_pct),
    change_7d_pct: n(row.change_7d_pct),
    change_30d_pct: n(row.change_30d_pct),
    volume_24h: n(row.volume_24h),
    circulating_supply: n(row.circulating_supply),
    total_supply: n(row.total_supply),
    max_supply: n(row.max_supply),
    rank: row.rank == null || !Number.isFinite(row.rank) ? null : Math.trunc(row.rank),
    volatility: n(row.volatility),
    logo_url: s(row.logo_url),
    data_source: row.data_source,
    provider_id: row.provider_id,
    quote_status: row.quote_status,
    listed_status: row.listed_status || "active",
    first_seen_at: nowIso,
    last_updated: row.last_updated ?? nowIso,
    raw_symbol_key: s(row.raw_symbol_key),
    legacy_symbol: s(row.legacy_symbol),
    volume_basis: s(row.volume_basis),
    force_identity: row.forceIdentity ? 1 : 0,
    touch_quotes: touchQuotes,
  });
  return existed ? "updated" : "inserted";
}

export function upsertInstruments(rows: InstrumentUpsert[], nowIso: string): { inserted: number; updated: number } {
  const db = getDb();
  let inserted = 0;
  let updated = 0;
  const tx = db.transaction((batch: InstrumentUpsert[]) => {
    for (const row of batch) {
      const kind = upsertInstrument(row, nowIso);
      if (kind === "inserted") inserted++;
      else updated++;
    }
  });
  const chunk = 400;
  for (let i = 0; i < rows.length; i += chunk) {
    tx(rows.slice(i, i + chunk));
  }
  return { inserted, updated };
}

/** Append a provider category without guessing. Keeps an existing category if already set. */
export function setCategoryIfEmpty(id: string, category: string) {
  getDb()
    .prepare(
      `UPDATE instruments SET category = ? WHERE id = ? AND (category IS NULL OR category = '')`
    )
    .run(category, id);
}

export function getInstrument(id: string): InstrumentRow | null {
  const row = getDb().prepare(`SELECT * FROM instruments WHERE id = ?`).get(id) as InstrumentRow | undefined;
  return row ?? null;
}

const SORTS: Record<string, { col: string; nulls: boolean; defaultDir: "asc" | "desc" }> = {
  market_cap: { col: "market_cap", nulls: true, defaultDir: "desc" },
  price: { col: "price", nulls: true, defaultDir: "desc" },
  change_24h: { col: "change_24h_pct", nulls: true, defaultDir: "desc" },
  change_7d: { col: "change_7d_pct", nulls: true, defaultDir: "desc" },
  change_30d: { col: "change_30d_pct", nulls: true, defaultDir: "desc" },
  volume: { col: "volume_24h", nulls: true, defaultDir: "desc" },
  rank: { col: "rank", nulls: true, defaultDir: "asc" },
  name: { col: "name", nulls: false, defaultDir: "asc" },
  volatility: { col: "volatility", nulls: true, defaultDir: "desc" },
  recently_added: { col: "first_seen_at", nulls: false, defaultDir: "desc" },
};

export interface InstrumentQuery {
  q?: string;
  asset_type?: string;
  country?: string;
  category?: string;
  exchange?: string;
  market_cap_min?: number | null;
  volume_min?: number | null;
  sort?: string;
  dir?: string;
  page?: number;
  pageSize?: number;
  cursor?: string | null;
}

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function queryInstruments(q: InstrumentQuery): {
  items: InstrumentRow[];
  total: number;
  page: number;
  pageSize: number;
  nextCursor: string | null;
} {
  const pageSize = Math.min(100, Math.max(1, Math.floor(q.pageSize || 50)));
  let offset = 0;
  if (q.cursor != null && q.cursor !== "") {
    const c = Number(q.cursor);
    offset = Number.isFinite(c) && c > 0 ? Math.floor(c) : 0;
  } else {
    const page = Math.max(1, Math.floor(q.page || 1));
    offset = (page - 1) * pageSize;
  }
  const page = Math.floor(offset / pageSize) + 1;

  const where: string[] = [];
  const params: Record<string, string | number> = {};

  const text = (q.q || "").trim().slice(0, 80);
  if (text) {
    const like = `%${escapeLike(text)}%`;
    params.like = like;
    params.qexact = text;
    where.push(`(
      symbol LIKE @like ESCAPE '\\' COLLATE NOCASE
      OR name LIKE @like ESCAPE '\\' COLLATE NOCASE
      OR provider_id LIKE @like ESCAPE '\\' COLLATE NOCASE
      OR IFNULL(exchange,'') LIKE @like ESCAPE '\\' COLLATE NOCASE
      OR IFNULL(raw_symbol_key,'') LIKE @like ESCAPE '\\' COLLATE NOCASE
      OR IFNULL(legacy_symbol,'') LIKE @like ESCAPE '\\' COLLATE NOCASE
    )`);
  }
  if (q.asset_type) {
    where.push(`asset_type = @asset_type`);
    params.asset_type = q.asset_type;
  }
  if (q.country) {
    where.push(`country = @country`);
    params.country = q.country;
  }
  if (q.category) {
    where.push(`category = @category`);
    params.category = q.category;
  }
  if (q.exchange) {
    where.push(`exchange = @exchange`);
    params.exchange = q.exchange;
  }
  if (q.market_cap_min != null && Number.isFinite(q.market_cap_min)) {
    where.push(`market_cap IS NOT NULL AND market_cap >= @mcap_min`);
    params.mcap_min = q.market_cap_min;
  }
  if (q.volume_min != null && Number.isFinite(q.volume_min)) {
    where.push(`volume_24h IS NOT NULL AND volume_24h >= @vol_min`);
    params.vol_min = q.volume_min;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sortKey = q.sort && SORTS[q.sort] ? q.sort : "market_cap";
  const spec = SORTS[sortKey];
  const dir: "asc" | "desc" = q.dir === "asc" || q.dir === "desc" ? q.dir : spec.defaultDir;
  const dirSql = dir === "asc" ? "ASC" : "DESC";
  const nullSql = spec.nulls ? `(${spec.col} IS NULL), ` : "";
  const rankSql = text
    ? `CASE
        WHEN upper(symbol) = upper(@qexact) OR upper(IFNULL(legacy_symbol,'')) = upper(@qexact) OR upper(name) = upper(@qexact) THEN 0
        WHEN upper(symbol) LIKE upper(@qexact) || '%' ESCAPE '\\' OR upper(IFNULL(legacy_symbol,'')) LIKE upper(@qexact) || '%' ESCAPE '\\' THEN 1
        WHEN upper(name) LIKE upper(@qexact) || '%' ESCAPE '\\' THEN 2
        ELSE 3
      END, `
    : "";

  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM instruments ${whereSql}`).get(params) as { c: number }
  ).c;
  const items = db
    .prepare(
      `SELECT * FROM instruments ${whereSql}
       ORDER BY ${rankSql}${nullSql}${spec.col} ${dirSql}, name COLLATE NOCASE ASC, id ASC
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: pageSize, offset }) as InstrumentRow[];

  const next = offset + items.length < total ? String(offset + items.length) : null;
  return { items, total, page, pageSize, nextCursor: next };
}

export function suggestInstruments(q: string, limit = 8): InstrumentRow[] {
  const text = q.trim().slice(0, 80);
  if (!text) return [];
  const lim = Math.min(20, Math.max(1, limit));
  return queryInstruments({ q: text, page: 1, pageSize: lim, sort: "market_cap", dir: "desc" }).items;
}

export interface Facets {
  asset_types: { asset_type: string; count: number }[];
  countries: { value: string; count: number }[];
  categories: { value: string; count: number }[];
  exchanges: { value: string; count: number }[];
}

export function instrumentFacets(): Facets {
  const db = getDb();
  const asset_types = db
    .prepare(`SELECT asset_type, COUNT(*) AS count FROM instruments GROUP BY asset_type ORDER BY count DESC`)
    .all() as { asset_type: string; count: number }[];
  const countries = db
    .prepare(
      `SELECT country AS value, COUNT(*) AS count FROM instruments
       WHERE country IS NOT NULL AND country != '' GROUP BY country ORDER BY count DESC, country ASC`
    )
    .all() as { value: string; count: number }[];
  const categories = db
    .prepare(
      `SELECT category AS value, COUNT(*) AS count FROM instruments
       WHERE category IS NOT NULL AND category != '' GROUP BY category ORDER BY count DESC, category ASC`
    )
    .all() as { value: string; count: number }[];
  const exchanges = db
    .prepare(
      `SELECT exchange AS value, COUNT(*) AS count FROM instruments
       WHERE exchange IS NOT NULL AND exchange != '' GROUP BY exchange ORDER BY count DESC, exchange ASC LIMIT 80`
    )
    .all() as { value: string; count: number }[];
  return { asset_types, countries, categories, exchanges };
}

export function countInstruments(): { total: number; byType: { asset_type: string; c: number }[]; byQuote: { quote_status: string; c: number }[] } {
  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM instruments`).get() as { c: number }).c;
  const byType = db.prepare(`SELECT asset_type, COUNT(*) AS c FROM instruments GROUP BY asset_type`).all() as {
    asset_type: string;
    c: number;
  }[];
  const byQuote = db.prepare(`SELECT quote_status, COUNT(*) AS c FROM instruments GROUP BY quote_status`).all() as {
    quote_status: string;
    c: number;
  }[];
  return { total, byType, byQuote };
}

export interface SymbolResolution {
  status: "resolved" | "ambiguous" | "unresolved";
  instrument?: InstrumentRow;
  candidates: InstrumentRow[];
}

/** Exact symbol / legacy alias / provider id. Never picks among venues. */
export function resolveSymbol(input: string): SymbolResolution {
  const q = input.trim();
  if (!q) return { status: "unresolved", candidates: [] };
  const rows = getDb()
    .prepare(
      `SELECT * FROM instruments
       WHERE symbol = ? COLLATE NOCASE
          OR IFNULL(legacy_symbol,'') = ? COLLATE NOCASE
          OR IFNULL(raw_symbol_key,'') = ? COLLATE NOCASE
          OR provider_id = ? COLLATE NOCASE
       ORDER BY (market_cap IS NULL), market_cap DESC, name COLLATE NOCASE ASC`
    )
    .all(q, q, q, q) as InstrumentRow[];
  const seen = new Set<string>();
  const candidates = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  if (candidates.length === 1) return { status: "resolved", instrument: candidates[0], candidates };
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  return { status: "unresolved", candidates: [] };
}

export interface SyncRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  pages: number | null;
  inserted: number | null;
  updated: number | null;
  rate_limited: number;
  error: string | null;
  detail: string | null;
}

export function startSyncRun(): string {
  const id = randomUUID();
  const started = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO sync_runs(id, started_at, status, pages, inserted, updated, rate_limited)
       VALUES(?, ?, 'started', 0, 0, 0, 0)`
    )
    .run(id, started);
  return id;
}

export function finishSyncRun(
  id: string,
  patch: {
    status: string;
    pages: number;
    inserted: number;
    updated: number;
    rate_limited: boolean;
    error?: string | null;
    detail?: unknown;
  }
) {
  getDb()
    .prepare(
      `UPDATE sync_runs SET finished_at=?, status=?, pages=?, inserted=?, updated=?, rate_limited=?, error=?, detail=? WHERE id=?`
    )
    .run(
      new Date().toISOString(),
      patch.status,
      patch.pages,
      patch.inserted,
      patch.updated,
      patch.rate_limited ? 1 : 0,
      patch.error ?? null,
      patch.detail != null ? JSON.stringify(patch.detail) : null,
      id
    );
}

export function latestSyncRun(): SyncRunRow | null {
  const row = getDb().prepare(`SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 1`).get() as SyncRunRow | undefined;
  return row ?? null;
}

export function listWatchlists(userId: string) {
  return getDb()
    .prepare(
      `SELECT w.id, w.name, w.created_at, COUNT(i.instrument_id) AS items
       FROM watchlists w
       LEFT JOIN watchlist_items i ON i.watchlist_id = w.id
       WHERE w.user_id = ?
       GROUP BY w.id
       ORDER BY w.created_at ASC`
    )
    .all(userId) as { id: string; name: string; created_at: string; items: number }[];
}

export function createWatchlist(userId: string, name: string) {
  const id = randomUUID();
  const created = new Date().toISOString();
  getDb().prepare(`INSERT INTO watchlists(id, user_id, name, created_at) VALUES(?, ?, ?, ?)`).run(id, userId, name, created);
  return { id, name, created_at: created, items: 0 };
}

export function getWatchlist(userId: string, id: string) {
  return (
    (getDb().prepare(`SELECT id, user_id, name, created_at FROM watchlists WHERE id = ? AND user_id = ?`).get(id, userId) as
      | { id: string; user_id: string; name: string; created_at: string }
      | undefined) ?? null
  );
}

export function addWatchlistItem(watchlistId: string, instrumentId: string) {
  const inst = getInstrument(instrumentId);
  if (!inst) return { ok: false as const, error: "unknown instrument" };
  getDb()
    .prepare(
      `INSERT INTO watchlist_items(watchlist_id, instrument_id, added_at) VALUES(?, ?, ?)
       ON CONFLICT(watchlist_id, instrument_id) DO NOTHING`
    )
    .run(watchlistId, instrumentId, new Date().toISOString());
  return { ok: true as const, instrument: inst };
}

export function removeWatchlistItem(watchlistId: string, instrumentId: string) {
  getDb().prepare(`DELETE FROM watchlist_items WHERE watchlist_id = ? AND instrument_id = ?`).run(watchlistId, instrumentId);
}

export function watchlistItems(watchlistId: string): InstrumentRow[] {
  return getDb()
    .prepare(
      `SELECT ins.* FROM watchlist_items wi
       JOIN instruments ins ON ins.id = wi.instrument_id
       WHERE wi.watchlist_id = ?
       ORDER BY wi.added_at ASC`
    )
    .all(watchlistId) as InstrumentRow[];
}
