import { MARKET_UNIVERSE } from "./universe";
import type { MarketSnapshot, Provenance } from "../types";
import { getDb, upsertJson, setMeta, getJsonAll } from "../db";
import { persistSnapshotsToHistory } from "./history";
import { recordAttempt } from "../sources/health";
import { classifyFailure, isValidPrice, statusFromError, withRetry, withTimeout, type AttemptOutcome } from "../sources/health-core";
import { computeDataQualityLabel } from "../quality/summary";

function pctChange(current: number, prior: number): number | null {
  if (!prior || !Number.isFinite(prior) || !Number.isFinite(current)) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function estimateVol(closes: number[]): number | null {
  if (closes.length < 10) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < 5) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface ChartResult {
  meta?: { regularMarketPrice?: number; regularMarketTime?: number; currency?: string; symbol?: string };
  timestamp?: number[];
  indicators?: { quote?: { close?: (number | null)[] }[] };
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

async function fetchChart(
  yahooSymbol: string,
  fetchImpl: FetchLike
): Promise<{ price: number | null; closes: number[]; marketTime: string | null }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=3mo&interval=1d`;
  const res = await withTimeout(
    fetchImpl(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GFIAgent/0.1; research)", Accept: "application/json" },
      cache: "no-store",
    }),
    20000,
    yahooSymbol
  );
  const text = await res.text();
  if (res.status === 429 || text.startsWith("Too Many Requests")) throw new HttpError(429, "HTTP 429 Too Many Requests");
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`);
  let json: { chart?: { result?: ChartResult[]; error?: unknown } };
  try {
    json = JSON.parse(text);
  } catch {
    throw new HttpError(res.status, "invalid JSON");
  }
  const result = json.chart?.result?.[0];
  if (!result) throw new HttpError(res.status, "invalid data: empty chart result");
  const closesRaw = result.indicators?.quote?.[0]?.close ?? [];
  const closes = closesRaw.filter((c): c is number => isValidPrice(c));
  const price = result.meta?.regularMarketPrice ?? (closes.length ? closes[closes.length - 1] : null);
  const mt = result.meta?.regularMarketTime;
  return { price: price ?? null, closes, marketTime: mt && mt > 0 ? new Date(mt * 1000).toISOString() : null };
}

interface SymbolResult {
  snap: MarketSnapshot;
  outcome: AttemptOutcome;
}

async function fetchOne(item: (typeof MARKET_UNIVERSE)[0], fetchImpl: FetchLike, retryBaseMs: number): Promise<SymbolResult> {
  const now = new Date().toISOString();
  const provenance: Provenance = {
    source: "Yahoo Finance chart API",
    sourceTier: 3,
    url: `https://finance.yahoo.com/quote/${encodeURIComponent(item.yahooSymbol)}`,
    fetchedAt: now,
    quality: "live",
  };
  const base = {
    symbol: item.symbol,
    name: item.name,
    category: item.category,
    isProxy: item.isProxy,
    proxyNote: item.proxyNote,
  };
  const t0 = Date.now();
  const r = await withRetry<{ price: number | null; closes: number[]; marketTime: string | null }>(
    async () => {
      try {
        const v = await fetchChart(item.yahooSymbol, fetchImpl);
        return { outcome: { ok: true, errorClass: "ok" }, value: v };
      } catch (e) {
        const status = e instanceof HttpError ? e.status : statusFromError(e);
        const msg = e instanceof Error ? e.message : String(e);
        const cls = /invalid (json|data)/i.test(msg) ? "invalid_data" : classifyFailure({ status, error: msg });
        return { outcome: { ok: false, errorClass: cls, httpStatus: status, error: msg.slice(0, 200) } };
      }
    },
    { retries: 1, baseDelayMs: retryBaseMs }
  );
  const latencyMs = Date.now() - t0;
  if (!r.outcome.ok || !r.value) {
    return {
      snap: { ...base, price: null, change1d: null, change1w: null, change1m: null, volatilityEst: null, provenance: { ...provenance, quality: "insufficient", errorClass: r.outcome.errorClass, note: `Fetch failed (${r.outcome.errorClass}): ${(r.outcome.error ?? "").slice(0, 160)}` } },
      outcome: { ...r.outcome, latencyMs, items: 0 },
    };
  }
  const { price, closes, marketTime } = r.value;
  const px = isValidPrice(price) ? price : price == null && closes.length ? closes[closes.length - 1] : null;
  if (!isValidPrice(px)) {
    // Response arrived but the quote is unusable (e.g. BUND.DE returns regularMarketPrice 0): invalid, not live.
    return {
      snap: { ...base, price: null, change1d: null, change1w: null, change1m: null, volatilityEst: null, provenance: { ...provenance, quality: "insufficient", errorClass: "invalid_data", observedAt: marketTime, note: `Invalid quote from source (price=${String(price)}); treated as missing` } },
      outcome: { ok: false, errorClass: "invalid_data", httpStatus: 200, error: `invalid price ${String(price)}`, latencyMs, items: 0 },
    };
  }
  const d1 = closes.length >= 2 ? closes[closes.length - 2] : null;
  const w1 = closes.length >= 6 ? closes[closes.length - 6] : null;
  const m1 = closes.length >= 22 ? closes[closes.length - 22] : closes[0] ?? null;
  return {
    snap: {
      ...base,
      price: px,
      change1d: d1 != null ? pctChange(px, d1) : null,
      change1w: w1 != null ? pctChange(px, w1) : null,
      change1m: m1 != null ? pctChange(px, m1) : null,
      volatilityEst: estimateVol(closes.slice(-22)),
      provenance: { ...provenance, observedAt: marketTime },
    },
    outcome: { ok: true, errorClass: "ok", httpStatus: 200, latencyMs, items: 1, newestObservationAt: marketTime ?? now },
  };
}

