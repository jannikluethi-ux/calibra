import { test } from "node:test";
import assert from "node:assert/strict";
import { detectConflicts, extractNumericClaims, compareSides, conflictEffect, unambiguous, type ConflictInput } from "../../src/lib/intel/conflicts";

const base = (o: Partial<ConflictInput>): ConflictInput => ({
  id: "x", title: "", summary: "", sentiment: "neutral", classifierConfidence: 0.6, tier: 3, sourceName: "CNBC Top News",
  publishedAt: "2026-10-14T12:00:00.000Z", mechanisms: ["inflation"], regions: ["US"], groupKey: null, ...o,
});

test("numeric claims carry period basis; forward-looking figures are excluded", () => {
  const c = extractNumericClaims("Consumer prices rose 0.6% in September, putting annual inflation rate at 3.7%");
  assert.ok(c.some((x) => x.value === 3.7 && x.basis === "yoy"));
  assert.ok(c.some((x) => x.value === 0.6 && x.basis === "unspecified"));
  assert.equal(extractNumericClaims("Inflation is expected to reach 3.6% from a year ago").length, 0);
  const d = extractNumericClaims("The deficit swelled to $1.8 trillion");
  assert.equal(d[0].value, 1800);
  assert.equal(unambiguous([{ metric: "m", value: 1, unit: "%", basis: "yoy", core: false, text: "" }, { metric: "m", value: 2, unit: "%", basis: "yoy", core: false, text: "" }]).length, 0);
});

test("monthly vs annual CPI is not a factual conflict (real 2026-10-14 headlines)", () => {
  const a = base({ id: "a", title: "Consumer prices rose 0.6% in September, putting annual inflation rate at 3.7%", groupKey: "g" });
  const b = base({ id: "b", title: "Consumer prices rose 3.7% annually in September as gas prices skyrocket", groupKey: "g", publishedAt: "2026-10-14T13:53:00.000Z" });
  assert.equal(detectConflicts([a, b]).length, 0);
});

test("different values for the same statistic and basis -> factual, verifiable, unresolved, both sides kept", () => {
  const a = base({ id: "a", title: "US inflation rose 3.7% from a year ago", tier: 1, sourceName: "Official" });
  const b = base({ id: "b", title: "US inflation rose 3.4% from a year ago", publishedAt: "2026-10-14T15:00:00.000Z" });
  const c = detectConflicts([a, b]);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, "factual");
  assert.equal(c[0].verifiable, true);
  assert.equal(c[0].detail.resolution, "unresolved");
  assert.deepEqual([c[0].a.eventId, c[0].b.eventId].sort(), ["a", "b"]);
  assert.match(c[0].detail.sourceComparison, /Official is the higher-quality source/);
  assert.match(c[0].detail.timeComparison, /3\.0h earlier/);
  // stable id for same input
  assert.equal(detectConflicts([b, a])[0].id, c[0].id);
});

test("opposite directional readings on same mechanism+region -> interpretive, not verifiable; neutral/low-confidence ignored", () => {
  const a = base({ id: "a", title: "Fed signals more hikes", sentiment: "hawkish", mechanisms: ["rate_expectations"] });
  const b = base({ id: "b", title: "Fed signals cuts ahead", sentiment: "dovish", mechanisms: ["rate_expectations"], publishedAt: "2026-10-15T10:00:00.000Z" });
  const c = detectConflicts([a, b]);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, "interpretive");
  assert.equal(c[0].verifiable, false);
  assert.equal(detectConflicts([a, { ...b, sentiment: "neutral" }]).length, 0);
  assert.equal(detectConflicts([a, { ...b, classifierConfidence: 0.3 }]).length, 0);
  assert.equal(detectConflicts([a, { ...b, regions: ["EA"] }]).length, 0, "different region");
  assert.equal(detectConflicts([a, { ...b, publishedAt: "2026-10-17T13:00:00.000Z" }]).length, 0, "outside 48h");
});

test("conflict effect: confidence penalty and shrink steps are bounded; comparison is symmetric context", () => {
  assert.deepEqual(conflictEffect([]), { shrinkSteps: 0, cancelTilt: false, confidencePenalty: 0 });
  assert.deepEqual(conflictEffect([{ kind: "factual" }]), { shrinkSteps: 1, cancelTilt: false, confidencePenalty: 15 });
  assert.deepEqual(conflictEffect([{ kind: "interpretive" }, { kind: "factual" }, { kind: "factual" }]), { shrinkSteps: 2, cancelTilt: true, confidencePenalty: 30 });
  const s = compareSides({ eventId: "a", sourceName: "A", tier: 2, publishedAt: "2026-10-14T12:00:00Z", claim: "" }, { eventId: "b", sourceName: "B", tier: 2, publishedAt: "2026-10-14T12:00:00Z", claim: "" });
  assert.match(s.sourceComparison, /does not separate/);
});
