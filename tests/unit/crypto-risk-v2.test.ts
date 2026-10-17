import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRisk, type RiskInputs, MODEL_VERSION, bandFor } from "../../src/lib/crypto/risk-v2";

const NOW = "2026-10-17T12:00:00.000Z";
function base(o: Partial<RiskInputs> = {}): RiskInputs {
  return {
    id: "crypto:coingecko:test", symbol: "TST", name: "Test", now: NOW,
    marketDataAt: "2026-10-17T11:00:00.000Z", retrievedAt: "2026-10-17T11:05:00.000Z",
    price: 2, marketCap: 5e9, fdv: 5.2e9, volume24h: 4e8, circulating: 1e9, total: 1e9, max: 1.1e9,
    change7d: 1, change30d: 3, athChangePct: -20, vol30d: 35, historyDays: 89,
    categories: [], networks: ["ethereum"], platformDataKnown: true, symbolCollisions: 0,
    incidents: null, priceSources: 2, priceDisagreement: false, ...o,
  };
}
const f = (r: ReturnType<typeof computeRisk>, k: string) => r.factors.find((x) => x.key === k)!;

test("model is versioned and bands follow thresholds", () => {
  const r = computeRisk(base());
  assert.equal(r.modelVersion, MODEL_VERSION);
  assert.equal(bandFor(0), "low"); assert.equal(bandFor(25), "moderate"); assert.equal(bandFor(45), "elevated");
  assert.equal(bandFor(65), "high"); assert.equal(bandFor(85), "extreme");
  assert.equal(r.riskType, "none_flagged"); assert.equal(r.highRisk, false);
  assert.ok(Number.isInteger(r.score!), "integer score, no false precision");
});

test("unknown is never safe: no inputs -> insufficient data, null score, low confidence, explicit flags", () => {
  const r = computeRisk(base({ price: null, marketCap: null, fdv: null, volume24h: null, circulating: null, total: null, max: null, change7d: null, change30d: null, vol30d: null, historyDays: 0, marketDataAt: null, retrievedAt: null, platformDataKnown: false, networks: [] }));
  assert.equal(r.score, null);
  assert.equal(r.band, "insufficient_data");
  assert.equal(r.riskType, "insufficient_data");
  assert.equal(r.highRisk, false);
  assert.equal(r.confidence, 0);
  assert.equal(r.confidenceLabel, "low");
  for (const k of ["liquidity", "market_size", "dilution", "market_volatility", "security", "regulatory"]) {
    assert.equal(f(r, k).score, null, k); assert.equal(f(r, k).basis, "unknown", k);
  }
  for (const msg of ["Market cap not reported", "Supply not reported", "Fully diluted valuation not reported", "Volume not reported", "Contract/platform identity not retrieved yet", "No market-data timestamp"]) {
    assert.ok(r.flags.includes(msg), msg);
  }
});

test("unknown factors do not lower the score; they lower confidence", () => {
  const a = computeRisk(base({ marketCap: 2e7, volume24h: 5e4 }));
  const b = computeRisk(base({ marketCap: 2e7, volume24h: 5e4, incidents: [] }));
  assert.equal(a.score, b.score, "mapped-without-incident is still unknown, not 0");
  assert.equal(f(b, "security").score, null);
  assert.match(f(b, "security").evidence[0], /not mean the code is safe/);
  assert.ok(a.flags.some((x) => /% of the model weight is UNKNOWN/.test(x)));
});

test("volatility alone never makes an asset high risk", () => {
  const r = computeRisk(base({ vol30d: 400, change30d: -70, athChangePct: -95 }));
  assert.equal(f(r, "market_volatility").score, 90);
  assert.equal(r.riskType, "volatility_only");
  assert.equal(r.highRisk, false);
  assert.notEqual(r.band, "high"); assert.notEqual(r.band, "extreme");
  assert.ok(r.reasons.some((x) => /Volatility only \(not structural\)/.test(x)));
});

