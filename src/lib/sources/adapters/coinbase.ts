import { getDb } from "../../db";
import { fetchJson, sleep } from "../http";
import { appendObservation } from "../observations";
import { COINBASE_PRODUCT_MAP } from "./coinbase-map";

export async function runCoinbase(): Promise<{ httpStatus: number | null; ok: boolean; note: string; observations: number; partial: boolean }> {
  const db = getDb();
  const known = db.prepare(`SELECT id FROM instruments WHERE id = ?`);
  let observations = 0;
  let okCount = 0;
  let lastStatus: number | null = null;
  const lines: string[] = [];
  for (const row of COINBASE_PRODUCT_MAP) {
    const exists = known.get(row.instrumentId) as { id: string } | undefined;
    if (!exists) {
      lines.push(`${row.product}: instrument missing, skipped`);
      continue;
    }
    const url = `https://api.exchange.coinbase.com/products/${row.product}/ticker`;
    const res = await fetchJson(url);
    lastStatus = res.status;
    if (res.rateLimited) {
      lines.push(`${row.product}: HTTP 429, stopped`);
      return {
        httpStatus: 429,
        ok: okCount > 0,
        note: lines.join("; "),
        observations,
        partial: true,
      };
    }
    if (!res.ok || !res.json || typeof res.json !== "object") {
      lines.push(`${row.product}: HTTP ${res.status} ${res.error || "no json"}`);
      await sleep(150);
      continue;
    }
    const body = res.json as { price?: string; time?: string };
    const price = Number(body.price);
    if (!Number.isFinite(price)) {
      lines.push(`${row.product}: HTTP ${res.status} price missing`);
      await sleep(150);
      continue;
    }
    const retrievedAt = new Date().toISOString();
    const wrote = appendObservation({
      instrumentId: row.instrumentId,
      field: "price",
      value: price,
      unit: "USD",
      currency: "USD",
      observedAt: body.time || retrievedAt,
      retrievedAt,
      sourceId: "coinbase",
      sourceUrl: url,
      claimType: "market_quote",
    });
    if (wrote) observations += 1;
    okCount += 1;
    lines.push(`${row.product}: HTTP ${res.status} price ${price}`);
    await sleep(150);
  }
  return {
    httpStatus: lastStatus,
    ok: okCount > 0,
    note: `Coinbase tickers with JSON: ${okCount}. ${lines.join("; ")}`.slice(0, 780),
    observations,
    partial: okCount > 0 && okCount < COINBASE_PRODUCT_MAP.length,
  };
}
