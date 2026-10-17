import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";

useTempDb("calibra-intel-");

const now = new Date();
const h = (n: number) => new Date(now.getTime() - n * 3600_000).toISOString();

function ev(o: { id: string; title: string; summary?: string; at: string; source?: string; sourceId?: string | null; tier?: number; sentiment?: string; conf?: number; quality?: string; composite?: number; eventType?: string }) {
  const sourceId = o.sourceId === undefined ? "rss_federal_reserve" : o.sourceId;
  return {
    id: o.id, title: o.title, summary: o.summary ?? "", rawText: "", transmissionMechanism: "", causalChain: [], expectedImpact: "", timeHorizon: "1-4w",
    impactScore: { magnitude: 50, probability: 50, marketSensitivity: 50, transmissionSpeed: 50, persistence: 50, confidence: 50, composite: o.composite ?? 60, methodology: "t" },
    sourceTier: o.tier ?? 1, sourceName: o.source ?? "Federal Reserve Press", citationUrl: `https://example.org/${o.id}`, publishedAt: o.at, ingestedAt: o.at, quality: o.quality ?? "live", tags: [],
    classification: { categories: [], entities: [], sentiment: o.sentiment ?? "neutral", confidence: o.conf ?? 0.6, method: "heuristic_v2", classifier_version: "heuristic_v2", event_type: o.eventType ?? "monetary_policy" },
    provenance: sourceId ? { sourceId, sourceName: o.source ?? "Federal Reserve Press", feedUrl: "https://example.org/feed", itemUrl: `https://example.org/${o.id}`, sourcePublishedAt: o.at, retrievedAt: o.at, fields: { title: "observed" }, transformations: ["rss-parse"], corroboration: null, pipeline: "test" } : undefined,
  };
}

