/**
 * Throwaway-DB fixtures for the read-only regression suite. Every write here is an EXPLICIT setup call
 * (seed, persist, create) made before measurement starts; nothing relies on a GET to populate the DB.
 */
import { createHash } from "node:crypto";

export interface FixtureCtx {
  fixture: "empty" | "populated";
  eventId: string;
  watchlistId: string;
  validToken?: string;
  expiredToken?: string;
}

export const FAKE_TOKEN = "0".repeat(64);

export async function buildEmptyFixture(): Promise<FixtureCtx> {
  const { getDb } = await import("../../src/lib/db");
  getDb(); // schema step on open; no data
  return { fixture: "empty", eventId: "no-such-event", watchlistId: "no-such-watchlist" };
}

export async function buildPopulatedFixture(): Promise<FixtureCtx> {
  const { getDb, upsertJson, setMeta } = await import("../../src/lib/db");
  const db = getDb();
  const { ensureSeedData } = await import("../../src/lib/bootstrap/refresh");
  const { prepareCryptoStore } = await import("../../src/lib/sources/prepare");
  const { persistRiskGauges } = await import("../../src/lib/risk/gauges");
  const { persistWarnings } = await import("../../src/lib/warnings/detect");
  const { persistCausalGraph } = await import("../../src/lib/causal/graph");
  const { upsertInstrument, createWatchlist, addWatchlistItem } = await import("../../src/lib/instruments/store");
  const { insertHistoryPoint } = await import("../../src/lib/market/history");
  const { createUser } = await import("../../src/lib/auth/users");
  const { createSession } = await import("../../src/lib/auth/session");

  ensureSeedData();
  prepareCryptoStore(); // explicit: source tables + source rows
  const now = new Date();
  const iso = now.toISOString();
  for (const [symbol, name, category, price] of [
    ["SPX", "S&P 500", "equity_index", 5000],
    ["BTC", "Bitcoin", "crypto", 60000],
    ["GOLD", "Gold", "commodity", 2300],
  ] as const) {
    upsertJson("market_snapshots", "symbol", symbol, {
      symbol, name, category, price, change1d: 0.4, change1w: -1.2, change1m: 2.5, volatilityEst: 0.18, currency: "USD",
      provenance: { source: "fixture", sourceTier: "tier1", fetchedAt: iso, quality: "live" },
    }, { updated_at: iso });
    for (let d = 40; d >= 1; d--) {
      insertHistoryPoint({
        symbol, price: price * (1 + Math.sin(d) / 50), ts: new Date(now.getTime() - d * 86400_000).toISOString(),
        source: "fixture", quality: "live", barKind: "yahoo_historical_bar",
      } as never);
    }
  }
  setMeta("lastMarketUpdate", iso);
  persistRiskGauges();
  persistWarnings();
  persistCausalGraph();
  const base = {
    exchange: null, exchange_code: null, country: null, currency: "USD", sector: null, industry: null, blockchain: null,
    category: null, market_cap: 1e12, price: 100, change_24h_pct: 1, change_7d_pct: 2, change_30d_pct: 3, volume_24h: 1e9,
    circulating_supply: null, total_supply: null, max_supply: null, rank: 1, volatility: 0.3, logo_url: null,
    quote_status: "quoted", listed_status: "active", raw_symbol_key: null, legacy_symbol: null, volume_basis: null,
  };
  upsertInstrument({ ...base, id: "yahoo:AAPL", symbol: "AAPL", name: "Apple Inc.", asset_type: "stock", exchange: "NASDAQ", country: "US", data_source: "yahoo", provider_id: "AAPL" } as never, iso);
  upsertInstrument({ ...base, id: "crypto:coingecko:bitcoin", symbol: "BTC", name: "Bitcoin", asset_type: "crypto", blockchain: "bitcoin", data_source: "coingecko", provider_id: "bitcoin" } as never, iso);

  const user = createUser("fixture-user@example.invalid", "fixture-password-not-secret", "pro");
  const validToken = createSession(user.id);
  const expiredToken = createHash("sha256").update("expired-fixture").digest("hex");
  db.prepare("INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)").run(
    expiredToken, user.id, "2020-01-01T00:00:00.000Z", "2020-01-02T00:00:00.000Z"
  );
  const wl = createWatchlist(user.id, "Fixture list") as { id: string };
  addWatchlistItem(wl.id, "yahoo:AAPL");
  setMeta("scheduler.enabled", "0");
  const ev = db.prepare("SELECT id FROM events ORDER BY rowid LIMIT 1").get() as { id: string } | undefined;
  return { fixture: "populated", eventId: ev?.id ?? "no-such-event", watchlistId: wl.id, validToken, expiredToken };
}
