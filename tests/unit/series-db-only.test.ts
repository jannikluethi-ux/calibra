/**
 * B2 get-fix (C8): GET /api/instruments/[id]/series serves stored data only; the provider is reached only through the
 * token-guarded prefetch (POST) with TTL cache, provider gap, timeout and 503 on provider errors. Providers are mocked;
 * real fetch is blocked throughout.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";
import { blockFetch } from "./_dbsnap";

useTempDb("calibra-series-");
delete process.env.CALIBRA_JOB_TOKEN;
delete process.env.CALIBRA_SCHEDULER;
process.env.CALIBRA_JOB_MIN_INTERVAL_S = "0";
const fetchCalls = blockFetch();
const TOKEN = "s".repeat(20) + "-unit-test-token-0123456789"; // test-only value
const ID = "crypto:coingecko:bitcoin";
const URL_ = (range = "1M", q = "") => `http://localhost:3456/api/instruments/${encodeURIComponent(ID)}/series?range=${range}${q}`;

async function setup() {
  const { getDb } = await import("../../src/lib/db");
  const { upsertInstrument } = await import("../../src/lib/instruments/store");
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM instruments WHERE id = ?").get(ID)) {
    upsertInstrument({
      id: ID, symbol: "BTC", name: "Bitcoin", asset_type: "crypto", data_source: "coingecko", provider_id: "bitcoin",
      exchange: null, exchange_code: null, country: null, currency: "USD", sector: null, industry: null, blockchain: "bitcoin",
      category: null, market_cap: 1, price: 1, change_24h_pct: 0, change_7d_pct: 0, change_30d_pct: 0, volume_24h: 1,
      circulating_supply: null, total_supply: null, max_supply: null, rank: 1, volatility: null, logo_url: null,
      quote_status: "live", listed_status: "active", raw_symbol_key: null, legacy_symbol: null, volume_basis: null,
    } as never, "2026-10-01T00:00:00.000Z");
  }
  return db;
}
const tc = (db: { prepare: (s: string) => { get: () => unknown } }) => (db.prepare("SELECT total_changes() c").get() as { c: number }).c;

test("GET never fetches and never writes: cache miss -> 'Awaiting first prefetch', repeated", async () => {
  const db = await setup();
  const { GET } = await import("../../src/app/api/instruments/[id]/series/route");
  const t0 = tc(db);
  for (let i = 0; i < 3; i++) {
    const r = await GET(new Request(URL_()), { params: { id: encodeURIComponent(ID) } });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.supported, false);
    assert.equal(j.cached, false);
    assert.match(j.note, /Awaiting first prefetch/);
  }
  assert.equal(tc(db), t0);
  assert.deepEqual(fetchCalls, []);
});

test("POST prefetch is guarded: no token configured -> 503, missing/invalid token -> 401/403, nothing fetched", async () => {
  await setup();
  const { POST } = await import("../../src/app/api/instruments/[id]/series/route");
  const p = { params: { id: encodeURIComponent(ID) } };
  assert.equal((await POST(new Request(URL_(), { method: "POST" }), p)).status, 503);
  process.env.CALIBRA_JOB_TOKEN = TOKEN;
  try {
    assert.equal((await POST(new Request(URL_(), { method: "POST" }), p)).status, 401);
    assert.equal((await POST(new Request(URL_(), { method: "POST", headers: { authorization: "Bearer " + "x".repeat(40) } }), p)).status, 403);
    // automation disabled -> 409 unless force=1
    const { setSchedulerEnabled } = await import("../../src/lib/scheduler/runner");
    setSchedulerEnabled(false);
    assert.equal((await POST(new Request(URL_(), { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }), p)).status, 409);
    // forced, real loader: fetch is blocked in tests -> provider error -> 503, cache untouched
    const { resetSeriesProviderGap } = await import("../../src/lib/instruments/series-cache");
    resetSeriesProviderGap();
    const r = await POST(new Request(URL_("1M", "&force=1"), { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }), p);
    assert.equal(r.status, 503);
    assert.equal(fetchCalls.length, 1, "exactly one (blocked) provider attempt, only from the guarded POST");
    assert.ok(fetchCalls[0].startsWith("https://api.coingecko.com/"));
  } finally {
    delete process.env.CALIBRA_JOB_TOKEN;
    fetchCalls.length = 0;
  }
});

test("prefetchSeries with a mocked provider: stores, TTL cache, provider gap 429, timeout/error 503 without overwrite", async () => {
  const db = await setup();
  const { prefetchSeries, getCachedSeries, resetSeriesProviderGap } = await import("../../src/lib/instruments/series-cache");
  const { getInstrument } = await import("../../src/lib/instruments/store");
  const inst = getInstrument(ID)!;
  let calls = 0;
  const ok = async () => {
    calls++;
    return { range: "3M", supported: true, points: [{ t: "2026-10-01T00:00:00.000Z", v: 1 }, { t: "2026-10-02T00:00:00.000Z", v: 2 }], source: "mock", note: "mock" };
  };
  let clock = Date.parse("2026-10-24T08:00:00.000Z");
  const now = () => clock;
  resetSeriesProviderGap();
  const a = await prefetchSeries(inst, "3M", { loader: ok, now });
  assert.equal(a.status, 200);
  assert.equal(calls, 1);
  const g = getCachedSeries(ID, "3M");
  assert.equal(g.cached, true);
  assert.equal(g.points.length, 2);
  assert.equal(g.fetchedAt, "2026-10-24T08:00:00.000Z");

  clock += 60_000; // within TTL -> served from cache, no provider call
  const b = await prefetchSeries(inst, "3M", { loader: ok, now });
  assert.equal(b.status, 200);
  assert.equal(calls, 1);

  clock += 3_600_000; // stale; provider gap from the last call long passed
  const t1 = tc(db);
  const failing = async () => {
    throw new Error("boom");
  };
  const c = await prefetchSeries(inst, "3M", { loader: failing, now });
  assert.equal(c.status, 503);
  assert.equal(tc(db), t1, "provider error never overwrites the cache");
  assert.equal(getCachedSeries(ID, "3M").fetchedAt, "2026-10-24T08:00:00.000Z");

  clock += 500; // inside the 2 s provider gap
  const d = await prefetchSeries(inst, "1Y", { loader: ok, now });
  assert.equal(d.status, 429);

  clock += 5_000;
  process.env.CALIBRA_SERIES_TIMEOUT_MS = "20";
  try {
    const hang = () => new Promise<never>(() => {});
    const e = await prefetchSeries(inst, "1Y", { loader: hang as never, now });
    assert.equal(e.status, 503);
    assert.match(String((e.body as { error: string }).error), /timed out/);
  } finally {
    delete process.env.CALIBRA_SERIES_TIMEOUT_MS;
  }
  clock += 5_000;
  const empty = async () => ({ range: "1Y", supported: false, points: [], source: null, note: "Data unavailable" });
  assert.equal((await prefetchSeries(inst, "1Y", { loader: empty, now })).status, 503);
  assert.equal((await prefetchSeries(inst, "bogus", { loader: ok, now })).status, 400);
  assert.equal(getCachedSeries(ID, "1Y").cached, false);
  assert.deepEqual(fetchCalls, [], "mocked loader only; no real fetch");
});

test("source guard: the series GET handler and getCachedSeries never reference the provider loader", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const route = readFileSync(join(__dirname, "../../src/app/api/instruments/[id]/series/route.ts"), "utf8");
  const getBody = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.ok(!/prefetchSeries|loadSeries|fetch\(/.test(getBody));
});