test("event intelligence: append-only assessments, documented mappings, preserved conflicts, pre-v2 rows untouched, v2 rows additive", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { runEventIntelligence, latestAssessment, mappingsForAssessment, conflictsForEvents, eventListBadges } = await import("../../src/lib/intel/store");
  const { rebuildScenariosFromEvents, getScenarios, scenarioSchemaStatus } = await import("../../src/lib/scenarios/engine");
  const { computeEventMetrics } = await import("../../src/lib/quality/events");
  const db = getDb();
  const cols = (db.prepare(`PRAGMA table_info(scenarios)`).all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes("schema_version"), "additive column");

  const ins = db.prepare(`INSERT INTO events (id, published_at, data, quality) VALUES (?, ?, ?, ?)`);
  const put = (e: ReturnType<typeof ev>) => ins.run(e.id, e.publishedAt, JSON.stringify(e), e.quality);
  put(ev({ id: "fomc", title: "Federal Reserve issues FOMC statement; policy rate unchanged", at: h(5), sentiment: "hawkish", conf: 0.7 }));
  put(ev({ id: "old", title: "Federal Reserve raises the policy rate", at: h(30) }));
  put(ev({ id: "celeb", title: "Celebrity says Bitcoin is fun", at: h(4), source: "CNBC Top News", sourceId: "rss_cnbc", tier: 3, composite: 40, eventType: "other" }));
  put(ev({ id: "cpiA", title: "US inflation rose 3.7% from a year ago", at: h(6), source: "CNBC Top News", sourceId: "rss_cnbc", tier: 3, eventType: "inflation" }));
  put(ev({ id: "cpiB", title: "US inflation rose 3.4% from a year ago, officials say", at: h(3), source: "Federal Reserve Press", tier: 1, eventType: "inflation" }));
  put(ev({ id: "demo1", title: "FOMC sample", at: h(2), quality: "demo" }));
  // a legacy (pre-v2) scenario row for "old"
  const legacy = { id: "legacy-1", eventId: "old", title: "legacy", base: { name: "base", probability: 55, confidence: 50, narrative: "n", supportingEvidence: [], contradictingEvidence: [], keyAssumptions: [], invalidationConditions: [], affectedAssets: ["SPX"] }, bull: { name: "bull", probability: 20, confidence: 50, narrative: "n", supportingEvidence: [], contradictingEvidence: [], keyAssumptions: [], invalidationConditions: [], affectedAssets: [] }, bear: { name: "bear", probability: 15, confidence: 50, narrative: "n", supportingEvidence: [], contradictingEvidence: [], keyAssumptions: [], invalidationConditions: [], affectedAssets: [] }, tail: { name: "tail", probability: 10, confidence: 50, narrative: "n", supportingEvidence: [], contradictingEvidence: [], keyAssumptions: [], invalidationConditions: [], affectedAssets: [] }, timeHorizon: "1-4w", affectedAssets: ["SPX", "VIX", "US10Y"], createdAt: h(29), updatedAt: h(29), label: "estimate" };
  db.prepare(`INSERT INTO scenarios (id, created_at, data) VALUES (?,?,?)`).run("legacy-1", legacy.createdAt, JSON.stringify(legacy));
  const legacyBefore = db.prepare(`SELECT * FROM scenarios WHERE id = 'legacy-1'`).get();
  const eventsBefore = db.prepare(`SELECT id, data FROM events ORDER BY id`).all();

  const r1 = runEventIntelligence({ sinceDays: 5 });
  assert.equal(r1.events, 5, "live only");
  assert.equal(r1.newAssessments, 5);
  const r2 = runEventIntelligence({ sinceDays: 5 });
  assert.equal(r2.newAssessments, 0, "idempotent: unchanged inputs write nothing");
  assert.equal(r2.newMappings, 0);

  const fomc = latestAssessment("fomc")!;
  assert.equal(fomc.assessment.material, true);
  const maps = mappingsForAssessment(fomc.id);
  assert.ok(maps.some((m) => m.symbol === "US2Y" && m.direction === "up" && m.instrumentId === null), "instrument id null when not in instruments table");
  assert.ok(maps.every((m) => m.rationale && m.detail.assumptions.length && m.detail.evidenceLimits.length && m.detail.competing.length));
  const celeb = latestAssessment("celeb")!;
  assert.equal(celeb.assessment.material, false);
  assert.equal(mappingsForAssessment(celeb.id).length, 0, "no keyword-only BTC mapping");

  const cf = conflictsForEvents(["cpiA"]);
  assert.equal(cf.length, 1);
  assert.equal(cf[0].kind, "factual");
  assert.equal(cf[0].verifiable, true);
  assert.equal(cf[0].detail.resolution, "unresolved");
  assert.ok(latestAssessment("cpiB")!.assessment.conflicts.length === 1);

  const scen = rebuildScenariosFromEvents(15);
  assert.ok(scen.length >= 2);
  assert.ok(scen.every((s) => s.schemaVersion === 2 && s.v2 && s.v2.exhaustive === false));
  assert.ok(!scen.some((s) => s.eventId === "old"), "event with pre-v2 row not rewritten");
  assert.ok(!scen.some((s) => s.eventId === "celeb"), "non-material: no scenario");
  assert.deepEqual(db.prepare(`SELECT * FROM scenarios WHERE id = 'legacy-1'`).get(), legacyBefore, "pre-v2 row byte-identical");
  const cpiB = scen.find((s) => s.eventId === "cpiB")!;
  assert.equal(cpiB.v2!.dqStatus, "conflicted");
  const fomcS = scen.find((s) => s.eventId === "fomc")!;
  assert.ok(cpiB.v2!.confidence < fomcS.v2!.confidence);
  const all = getScenarios();
  assert.equal(scenarioSchemaStatus(all.find((s) => s.id === "legacy-1")!), "pre-v2");
  assert.equal(scenarioSchemaStatus(fomcS), "v2");
  const revs1 = (db.prepare(`SELECT COUNT(*) n FROM scenario_v2_revisions`).get() as { n: number }).n;
  rebuildScenariosFromEvents(15);
  assert.equal((db.prepare(`SELECT COUNT(*) n FROM scenario_v2_revisions`).get() as { n: number }).n, revs1, "no new revision when unchanged");

  // input change -> new assessment version (old kept) and a new scenario revision, same scenario id
  const changed = ev({ id: "fomc", title: "Federal Reserve issues FOMC statement; policy rate unchanged", at: h(5), sentiment: "dovish", conf: 0.7 });
  db.prepare(`UPDATE events SET data = ? WHERE id = 'fomc'`).run(JSON.stringify(changed));
  runEventIntelligence({ sinceDays: 5 });
  assert.equal((db.prepare(`SELECT COUNT(*) n FROM event_assessments WHERE event_id = 'fomc'`).get() as { n: number }).n, 2);
  const after = rebuildScenariosFromEvents(15).find((s) => s.eventId === "fomc")!;
  assert.equal(after.id, fomcS.id);
  assert.ok(after.v2!.scenarios[1].weight > after.v2!.scenarios[2].weight, "dovish tilts upside");
  assert.equal((db.prepare(`SELECT COUNT(*) n FROM scenario_v2_revisions WHERE event_id = 'fomc'`).get() as { n: number }).n, 2, "history kept");

  // events table untouched except the deliberate test update
  const eventsAfter = db.prepare(`SELECT id, data FROM events ORDER BY id`).all() as { id: string; data: string }[];
  assert.equal(eventsAfter.length, (eventsBefore as unknown[]).length);

  const b = eventListBadges(["fomc", "old", "cpiA"]);
  assert.equal(b.get("fomc")!.scenario, "v2");
  assert.equal(b.get("old")!.scenario, "pre-v2");
  assert.equal(b.get("cpiA")!.conflicts, 1);

  const m = computeEventMetrics();
  assert.equal(m.concentration.window7d.total, 5);
  assert.equal(m.concentration.window7d.topShare, 0.6);
  assert.equal(m.concentration.window7d.hhi, 5200);
  assert.equal(m.concentration.window7d.officialShare, 0.6);
  assert.equal(m.intelligence.scenariosPreV2, 1);
  assert.ok(m.intelligence.scenariosV2 >= 2);
  assert.equal(m.intelligence.conflicts.factual, 1);
  assert.ok(m.freshness.perSource.some((p) => p.sourceName === "SNB" || p.sourceName === "Swiss National Bank Press Releases"), "configured feeds without items are listed");
});
