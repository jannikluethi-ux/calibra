import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSameStory, clusterHeadlines, pickCanonical } from "../../src/lib/ingestion/cluster-core";

const h = (id: string, title: string, at: string, tier = 3) => ({ id, title, publishedAt: at, sourceTier: tier });

// True positives: real re-headlined pairs observed in the Calibra event store.
const SAME: [string, string][] = [
  ["Trump to announce planned $15 billion steel plant, would be largest in U.S. history", "Trump to announce plan for $15 billion steel plant, would be largest in U.S. history"],
  ["Hedge funds now hold a record share of the $30 trillion Treasury market. What could go wrong?", "Hedge funds hold a record share of the $30 trillion Treasury market. What could go wrong?"],
  ["Dow posts back-to-back losses as Treasury yields continue their ascent: Live updates", "Dow posts back-to-back losses as Treasury yields continue their ascent"],
  ["Oil prices jump over 4% as Trump rejects Iranian proposal to reopen Strait of Hormuz", "Oil prices rise as Trump rejects Iranian proposal to reopen Strait of Hormuz"],
  ["Producer prices in China rise at fastest pace since June 2022, beating expectations", "China's producer prices rise at fastest pace since June 2022, beating expectations"],
  ["Nvidia, AMD, Dell sell-off in global tech rout on AI funding worries", "Nvidia, AMD, Dell sink in global tech rout on AI funding worries"],
];

// False positives to avoid: same entity / similar wording but different facts or moves.
const DIFFERENT: [string, string][] = [
  ["Fed holds rates steady, signals patience", "Fed's Waller says rate cuts may come later this year"],
  ["ECB raises rates by 25 basis points", "ECB raises rates by 50 basis points"],
  ["Treasury yields are broadly flat as investors anticipate FOMC minutes", "Treasury yields fall as investors anticipate FOMC minutes"],
  ["Stock futures are flat as investors grapple with higher yields, await Fed minutes: Live updates", "Stock futures fall as investors grapple with higher yields, await Fed minutes: Live updates"],
  ["China exports surge in September", "China imports slump in September"],
  ["Oil prices rise on Middle East tensions", "Gold prices rise on Middle East tensions"],
  ["SpaceX prepares to send Starship rocket to orbit for first time", "SpaceX launches its massive Starship rocket into orbit for the first time"],
  ["Bitcoin falls below $60,000", "Bitcoin rises above $60,000"],
];

test("same story (true positives) are linked", () => {
  for (const [a, b] of SAME) {
    const d = decideSameStory(h("a", a, "2026-10-01T10:00:00Z"), h("b", b, "2026-10-01T12:00:00Z"));
    assert.equal(d.same, true, `${a} || ${b} → ${d.reasons.join("; ")}`);
  }
});

test("different stories (false-positive traps) are not linked", () => {
  for (const [a, b] of DIFFERENT) {
    const d = decideSameStory(h("a", a, "2026-10-01T10:00:00Z"), h("b", b, "2026-10-01T11:00:00Z"));
    assert.equal(d.same, false, `${a} || ${b} → ${d.reasons.join("; ")}`);
  }
});

test("shared entity alone never links", () => {
  const d = decideSameStory(h("a", "Federal Reserve Board announces enforcement action", "2026-10-01T10:00:00Z"), h("b", "Federal Reserve Board announces approval of application", "2026-10-01T10:30:00Z"));
  assert.equal(d.same, false, d.reasons.join("; "));
});

test("identical headlines outside the 48h window are not linked (recurring headlines)", () => {
  const t = "Stock market today: Dow, S&P 500, Nasdaq futures";
  assert.equal(decideSameStory(h("a", t, "2026-10-01T10:00:00Z"), h("b", t, "2026-10-04T10:00:00Z")).same, false);
});

test("clustering is non-chaining and picks the best-tier, earliest event as canonical", () => {
  const items = [
    h("cnbc1", "Trump to announce planned $15 billion steel plant, would be largest in U.S. history", "2026-09-28T16:29:00Z", 3),
    h("cnbc2", "Trump to announce plan for $15 billion steel plant, would be largest in U.S. history", "2026-09-28T16:48:00Z", 3),
    h("fed1", "Federal Reserve issues FOMC statement", "2026-09-28T18:00:00Z", 1),
    h("cnbc3", "Trump announces plan for $15 billion steel plant, would be largest in U.S. history", "2026-09-28T19:11:00Z", 3),
  ];
  const cl = clusterHeadlines(items);
  const steel = cl.find((c) => c.members.length > 1)!;
  // cnbc3 ("announces" vs "to announce planned") is below threshold against the canonical: kept separate
  // (conservative; a false negative is preferred to a false merge).
  assert.deepEqual(steel.members.map((m) => m.item.id).sort(), ["cnbc1", "cnbc2"]);
  assert.equal(steel.canonical.id, "cnbc1");
  assert.equal(cl.length, 3, "the Fed statement stays its own story");
  assert.equal(pickCanonical([h("x", "t", "2026-01-02T00:00:00Z", 3), h("y", "t", "2026-01-03T00:00:00Z", 1)]).id, "y");
});
