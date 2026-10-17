import { test } from "node:test";
import assert from "node:assert/strict";
import { MECHANISMS, tagMechanisms, tagRegions, tagIndustries, INTERPRETATION_LABEL } from "../../src/lib/intel/mechanisms";
import { INSTRUMENT_MAP, mapEventToInstruments, extractCryptoIdentifiers } from "../../src/lib/intel/instrument-map";
import { MARKET_UNIVERSE } from "../../src/lib/market/universe";

const ids = (t: ReturnType<typeof tagMechanisms>, basis = "text_match") => t.filter((m) => m.basis === basis).map((m) => m.id).sort();

test("all 13 transmission mechanisms exist and each fires on representative text with matched terms recorded", () => {
  const want = ["inflation", "rate_expectations", "growth", "fiscal", "trade", "energy", "supply_chain", "fx", "credit", "liquidity", "risk_appetite", "regulation", "capital_flows"];
  assert.deepEqual(MECHANISMS.map((m) => m.id).sort(), [...want].sort());
  const samples: Record<string, string> = {
    inflation: "CPI rose as consumer prices climbed",
    rate_expectations: "The FOMC left the policy rate unchanged",
    growth: "GDP contracted and recession fears grew",
    fiscal: "The budget deficit widened",
    trade: "New tariffs on imports announced",
    energy: "Brent crude jumped",
    supply_chain: "Shipping through the Strait of Hormuz halted",
    fx: "The dollar index rose; the yen weakened sharply",
    credit: "Credit spreads widened after a default",
    liquidity: "The Fed expanded its balance sheet via the standing repo facility",
    risk_appetite: "Stocks tumble as the fear gauge surges",
    regulation: "The SEC adopted a proposed rule on capital requirements",
    capital_flows: "Capital outflows accelerated after sanctions",
  };
  for (const [id, text] of Object.entries(samples)) {
    const t = tagMechanisms(text);
    const hit = t.find((m) => m.id === id && m.basis === "text_match");
    assert.ok(hit, `${id} should match "${text}"`);
    assert.ok(hit!.matched.length > 0 && hit!.rule.includes(id));
  }
  assert.equal(INTERPRETATION_LABEL, "interpretation (rule-based)");
});

test("acronym guards: lowercase 'us'/'fed', SNB Bancshares, euro banknotes, credit cards, former employees do not tag", () => {
  assert.deepEqual(tagRegions("Tell us what you think; we fed the data"), []);
  assert.ok(!tagRegions("Fed ends action with SNB Bancshares").some((r) => r.id === "CH"));
  assert.ok(tagRegions("SNB holds rates").some((r) => r.id === "CH"));
  assert.ok(!ids(tagMechanisms("Ten million took part in the survey on new euro banknotes")).includes("fx"));
  assert.ok(!ids(tagMechanisms("Meta agent attacks credit card fees")).includes("credit"));
  assert.ok(!ids(tagMechanisms("Fed issues enforcement actions with former employee of a bank")).includes("regulation"));
  assert.ok(ids(tagMechanisms("Fed announces enforcement action against Big Bank")).includes("regulation"));
});

test("classifier event type implies a mechanism only with the weaker basis; regions record issuer basis", () => {
  const t = tagMechanisms("Statement released today", "monetary_policy");
  assert.deepEqual(ids(t), []);
  assert.deepEqual(ids(t, "classifier_event_type"), ["rate_expectations"]);
  const r = tagRegions("Statement released today", "CH");
  assert.deepEqual(r.map((x) => [x.id, x.basis]), [["CH", "issuing_institution"]]);
  assert.ok(tagIndustries("Banks and oil refiners").some((i) => i.id === "banks"));
});

