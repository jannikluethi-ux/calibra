/**
 * Event assessment builder (event_intel_v1). Pure: takes an event plus context and returns a structured
 * assessment that keeps OBSERVATION (what the source reported, with provenance) separate from
 * INTERPRETATION (rule-based mechanism tags, labelled "interpretation (rule-based)").
 * Nothing here claims that an event caused or will cause a market move.
 */
import { createHash } from "crypto";
import type { FinancialEvent } from "../types";
import {
  INTERPRETATION_LABEL,
  MECHANISM_BY_ID,
  RULES_VERSION,
  tagIndustries,
  tagMechanisms,
  tagRegions,
  type MechanismTag,
  type RegionId,
} from "./mechanisms";

export const ASSESSMENT_VERSION = "event_intel_v1";
export const CAUSAL_DISCLAIMER =
  "This assessment lists channels through which events of this kind are commonly discussed as affecting markets. It does not claim the event caused, or will cause, any price move.";

/** Issuing institution of official feeds (used as region evidence with basis "issuing_institution"). */
export const SOURCE_REGION: Record<string, RegionId> = {
  rss_federal_reserve: "US",
  rss_sec: "US",
  rss_cftc: "US",
  rss_ecb: "EA",
  rss_snb: "CH",
  rss_boe: "UK",
  rss_boj: "JP",
  rss_boc: "CA",
  rss_bis: "GLOBAL",
  rss_fsb: "GLOBAL",
  rss_imf: "GLOBAL",
};
export const PRIMARY_SOURCES = new Set(Object.keys(SOURCE_REGION));

/** Feed display name -> source id, for events stored before provenance was recorded (they carry only sourceName). */
const SOURCE_ID_BY_NAME: Record<string, string> = {
  "Federal Reserve Press": "rss_federal_reserve",
  "ECB Press": "rss_ecb",
  "IMF News": "rss_imf",
  "Swiss National Bank Press Releases": "rss_snb",
  "BIS Press Releases": "rss_bis",
  "SEC Press Releases": "rss_sec",
  "Bank of England News": "rss_boe",
  "Bank of Japan What's New": "rss_boj",
  "Bank of Canada Press Releases": "rss_boc",
  "CFTC Press Releases": "rss_cftc",
  "Financial Stability Board": "rss_fsb",
  "CNBC Top News": "rss_cnbc",
  "Reuters Business": "rss_reuters",
};

export function sourceIdOf(e: Pick<FinancialEvent, "provenance" | "sourceName">): string | null {
  return e.provenance?.sourceId ?? SOURCE_ID_BY_NAME[e.sourceName] ?? null;
}

export const MATERIALITY_RULE =
  "Material = live (non-demo) canonical event with at least one text-matched transmission mechanism AND at least one of: issued by an official/primary source (tier 1), reported by 2+ distinct sources in its duplicate group, or impact composite >= 50.";

export interface AssessmentContext {
  clusterSize: number;
  clusterSources: string[];
  canonicalEventId: string | null;
  isCanonical: boolean;
  conflicts: { id: string; kind: "factual" | "interpretive"; summary: string }[];
  nowIso: string;
}

export interface EventAssessment {
  modelVersion: typeof ASSESSMENT_VERSION;
  rulesVersion: string;
  eventId: string;
  assessedAt: string;
  material: boolean;
  materialityReasons: string[];
  observation: {
    whatHappened: string;
    reportedSummary: string | null;
    source: {
      id: string | null;
      name: string;
      tier: number;
      primary: boolean;
      itemUrl: string | null;
      feedUrl: string | null;
      sourcePublishedAt: string | null;
      retrievedAt: string | null;
    };
    corroboration: { duplicateGroupSize: number; distinctSources: string[]; canonicalEventId: string | null };
  };
  verified: string[];
  uncertain: string[];
  interpretation: {
    label: typeof INTERPRETATION_LABEL;
    whyItMatters: string[];
    mechanisms: (MechanismTag & { channel: string })[];
    regions: { id: RegionId; label: string; basis: string; matched: string[] }[];
    industries: { id: string; label: string; matched: string[] }[];
    assetClasses: string[];
    competingInterpretations: string[];
    invalidation: string[];
    classifierReading: { eventType: string | null; sentiment: string; confidence: number; method: string };
  };
  supportingEvidence: { kind: "source_item" | "duplicate_group" | "rule_match"; text: string; url?: string | null }[];
  conflicts: { id: string; kind: "factual" | "interpretive"; summary: string }[];
  causalDisclaimer: string;
  inputHash: string;
}