/**
 * When a symbol has no valid live quote, show the last VALID non-demo snapshot unchanged and labeled
 * as carried forward (quality "cached"), or missing (price null) if there is none. Never invents a value.
 */
function carryForward(failed: MarketSnapshot, previous: MarketSnapshot | undefined): MarketSnapshot {
  const prevValid =
    previous && isValidPrice(previous.price) && previous.provenance.quality !== "demo" && previous.provenance.quality !== "insufficient";
  if (!prevValid) return failed;
  const lastFetched = previous.provenance.carriedForward ? previous.provenance.fetchedAt : previous.provenance.fetchedAt;
  return {
    ...previous,
    provenance: {
      ...previous.provenance,
      quality: "cached",
      carriedForward: true,
      errorClass: failed.provenance.errorClass,
      fetchedAt: lastFetched,
      note: `Last valid quote from ${lastFetched} shown; latest fetch ${failed.provenance.fetchedAt} failed (${failed.provenance.errorClass ?? "unknown"}). Not refreshed.`,
    },
  };
}

export interface MarketRefreshOptions {
  fetchImpl?: FetchLike;
  paceMs?: number;
  retryBaseMs?: number;
}

export async function refreshMarketData(opts: MarketRefreshOptions = {}): Promise<MarketSnapshot[]> {
  const fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const paceMs = opts.paceMs ?? 450; // pace to reduce 429s
  const retryBaseMs = opts.retryBaseMs ?? 1000;
  getDb();
  const previous = new Map(getMarketSnapshots().map((s) => [s.symbol, s]));
  const results: SymbolResult[] = [];
  let rateLimited = false;
  for (const item of MARKET_UNIVERSE) {
    if (rateLimited) {
      // Stop hammering a provider that already said 429 in this run.
      const now = new Date().toISOString();
      results.push({
        snap: { symbol: item.symbol, name: item.name, category: item.category, price: null, change1d: null, change1w: null, change1m: null, volatilityEst: null, isProxy: item.isProxy, proxyNote: item.proxyNote, provenance: { source: "Yahoo Finance chart API", sourceTier: 3, fetchedAt: now, quality: "insufficient", errorClass: "rate_limited", note: "Not requested: provider rate-limited earlier in this run" } },
        outcome: { ok: false, errorClass: "rate_limited", items: 0 },
      });
      continue;
    }
    const r = await fetchOne(item, fetchImpl, retryBaseMs);
    results.push(r);
    if (r.outcome.errorClass === "rate_limited") rateLimited = true;
    if (paceMs > 0) await sleep(paceMs);
  }

  const finalResults = results.map((r) => (isValidPrice(r.snap.price) ? r.snap : carryForward(r.snap, previous.get(r.snap.symbol))));

  const now = new Date().toISOString();
  for (const snap of finalResults) {
    upsertJson("market_snapshots", "symbol", snap.symbol, snap, { updated_at: now });
  }
  // Append-only history gets ONLY fresh, valid, non-demo quotes (carried-forward values are not re-recorded).
  persistSnapshotsToHistory(finalResults.filter((s) => !s.provenance.carriedForward && isValidPrice(s.price)));

  const okN = results.filter((r) => r.outcome.ok).length;
  const failed = results.filter((r) => !r.outcome.ok);
  const classes = failed.reduce<Record<string, number>>((a, r) => ((a[r.outcome.errorClass] = (a[r.outcome.errorClass] ?? 0) + 1), a), {});
  const newest = results.map((r) => r.outcome.newestObservationAt).filter((x): x is string => !!x).sort().pop() ?? null;
  recordAttempt("yahoo_markets", {
    ok: okN > 0,
    errorClass: okN > 0 ? "ok" : rateLimited ? "rate_limited" : (Object.keys(classes)[0] as AttemptOutcome["errorClass"]) ?? "unavailable",
    httpStatus: okN > 0 ? 200 : results.find((r) => r.outcome.httpStatus)?.outcome.httpStatus ?? null,
    latencyMs: results.reduce((a, r) => a + (r.outcome.latencyMs ?? 0), 0),
    items: okN,
    newestObservationAt: newest,
    error: failed.length ? `${failed.length}/${results.length} symbols without valid quote: ${failed.map((r) => `${r.snap.symbol}=${r.outcome.errorClass}`).join(", ")}`.slice(0, 300) : null,
  });

  if (okN > 0) setMeta("lastMarketUpdate", now);
  setMeta("dataQuality", computeDataQualityLabel());
  return finalResults;
}

export function getMarketSnapshots(): MarketSnapshot[] {
  return getJsonAll<MarketSnapshot>("market_snapshots");
}

export function getMarketSnapshot(symbol: string): MarketSnapshot | null {
  const all = getMarketSnapshots();
  return all.find((s) => s.symbol === symbol) ?? null;
}
