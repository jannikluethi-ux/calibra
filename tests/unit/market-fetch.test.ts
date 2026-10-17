import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";

useTempDb("calibra-market-");

function chart(price: number, t = Math.floor(Date.parse("2026-10-16T20:00:00Z") / 1000)) {
  const closes = Array.from({ length: 30 }, (_, i) => (price > 0 ? price * (1 + (i - 29) * 0.001) : 0));
  return JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: price, regularMarketTime: price > 0 ? t : 0 }, timestamp: [], indicators: { quote: [{ close: closes }] } }] } });
}

type Behaviour = Record<string, "ok" | "zero" | "500" | "429" | "badjson">;
function mockFetch(b: Behaviour, calls: string[]) {
  return async (url: string) => {
    const sym = decodeURIComponent(url.split("/chart/")[1].split("?")[0]);
    calls.push(sym);
    const mode = b[sym] ?? "ok";
    if (mode === "500") return new Response("err", { status: 500 });
    if (mode === "429") return new Response("Too Many Requests", { status: 429 });
    if (mode === "badjson") return new Response("<html>", { status: 200 });
    if (mode === "zero") return new Response(chart(0), { status: 200 });
    return new Response(chart(100 + sym.length), { status: 200 });
  };
}

test("market fetch: zero price is invalid, never live; failures carry forward the last valid value; never demo", async () => {
  const { refreshMarketData, getMarketSnapshot } = await import("../../src/lib/market/fetch");
  const { getDb } = await import("../../src/lib/db");
  const { getHealth } = await import("../../src/lib/sources/health");
  const db = getDb();
  const hist = (s: string) => (db.prepare(`SELECT COUNT(*) n FROM market_history WHERE symbol = ?`).get(s) as { n: number }).n;

  const calls: string[] = [];
  const first = await refreshMarketData({ fetchImpl: mockFetch({ "BUND.DE": "zero" }, calls) as never, paceMs: 0, retryBaseMs: 1 });
  const de = first.find((s) => s.symbol === "DE10Y")!;
  assert.equal(de.price, null, "price 0 must not be stored as a value");
  assert.notEqual(de.provenance.quality, "live");
  assert.equal(de.provenance.errorClass, "invalid_data");
  assert.equal(hist("DE10Y"), 0, "invalid quote never enters history");
  assert.ok(first.every((s) => s.provenance.quality !== "demo"), "no demo substitution");
  const goldBefore = getMarketSnapshot("GOLD")!;
  assert.equal(goldBefore.provenance.quality, "live");
  const goldHist = hist("GOLD");
  assert.ok(goldHist >= 1);

  // Second run: GOLD 500s (retried once), SPX returns bad JSON.
  const calls2: string[] = [];
  const second = await refreshMarketData({ fetchImpl: mockFetch({ "GC=F": "500", "^GSPC": "badjson", "BUND.DE": "zero" }, calls2) as never, paceMs: 0, retryBaseMs: 1 });
  assert.equal(calls2.filter((c) => c === "GC=F").length, 2, "bounded retry: 1 retry on 5xx");
  assert.equal(calls2.filter((c) => c === "^GSPC").length, 1, "invalid data is not retried");
  const gold = second.find((s) => s.symbol === "GOLD")!;
  assert.equal(gold.price, goldBefore.price, "carried forward value is the previous valid value, unchanged");
  assert.equal(gold.provenance.quality, "cached");
  assert.equal(gold.provenance.carriedForward, true);
  assert.equal(gold.provenance.errorClass, "unavailable");
  assert.equal(hist("GOLD"), goldHist, "carried-forward values are not re-written to history");
  const spx = second.find((s) => s.symbol === "SPX")!;
  assert.equal(spx.provenance.carriedForward, true);
  assert.equal(spx.provenance.errorClass, "invalid_data");
  const de2 = second.find((s) => s.symbol === "DE10Y")!;
  assert.equal(de2.price, null, "no previous valid value → stays missing");

  const h = getHealth("yahoo_markets")!;
  assert.equal(h.errorClass, "ok");
  assert.match(h.lastError ?? "", /DE10Y=invalid_data/);
});

test("market fetch: a 429 stops further calls in the run; affected symbols are rate_limited, not invented", async () => {
  const { refreshMarketData } = await import("../../src/lib/market/fetch");
  const calls: string[] = [];
  const res = await refreshMarketData({ fetchImpl: mockFetch({ "GC=F": "429" }, calls) as never, paceMs: 0, retryBaseMs: 1 });
  const idx = calls.indexOf("GC=F");
  assert.ok(idx >= 0);
  assert.equal(calls.filter((c) => c === "GC=F").length, 2, "429 is retried once (bounded)");
  assert.equal(calls.length, idx + 2, "no further symbols requested after the 429");
  const vix = res.find((s) => s.symbol === "VIX")!;
  assert.equal(vix.provenance.errorClass, "rate_limited");
  assert.equal(vix.provenance.carriedForward, true, "previous valid VIX shown as carried forward");
  assert.ok(res.every((s) => s.provenance.quality !== "demo"));
});

test("market fetch: total outage leaves lastMarketUpdate untouched and marks the source unavailable", async () => {
  const { refreshMarketData } = await import("../../src/lib/market/fetch");
  const { getMeta } = await import("../../src/lib/db");
  const { getHealth } = await import("../../src/lib/sources/health");
  const before = getMeta("lastMarketUpdate");
  const down = async () => {
    throw new Error("getaddrinfo ENOTFOUND query1.finance.yahoo.com");
  };
  const res = await refreshMarketData({ fetchImpl: down as never, paceMs: 0, retryBaseMs: 1 });
  assert.equal(getMeta("lastMarketUpdate"), before);
  assert.ok(res.every((s) => s.provenance.quality === "cached" || s.price === null));
  assert.equal(getHealth("yahoo_markets")!.errorClass, "unavailable");
  assert.notEqual(getMeta("dataQuality"), "live");
});