export function observedText(e: Pick<FinancialEvent, "title" | "summary">) {
  const s = e.summary && e.summary !== e.title ? ` ${e.summary}` : "";
  return `${e.title}.${s}`;
}

export function assessEvent(e: FinancialEvent, ctx: AssessmentContext): EventAssessment {
  const text = observedText(e);
  const srcId = sourceIdOf(e);
  const primary = !!srcId && PRIMARY_SOURCES.has(srcId);
  const mechs = tagMechanisms(text, e.classification.event_type);
  const textMechs = mechs.filter((m) => m.basis === "text_match");
  const regions = tagRegions(text, srcId ? SOURCE_REGION[srcId] ?? null : null);
  const industries = tagIndustries(text);
  const composite = Number(e.impactScore?.composite ?? 0);
  const distinct = Array.from(new Set(ctx.clusterSources.length ? ctx.clusterSources : [e.sourceName]));

  const reasons: string[] = [];
  let material = e.quality === "live" && ctx.isCanonical && textMechs.length > 0;
  if (e.quality !== "live") reasons.push(`Not material: quality '${e.quality}' (only live events are assessed as material).`);
  if (!ctx.isCanonical) reasons.push("Not material on its own: a non-canonical member of a duplicate group (the canonical event carries the assessment).");
  if (!textMechs.length) reasons.push("Not material: no transmission mechanism matched in the source text.");
  const triggers: string[] = [];
  if (e.sourceTier === 1 || primary) triggers.push(`official/primary source (tier ${e.sourceTier})`);
  if (distinct.length >= 2) triggers.push(`reported by ${distinct.length} distinct sources`);
  if (composite >= 50) triggers.push(`impact composite ${composite} >= 50 (heuristic score)`);
  if (material && !triggers.length) {
    material = false;
    reasons.push("Not material: single secondary source, impact composite below 50.");
  }
  if (material) reasons.push(`Material: ${textMechs.length} mechanism(s) matched; ${triggers.join("; ")}.`);

  const verified: string[] = [];
  const pubAt = e.provenance?.sourcePublishedAt ?? (e.provenance ? null : e.publishedAt);
  verified.push(`${e.sourceName} (tier ${e.sourceTier}) published an item titled "${e.title.slice(0, 200)}"${pubAt ? ` at ${pubAt} (UTC)` : " (no publish time in the source)"}.`);
  if (e.citationUrl) verified.push(`Source link recorded: ${e.citationUrl}`);
  if (primary) verified.push("The item comes from the issuing institution's own feed (primary source), so the statement itself is attributable to that institution.");
  if (distinct.length >= 2) verified.push(`The same story was reported by ${distinct.length} distinct sources: ${distinct.join(", ")}.`);

  const uncertain: string[] = [];
  if (!primary) uncertain.push("Content claims are as reported by a secondary/media source and have not been independently verified.");
  if (e.sourceTier >= 3 && distinct.length < 2) uncertain.push("Single tier-3 source with no corroborating report in its duplicate group.");
  if (!pubAt) uncertain.push("The source gave no publish time; ordering uses retrieval time.");
  uncertain.push("Whether markets had already priced this information is not observed.");
  uncertain.push(`Classifier reading (${e.classification.classifier_version ?? e.classification.method}) is heuristic: sentiment '${e.classification.sentiment}', confidence ${Number(e.classification.confidence).toFixed(2)}.`);
  if (ctx.conflicts.length) uncertain.push(`${ctx.conflicts.length} conflicting report(s) detected; see conflicts.`);

  const mechDetail = mechs.map((m) => ({ ...m, channel: MECHANISM_BY_ID[m.id].channel }));
  const why = textMechs.map((m) => `${MECHANISM_BY_ID[m.id].label}: ${MECHANISM_BY_ID[m.id].whyItMatters}`);
  const assetClasses = Array.from(new Set(textMechs.flatMap((m) => MECHANISM_BY_ID[m.id].assetClasses)));
  const competing: string[] = [];
  for (const m of textMechs) competing.push(`${MECHANISM_BY_ID[m.id].label}: ${MECHANISM_BY_ID[m.id].competingNote}`);
  if (textMechs.length >= 2) competing.push(`Several channels matched (${textMechs.map((m) => m.label).join(", ")}); they can offset each other and their relative importance is not determined.`);
  if (e.classification.sentiment === "neutral" || e.classification.sentiment === "mixed") competing.push("No directional reading: the classifier found the text neutral or mixed, so no direction is implied.");
  for (const c of ctx.conflicts) competing.push(`Conflicting report (${c.kind}): ${c.summary}`);
  const invalidation = Array.from(new Set(textMechs.flatMap((m) => MECHANISM_BY_ID[m.id].invalidation)));
  invalidation.push("The source corrects or withdraws the item.");

  const supporting: EventAssessment["supportingEvidence"] = [
    { kind: "source_item", text: `${e.sourceName}: "${e.title.slice(0, 200)}"`, url: e.citationUrl ?? e.provenance?.itemUrl ?? null },
  ];
  if (distinct.length >= 2) supporting.push({ kind: "duplicate_group", text: `Duplicate group of ${ctx.clusterSize} item(s) from ${distinct.join(", ")}` });
  for (const m of textMechs) supporting.push({ kind: "rule_match", text: `${m.label} rule matched: ${m.matched.map((x) => `"${x}"`).join(", ")}` });

  const hashInput = JSON.stringify([
    ASSESSMENT_VERSION,
    RULES_VERSION,
    e.id,
    e.title,
    e.summary,
    e.sourceTier,
    e.classification.sentiment,
    e.classification.event_type ?? null,
    Number(e.classification.confidence),
    composite,
    ctx.isCanonical,
    distinct.slice().sort(),
    ctx.conflicts.map((c) => c.id).sort(),
  ]);
  const inputHash = createHash("sha256").update(hashInput).digest("hex").slice(0, 32);

  return {
    modelVersion: ASSESSMENT_VERSION,
    rulesVersion: RULES_VERSION,
    eventId: e.id,
    assessedAt: ctx.nowIso,
    material,
    materialityReasons: reasons,
    observation: {
      whatHappened: e.title,
      reportedSummary: e.summary && e.summary !== e.title ? e.summary : null,
      source: {
        id: srcId,
        name: e.sourceName,
        tier: e.sourceTier,
        primary,
        itemUrl: e.provenance?.itemUrl ?? e.citationUrl ?? null,
        feedUrl: e.provenance?.feedUrl ?? null,
        sourcePublishedAt: pubAt,
        retrievedAt: e.provenance?.retrievedAt ?? null,
      },
      corroboration: { duplicateGroupSize: ctx.clusterSize, distinctSources: distinct, canonicalEventId: ctx.canonicalEventId },
    },
    verified,
    uncertain,
    interpretation: {
      label: INTERPRETATION_LABEL,
      whyItMatters: why,
      mechanisms: mechDetail,
      regions,
      industries,
      assetClasses,
      competingInterpretations: competing,
      invalidation,
      classifierReading: {
        eventType: e.classification.event_type ?? null,
        sentiment: e.classification.sentiment,
        confidence: Number(e.classification.confidence),
        method: e.classification.classifier_version ?? e.classification.method,
      },
    },
    supportingEvidence: supporting,
    conflicts: ctx.conflicts,
    causalDisclaimer: CAUSAL_DISCLAIMER,
    inputHash,
  };
}
