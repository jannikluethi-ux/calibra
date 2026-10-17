import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";

useTempDb("calibra-crypto-");

const NOW = new Date("2026-10-17T12:00:00.000Z");
const NOW_A = new Date("2026-10-15T00:00:00.000Z");
const iso = NOW.toISOString();
const DAY = 86400_000;
type R = { status: number; ok: boolean; json?: unknown; error?: string; rateLimited: boolean };
const ok = (json: unknown): R => ({ status: 200, ok: true, json, rateLimited: false });
const rl: R = { status: 429, ok: false, error: "HTTP 429", rateLimited: true };

function coin(id: string, symbol: string, name: string, o: Record<string, unknown> = {}) {
  return {
    id, symbol, name, current_price: 1, market_cap: 5e9, fully_diluted_valuation: 5.1e9, total_volume: 5e8, market_cap_rank: 50,
    price_change_percentage_24h: 1, price_change_percentage_7d_in_currency: 2, price_change_percentage_30d_in_currency: 3,
    market_cap_change_percentage_24h: 1, circulating_supply: 1e9, total_supply: 1e9, max_supply: 1.05e9, high_24h: 1.1, low_24h: 0.9,
    ath: 4, ath_change_percentage: -75, ath_date: "2024-03-01T00:00:00.000Z", last_updated: "2026-10-17T11:55:00.000Z", ...o,
  };
}
const PAGE = [
  coin("bitcoin", "btc", "Bitcoin", { current_price: 100000, market_cap: 2e12, fully_diluted_valuation: 2.1e12, total_volume: 3e10, market_cap_rank: 1, circulating_supply: 2e7, total_supply: 2e7, max_supply: 2.1e7 }),
  coin("ethereum", "eth", "Ethereum", { current_price: 4000, market_cap: 5e11, fully_diluted_valuation: 5e11, total_volume: 2e10, market_cap_rank: 2, max_supply: null }),
  coin("tinycoin", "xai", "Tiny XAI", { market_cap: 5e6, fully_diluted_valuation: 1e8, total_volume: 3e3, market_cap_rank: 990 }),
  coin("xai-other", "xai", "Other XAI", { market_cap: 3e8, fully_diluted_valuation: 3.2e8, total_volume: 2e7 }),
  coin("x-dollar", "usdx", "X Dollar", { current_price: 0.85, market_cap: 2e8, fully_diluted_valuation: 2e8, total_volume: 5e6 }),
  coin("wildcoin", "wld2", "Wild Coin", { price_change_percentage_30d_in_currency: 150 }),
  coin("nofdv", "nfd", "No FDV Coin", { fully_diluted_valuation: null, max_supply: null, total_supply: null, circulating_supply: null }),
  coin("deadcoin", "dead", "Dead Coin", { current_price: null }),
];
const chart = () => {
  const end = Date.UTC(2026, 9, 17); // today midnight (must be excluded)
  const prices: [number, number][] = [];
  for (let i = 60; i >= 0; i--) prices.push([end - i * DAY, 100 * (1 + 0.02 * Math.sin(i))]);
  prices.push([NOW.getTime(), 999]); // intraday point (excluded)
  return { prices, market_caps: prices.map(([t, p]) => [t, p * 1e6]), total_volumes: prices.map(([t]) => [t, 1e6]) };
};

