import { randomUUID } from "crypto";
import { getDb, setMeta } from "../db";
import type { DataQuality, MarketHistoryPoint, MarketSnapshot } from "../types";
import { MARKET_UNIVERSE } from "./universe";

export function insertHistoryPoint(point: Omit<MarketHistoryPoint, "id"> & { id?: string }): void {
  const db = getDb();
  const id = point.id ?? randomUUID();
  // Dedupe near-identical live snapshots (same symbol+ts+price)
  const existing = db
    .prepare(
      `SELECT id FROM market_history WHERE symbol = ? AND ts = ? AND ABS(price - ?) < 1e-9 AND bar_kind = ? LIMIT 1`
    )
    .get(point.symbol, point.ts, point.price, point.barKind) as { id: string } | undefined;
  if (existing) return;

  db.prepare(
    `INSERT INTO market_history(id, symbol, price, ts, source, quality, bar_kind, note, data)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    point.symbol,
    point.price,
    point.ts,
    point.source,
    point.quality,
    point.barKind,
    point.note ?? null,
    JSON.stringify({ ...point, id })
  );
}

/** Persist each successful market fetch into append-only history */
export function persistSnapshotsToHistory(snaps: MarketSnapshot[]): number {
  let n = 0;
  for (const snap of snaps) {
    if (snap.price == null || !Number.isFinite(snap.price)) continue;
    // Never treat demo/illustrative prices as resolvable market history
    if (snap.provenance.quality === "demo") continue;
    insertHistoryPoint({
      symbol: snap.symbol,
      price: snap.price,
      ts: snap.provenance.fetchedAt,
      source: snap.provenance.source,
      quality: snap.provenance.quality,
      barKind: "live_snapshot",
      note: snap.provenance.note,
    });
    n++;
  }
  return n;
}

export function getHistoryForSymbol(symbol: string): MarketHistoryPoint[] {
  const rows = getDb()
    .prepare(`SELECT data FROM market_history WHERE symbol = ? ORDER BY ts ASC`)
    .all(symbol) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as MarketHistoryPoint);
}

export function countHistory(): number {
  const row = getDb().prepare(`SELECT COUNT(*) as c FROM market_history`).get() as { c: number };
  return row.c;
}

/**
 * Find snapshot closest to targetTs within ±toleranceMs.
 * Prefer live_snapshot; fall back to yahoo_historical_bar.
 * Returns null if none within tolerance — caller must mark unresolvable.
 */
export function findClosestObservation(
  symbol: string,
  targetTs: string,
  toleranceMs: number
): MarketHistoryPoint | null {
  const target = new Date(targetTs).getTime();
  if (!Number.isFinite(target)) return null;

  const rows = getDb()
    .prepare(`SELECT data FROM market_history WHERE symbol = ?`)
    .all(symbol) as { data: string }[];

  let best: MarketHistoryPoint | null = null;
  let bestDist = Infinity;

  for (const row of rows) {
    const p = JSON.parse(row.data) as MarketHistoryPoint;
    const t = new Date(p.ts).getTime();
    if (!Number.isFinite(t)) continue;
    const dist = Math.abs(t - target);
    if (dist > toleranceMs) continue;
    // Prefer live over historical when equally close
    const prefer =
      best == null ||
      dist < bestDist ||
      (dist === bestDist && p.barKind === "live_snapshot" && best.barKind !== "live_snapshot");
    if (prefer) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}

interface ChartBar {
  ts: string;
  close: number;
}

async function fetchYahooDailyBars(yahooSymbol: string, range = "10d"): Promise<ChartBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=1d`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GFIAgent/0.1; research)",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.startsWith("Too Many Requests")) throw new Error("Too Many Requests");
  const json = JSON.parse(text) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  };
  const result = json.chart?.result?.[0];
  if (!result?.timestamp) return [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const bars: ChartBar[] = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c)) continue;
    bars.push({
      ts: new Date(result.timestamp[i] * 1000).toISOString(),
      close: c,
    });
  }
  return bars;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Backfill yahoo historical daily bars into market_history.
 * Labeled bar_kind=yahoo_historical_bar — never silently mixed with live track claims.
 */
export async function backfillHistoricalBars(
  symbols?: string[]
): Promise<{ inserted: number; errors: string[] }> {
  const focus = symbols ?? ["BTC", "SPX", "EURUSD", "GOLD", "VIX", "ETH", "OIL", "US10Y"];
  let inserted = 0;
  const errors: string[] = [];

  for (const sym of focus) {
    const item = MARKET_UNIVERSE.find((u) => u.symbol === sym);
    if (!item) continue;
    try {
      const bars = await fetchYahooDailyBars(item.yahooSymbol, "10d");
      for (const bar of bars) {
        const before = countHistory();
        insertHistoryPoint({
          symbol: sym,
          price: bar.close,
          ts: bar.ts,
          source: "Yahoo Finance chart API (historical bar)",
          quality: "cached" as DataQuality,
          barKind: "yahoo_historical_bar",
          note: `Daily close bar for ${item.yahooSymbol} — provenance for resolution only`,
        });
        if (countHistory() > before) inserted++;
      }
      await sleep(400);
    } catch (e) {
      errors.push(`${sym}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  setMeta("lastHistoryBackfill", new Date().toISOString());
  return { inserted, errors };
}

export function getLatestHistoryTs(symbol: string): string | null {
  const row = getDb()
    .prepare(`SELECT ts FROM market_history WHERE symbol = ? ORDER BY ts DESC LIMIT 1`)
    .get(symbol) as { ts: string } | undefined;
  return row?.ts ?? null;
}
