/**
 * Event-intelligence persistence and orchestration. Append-only writes; events and pre-v2 scenarios are never modified.
 */
import type Database from "better-sqlite3";
import { getDb, getMeta, setMeta } from "../db";
import type { FinancialEvent, Scenario } from "../types";
import { getUniverseItem } from "../market/universe";
import { ensureIntelTables } from "./schema";
import { assessEvent, observedText, sourceIdOf, SOURCE_REGION, ASSESSMENT_VERSION, type EventAssessment } from "./assess";
import { detectConflicts, type ConflictInput, type DetectedConflict, CONFLICT_VERSION } from "./conflicts";
import { tagMechanisms, tagRegions, type RegionId } from "./mechanisms";
import { extractCryptoIdentifiers, mapEventToInstruments, MAP_VERSION, type CandidateMapping, type Sentiment } from "./instrument-map";
import { buildScenarioSetV2, type MappingLite } from "./scenario-v2";

export const META_INTEL_LAST = "eventIntelLastRun";

interface EvRow {
  id: string;
  data: string;
}

function loadEvents(db: Database.Database, sinceIso: string, limit: number): FinancialEvent[] {
  const rows = db
    .prepare(`SELECT id, data FROM events WHERE quality = 'live' AND published_at >= ? ORDER BY published_at DESC LIMIT ?`)
    .all(sinceIso, limit) as EvRow[];
  return rows.map((r) => JSON.parse(r.data) as FinancialEvent);
}

function clusterIndex(db: Database.Database) {
  const rows = db.prepare(`SELECT event_id, canonical_event_id FROM event_clusters`).all() as { event_id: string; canonical_event_id: string }[];
  const canonicalOf = new Map<string, string>();
  const members = new Map<string, Set<string>>();
  for (const r of rows) {
    canonicalOf.set(r.event_id, r.canonical_event_id);
    const s = members.get(r.canonical_event_id) ?? new Set<string>([r.canonical_event_id]);
    s.add(r.event_id);
    members.set(r.canonical_event_id, s);
  }
  return { canonicalOf, members };
}

export function resolveInstrumentId(db: Database.Database, symbol: string): string | null {
  if (symbol === "BTC") return "crypto:coingecko:bitcoin";
  const u = getUniverseItem(symbol);
  if (!u) return null;
  const id = `yahoo:${u.yahooSymbol}`;
  const row = db.prepare(`SELECT id FROM instruments WHERE id = ?`).get(id) as { id: string } | undefined;
  return row ? row.id : null;
}

export function cryptoLinksForText(db: Database.Database, text: string): CandidateMapping[] {
  const { contracts, coingeckoIds } = extractCryptoIdentifiers(text);
  const out: CandidateMapping[] = [];
  const base = {
    mechanism: "regulation" as const,
    direction: null,
    directionBasis: "No direction: asset-specific item; effect not inferred.",
    horizon: "1-7d" as const,
    confidence: "low" as const,
    assumptions: ["The item concerns this specific asset"],
    evidenceLimits: ["Linked by identifier in the text; the item's relevance to price is not assessed"],
    competing: ["Market-wide crypto moves"],
  };
  for (const c of contracts) {
    const rows = db.prepare(`SELECT instrument_id, network FROM crypto_contracts WHERE lower(contract_address) = ?`).all(c) as { instrument_id: string; network: string }[];
    for (const r of rows) {
      out.push({ ...base, symbol: r.instrument_id, instrumentId: r.instrument_id, linkBasis: "contract_address", rationale: `Contract ${c} (${r.network}) appears in the event text and matches this asset in crypto_contracts.`, matched: c });
    }
  }
  for (const id of coingeckoIds) {
    const iid = `crypto:coingecko:${id}`;
    const row = db.prepare(`SELECT id FROM instruments WHERE id = ?`).get(iid) as { id: string } | undefined;
    if (row) out.push({ ...base, symbol: iid, instrumentId: iid, linkBasis: "coingecko_id", rationale: `CoinGecko id '${id}' appears explicitly in the event text.`, matched: id });
  }
  return out;
}