function mockFetch(calls: string[], overrides: (url: string) => R | null = () => null) {
  return async (url: string): Promise<R> => {
    calls.push(url);
    const o = overrides(url);
    if (o) return o;
    if (url.includes("/coins/markets") && url.includes("category=stablecoins")) return ok([{ id: "x-dollar" }]);
    if (url.includes("/coins/markets") && url.includes("category=")) return ok([]);
    if (url.includes("/coins/markets")) return ok(url.includes("page=1&") ? PAGE : []);
    if (url.includes("/coins/list")) return ok([{ id: "tinycoin", platforms: { ethereum: "0xAbCdEf0000000000000000000000000000000001" } }, { id: "x-dollar", platforms: { solana: "So1Dollar" } }, { id: "bitcoin", platforms: {} }, { id: "not-live", platforms: { ethereum: "0x9" } }]);
    if (url.includes("market_chart")) return ok(chart());
    if (url.includes("llama.fi/hacks")) return ok([
      { date: Math.floor((NOW.getTime() - 30 * DAY) / 1000), name: "Tiny Protocol", classification: "Protocol Logic", technique: "Reentrancy", amount: 4e6, returnedFunds: null, defillamaId: 123, chain: ["Ethereum"], targetType: "DeFi Protocol", source: "https://example.org/post" },
      { date: Math.floor((NOW.getTime() - 10 * DAY) / 1000), name: "Unmapped", classification: "Infrastructure", technique: "Private key", amount: 1e6, defillamaId: 999 },
    ]);
    return { status: 404, ok: false, error: "unexpected", rateLimited: false };
  };
}

test("CoinGecko 429 stops further CoinGecko calls, records rate_limited, invents nothing", async () => {
  const { runCryptoMarketSync } = await import("../../src/lib/crypto/market-sync");
  const { getDb, getMeta } = await import("../../src/lib/db");
  const { getHealth } = await import("../../src/lib/sources/health");
  const calls: string[] = [];
  const r = await runCryptoMarketSync({ fetchJson: mockFetch(calls, (u) => (u.includes("coingecko") ? rl : ok([]))), now: NOW_A, paceMs: 0, maxPages: 4, historyCoins: 4 });
  assert.equal(r.coingecko.rateLimited, true);
  assert.equal(calls.filter((u) => u.includes("coingecko")).length, 1, "no CoinGecko call after the 429");
  assert.equal(r.snapshots, 0);
  assert.equal((getDb().prepare(`SELECT COUNT(*) c FROM crypto_market_snapshots`).get() as { c: number }).c, 0);
  assert.equal((getDb().prepare(`SELECT COUNT(*) c FROM instruments WHERE asset_type='crypto'`).get() as { c: number }).c, 0);
  assert.equal(getMeta("crypto.daily.lastRun"), null, "daily step not marked done when rate-limited");
  const h = getHealth("coingecko")!;
  assert.equal(h.errorClass, "rate_limited");
  const { resetCoingeckoBlock } = await import("../../src/lib/sources/cg-guard");
  resetCoingeckoBlock();
});

