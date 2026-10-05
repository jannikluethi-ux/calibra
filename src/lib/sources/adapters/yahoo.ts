import { fetchJson } from "../http";
import { getDb } from "../../db";
import { appendObservation } from "../observations";

/**
 * One chart request so the source row records a real HTTP status.
 * Does not walk the equity universe and does not write crypto consensus prices.
 * Yahoo crypto instruments (yahoo:BTC-USD, yahoo:ETH-USD) stay separate rows.
 */
export async function runYahoo(): Promise<{ httpStatus: number | null; ok: boolean; note: string; observations: number; partial: boolean }> {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d";
  const res = await fetchJson(url);
  if (!res.ok || !res.json || typeof res.json !== "object") {
    return {
      httpStatus: res.status,
      ok: false,
      note: `Yahoo AAPL chart failed: HTTP ${res.status} ${res.error || ""}`.slice(0, 400),
      observations: 0,
      partial: false,
    };
  }
  const chart = res.json as {
    chart?: { result?: { meta?: { regularMarketPrice?: number } }[] };
  };
  const price = chart.chart?.result?.[0]?.meta?.regularMarketPrice;
  let observations = 0;
  if (typeof price === "number" && Number.isFinite(price)) {
    const inst = getDb().prepare(`SELECT id FROM instruments WHERE id = ?`).get("yahoo:AAPL") as
      | { id: string }
      | undefined;
    if (inst) {
      const now = new Date().toISOString();
      if (
        appendObservation({
          instrumentId: inst.id,
          field: "price",
          value: price,
          unit: "USD",
          currency: "USD",
          observedAt: now,
          retrievedAt: now,
          sourceId: "yahoo",
          sourceUrl: "https://finance.yahoo.com/quote/AAPL",
          claimType: "market_quote",
        })
      ) {
        observations = 1;
      }
    }
  }
  return {
    httpStatus: res.status,
    ok: true,
    note: `HTTP ${res.status} for AAPL chart only. Equity/FX/index path. Not an equity-universe sync. AAPL price stored: ${typeof price === "number" ? price : "missing"}.`,
    observations,
    partial: true,
  };
}
