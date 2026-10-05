import { blockCoingecko, coingeckoBlocked } from "../cg-guard";
import { fetchJson, sleep } from "../http";
import { appendObservation } from "../observations";
import { COINBASE_PRODUCT_MAP } from "./coinbase-map";
import { PROJECT_COINS } from "./coingecko-project";

const GAP_MS = 8000;

function idsForSimplePrice(): string[] {
  const ids = new Set<string>();
  for (const row of COINBASE_PRODUCT_MAP) {
    const prefix = "crypto:coingecko:";
    if (row.instrumentId.startsWith(prefix)) ids.add(row.instrumentId.slice(prefix.length));
  }
  for (const coin of PROJECT_COINS) ids.add(coin.id);
  return Array.from(ids);
}

export async function runCoingeckoMarkets(): Promise<{ httpStatus: number | null; ok: boolean; note: string; observations: number; partial: boolean }> {
  if (coingeckoBlocked()) {
    return {
      httpStatus: 429,
      ok: false,
      note: "Skipped simple/price and /global. An earlier CoinGecko call returned 429.",
      observations: 0,
      partial: true,
    };
  }
  const notes: string[] = [];
  let observations = 0;
  let lastStatus: number | null = null;
  let anyOk = false;
  let partial = false;

  await sleep(GAP_MS);
  const ids = idsForSimplePrice();
  const simpleUrl =
    "https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd" +
    "&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true" +
    `&ids=${ids.join(",")}`;
  const simple = await fetchJson(simpleUrl);
  lastStatus = simple.status;
  if (simple.rateLimited) {
    blockCoingecko();
    return {
      httpStatus: 429,
      ok: false,
      note: "simple/price HTTP 429. Did not call /global. No retry.",
      observations: 0,
      partial: true,
    };
  }
  if (!simple.ok || !simple.json || typeof simple.json !== "object" || Array.isArray(simple.json)) {
    notes.push(`simple/price HTTP ${simple.status} ${simple.error || "failed"}`);
    partial = true;
  } else {
    anyOk = true;
    const retrievedAt = new Date().toISOString();
    const body = simple.json as Record<string, Record<string, unknown>>;
    for (const id of ids) {
      const row = body[id];
      if (!row || typeof row !== "object") continue;
      const instrumentId = `crypto:coingecko:${id}`;
      const observedAt =
        typeof row.last_updated_at === "number"
          ? new Date(row.last_updated_at * 1000).toISOString()
          : retrievedAt;
      const sourceUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
      const fields: { field: string; key: string; unit: string | null }[] = [
        { field: "price", key: "usd", unit: "USD" },
        { field: "market_cap", key: "usd_market_cap", unit: "USD" },
        { field: "volume_24h", key: "usd_24h_vol", unit: "USD" },
        { field: "change_24h_pct", key: "usd_24h_change", unit: "percent" },
      ];
      for (const f of fields) {
        const value = row[f.key];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        if (
          appendObservation({
            instrumentId,
            field: f.field,
            value,
            unit: f.unit,
            currency: f.unit === "USD" ? "USD" : null,
            observedAt,
            retrievedAt,
            sourceId: "coingecko",
            sourceUrl,
            claimType: "market_quote",
          })
        ) {
          observations += 1;
        }
      }
    }
    notes.push(`simple/price HTTP ${simple.status} for ${ids.length} ids`);
  }

  if (coingeckoBlocked()) {
    return { httpStatus: lastStatus, ok: anyOk, note: notes.join("; "), observations, partial: true };
  }
  await sleep(GAP_MS);
  const globalUrl = "https://api.coingecko.com/api/v3/global";
  const globalRes = await fetchJson(globalUrl);
  lastStatus = globalRes.status;
  if (globalRes.rateLimited) {
    blockCoingecko();
    notes.push("global HTTP 429, stopped, no retry");
    partial = true;
  } else if (!globalRes.ok || !globalRes.json || typeof globalRes.json !== "object") {
    notes.push(`global HTTP ${globalRes.status} ${globalRes.error || "failed"}`);
    partial = true;
  } else {
    anyOk = true;
    const data = (globalRes.json as { data?: Record<string, unknown> }).data;
    if (data && typeof data === "object") {
      const pct = data.market_cap_percentage;
      const mcap = data.total_market_cap;
      const vol = data.total_volume;
      const stored = {
        total_market_cap_usd:
          mcap && typeof mcap === "object" ? (mcap as { usd?: unknown }).usd ?? null : null,
        total_volume_usd: vol && typeof vol === "object" ? (vol as { usd?: unknown }).usd ?? null : null,
        market_cap_percentage_btc:
          pct && typeof pct === "object" ? (pct as { btc?: unknown }).btc ?? null : null,
        market_cap_percentage_eth:
          pct && typeof pct === "object" ? (pct as { eth?: unknown }).eth ?? null : null,
        market_cap_change_percentage_24h_usd: data.market_cap_change_percentage_24h_usd ?? null,
        active_cryptocurrencies: data.active_cryptocurrencies ?? null,
        updated_at: data.updated_at ?? null,
      };
      const observedAt =
        typeof data.updated_at === "number" ? new Date(data.updated_at * 1000).toISOString() : new Date().toISOString();
      if (
        appendObservation({
          instrumentId: null,
          field: "cg_global",
          value: stored,
          unit: "USD",
          currency: "USD",
          observedAt,
          retrievedAt: new Date().toISOString(),
          sourceId: "coingecko",
          sourceUrl: globalUrl,
          claimType: "market_quote",
        })
      ) {
        observations += 1;
      }
      notes.push(`global HTTP ${globalRes.status}`);
    } else {
      notes.push("global HTTP 200 but data missing");
      partial = true;
    }
  }

  return {
    httpStatus: lastStatus,
    ok: anyOk,
    note: notes.join("; "),
    observations,
    partial,
  };
}