test("market sync writes snapshots, identity, categories, incidents and history from source data only", async () => {
  const { runCryptoMarketSync } = await import("../../src/lib/crypto/market-sync");
  const { getDb, getMeta } = await import("../../src/lib/db");
  const { skipCheck } = await import("../../src/lib/sources/health");
  assert.equal(skipCheck("coingecko", iso).skip, false, "rate-limit cool-down has expired by NOW");
  const db = getDb();
  // stale live coin from an older universe sync (not in today's page)
  const { upsertInstruments } = await import("../../src/lib/instruments/store");
  const { marketRow } = await import("../../src/lib/instruments/sync");
  upsertInstruments([marketRow({ ...coin("oldcoin", "old", "Old Coin"), last_updated: "2026-10-04T15:00:00.000Z" })], "2026-10-04T15:00:00.000Z");
  // protocol map (normally written by the DefiLlama protocols adapter)
  const { ensureCryptoIntelTables } = await import("../../src/lib/crypto/intel-schema");
  ensureCryptoIntelTables(db);
  db.prepare(`INSERT INTO crypto_protocol_map (defillama_id, protocol_name, gecko_id, instrument_id, retrieved_at) VALUES ('123','Tiny Protocol','tinycoin','crypto:coingecko:tinycoin',?)`).run(iso);

  const calls: string[] = [];
  const r = await runCryptoMarketSync({ fetchJson: mockFetch(calls), now: NOW, paceMs: 0, maxPages: 2, historyCoins: 2 });
  assert.equal(r.coingecko.rateLimited, false);
  assert.equal(r.marketsUpdated, 8);
  assert.equal(r.snapshots, 7, "coin without a price gets no snapshot");
  assert.equal((db.prepare(`SELECT quote_status FROM instruments WHERE id='crypto:coingecko:deadcoin'`).get() as { quote_status: string }).quote_status, "unavailable");
  const nf = db.prepare(`SELECT fdv, circulating_supply FROM crypto_market_snapshots WHERE instrument_id='crypto:coingecko:nofdv'`).get() as { fdv: number | null; circulating_supply: number | null };
  assert.equal(nf.fdv, null, "missing FDV stays missing");
  assert.equal(nf.circulating_supply, null);
  // identity
  assert.equal((db.prepare(`SELECT contract_address FROM crypto_contracts WHERE instrument_id='crypto:coingecko:tinycoin' AND network='ethereum'`).get() as { contract_address: string }).contract_address, "0xAbCdEf0000000000000000000000000000000001");
  assert.equal((db.prepare(`SELECT COUNT(*) c FROM crypto_contracts WHERE instrument_id='crypto:coingecko:not-live'`).get() as { c: number }).c, 0, "only live ids");
  assert.ok(getMeta("crypto.platforms.retrievedAt"));
  assert.deepEqual(db.prepare(`SELECT instrument_id FROM crypto_categories`).all(), [{ instrument_id: "crypto:coingecko:x-dollar" }]);
  // incidents: mapped only through protocol id, unmapped kept with null instrument
  const inc = db.prepare(`SELECT defillama_id, instrument_id FROM crypto_security_incidents ORDER BY defillama_id`).all();
  assert.deepEqual(inc, [{ defillama_id: "123", instrument_id: "crypto:coingecko:tinycoin" }, { defillama_id: "999", instrument_id: null }]);
  // history: BTC + ETH first, completed days only
  assert.deepEqual(r.history.coins, ["bitcoin", "ethereum"]);
  const hb = db.prepare(`SELECT COUNT(*) c, MAX(day) m FROM crypto_price_history WHERE instrument_id='crypto:coingecko:bitcoin'`).get() as { c: number; m: string };
  assert.equal(hb.c, 60);
  assert.equal(hb.m, "2026-10-16", "today's partial day and intraday point excluded");

  // second run: snapshots are appended, history not duplicated, daily step gated
  const before = db.prepare(`SELECT id, price FROM crypto_market_snapshots ORDER BY id`).all();
  const r2 = await runCryptoMarketSync({ fetchJson: mockFetch([]), now: new Date(NOW.getTime() + 21 * 3600_000), paceMs: 0, maxPages: 1, historyCoins: 2 });
  assert.equal(r2.daily.ran, false, "daily step gated to once per 24 h");
  assert.deepEqual(r2.history.coins, ["bitcoin", "ethereum"], "BTC/ETH re-fetched once older than 20 h");
  assert.equal((db.prepare(`SELECT COUNT(*) c FROM crypto_market_snapshots`).get() as { c: number }).c, 14);
  assert.deepEqual(db.prepare(`SELECT id, price FROM crypto_market_snapshots ORDER BY id LIMIT ?`).all(before.length), before, "earlier snapshots untouched");
  const h2 = db.prepare(`SELECT COUNT(*) c, COUNT(DISTINCT day) d FROM crypto_price_history WHERE instrument_id='crypto:coingecko:bitcoin'`).get() as { c: number; d: number };
  assert.equal(h2.c, 61, "only the newly completed day is added");
  assert.equal(h2.d, h2.c, "no duplicate days");
});

test("v1 assessments are archived (never rewritten) before the v1 upsert overwrites them", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { archiveV1Assessments } = await import("../../src/lib/crypto/risk-store");
  const db = getDb();
  const up = db.prepare(`INSERT INTO crypto_risk_assessments (instrument_id, computed_at, total, band, components_json, factors_scored, market_factors_scored) VALUES (?, ?, ?, ?, '{}', 3, 2)
    ON CONFLICT(instrument_id) DO UPDATE SET computed_at=excluded.computed_at, total=excluded.total, band=excluded.band`);
  up.run("crypto:coingecko:bitcoin", "2026-10-15T22:29:00.000Z", 30, "moderate");
  assert.equal(archiveV1Assessments(), 1);
  assert.equal(archiveV1Assessments(), 0, "idempotent");
  up.run("crypto:coingecko:bitcoin", "2026-10-17T10:00:00.000Z", 50, "elevated");
  assert.equal(archiveV1Assessments(), 1);
  const rows = db.prepare(`SELECT computed_at, score, band FROM crypto_risk_scores WHERE model_version='research_v1' AND instrument_id='crypto:coingecko:bitcoin' ORDER BY computed_at`).all();
  assert.deepEqual(rows, [
    { computed_at: "2026-10-15T22:29:00.000Z", score: 30, band: "moderate" },
    { computed_at: "2026-10-17T10:00:00.000Z", score: 50, band: "elevated" },
  ]);
});