test("structural: thin liquidity + tiny cap + heavy dilution is high risk with reasons", () => {
  const r = computeRisk(base({ marketCap: 5e6, fdv: 1e8, volume24h: 3e3, vol30d: 60 }));
  assert.equal(f(r, "liquidity").score, 85, "turnover 0.06% -> 75, raised by the <$100k volume floor to 85");
  assert.equal(f(r, "market_size").score, 85);
  assert.equal(f(r, "dilution").score, 92);
  assert.equal(r.riskType, "structural");
  assert.ok(r.band === "high" || r.band === "extreme");
  assert.equal(r.highRisk, true);
  assert.deepEqual(new Set(r.structuralKeys), new Set(["liquidity", "market_size", "dilution"]));
  assert.ok(r.reasons[0].startsWith("Tokenomics / dilution") || r.reasons[0].startsWith("Liquidity"));
});

test("deep absolute volume caps liquidity risk (large caps with low turnover)", () => {
  const r = computeRisk(base({ marketCap: 1.7e12, volume24h: 1.48e10 }));
  assert.equal(f(r, "liquidity").score, 15);
});

test("USD stablecoin de-peg is a structural red flag; non-stablecoins: peg not applicable", () => {
  const ok = computeRisk(base({ symbol: "USDX", name: "X Dollar", categories: ["stablecoins"], price: 1.001 }));
  assert.equal(f(ok, "stablecoin_peg").score, 10);
  assert.equal(f(ok, "stablecoin_peg").basis, "corroborated");
  const bad = computeRisk(base({ symbol: "USDX", name: "X Dollar", categories: ["stablecoins"], price: 0.85, priceSources: 1 }));
  assert.equal(f(bad, "stablecoin_peg").score, 95);
  assert.equal(f(bad, "stablecoin_peg").basis, "reported");
  assert.equal(bad.highRisk, true, "red flag even when the weighted band is lower");
  const na = computeRisk(base());
  assert.equal(f(na, "stablecoin_peg").applicable, false);
  const euro = computeRisk(base({ symbol: "EURC", name: "Euro Coin", categories: ["stablecoins"], price: 1.16 }));
  assert.equal(f(euro, "stablecoin_peg").applicable, false, "non-USD stablecoins are not judged against $1");
});

test("security incidents: recent exploit flags high risk; fully returned is lower; >3y ignored", () => {
  const inc = (days: number, amount: number, returned: number | null) => ({ name: "Proto", date: new Date(Date.parse(NOW) - days * 86400_000).toISOString(), amountUsd: amount, returnedUsd: returned, classification: "Protocol Logic", technique: "Reentrancy" });
  const recent = computeRisk(base({ incidents: [inc(30, 5e7, null)] }));
  assert.equal(f(recent, "security").score, 85);
  assert.equal(f(recent, "security").basis, "reported");
  assert.equal(recent.highRisk, true);
  assert.equal(f(computeRisk(base({ incidents: [inc(30, 5e7, 5e7)] })), "security").score, 65);
  assert.equal(f(computeRisk(base({ incidents: [inc(500, 5e7, null)] })), "security").score, 60);
  assert.equal(f(computeRisk(base({ incidents: [inc(2000, 5e7, null)] })), "security").score, null);
});

test("confidence is separate from score: stale data lowers confidence only", () => {
  const fresh = computeRisk(base());
  const stale = computeRisk(base({ marketDataAt: "2026-10-04T15:00:00.000Z" }));
  assert.equal(fresh.score, stale.score);
  assert.ok(stale.confidence < fresh.confidence);
  assert.ok(stale.flags.some((x) => /stale/.test(x)));
  const single = computeRisk(base({ priceSources: 1 }));
  assert.ok(single.confidence < fresh.confidence);
  assert.ok(single.flags.includes("Price from a single source (not corroborated)"));
});

test("ticker collisions are flagged", () => {
  const r = computeRisk(base({ symbolCollisions: 2 }));
  assert.ok(r.flags.some((x) => /shared with 2 other asset/.test(x)));
});

test("fallback volatility from 30d change is labeled reported, not measured", () => {
  const r = computeRisk(base({ vol30d: null, historyDays: 0, change30d: -30 }));
  assert.equal(f(r, "market_volatility").basis, "reported");
  assert.equal(f(r, "market_volatility").score, 60);
});
