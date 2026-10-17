import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWeights, computeConfidence, normalizeWeights, buildScenarioSetV2, EXHAUSTIVENESS_NOTE } from "../../src/lib/intel/scenario-v2";
import { assessEvent } from "../../src/lib/intel/assess";
import type { FinancialEvent } from "../../src/lib/types";

const NOW = "2026-10-17T12:00:00.000Z";

export function mkEvent(o: Partial<FinancialEvent> & { sentiment?: string; conf?: number; eventType?: string } = {}): FinancialEvent {
  return {
    id: o.id ?? "ev1",
    title: o.title ?? "Federal Reserve issues FOMC statement; policy rate unchanged",
    summary: o.summary ?? "",
    rawText: "",
    transmissionMechanism: "",
    causalChain: [],
    expectedImpact: "",
    timeHorizon: "1-4w",
    impactScore: { magnitude: 60, probability: 60, marketSensitivity: 60, transmissionSpeed: 60, persistence: 60, confidence: 60, composite: o.impactScore?.composite ?? 60, methodology: "test" },
    sourceTier: o.sourceTier ?? 1,
    sourceName: o.sourceName ?? "Federal Reserve Press",
    citationUrl: "https://www.federalreserve.gov/x",
    publishedAt: o.publishedAt ?? "2026-10-17T10:00:00.000Z",
    ingestedAt: NOW,
    quality: o.quality ?? "live",
    tags: [],
    classification: { categories: [], entities: [], sentiment: (o.sentiment ?? "neutral") as FinancialEvent["classification"]["sentiment"], confidence: o.conf ?? 0.6, method: "heuristic_v2", classifier_version: "heuristic_v2", event_type: (o.eventType ?? "monetary_policy") as never },
    provenance: "provenance" in o ? o.provenance : { sourceId: "rss_federal_reserve", sourceName: "Federal Reserve Press", feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml", itemUrl: "https://www.federalreserve.gov/x", sourcePublishedAt: o.publishedAt ?? "2026-10-17T10:00:00.000Z", retrievedAt: NOW, fields: { title: "observed" }, transformations: [], corroboration: null, pipeline: "test" },
  } as FinancialEvent;
}
const ctx = (o: Record<string, unknown> = {}) => ({ clusterSize: 1, clusterSources: [] as string[], canonicalEventId: null, isCanonical: true, conflicts: [] as { id: string; kind: "factual" | "interpretive"; summary: string }[], nowIso: NOW, ...o });

test("weights: documented prior, tilt, tail, conflict shrink; always integers summing to 100", () => {
  assert.deepEqual(computeWeights({ sentiment: "neutral", classifierConfidence: 0.9, composite: 50, mechanisms: [], conflicts: [] }).weights, [50, 20, 20, 10]);
  assert.deepEqual(computeWeights({ sentiment: "hawkish", classifierConfidence: 0.6, composite: 50, mechanisms: [], conflicts: [] }).weights, [50, 10, 30, 10]);
  assert.deepEqual(computeWeights({ sentiment: "risk_on", classifierConfidence: 0.6, composite: 50, mechanisms: [], conflicts: [] }).weights, [50, 30, 10, 10]);
  assert.deepEqual(computeWeights({ sentiment: "hawkish", classifierConfidence: 0.4, composite: 50, mechanisms: [], conflicts: [] }).weights, [50, 20, 20, 10], "low confidence: no tilt");
  assert.deepEqual(computeWeights({ sentiment: "neutral", classifierConfidence: 0.6, composite: 75, mechanisms: [], conflicts: [] }).weights, [45, 20, 20, 15]);
  const shr = computeWeights({ sentiment: "hawkish", classifierConfidence: 0.6, composite: 50, mechanisms: [], conflicts: [{ kind: "interpretive" }] });
  assert.match(shr.steps.join(" "), /tilt cancelled/);
  assert.deepEqual(shr.weights, [44, 21, 21, 14]);
  for (const s of ["neutral", "hawkish", "dovish", "risk_on", "risk_off", "mixed"]) for (const c of [0, 0.5, 1]) for (const comp of [10, 70, 100]) for (const k of [[], [{ kind: "factual" as const }], [{ kind: "factual" as const }, { kind: "interpretive" as const }, { kind: "factual" as const }]]) {
    const w = computeWeights({ sentiment: s, classifierConfidence: c, composite: comp, mechanisms: ["credit"], conflicts: k }).weights;
    assert.equal(w.reduce((a, x) => a + x, 0), 100);
    assert.ok(w.every((x) => Number.isInteger(x) && x >= 0));
  }
  assert.deepEqual(normalizeWeights([1, 1, 1]), [34, 33, 33]);
});

test("confidence: tier caps, conflict penalty, uncorroborated tier-3 cap, staleness, floor", () => {
  assert.equal(computeConfidence({ classifierConfidence: 0.9, tier: 1, corroboratedSources: 1, conflicts: [], ageHours: 1 }).confidence, 70);
  assert.equal(computeConfidence({ classifierConfidence: 0.9, tier: 3, corroboratedSources: 1, conflicts: [], ageHours: 1 }).confidence, 40);
  assert.equal(computeConfidence({ classifierConfidence: 0.9, tier: 3, corroboratedSources: 2, conflicts: [], ageHours: 1 }).confidence, 50);
  assert.equal(computeConfidence({ classifierConfidence: 0.9, tier: 1, corroboratedSources: 1, conflicts: [{ kind: "factual" }], ageHours: 1 }).confidence, 55);
  assert.equal(computeConfidence({ classifierConfidence: 0.9, tier: 1, corroboratedSources: 1, conflicts: [], ageHours: 200 }).confidence, 60);
  assert.equal(computeConfidence({ classifierConfidence: 0.05, tier: 4, corroboratedSources: 1, conflicts: [{ kind: "factual" }, { kind: "factual" }], ageHours: 500 }).confidence, 10);
});

test("assessment separates observation from rule-based interpretation and never claims causation", () => {
  const a = assessEvent(mkEvent(), ctx());
  assert.equal(a.material, true);
  assert.equal(a.interpretation.label, "interpretation (rule-based)");
  assert.ok(a.verified[0].includes("Federal Reserve Press (tier 1) published"));
  assert.ok(a.observation.source.primary);
  assert.ok(a.interpretation.mechanisms.some((m) => m.id === "rate_expectations" && m.basis === "text_match"));
  assert.ok(a.interpretation.regions.some((r) => r.id === "US"));
  assert.ok(a.interpretation.invalidation.length > 0 && a.interpretation.competingInterpretations.length > 0);
  assert.match(a.causalDisclaimer, /does not claim the event caused/);
  const all = JSON.stringify({ ...a, causalDisclaimer: "" }).toLowerCase();
  for (const bad of ["will cause", "caused the", "guarantee", "certainly", "buy ", "sell "]) assert.ok(!all.includes(bad), `no "${bad}"`);
  // materiality rules
  assert.equal(assessEvent(mkEvent({ quality: "demo" }), ctx()).material, false);
  assert.equal(assessEvent(mkEvent(), ctx({ isCanonical: false })).material, false);
  assert.equal(assessEvent(mkEvent({ title: "Board meeting held", eventType: "other" }), ctx()).material, false);
  const cnbc = mkEvent({ sourceTier: 3, sourceName: "CNBC Top News", provenance: undefined, impactScore: { composite: 40 } as never });
  assert.equal(assessEvent(cnbc, ctx()).material, false, "single tier-3, composite < 50");
  assert.equal(assessEvent(cnbc, ctx({ clusterSize: 2, clusterSources: ["CNBC Top News", "Federal Reserve Press"] })).material, true, "corroborated");
  // input hash changes when conflicts change
  assert.notEqual(assessEvent(mkEvent(), ctx()).inputHash, assessEvent(mkEvent(), ctx({ conflicts: [{ id: "c1", kind: "factual", summary: "x" }] })).inputHash);
});

test("v2 set: all required fields, not exhaustive, documented weights, conflicts lower confidence, legacy branches compatible", () => {
  const e = mkEvent({ sentiment: "hawkish", conf: 0.7 });
  const a = assessEvent(e, ctx());
  const maps = [{ symbol: "US2Y", mechanism: "rate_expectations", direction: "up" as const, horizon: "1-7d" as const, rationale: "Short yields price the policy path.", assumptions: ["x"], confidence: "medium" }];
  const s = buildScenarioSetV2({ event: e, assessment: a, assessmentId: 1, mappings: maps, nowIso: NOW })!;
  assert.equal(s.schemaVersion, 2);
  const v = s.v2!;
  assert.equal(v.exhaustive, false);
  assert.equal(v.exhaustivenessNote, EXHAUSTIVENESS_NOTE);
  assert.equal(v.scenarios.length, 4);
  assert.equal(v.scenarios.reduce((x, y) => x + y.weight, 0), 100);
  for (const sc of v.scenarios) {
    for (const k of ["name", "description", "horizon"] as const) assert.ok(String(sc[k]).length > 0, k);
    for (const k of ["evidence", "assumptions", "drivers", "impactMechanisms", "indicatorsToMonitor", "invalidationConditions", "instruments"] as const) assert.ok(sc[k].length > 0, `${sc.key}.${k}`);
    assert.ok(sc.confidence >= 10 && sc.confidence <= 100);
  }
  assert.ok(v.lastUpdate && v.dqStatus && v.weightSteps.length === 5 || v.weightSteps.length >= 5);
  assert.equal(v.dqStatus, "ok");
  assert.equal(s.base.probability, v.scenarios[0].weight);
  assert.equal(s.bear.probability, v.scenarios[2].weight);
  assert.deepEqual(s.affectedAssets, ["US2Y"]);
  // a conflict lowers confidence and sharpness
  const ac = assessEvent(e, ctx({ conflicts: [{ id: "c1", kind: "interpretive", summary: "opposite reading" }] }));
  const sc2 = buildScenarioSetV2({ event: e, assessment: ac, assessmentId: 2, mappings: maps, nowIso: NOW })!;
  assert.ok(sc2.v2!.confidence < v.confidence);
  assert.equal(sc2.v2!.dqStatus, "conflicted");
  assert.ok(Math.max(...sc2.v2!.scenarios.map((x) => x.weight)) < Math.max(...v.scenarios.map((x) => x.weight)));
  // non-material -> no scenario (no manufactured weights)
  assert.equal(buildScenarioSetV2({ event: e, assessment: { ...a, material: false }, assessmentId: 1, mappings: maps, nowIso: NOW }), null);
  // no mapping -> limited, instruments empty but still declared
  const s3 = buildScenarioSetV2({ event: e, assessment: a, assessmentId: 1, mappings: [], nowIso: NOW })!;
  assert.equal(s3.v2!.dqStatus, "limited");
  assert.deepEqual(s3.affectedAssets, []);
});