test("v2 scoring: append-only history, latest pointer, high-risk classification", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { scoreAllCryptoV2 } = await import("../../src/lib/crypto/risk-store");
  const db = getDb();
  const now = new Date(NOW.getTime() + 2 * 3600_000).toISOString();
  const r1 = scoreAllCryptoV2(now);
  assert.equal(r1.scored, 8, "7 live coins with prices + 1 stale live coin; no-price coin excluded");
  assert.equal(r1.appended, 8);
  const r2 = scoreAllCryptoV2(now);
  assert.equal(r2.appended, 0, "unchanged scores are not re-appended within 24 h");
  const hr = (db.prepare(`SELECT instrument_id FROM crypto_risk_latest WHERE high_risk = 1 ORDER BY instrument_id`).all() as { instrument_id: string }[]).map((x) => x.instrument_id);
  assert.deepEqual(hr, ["crypto:coingecko:tinycoin", "crypto:coingecko:x-dollar"]);
  const wild = db.prepare(`SELECT risk_type, band, high_risk FROM crypto_risk_latest WHERE instrument_id='crypto:coingecko:wildcoin'`).get() as { risk_type: string; band: string; high_risk: number };
  assert.equal(wild.risk_type, "volatility_only");
  assert.equal(wild.high_risk, 0);
  // a data change appends a new row and keeps the old one
  const firstRow = db.prepare(`SELECT id, score FROM crypto_risk_scores WHERE instrument_id='crypto:coingecko:xai-other' AND model_version='crypto_risk_v2'`).get() as { id: number; score: number };
  db.prepare(`UPDATE instruments SET volume_24h = 5e4 WHERE id='crypto:coingecko:xai-other'`).run();
  const r3 = scoreAllCryptoV2(new Date(NOW.getTime() + 3 * 3600_000).toISOString());
  assert.equal(r3.appended, 1);
  const hist = db.prepare(`SELECT id, score FROM crypto_risk_scores WHERE instrument_id='crypto:coingecko:xai-other' AND model_version='crypto_risk_v2' ORDER BY id`).all() as { id: number; score: number }[];
  assert.equal(hist.length, 2);
  assert.deepEqual(hist[0], firstRow, "old assessment preserved");
  assert.ok(hist[1].score > hist[0].score);
  const latest = db.prepare(`SELECT score_id FROM crypto_risk_latest WHERE instrument_id='crypto:coingecko:xai-other'`).get() as { score_id: number };
  assert.equal(latest.score_id, hist[1].id);
});

