import type { InstrumentRow } from "./store";

export const SERIES_RANGES = ["1D", "7D", "1M", "3M", "6M", "1Y", "3Y", "5Y", "Max"] as const;
export type SeriesRange = (typeof SERIES_RANGES)[number];

export interface SeriesPoint {
  t: string;
  v: number;
}

export interface SeriesResult {
  range: string;
  supported: boolean;
  points: SeriesPoint[];
  source: string | null;
  note: string;
}

const YAHOO_RANGE: Partial<Record<SeriesRange, { range: string; interval: string }>> = {
  "1D": { range: "1d", interval: "5m" },
  "1M": { range: "1mo", interval: "1d" },
  "3M": { range: "3mo", interval: "1d" },
  "6M": { range: "6mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  "5Y": { range: "5y", interval: "1wk" },
  Max: { range: "max", interval: "1mo" },
};

const CG_DAYS: Partial<Record<SeriesRange, string>> = {
  "1D": "1",
  "7D": "7",
  "1M": "30",
  "3M": "90",
  "6M": "180",
  "1Y": "365",
  "3Y": "1095",
  "5Y": "1825",
  Max: "max",
};

function unavailable(range: string, note: string): SeriesResult {
  return { range, supported: false, points: [], source: null, note };
}

async function yahooSeries(symbol: string, range: SeriesRange): Promise<SeriesResult> {
  const spec = YAHOO_RANGE[range];
  if (!spec) {
    return unavailable(range, "Data unavailable");
  }
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${spec.range}&interval=${spec.interval}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; GFIAgent/0.1; research)",
    },
    cache: "no-store",
  });
  if (!res.ok) return unavailable(range, "Data unavailable");
  const text = await res.text();
  if (text.startsWith("Too Many Requests")) return unavailable(range, "Data unavailable");
  const json = JSON.parse(text) as {
    chart?: {
      result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[];
    };
  };
  const result = json.chart?.result?.[0];
  const ts = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!ts || !closes) return unavailable(range, "Data unavailable");
  const points: SeriesPoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const v = closes[i];
    if (v == null || !Number.isFinite(v)) continue;
    points.push({ t: new Date(ts[i] * 1000).toISOString(), v });
  }
  if (!points.length) return unavailable(range, "Data unavailable");
  return {
    range,
    supported: true,
    points,
    source: "Yahoo Finance chart API",
    note: `${spec.range} ${spec.interval}`,
  };
}

async function coingeckoSeries(providerId: string, range: SeriesRange): Promise<SeriesResult> {
  const days = CG_DAYS[range];
  if (!days) return unavailable(range, "Data unavailable");
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(providerId)}/market_chart?vs_currency=usd&days=${days}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; Calibra/0.1; research)" },
    cache: "no-store",
  });
  if (res.status === 429 || !res.ok) return unavailable(range, "Data unavailable");
  const json = (await res.json()) as { prices?: [number, number][] };
  const prices = json.prices;
  if (!Array.isArray(prices) || !prices.length) return unavailable(range, "Data unavailable");
  const points: SeriesPoint[] = [];
  for (const pair of prices) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const [ms, v] = pair;
    if (!Number.isFinite(ms) || !Number.isFinite(v)) continue;
    points.push({ t: new Date(ms).toISOString(), v });
  }
  if (!points.length) return unavailable(range, "Data unavailable");
  return {
    range,
    supported: true,
    points,
    source: "CoinGecko market_chart",
    note: `days=${days}`,
  };
}

export async function loadSeries(inst: InstrumentRow, range: string): Promise<SeriesResult> {
  const r = (SERIES_RANGES as readonly string[]).includes(range) ? (range as SeriesRange) : null;
  if (!r) return unavailable(range, "Data unavailable");
  if (inst.data_source === "coingecko") {
    return coingeckoSeries(inst.provider_id, r);
  }
  if (inst.data_source === "yahoo") {
    const symbol = inst.raw_symbol_key || inst.provider_id;
    return yahooSeries(symbol, r);
  }
  return unavailable(r, "Data unavailable");
}

export function seriesSupport(inst: InstrumentRow): { range: SeriesRange; supported: boolean }[] {
  return SERIES_RANGES.map((range) => {
    if (inst.data_source === "coingecko") return { range, supported: CG_DAYS[range] != null };
    if (inst.data_source === "yahoo") return { range, supported: YAHOO_RANGE[range] != null };
    return { range, supported: false };
  });
}