function toConflictInput(e: FinancialEvent, groupKey: string | null): ConflictInput {
  const text = observedText(e);
  const srcId = sourceIdOf(e);
  return {
    id: e.id,
    title: e.title,
    summary: e.summary && e.summary !== e.title ? e.summary : "",
    sentiment: e.classification.sentiment,
    classifierConfidence: Number(e.classification.confidence),
    tier: e.sourceTier,
    sourceName: e.sourceName,
    publishedAt: e.publishedAt,
    mechanisms: tagMechanisms(text).filter((m) => m.basis === "text_match").map((m) => m.id),
    regions: tagRegions(text, srcId ? SOURCE_REGION[srcId] ?? null : null).map((r) => r.id),
    groupKey,
  };
}

export function storeConflicts(db: Database.Database, conflicts: DetectedConflict[], nowIso: string): number {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO event_conflicts (id, kind, topic_key, event_a, event_b, claim_a, claim_b, verifiable, detected_by, detail_json, detected_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  let n = 0;
  for (const c of conflicts) {
    const r = ins.run(c.id, c.kind, c.topicKey, c.a.eventId, c.b.eventId, c.a.claim, c.b.claim, c.verifiable ? 1 : 0, CONFLICT_VERSION, JSON.stringify({ ...c.detail, a: c.a, b: c.b }), nowIso);
    n += r.changes;
  }
  return n;
}

export interface StoredConflict {
  id: string;
  kind: "factual" | "interpretive";
  topicKey: string;
  eventA: string;
  eventB: string;
  claimA: string;
  claimB: string;
  verifiable: boolean;
  detail: DetectedConflict["detail"] & { a: DetectedConflict["a"]; b: DetectedConflict["b"] };
  detectedAt: string;
}

function rowToConflict(r: Record<string, unknown>): StoredConflict {
  return {
    id: String(r.id),
    kind: r.kind as StoredConflict["kind"],
    topicKey: String(r.topic_key),
    eventA: String(r.event_a),
    eventB: String(r.event_b),
    claimA: String(r.claim_a),
    claimB: String(r.claim_b),
    verifiable: Number(r.verifiable) === 1,
    detail: JSON.parse(String(r.detail_json)),
    detectedAt: String(r.detected_at),
  };
}

export function conflictsForEvents(ids: string[], db: Database.Database = getDb()): StoredConflict[] {
  ensureIntelTables(db);
  if (!ids.length) return [];
  const ph = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM event_conflicts WHERE event_a IN (${ph}) OR event_b IN (${ph}) ORDER BY detected_at DESC`).all(...ids, ...ids) as Record<string, unknown>[];
  return rows.map(rowToConflict);
}

export function listConflicts(limit = 50, db: Database.Database = getDb()): StoredConflict[] {
  ensureIntelTables(db);
  return (db.prepare(`SELECT * FROM event_conflicts ORDER BY detected_at DESC LIMIT ?`).all(limit) as Record<string, unknown>[]).map(rowToConflict);
}

function conflictSummary(c: StoredConflict | DetectedConflict, selfId: string) {
  const a = "a" in c ? c.a : c.detail.a;
  const b = "b" in c ? c.b : c.detail.b;
  const other = a.eventId === selfId ? b : a;
  const mine = a.eventId === selfId ? a : b;
  return `${mine.claim} vs ${other.sourceName} (tier ${other.tier}): ${other.claim}`.slice(0, 300);
}

export interface StoredAssessment {
  id: number;
  assessment: EventAssessment;
}

export function latestAssessment(eventId: string, db: Database.Database = getDb()): StoredAssessment | null {
  ensureIntelTables(db);
  const r = db.prepare(`SELECT id, assessment_json FROM event_assessments WHERE event_id = ? ORDER BY id DESC LIMIT 1`).get(eventId) as { id: number; assessment_json: string } | undefined;
  return r ? { id: r.id, assessment: JSON.parse(r.assessment_json) } : null;
}

export function assessmentHistory(eventId: string, db: Database.Database = getDb()): { id: number; assessedAt: string; material: boolean; inputHash: string }[] {
  ensureIntelTables(db);
  return (db.prepare(`SELECT id, assessed_at, material, input_hash FROM event_assessments WHERE event_id = ? ORDER BY id DESC`).all(eventId) as { id: number; assessed_at: string; material: number; input_hash: string }[]).map((r) => ({ id: r.id, assessedAt: r.assessed_at, material: r.material === 1, inputHash: r.input_hash }));
}

export interface StoredMapping {
  id: number;
  eventId: string;
  assessmentId: number;
  instrumentId: string | null;
  symbol: string;
  mechanism: string;
  linkBasis: string;
  direction: "up" | "down" | null;
  horizon: string;
  confidence: string;
  rationale: string;
  detail: { directionBasis: string; assumptions: string[]; evidenceLimits: string[]; competing: string[]; matched?: string };
}

export function mappingsForAssessment(assessmentId: number, db: Database.Database = getDb()): StoredMapping[] {
  ensureIntelTables(db);
  const rows = db.prepare(`SELECT * FROM event_instrument_mappings WHERE assessment_id = ? ORDER BY id`).all(assessmentId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    eventId: String(r.event_id),
    assessmentId: Number(r.assessment_id),
    instrumentId: (r.instrument_id as string) ?? null,
    symbol: String(r.symbol),
    mechanism: String(r.mechanism),
    linkBasis: String(r.link_basis),
    direction: (r.direction as "up" | "down" | null) ?? null,
    horizon: String(r.horizon),
    confidence: String(r.confidence),
    rationale: String(r.rationale),
    detail: JSON.parse(String(r.detail_json)),
  }));
}

export interface IntelRunResult {
  events: number;
  assessed: number;
  newAssessments: number;
  material: number;
  newMappings: number;
  conflictsDetected: number;
  newConflicts: number;
}

/**
 * Assess recent live events, detect conflicts, and record instrument mappings for material events.
 * Re-running with unchanged inputs writes nothing (unique input hash).
 */
export function runEventIntelligence(opts: { sinceDays?: number; limit?: number; nowIso?: string } = {}): IntelRunResult {
  const db = getDb();
  ensureIntelTables(db);
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const since = new Date(Date.parse(nowIso) - (opts.sinceDays ?? 21) * 86400_000).toISOString();
  const events = loadEvents(db, since, opts.limit ?? 2000);
  const { canonicalOf, members } = clusterIndex(db);
  const byId = new Map(events.map((e) => [e.id, e]));

  // 1) conflicts over the window (members included - disagreement inside a duplicate group matters)
  const detected = detectConflicts(events.map((e) => toConflictInput(e, canonicalOf.get(e.id) ?? null)));
  const newConflicts = storeConflicts(db, detected, nowIso);
  const allConf = conflictsForEvents(events.map((e) => e.id), db);
  const confByEvent = new Map<string, StoredConflict[]>();
  for (const c of allConf) {
    for (const id of [c.eventA, c.eventB]) {
      const keys = new Set([id, canonicalOf.get(id) ?? id]);
      for (const k of Array.from(keys)) {
        const arr = confByEvent.get(k) ?? [];
        if (!arr.some((x) => x.id === c.id)) arr.push(c);
        confByEvent.set(k, arr);
      }
    }
  }

  const insA = db.prepare(`INSERT OR IGNORE INTO event_assessments (event_id, model_version, input_hash, material, assessed_at, assessment_json) VALUES (?,?,?,?,?,?)`);
  const getA = db.prepare(`SELECT id FROM event_assessments WHERE event_id = ? AND model_version = ? AND input_hash = ?`);
  const insM = db.prepare(
    `INSERT OR IGNORE INTO event_instrument_mappings (event_id, assessment_id, instrument_id, symbol, mechanism, link_basis, direction, horizon, confidence, rationale, detail_json, model_version, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  let newAssessments = 0;
  let material = 0;
  let newMappings = 0;

  const tx = db.transaction(() => {
    for (const e of events) {
      const canonical = canonicalOf.get(e.id) ?? e.id;
      const isCanonical = canonical === e.id;
      const group = Array.from(members.get(canonical) ?? new Set([e.id]));
      const sources = Array.from(
        new Set(group.map((id) => byId.get(id)?.sourceName ?? (db.prepare(`SELECT json_extract(data,'$.sourceName') s FROM events WHERE id = ?`).get(id) as { s: string } | undefined)?.s).filter(Boolean) as string[])
      );
      const conf = (confByEvent.get(e.id) ?? []).map((c) => ({ id: c.id, kind: c.kind, summary: conflictSummary(c, e.id) }));
      const a = assessEvent(e, { clusterSize: group.length, clusterSources: sources, canonicalEventId: group.length > 1 ? canonical : null, isCanonical, conflicts: conf, nowIso });
      const r = insA.run(e.id, ASSESSMENT_VERSION, a.inputHash, a.material ? 1 : 0, nowIso, JSON.stringify(a));
      const aid = (getA.get(e.id, ASSESSMENT_VERSION, a.inputHash) as { id: number }).id;
      if (r.changes) newAssessments++;
      if (!a.material) continue;
      material++;
      if (!r.changes) continue; // mappings already recorded for this assessment
      const text = observedText(e);
      const maps = [
        ...mapEventToInstruments({
          text,
          mechanisms: a.interpretation.mechanisms.map((m) => ({ id: m.id, basis: m.basis })),
          regions: a.interpretation.regions.map((x) => x.id as RegionId),
          sentiment: e.classification.sentiment as Sentiment,
          classifierConfidence: Number(e.classification.confidence),
        }),
        ...cryptoLinksForText(db, `${text} ${e.citationUrl ?? ""}`),
      ];
      for (const m of maps) {
        const iid = m.instrumentId !== undefined ? m.instrumentId : resolveInstrumentId(db, m.symbol);
        const res = insM.run(
          e.id,
          aid,
          iid,
          m.symbol,
          m.mechanism,
          m.linkBasis,
          m.direction,
          m.horizon,
          m.confidence,
          m.rationale,
          JSON.stringify({ directionBasis: m.directionBasis, assumptions: m.assumptions, evidenceLimits: m.evidenceLimits, competing: m.competing, matched: m.matched }),
          MAP_VERSION,
          nowIso
        );
        newMappings += res.changes;
      }
    }
  });
  tx();
  const result = { events: events.length, assessed: events.length, newAssessments, material, newMappings, conflictsDetected: detected.length, newConflicts };
  setMeta(META_INTEL_LAST, JSON.stringify({ at: nowIso, ...result }));
  return result;
}

export function lastIntelRun(): (IntelRunResult & { at: string }) | null {
  const v = getMeta(META_INTEL_LAST);
  try {
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

/** Builds (but does not store) the v2 scenario set for an event from its latest assessment and mappings. */
export function buildV2ForEvent(e: FinancialEvent, nowIso: string, db: Database.Database = getDb()): Scenario | null {
  const sa = latestAssessment(e.id, db);
  if (!sa || !sa.assessment.material) return null;
  const maps: MappingLite[] = mappingsForAssessment(sa.id, db).map((m) => ({
    symbol: m.symbol,
    mechanism: m.mechanism,
    direction: m.direction,
    horizon: m.horizon as MappingLite["horizon"],
    rationale: m.rationale,
    assumptions: m.detail.assumptions ?? [],
    confidence: m.confidence,
  }));
  return buildScenarioSetV2({ event: e, assessment: sa.assessment, assessmentId: sa.id, mappings: maps, nowIso });
}

export interface ScenarioRow {
  scenario: Scenario;
  schemaVersion: number | null;
}

export function scenarioRowForEvent(eventId: string, db: Database.Database = getDb()): ScenarioRow | null {
  const r = db.prepare(`SELECT data, schema_version FROM scenarios WHERE json_extract(data, '$.eventId') = ? ORDER BY created_at DESC LIMIT 1`).get(eventId) as { data: string; schema_version: number | null } | undefined;
  return r ? { scenario: JSON.parse(r.data), schemaVersion: r.schema_version ?? null } : null;
}

/**
 * Write v2 scenario sets for recent material canonical events.
 *  - an event that already has a pre-v2 row: left untouched (the old row stays valid and is shown as pre-v2);
 *  - an event without a row: a new schema_version=2 row;
 *  - an event with a v2 row: updated in place only when its inputs changed, with every version kept in scenario_v2_revisions.
 */
export function writeScenarioSetsV2(events: FinancialEvent[], opts: { max?: number; nowIso?: string } = {}) {
  const db = getDb();
  ensureIntelTables(db);
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const max = opts.max ?? 15;
  const out: Scenario[] = [];
  let skippedPreV2 = 0;
  let notMaterial = 0;
  let unchanged = 0;
  const upsert = db.prepare(
    `INSERT INTO scenarios (id, created_at, data, schema_version) VALUES (?,?,?,2)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, schema_version = 2 WHERE scenarios.schema_version = 2`
  );
  const rev = db.prepare(`INSERT OR IGNORE INTO scenario_v2_revisions (scenario_id, event_id, input_hash, created_at, data) VALUES (?,?,?,?,?)`);
  for (const e of events) {
    if (out.length >= max) break;
    const existing = scenarioRowForEvent(e.id, db);
    if (existing && existing.schemaVersion !== 2) {
      skippedPreV2++;
      continue;
    }
    const fresh = buildV2ForEvent(e, nowIso, db);
    if (!fresh || !fresh.v2) {
      notMaterial++;
      continue;
    }
    if (existing && existing.scenario.v2?.inputHash === fresh.v2.inputHash) {
      unchanged++;
      out.push(existing.scenario);
      continue;
    }
    if (existing) {
      fresh.id = existing.scenario.id;
      fresh.createdAt = existing.scenario.createdAt;
    }
    upsert.run(fresh.id, fresh.createdAt, JSON.stringify(fresh));
    rev.run(fresh.id, e.id, fresh.v2.inputHash, nowIso, JSON.stringify(fresh));
    out.push(fresh);
  }
  return { scenarios: out, skippedPreV2, notMaterial, unchanged };
}

/** Per-event list badges: material flag, duplicate-group size/role, conflict count, scenario schema. */
export function eventListBadges(ids: string[], db: Database.Database = getDb()) {
  ensureIntelTables(db);
  const out = new Map<string, { material: boolean | null; groupSize: number; canonical: boolean; conflicts: number; scenario: "v2" | "pre-v2" | null }>();
  if (!ids.length) return out;
  const ph = ids.map(() => "?").join(",");
  const mat = new Map(
    (db.prepare(`SELECT a.event_id, a.material FROM event_assessments a WHERE a.event_id IN (${ph}) AND a.id = (SELECT MAX(id) FROM event_assessments b WHERE b.event_id = a.event_id)`).all(...ids) as { event_id: string; material: number }[]).map((r) => [r.event_id, r.material === 1])
  );
  const cl = new Map(
    (db
      .prepare(`SELECT c.event_id, c.canonical_event_id, (SELECT COUNT(*) FROM event_clusters x WHERE x.canonical_event_id = c.canonical_event_id) AS n FROM event_clusters c WHERE c.event_id IN (${ph})`)
      .all(...ids) as { event_id: string; canonical_event_id: string; n: number }[]).map((r) => [r.event_id, r])
  );
  const cf = new Map<string, number>();
  for (const r of db.prepare(`SELECT event_a, event_b FROM event_conflicts WHERE event_a IN (${ph}) OR event_b IN (${ph})`).all(...ids, ...ids) as { event_a: string; event_b: string }[]) {
    cf.set(r.event_a, (cf.get(r.event_a) ?? 0) + 1);
    cf.set(r.event_b, (cf.get(r.event_b) ?? 0) + 1);
  }
  const sc = new Map(
    (db.prepare(`SELECT json_extract(data,'$.eventId') AS e, schema_version AS v FROM scenarios WHERE json_extract(data,'$.eventId') IN (${ph})`).all(...ids) as { e: string; v: number | null }[]).map((r) => [r.e, r.v === 2 ? ("v2" as const) : ("pre-v2" as const)])
  );
  for (const id of ids) {
    const c = cl.get(id);
    out.set(id, { material: mat.has(id) ? mat.get(id)! : null, groupSize: c?.n ?? 1, canonical: !c || c.canonical_event_id === id, conflicts: cf.get(id) ?? 0, scenario: sc.get(id) ?? null });
  }
  return out;
}