test("high-risk list: filtering, sorting, search, collisions and stale data", async () => {
  const { listHighRisk, highRiskFacets } = await import("../../src/lib/crypto/risk-store");
  const { parseHighRiskQuery: P } = await import("../../src/lib/crypto/highrisk-query");
  const at = new Date(NOW.getTime() + 3 * 3600_000).toISOString();
  const ids = (q: Record<string, string>) => listHighRisk(P(q), at).rows.map((r) => r.provider_id);
  assert.deepEqual(ids({}), ["tinycoin", "x-dollar"].sort((a, b) => (a === "tinycoin" ? -1 : b === "tinycoin" ? 1 : 0)), "default = high-risk, by score desc");
  assert.deepEqual(ids({ view: "volatility" }), ["wildcoin"]);
  assert.deepEqual(ids({ view: "structural", factor: "stablecoin_peg" }), ["x-dollar"]);
  assert.deepEqual(ids({ view: "all", category: "stablecoins" }), ["x-dollar"]);
  assert.deepEqual(ids({ view: "all", network: "ethereum" }), ["tinycoin"]);
  assert.deepEqual(ids({ view: "all", q: "0xabcdef0000000000000000000000000000000001" }), ["tinycoin"], "contract search is case-insensitive");
  assert.deepEqual(ids({ view: "all", q: "x-dollar" }), ["x-dollar"], "CoinGecko id search");
  const xai = listHighRisk(P({ view: "all", q: "XAI", sort: "name" }), at).rows;
  assert.deepEqual(xai.map((r) => r.provider_id), ["xai-other", "tinycoin"], "ticker search returns both colliding assets, sorted by name");
  assert.ok(xai.every((r) => r.symbol_collisions === 1));
  const stale = listHighRisk(P({ view: "all", fresh: "stale" }), at).rows;
  assert.deepEqual(stale.map((r) => r.provider_id), ["oldcoin"]);
  assert.equal(stale[0].stale, true);
  assert.ok(!ids({ view: "all", fresh: "fresh" }).includes("oldcoin"));
  assert.equal(ids({ view: "all", sort: "market_cap" })[0], "bitcoin");
  assert.equal(ids({ view: "all", sort: "market_cap", dir: "asc" })[0], "tinycoin");
  assert.ok(ids({ view: "all", conf: "high" }).every((id) => id !== "oldcoin"), "stale data cannot have high confidence");
  const f = highRiskFacets();
  assert.deepEqual(f.categories.map((c) => c.v), ["stablecoins"], "only data-backed category filters");
  assert.deepEqual(new Set(f.networks.map((n) => n.v)), new Set(["ethereum", "solana"]));
  assert.ok(f.factors.every((x) => x.c > 0));
  assert.equal(f.highRisk, 2);
});

test("risk profile: factors with provenance, identity, collisions, incidents, behaviour, missing fields", async () => {
  const { getRiskProfile } = await import("../../src/lib/crypto/risk-store");
  const at = new Date(NOW.getTime() + 3 * 3600_000).toISOString();
  const t = getRiskProfile("crypto:coingecko:tinycoin", at);
  assert.equal(t.latest!.highRisk, true);
  const sec = t.latest!.factors.find((x) => x.key === "security")!;
  assert.equal(sec.score, 85); assert.equal(sec.basis, "reported"); assert.equal(sec.source, "DefiLlama hacks");
  for (const fct of t.latest!.factors) assert.ok(fct.evidence.length > 0, `${fct.key} has evidence`);
  assert.equal(t.contracts[0].network, "ethereum");
  assert.deepEqual(t.collisions.map((c) => c.id), ["crypto:coingecko:xai-other"]);
  assert.equal(t.incidents.length, 1);
  assert.equal(t.protocolMapped, true);
  assert.equal(t.behavior.historyDays, 0);
  assert.equal(t.behavior.vol30d, null, "no history -> UNKNOWN, not estimated");
  assert.ok(t.latest!.coverage > 0 && Object.keys(t.latest!.confidenceParts).length === 5);

  const b = getRiskProfile("crypto:coingecko:bitcoin", at);
  assert.equal(b.behavior.historyDays, 61);
  assert.equal(b.behavior.corrEth.pairs, 60);
  assert.ok(b.behavior.corrEth.value != null && b.behavior.corrEth.value > 0.99);
  assert.equal(b.behavior.corrBtc.value, null, "no self-correlation");
  assert.ok(b.history.some((h) => h.model_version === "research_v1"), "history shows archived v1 rows");
  assert.equal(b.protocolMapped, false);

  const n = getRiskProfile("crypto:coingecko:nofdv", at);
  assert.equal(n.inputs!.fdv, null);
  assert.ok(n.latest!.flags.includes("Fully diluted valuation not reported"));
  assert.equal(n.latest!.factors.find((x) => x.key === "dilution")!.score, null);

  const none = getRiskProfile("crypto:coingecko:does-not-exist", at);
  assert.equal(none.latest, null);
  assert.equal(none.history.length, 0);
});
