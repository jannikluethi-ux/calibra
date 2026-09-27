import { MARKET_UNIVERSE } from "./universe";
import type { MarketSnapshot, Provenance } from "../types";
import { getDb, upsertJson, setMeta, getJsonAll } from "../db";
import { persistSnapshotsToHistory } from "./history";

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
  meta?: { regularMarketPrice?: number; currency?: string; symbol?: string };
  timestamp?: number[];
  indicators?: { quote?: { close?: (number | null)[] }[] };
}

async function fetchChart(yahooSymbol: string): Promise<{ price: number | null; closes: number[] }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=3mo&interval=1d`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GFIAgent/0.1; research)",
      Accept: "application/json",
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const text = await res.text();
  if (text.startsWith("Too Many Requests")) throw new Error("Too Many Requests");
  const json = JSON.parse(text) as { chart?: { result?: ChartResult[]; error?: unknown } };
  const result = json.chart?.result?.[0];
  if (!result) throw new Error("Empty chart result");
  const closesRaw = result.indicators?.quote?.[0]?.close ?? [];
  const closes = closesRaw.filter((c): c is number => c != null && Number.isFinite(c));
  const price =
    result.meta?.regularMarketPrice ??
    (closes.length ? closes[closes.length - 1] : null);
  return { price: price ?? null, closes };
}

async function fetchOne(item: (typeof MARKET_UNIVERSE)[0]): Promise<MarketSnapshot> {
  const now = new Date().toISOString();
  const provenance: Provenance = {
    source: "Yahoo Finance chart API",
    sourceTier: 3,
    url: `https://finance.yahoo.com/quote/${encodeURIComponent(item.yahooSymbol)}`,
    fetchedAt: now,
    quality: "live",
  };

  try {
    const { price, closes } = await fetchChart(item.yahooSymbol);
    if (price == null && closes.length === 0) {
      return {
        symbol: item.symbol,
        name: item.name,
        category: item.category,
        price: null,
        change1d: null,
        change1w: null,
        change1m: null,
        volatilityEst: null,
        isProxy: item.isProxy,
        proxyNote: item.proxyNote,
        provenance: { ...provenance, quality: "insufficient", note: "No bars returned" },
      };
    }
    const px = price ?? closes[closes.length - 1];
    const d1 = closes.length >= 2 ? closes[closes.length - 2] : null;
    const w1 = closes.length >= 6 ? closes[closes.length - 6] : null;
    const m1 = closes.length >= 22 ? closes[closes.length - 22] : closes[0] ?? null;

    return {
      symbol: item.symbol,
      name: item.name,
      category: item.category,
      price: px,
      change1d: d1 != null ? pctChange(px, d1) : null,
      change1w: w1 != null ? pctChange(px, w1) : null,
      change1m: m1 != null ? pctChange(px, m1) : null,
      volatilityEst: estimateVol(closes.slice(-22)),
      isProxy: item.isProxy,
      proxyNote: item.proxyNote,
      provenance,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      symbol: item.symbol,
      name: item.name,
      category: item.category,
      price: null,
      change1d: null,
      change1w: null,
      change1m: null,
      volatilityEst: null,
      isProxy: item.isProxy,
      proxyNote: item.proxyNote,
      provenance: {
        ...provenance,
        quality: "insufficient",
        note: `Fetch failed: ${msg.slice(0, 160)}`,
      },
    };
  }
}