test("every curated mapping is documented and points at a tracked universe symbol", () => {
  const symbols = new Set(MARKET_UNIVERSE.map((u) => u.symbol));
  for (const e of INSTRUMENT_MAP) {
    assert.ok(symbols.has(e.symbol), `${e.symbol} tracked`);
    assert.ok(e.relation.length > 10 && e.assumptions.length && e.evidenceLimits.length && e.competing.length, `${e.symbol}/${e.mechanism} documented`);
    assert.ok(e.regions.length > 0);
  }
  const keys = INSTRUMENT_MAP.map((e) => `${e.symbol}|${e.mechanism}`);
  assert.equal(new Set(keys).size, keys.length, "unique symbol+mechanism");
});

test("no keyword-only mappings: a headline mentioning Bitcoin is not a Bitcoin mapping; implied mechanisms map nothing", () => {
  const text = "Bitcoin mentioned in celebrity interview";
  const m = mapEventToInstruments({ text, mechanisms: tagMechanisms(text), regions: [], sentiment: "neutral", classifierConfidence: 0.9 });
  assert.equal(m.length, 0);
  const implied = mapEventToInstruments({ text: "Statement", mechanisms: [{ id: "rate_expectations", basis: "classifier_event_type" }], regions: ["US"], sentiment: "hawkish", classifierConfidence: 0.9 });
  assert.equal(implied.length, 0);
  // BTC only via the USD liquidity mechanism, low confidence, no direction
  const liq = "The Fed balance sheet runoff (QT) slows";
  const lm = mapEventToInstruments({ text: liq, mechanisms: tagMechanisms(liq), regions: ["US"], sentiment: "neutral", classifierConfidence: 0.6 });
  const btc = lm.find((x) => x.symbol === "BTC");
  assert.ok(btc && btc.confidence === "low" && btc.direction === null && btc.mechanism === "liquidity");
  // crypto identifiers: tickers/names are ignored
  assert.deepEqual(extractCryptoIdentifiers("BTC and ETH rally; Solana too"), { contracts: [], coingeckoIds: [] });
  const x = extractCryptoIdentifiers("Token 0xAbCdEf0000000000000000000000000000000001 see https://www.coingecko.com/en/coins/usd-coin");
  assert.deepEqual(x, { contracts: ["0xabcdef0000000000000000000000000000000001"], coingeckoIds: ["usd-coin"] });
});

test("direction is null unless supportable; conditional on directional sentiment or explicit disruption", () => {
  const t = "FOMC raises the policy rate";
  const neutral = mapEventToInstruments({ text: t, mechanisms: tagMechanisms(t), regions: ["US"], sentiment: "neutral", classifierConfidence: 0.9 });
  assert.ok(neutral.length >= 3 && neutral.every((m) => m.direction === null));
  const hawk = mapEventToInstruments({ text: t, mechanisms: tagMechanisms(t), regions: ["US"], sentiment: "hawkish", classifierConfidence: 0.7 });
  assert.equal(hawk.find((m) => m.symbol === "US2Y")!.direction, "up");
  assert.match(hawk.find((m) => m.symbol === "US2Y")!.directionBasis, /Conditional/);
  assert.equal(hawk.find((m) => m.symbol === "SPX")!.direction, null, "equity sign ambiguous");
  const lowConf = mapEventToInstruments({ text: t, mechanisms: tagMechanisms(t), regions: ["US"], sentiment: "hawkish", classifierConfidence: 0.4 });
  assert.ok(lowConf.every((m) => m.direction === null));
  const oil = "Iran attacks tankers; Brent crude jumps";
  const om = mapEventToInstruments({ text: oil, mechanisms: tagMechanisms(oil), regions: tagRegions(oil).map((r) => r.id), sentiment: "neutral", classifierConfidence: 0.5 });
  assert.equal(om.find((m) => m.symbol === "OIL" && m.mechanism === "energy")!.direction, "up");
  // region gate: ECB news does not map to US instruments
  const ecb = "ECB raises interest rates";
  const em = mapEventToInstruments({ text: ecb, mechanisms: tagMechanisms(ecb), regions: tagRegions(ecb).map((r) => r.id), sentiment: "neutral", classifierConfidence: 0.5 });
  assert.ok(em.some((m) => m.symbol === "EURUSD") && !em.some((m) => m.symbol === "US2Y"));
});
