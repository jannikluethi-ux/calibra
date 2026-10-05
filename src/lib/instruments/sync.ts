/**
 * Instrument universe sync.
 * Rows are upserted from provider HTTP responses (CoinGecko coins/list + markets,
 * Yahoo search/chart). There is no hardcoded catalog of equities or coins.
 * A newly listed provider id is inserted on the next sync without a code change.
 * Failures never delete existing instruments, market_history, events, scenarios, or forecasts.
 */
import { getDb } from "../db";
import { MARKET_UNIVERSE, type UniverseItem } from "../market/universe";
import type { MarketSnapshot } from "../types";
import {
  finishSyncRun,
  setCategoryIfEmpty,
  startSyncRun,
  upsertInstruments,
  type InstrumentUpsert,
} from "./store";

const CG = "https://api.coingecko.com/api/v3";
const YAHOO_SEARCH = "https://query1.finance.yahoo.com/v1/finance/search";
const CG_PAUSE_MS = 3500;
const YAHOO_PAUSE_MS = 400;
const MAX_MARKET_PAGES = 4;
const MAX_YAHOO_CHARTS = 24;

/**
 * Queries sent TO Yahoo search. These are not instrument rows.
 * Only symbols present in the JSON response are upserted.
 */
const YAHOO_SEARCH_QUERIES = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "JPM",
  "XOM",
  "NESN.SW",
  "SAP",
  "ASML",
  "SPY",
  "QQQ",
  "GLD",
  "TLT",
  "EEM",
  "GBPUSD=X",
  "HG=F",
];

const CATEGORY_PREFERENCE = ["layer-1", "decentralized-finance-defi", "stablecoins", "meme-token"];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface HttpResult {
  status: number;
  json?: unknown;
  rateLimited: boolean;
  error?: string;
}