/** Labeled illustrative snapshots — ONLY used when live Yahoo fails entirely */
const DEMO_MARKETS: Partial<Record<string, { price: number; change1d: number; change1w: number; change1m: number; vol: number }>> = {
  SPX: { price: 5620, change1d: 0.35, change1w: 1.2, change1m: 2.8, vol: 14 },
  NDX: { price: 17800, change1d: 0.5, change1w: 1.5, change1m: 3.1, vol: 18 },
  SX5E: { price: 4850, change1d: -0.2, change1w: 0.4, change1m: 1.1, vol: 15 },
  UKX: { price: 8250, change1d: 0.1, change1w: 0.6, change1m: 1.4, vol: 12 },
  DAX: { price: 18600, change1d: -0.15, change1w: 0.8, change1m: 2.0, vol: 14 },
  NKY: { price: 38500, change1d: 0.4, change1w: -0.5, change1m: 1.0, vol: 16 },
  HSI: { price: 17800, change1d: -0.6, change1w: -1.2, change1m: -2.5, vol: 22 },
  MSCI_WORLD: { price: 115, change1d: 0.25, change1w: 0.9, change1m: 2.2, vol: 13 },
  BTC: { price: 84000, change1d: 1.2, change1w: -2.5, change1m: 5.0, vol: 45 },
  ETH: { price: 3200, change1d: 1.5, change1w: -3.0, change1m: 4.0, vol: 55 },
  GOLD: { price: 2650, change1d: 0.2, change1w: 1.1, change1m: 3.5, vol: 14 },
  SILVER: { price: 31, change1d: 0.4, change1w: 2.0, change1m: 5.0, vol: 25 },
  OIL: { price: 72, change1d: -0.8, change1w: 2.5, change1m: -1.0, vol: 28 },
  NATGAS: { price: 2.8, change1d: 1.5, change1w: -4.0, change1m: -8.0, vol: 55 },
  US2Y: { price: 4.1, change1d: 0.02, change1w: 0.05, change1m: -0.1, vol: 8 },
  US10Y: { price: 4.25, change1d: 0.03, change1w: 0.08, change1m: 0.12, vol: 10 },
  DE10Y: { price: 118, change1d: -0.1, change1w: 0.3, change1m: 0.8, vol: 8 },
  EURUSD: { price: 1.085, change1d: -0.15, change1w: 0.4, change1m: -0.8, vol: 8 },
  USDJPY: { price: 149.5, change1d: 0.2, change1w: -0.6, change1m: 1.5, vol: 10 },
  DXY: { price: 104.2, change1d: 0.1, change1w: -0.3, change1m: 0.5, vol: 7 },
  VIX: { price: 16.5, change1d: -2.0, change1w: 5.0, change1m: -8.0, vol: 80 },
};

function demoSnapshot(item: (typeof MARKET_UNIVERSE)[0]): MarketSnapshot {
  const d = DEMO_MARKETS[item.symbol];
  const now = new Date().toISOString();
  return {
    symbol: item.symbol,
    name: item.name,
    category: item.category,
    price: d?.price ?? null,
    change1d: d?.change1d ?? null,
    change1w: d?.change1w ?? null,
    change1m: d?.change1m ?? null,
    volatilityEst: d?.vol ?? null,
    isProxy: item.isProxy,
    proxyNote: item.proxyNote,
    provenance: {
      source: "Demo / illustrative market snapshot",
      sourceTier: 4,
      fetchedAt: now,
      quality: "demo",
      note: "ILLUSTRATIVE SAMPLE — live Yahoo fetch failed or rate-limited. Not a live quote.",
    },
  };
}

export async function refreshMarketData(): Promise<MarketSnapshot[]> {
  const results: MarketSnapshot[] = [];
  for (const item of MARKET_UNIVERSE) {
    const snap = await fetchOne(item);
    results.push(snap);
    await sleep(450); // pace to reduce 429s
  }

  const liveCount = results.filter((r) => r.provenance.quality === "live" && r.price != null).length;
  const finalResults =
    liveCount === 0
      ? MARKET_UNIVERSE.map((item) => {
          const failed = results.find((r) => r.symbol === item.symbol);
          const demo = demoSnapshot(item);
          return {
            ...demo,
            provenance: {
              ...demo.provenance,
              note: `ILLUSTRATIVE SAMPLE used because live fetch failed (${failed?.provenance.note || "unknown"}). Not a live quote.`,
            },
          };
        })
      : results.map((r) =>
          r.price == null && r.provenance.quality === "insufficient"
            ? (() => {
                const item = MARKET_UNIVERSE.find((u) => u.symbol === r.symbol)!;
                const demo = demoSnapshot(item);
                return {
                  ...demo,
                  provenance: {
                    ...demo.provenance,
                    note: `Per-symbol fallback: ${r.provenance.note}. Demo figures — not live.`,
                  },
                };
              })()
            : r
        );

  getDb();
  const now = new Date().toISOString();
  for (const snap of finalResults) {
    upsertJson("market_snapshots", "symbol", snap.symbol, snap, { updated_at: now });
  }
  // Persist ONLY non-demo live/cached quotes into append-only history for resolution
  persistSnapshotsToHistory(finalResults);
  setMeta("lastMarketUpdate", now);
  const liveFinal = finalResults.filter((r) => r.provenance.quality === "live" && r.price != null).length;
  setMeta(
    "dataQuality",
    liveFinal >= finalResults.length * 0.6 ? "live" : liveFinal > 0 ? "cached" : "demo"
  );
  return finalResults;
}

export function getMarketSnapshots(): MarketSnapshot[] {
  return getJsonAll<MarketSnapshot>("market_snapshots");
}

export function getMarketSnapshot(symbol: string): MarketSnapshot | null {
  const all = getMarketSnapshots();
  return all.find((s) => s.symbol === symbol) ?? null;
}
