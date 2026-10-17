import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";

useTempDb("calibra-dq-");

const NOW = "2026-10-17T10:00:00.000Z";
const H = 3600_000;
const iso = (msAgo: number) => new Date(Date.parse(NOW) - msAgo).toISOString();

async function seed(opts: { marketAgeH: number; eventAgeH: number; cryptoAgeH: number | null; zeroDe10y?: boolean }) {
  const { getDb, setMeta } = await import("../../src/lib/db");
  const { MARKET_UNIVERSE } = await import("../../src/lib/market/universe");
  const db = getDb();
  db.exec(`DELETE FROM market_snapshots; DELETE FROM events; DELETE FROM market_history;`);
  for (const u of MARKET_UNIVERSE) {
    const bad = opts.zeroDe10y && u.symbol === "DE10Y";
    const snap = { symbol: u.symbol, name: u.name, category: u.category, price: bad ? 0 : 100, change1d: null, change1w: null, change1m: null, volatilityEst: null, provenance: { source: "Yahoo Finance chart API", sourceTier: 3, fetchedAt: iso(opts.marketAgeH * H), quality: "live" } };
    db.prepare(`INSERT INTO market_snapshots (symbol, data, updated_at) VALUES (?, ?, ?)`).run(u.symbol, JSON.stringify(snap), iso(opts.marketAgeH * H));
  }
  if (opts.zeroDe10y) db.prepare(`INSERT INTO market_history (id, symbol, ts, price, source, quality, bar_kind) VALUES ('h1', 'DE10Y', ?, 0, 'yahoo', 'live', 'snapshot')`).run(iso(H));
  setMeta("lastMarketUpdate", iso(opts.marketAgeH * H));
  setMeta("lastEventUpdate", iso(opts.eventAgeH * H));
  const srcs = ["Federal Reserve Press", "ECB Press", "CNBC Top News"];
  for (let i = 0; i < 6; i++) {
    const at = iso(opts.eventAgeH * H + i * 60_000);
    db.prepare(`INSERT INTO events (id, published_at, data, quality) VALUES (?, ?, ?, 'live')`).run(`ev${i}`, at, JSON.stringify({ id: `ev${i}`, title: `Headline ${i}`, sourceName: srcs[i % 3], publishedAt: at }));
  }
  const { prepareCryptoStore: prep } = await import("../../src/lib/sources/prepare");
  prep();
  db.exec(`DELETE FROM source_observations;`); // temp DB only
  if (opts.cryptoAgeH != null) {
    const { prepareCryptoStore } = await import("../../src/lib/sources/prepare");
    const { appendObservation } = await import("../../src/lib/sources/observations");
    prepareCryptoStore();
    appendObservation({ instrumentId: "crypto:coingecko:bitcoin", field: "price_usd", value: 1, observedAt: iso(opts.cryptoAgeH * H), retrievedAt: iso(opts.cryptoAgeH * H), sourceId: "coingecko", sourceUrl: "https://api.coingecko.com/test", claimType: "observed" });
  }
}

test("all inputs fresh and valid → live", async () => {
  await seed({ marketAgeH: 0.5, eventAgeH: 1, cryptoAgeH: 2 });
  const { computeDataQualitySummary } = await import("../../src/lib/quality/summary");
  const s = computeDataQualitySummary(NOW);
  assert.equal(s.overall, "live", s.reasons.join("; "));
});

test("stale market data (critical input) → never live", async () => {
  await seed({ marketAgeH: 40, eventAgeH: 1, cryptoAgeH: 2 });
  const { computeDataQualitySummary } = await import("../../src/lib/quality/summary");
  const s = computeDataQualitySummary(NOW);
  assert.equal(s.overall, "stale");
  assert.equal(s.inputs.markets.status, "stale");
});

test("stale events (critical input) → stale", async () => {
  await seed({ marketAgeH: 0.5, eventAgeH: 72, cryptoAgeH: 2 });
  const { computeDataQualitySummary } = await import("../../src/lib/quality/summary");
  assert.equal(computeDataQualitySummary(NOW).overall, "stale");
});

test("invalid DE10Y (price 0) and stale crypto → degraded with reasons, affected outputs and skipped calculations", async () => {
  await seed({ marketAgeH: 0.5, eventAgeH: 1, cryptoAgeH: 36, zeroDe10y: true });
  const { computeDataQualitySummary } = await import("../../src/lib/quality/summary");
  const s = computeDataQualitySummary(NOW);
  assert.equal(s.overall, "degraded");
  assert.ok(s.staleValues.some((v) => v.symbol === "DE10Y" && v.state === "invalid"));
  assert.equal(s.inputs.crypto.status, "stale");
  assert.ok(s.invalidHistoryRows.some((r) => r.symbol === "DE10Y" && r.rows === 1));
  assert.ok(s.affectedOutputs.length > 0);
  assert.ok(s.skippedCalculations.some((x) => x.includes("DE10Y")));
});

test("failing source in the health registry is listed and degrades the label", async () => {
  await seed({ marketAgeH: 0.5, eventAgeH: 1, cryptoAgeH: 2 });
  const { recordAttempt } = await import("../../src/lib/sources/health");
  for (let i = 0; i < 3; i++) recordAttempt("rss_imf", { ok: false, errorClass: "unavailable", httpStatus: 403, error: "HTTP 403" }, NOW);
  const { computeDataQualitySummary } = await import("../../src/lib/quality/summary");
  const s = computeDataQualitySummary(NOW);
  assert.ok(s.failingSources.some((f) => f.sourceId === "rss_imf" && f.consecutiveFailures === 3));
  assert.equal(s.overall, "degraded");
});

test("no data at all → insufficient (never live)", async () => {
  const { getDb } = await import("../../src/lib/db");
  getDb().exec(`DELETE FROM market_snapshots; DELETE FROM events;`);
  const { computeDataQualitySummary } = await import("../../src/lib/quality/summary");
  assert.equal(computeDataQualitySummary(NOW).overall, "insufficient");
});