async function getJson(url: string): Promise<HttpResult> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; Calibra/0.1; research)",
      },
      cache: "no-store",
    });
    if (res.status === 429) return { status: 429, rateLimited: true };
    const text = await res.text();
    if (text.startsWith("Too Many Requests") || text.includes("Rate Limit")) {
      return { status: 429, rateLimited: true, error: text.slice(0, 180) };
    }
    if (!res.ok) return { status: res.status, rateLimited: false, error: `HTTP ${res.status} ${text.slice(0, 160)}` };
    try {
      return { status: res.status, json: JSON.parse(text) as unknown, rateLimited: false };
    } catch {
      return { status: res.status, rateLimited: false, error: "Invalid JSON" };
    }
  } catch (err) {
    return { status: 0, rateLimited: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function mapQuoteType(qt: string | null | undefined): string {
  switch ((qt || "").toUpperCase()) {
    case "EQUITY":
      return "stock";
    case "ETF":
      return "etf";
    case "INDEX":
      return "index";
    case "CURRENCY":
      return "forex";
    case "FUTURE":
      return "future";
    case "CRYPTOCURRENCY":
      return "crypto";
    case "MUTUALFUND":
      return "fund";
    case "OPTION":
      return "option";
    case "BOND":
      return "bond";
    case "REIT":
      return "reit";
    default:
      return "other";
  }
}

function trackedFallbackType(cat: UniverseItem["category"]): string {
  switch (cat) {
    case "equity_index":
      return "index";
    case "crypto":
      return "crypto";
    case "commodity":
      return "commodity";
    case "fx":
      return "forex";
    case "rates":
      return "bond";
    case "vol":
      return "other";
    default:
      return "other";
  }
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

interface CgListCoin {
  id: string;
  symbol: string;
  name: string;
}

interface CgMarketCoin {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  current_price?: number | null;
  market_cap?: number | null;
  market_cap_rank?: number | null;
  total_volume?: number | null;
  price_change_percentage_24h?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_30d_in_currency?: number | null;
  circulating_supply?: number | null;
  total_supply?: number | null;
  max_supply?: number | null;
  last_updated?: string | null;
}

function cgId(providerId: string) {
  return `crypto:coingecko:${providerId}`;
}

function yahooId(providerId: string) {
  return `yahoo:${providerId}`;
}

function listRow(c: CgListCoin, now: string): InstrumentUpsert {
  return {
    id: cgId(c.id),
    symbol: c.symbol.toUpperCase(),
    name: c.name,
    asset_type: "crypto",
    data_source: "coingecko",
    provider_id: c.id,
    quote_status: "list_only",
    listed_status: "active",
    raw_symbol_key: c.symbol,
    currency: null,
    last_updated: now,
  };
}

function marketRow(c: CgMarketCoin): InstrumentUpsert {
  const price = num(c.current_price);
  return {
    id: cgId(c.id),
    symbol: (c.symbol || "").toUpperCase(),
    name: c.name,
    asset_type: "crypto",
    data_source: "coingecko",
    provider_id: c.id,
    quote_status: price == null ? "unavailable" : "live",
    listed_status: "active",
    raw_symbol_key: c.symbol,
    currency: "USD",
    logo_url: str(c.image),
    price,
    market_cap: num(c.market_cap),
    rank: num(c.market_cap_rank),
    volume_24h: num(c.total_volume),
    volume_basis: num(c.total_volume) == null ? null : "coingecko_total_volume_24h",
    change_24h_pct: num(c.price_change_percentage_24h),
    change_7d_pct: num(c.price_change_percentage_7d_in_currency),
    change_30d_pct: num(c.price_change_percentage_30d_in_currency),
    circulating_supply: num(c.circulating_supply),
    total_supply: num(c.total_supply),
    max_supply: num(c.max_supply),
    last_updated: str(c.last_updated),
  };
}

function loadLiveSnapshots(): Map<string, MarketSnapshot> {
  const rows = getDb().prepare(`SELECT symbol, data FROM market_snapshots`).all() as { symbol: string; data: string }[];
  const out = new Map<string, MarketSnapshot>();
  for (const row of rows) {
    try {
      const snap = JSON.parse(row.data) as MarketSnapshot;
      if (snap.provenance?.quality === "live" && snap.price != null && Number.isFinite(snap.price)) {
        out.set(row.symbol, snap);
      }
    } catch {
      /* skip corrupt snapshot; do not invent a replacement */
    }
  }
  return out;
}

interface YahooSearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchange?: string;
  exchDisp?: string;
  sector?: string;
  industry?: string;
  typeDisp?: string;
}

interface ChartMeta {
  symbol?: string;
  shortName?: string;
  longName?: string;
  instrumentType?: string;
  currency?: string;
  exchangeName?: string;
  fullExchangeName?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
}

let syncing = false;

export async function runInstrumentSync(): Promise<Record<string, unknown>> {
  if (syncing) {
    return { status: "error", error: "sync already running" };
  }
  syncing = true;
  const runId = startSyncRun();
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  let pages = 0;
  let rateLimited = false;
  const errors: string[] = [];
  const detail: Record<string, unknown> = {
    coingecko: {},
    yahoo: {},
  };

  const tally = (r: { inserted: number; updated: number }) => {
    inserted += r.inserted;
    updated += r.updated;
  };

  try {
    // --- CoinGecko: id universe, then quote pages. Stop on 429; never wipe rows. ---
    await sleep(CG_PAUSE_MS);
    const listRes = await getJson(`${CG}/coins/list`);
    const cgDetail: Record<string, unknown> = { list_http: listRes.status };
    if (listRes.rateLimited) {
      rateLimited = true;
      errors.push("coingecko coins/list rate limited");
      cgDetail.list_count = 0;
    } else if (!listRes.json || !Array.isArray(listRes.json)) {
      errors.push(`coingecko coins/list: ${listRes.error || "unexpected body"}`);
      cgDetail.list_count = 0;
    } else {
      const coins = (listRes.json as CgListCoin[]).filter((c) => c && typeof c.id === "string" && c.symbol && c.name);
      cgDetail.list_count = coins.length;
      const rows = coins.map((c) => listRow(c, now));
      tally(upsertInstruments(rows, now));
      cgDetail.list_upserted = coins.length;
    }

    const quotedIds = new Set<string>();
    if (!rateLimited) {
      for (let page = 1; page <= MAX_MARKET_PAGES; page++) {
        await sleep(CG_PAUSE_MS);
        const url =
          `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}` +
          `&sparkline=false&price_change_percentage=7d,30d`;
        const res = await getJson(url);
        if (res.rateLimited) {
          rateLimited = true;
          errors.push(`coingecko markets page ${page} rate limited`);
          cgDetail.stopped_at_page = page;
          break;
        }
        if (!res.json || !Array.isArray(res.json)) {
          errors.push(`coingecko markets page ${page}: ${res.error || "unexpected body"}`);
          cgDetail.stopped_at_page = page;
          break;
        }
        const markets = (res.json as CgMarketCoin[]).filter((c) => c && typeof c.id === "string");
        if (!markets.length) {
          cgDetail.stopped_at_page = page;
          break;
        }
        tally(upsertInstruments(markets.map(marketRow), now));
        for (const m of markets) quotedIds.add(m.id);
        pages += 1;
        cgDetail[`page_${page}`] = markets.length;
      }
    }
    cgDetail.quoted_ids = quotedIds.size;

    // Categories only from CoinGecko's own category list + category-filtered markets.
    const appliedCategories: string[] = [];
    if (!rateLimited) {
      await sleep(CG_PAUSE_MS);
      const catRes = await getJson(`${CG}/coins/categories`);
      if (catRes.rateLimited) {
        rateLimited = true;
        errors.push("coingecko categories rate limited");
      } else if (Array.isArray(catRes.json)) {
        const nameById = new Map<string, string>();
        for (const row of catRes.json as { id?: string; name?: string }[]) {
          if (row?.id && row?.name) nameById.set(row.id, row.name);
        }
        cgDetail.category_catalog = nameById.size;
        for (const slug of CATEGORY_PREFERENCE) {
          if (rateLimited) break;
          const label = nameById.get(slug);
          if (!label) continue;
          await sleep(CG_PAUSE_MS);
          const url =
            `${CG}/coins/markets?vs_currency=usd&category=${encodeURIComponent(slug)}` +
            `&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=7d,30d`;
          const res = await getJson(url);
          if (res.rateLimited) {
            rateLimited = true;
            errors.push(`coingecko category ${slug} rate limited`);
            break;
          }
          if (!Array.isArray(res.json)) {
            errors.push(`coingecko category ${slug}: ${res.error || "unexpected body"}`);
            continue;
          }
          const markets = (res.json as CgMarketCoin[]).filter((c) => c && typeof c.id === "string");
          tally(upsertInstruments(markets.map(marketRow), now));
          for (const m of markets) {
            setCategoryIfEmpty(cgId(m.id), label);
            quotedIds.add(m.id);
          }
          appliedCategories.push(`${label}:${markets.length}`);
        }
      } else {
        errors.push(`coingecko categories: ${catRes.error || "unexpected body"}`);
      }
    }
    cgDetail.categories_applied = appliedCategories;
    cgDetail.quoted_ids = quotedIds.size;
    detail.coingecko = cgDetail;

    // --- Yahoo: search responses + existing tracked symbols. No fabricated constituents. ---
    const queries = Array.from(new Set([...MARKET_UNIVERSE.map((u) => u.yahooSymbol), ...YAHOO_SEARCH_QUERIES]));
    const seenYahoo = new Map<string, YahooSearchQuote>();
    let searchErrors = 0;
    for (const q of queries) {
      await sleep(YAHOO_PAUSE_MS);
      const url = `${YAHOO_SEARCH}?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false`;
      const res = await getJson(url);
      if (res.rateLimited) {
        rateLimited = true;
        errors.push(`yahoo search rate limited at ${q}`);
        break;
      }
      if (!res.json || typeof res.json !== "object") {
        searchErrors += 1;
        errors.push(`yahoo search ${q}: ${res.error || "unexpected body"}`);
        continue;
      }
      const quotes = (res.json as { quotes?: YahooSearchQuote[] }).quotes;
      if (!Array.isArray(quotes)) continue;
      for (const quote of quotes) {
        const symbol = str(quote.symbol);
        if (!symbol) continue;
        if (!seenYahoo.has(symbol)) seenYahoo.set(symbol, quote);
      }
    }

    const yahooRows: InstrumentUpsert[] = [];
    for (const [symbol, quote] of Array.from(seenYahoo.entries())) {
      const qt = str(quote.quoteType);
      yahooRows.push({
        id: yahooId(symbol),
        symbol,
        name: str(quote.longname) || str(quote.shortname) || symbol,
        asset_type: qt ? mapQuoteType(qt) : "other",
        exchange: str(quote.exchDisp),
        exchange_code: str(quote.exchange),
        sector: str(quote.sector),
        industry: str(quote.industry),
        data_source: "yahoo",
        provider_id: symbol,
        quote_status: "list_only",
        listed_status: "active",
        raw_symbol_key: symbol,
        last_updated: now,
      });
    }
    if (yahooRows.length) tally(upsertInstruments(yahooRows, now));

    const quoteTypeBySymbol = new Map<string, string>();
    for (const [symbol, quote] of Array.from(seenYahoo.entries())) {
      const qt = str(quote.quoteType);
      if (qt) quoteTypeBySymbol.set(symbol, qt);
    }

    const snaps = loadLiveSnapshots();
    const trackedRows: InstrumentUpsert[] = MARKET_UNIVERSE.map((item) => {
      const qt = quoteTypeBySymbol.get(item.yahooSymbol);
      const snap = snaps.get(item.symbol);
      const base: InstrumentUpsert = {
        id: yahooId(item.yahooSymbol),
        symbol: item.symbol,
        name: item.name,
        asset_type: qt ? mapQuoteType(qt) : trackedFallbackType(item.category),
        data_source: "yahoo",
        provider_id: item.yahooSymbol,
        quote_status: snap ? "live" : "list_only",
        listed_status: "active",
        raw_symbol_key: item.yahooSymbol,
        legacy_symbol: item.symbol,
        forceIdentity: true,
        last_updated: snap?.provenance.fetchedAt || now,
      };
      if (snap) {
        base.price = snap.price;
        base.change_24h_pct = snap.change1d;
        base.change_7d_pct = snap.change1w;
        base.change_30d_pct = snap.change1m;
        base.volatility = snap.volatilityEst;
        base.currency = snap.currency ?? null;
        base.volume_basis = null;
      }
      return base;
    });
    tally(upsertInstruments(trackedRows, now));

    // Live chart quotes for search hits that are not already covered by the tracked snapshot path.
    const trackedYahoo = new Set(MARKET_UNIVERSE.map((u) => u.yahooSymbol));
    const chartTargets: string[] = [];
    for (const q of YAHOO_SEARCH_QUERIES) {
      if (seenYahoo.has(q) && !trackedYahoo.has(q)) chartTargets.push(q);
    }
    for (const item of MARKET_UNIVERSE) {
      if (!snaps.get(item.symbol)) chartTargets.push(item.yahooSymbol);
    }
    const uniqueCharts = Array.from(new Set(chartTargets)).slice(0, MAX_YAHOO_CHARTS);
    let chartsOk = 0;
    for (const symbol of uniqueCharts) {
      await sleep(500);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
      const res = await getJson(url);
      if (res.rateLimited) {
        rateLimited = true;
        errors.push(`yahoo chart rate limited at ${symbol}`);
        break;
      }
      const meta = (res.json as { chart?: { result?: { meta?: ChartMeta }[] } } | undefined)?.chart?.result?.[0]?.meta;
      if (!meta || num(meta.regularMarketPrice) == null) {
        errors.push(`yahoo chart ${symbol}: ${res.error || "no price"}`);
        continue;
      }
      const qt = str(meta.instrumentType) || quoteTypeBySymbol.get(symbol) || null;
      const row: InstrumentUpsert = {
        id: yahooId(symbol),
        symbol,
        name: str(meta.longName) || str(meta.shortName) || symbol,
        asset_type: qt ? mapQuoteType(qt) : "other",
        exchange: str(meta.fullExchangeName),
        exchange_code: str(meta.exchangeName),
        currency: str(meta.currency),
        price: num(meta.regularMarketPrice),
        change_24h_pct: num(meta.regularMarketChangePercent),
        volume_24h: num(meta.regularMarketVolume),
        volume_basis: num(meta.regularMarketVolume) == null ? null : "yahoo_regular_market_volume",
        data_source: "yahoo",
        provider_id: symbol,
        quote_status: "live",
        listed_status: "active",
        raw_symbol_key: symbol,
        last_updated: now,
      };
      tally(upsertInstruments([row], now));
      chartsOk += 1;
    }

    detail.yahoo = {
      queries: queries.length,
      search_symbols: seenYahoo.size,
      search_errors: searchErrors,
      tracked: MARKET_UNIVERSE.length,
      charts_ok: chartsOk,
      charts_attempted: uniqueCharts.length,
    };

    const status = errors.length || rateLimited ? "partial" : "completed";
    const summary = {
      id: runId,
      status,
      pages,
      inserted,
      updated,
      rate_limited: rateLimited,
      error: errors.length ? errors.join(" | ").slice(0, 2000) : null,
      detail,
      finished_note: "upsert only; existing rows kept on failure",
    };
    finishSyncRun(runId, {
      status,
      pages,
      inserted,
      updated,
      rate_limited: rateLimited,
      error: summary.error,
      detail,
    });
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    finishSyncRun(runId, {
      status: inserted + updated > 0 ? "partial" : "error",
      pages,
      inserted,
      updated,
      rate_limited: rateLimited,
      error: message,
      detail: { ...detail, errors },
    });
    return {
      id: runId,
      status: inserted + updated > 0 ? "partial" : "error",
      pages,
      inserted,
      updated,
      rate_limited: rateLimited,
      error: message,
      detail,
    };
  } finally {
    syncing = false;
  }
}
