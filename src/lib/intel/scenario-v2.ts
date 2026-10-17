/**
 * Structured scenario sets (scenario_v2). Pure builder.
 *
 * Weight rules (documented in docs/event-intelligence-methodology.md):
 *  W1 Prior: base 50, upside 20, downside 20, tail 10. A fixed convention, not an estimate.
 *  W2 Tilt: if the classifier sentiment is directional with confidence >= 0.5, move 10 points from the
 *     opposing branch to the aligned branch (dovish/risk_on -> upside; hawkish/risk_off -> downside).
 *  W3 Tail: if impact composite >= 70, or credit/liquidity was matched with risk_off, move 5 from base to tail.
 *  W4 Conflicts: each open conflict (max 2) moves all weights 25% toward equal weights; an interpretive
 *     conflict also cancels W2.
 *  W5 Normalise to integers summing to 100 (largest-remainder rounding).
 * Weights are RELATIVE among the listed scenarios. They are not probabilities of occurrence, the set is not
 * exhaustive, and a weight says nothing about expected return.
 */
import { createHash } from "crypto";
import type { FinancialEvent, Scenario, ScenarioBranch, ScenarioSetV2, ScenarioV2, TimeHorizon } from "../types";
import type { EventAssessment } from "./assess";
import { conflictEffect } from "./conflicts";
import { INTERPRETATION_LABEL, MECHANISM_BY_ID, type MechanismId } from "./mechanisms";

export const SCENARIO_V2_VERSION = "scenario_v2";
export const SCENARIO_RULES_VERSION = "scenario_rules_2026-10-17";

export const EXHAUSTIVENESS_NOTE =
  "Not exhaustive: these four paths cover only the matched transmission channel(s). Other drivers, unrelated news and combinations are not modelled. Weights are relative among the listed scenarios, not probabilities of occurrence, and are separate from any expected return.";
export const WEIGHT_RULE = "W1 prior 50/20/20/10 → W2 sentiment tilt ±10 → W3 tail +5 → W4 conflict shrink 25%/conflict toward equal → W5 integer normalisation to 100.";

const NAMES: Record<MechanismId, { up: string; down: string }> = {
  inflation: { up: "Inflation pressure eases", down: "Inflation pressure persists" },
  rate_expectations: { up: "Easier policy path priced", down: "Tighter policy path priced" },
  growth: { up: "Growth holds up", down: "Growth disappoints" },
  fiscal: { up: "Fiscal news absorbed without bond stress", down: "Fiscal concerns lift term premium" },
  trade: { up: "Trade measures softened or waived", down: "Trade measures implemented and escalate" },
  energy: { up: "Energy supply concern fades", down: "Energy supply disruption persists" },
  supply_chain: { up: "Disruption is short-lived", down: "Disruption extends" },
  fx: { up: "Orderly currency adjustment", down: "Disorderly currency move" },
  credit: { up: "Credit issue stays contained", down: "Credit stress broadens" },
  liquidity: { up: "Liquidity conditions ease", down: "Liquidity conditions tighten" },
  risk_appetite: { up: "Risk appetite recovers", down: "Risk-off extends" },
  regulation: { up: "Rule adopted with limited burden", down: "Rule tightens conditions for the affected sector" },
  capital_flows: { up: "Flows stabilise or measures are waived", down: "Outflows or restrictions intensify" },
};

export interface MappingLite {
  symbol: string;
  mechanism: string;
  direction: "up" | "down" | null;
  horizon: TimeHorizon;
  rationale: string;
  assumptions: string[];
  confidence: string;
}

export function normalizeWeights(w: number[]): number[] {
  const raw = w.map((x) => Math.max(0, x));
  const s = raw.reduce((a, x) => a + x, 0) || 1;
  const exact = raw.map((x) => (x / s) * 100);
  const floors = exact.map(Math.floor);
  let rem = 100 - floors.reduce((a, x) => a + x, 0);
  const order = exact.map((x, i) => [x - floors[i], i] as const).sort((a, z) => z[0] - a[0] || a[1] - z[1]);
  for (const [, i] of order) {
    if (rem <= 0) break;
    floors[i]++;
    rem--;
  }
  return floors;
}

export function computeWeights(input: {
  sentiment: string;
  classifierConfidence: number;
  composite: number;
  mechanisms: string[];
  conflicts: { kind: "factual" | "interpretive" }[];
}): { weights: [number, number, number, number]; steps: string[] } {
  const steps: string[] = [];
  let w = [50, 20, 20, 10];
  steps.push("W1 prior: base 50, upside 20, downside 20, tail 10 (convention).");
  const eff = conflictEffect(input.conflicts);
  const directional = input.classifierConfidence >= 0.5 && ["hawkish", "dovish", "risk_on", "risk_off"].includes(input.sentiment);
  if (directional && !eff.cancelTilt) {
    const toUp = input.sentiment === "dovish" || input.sentiment === "risk_on";
    w = toUp ? [w[0], w[1] + 10, w[2] - 10, w[3]] : [w[0], w[1] - 10, w[2] + 10, w[3]];
    steps.push(`W2 tilt: sentiment '${input.sentiment}' (confidence ${input.classifierConfidence.toFixed(2)}) → +10 ${toUp ? "upside" : "downside"}, −10 ${toUp ? "downside" : "upside"}.`);
  } else if (directional && eff.cancelTilt) {
    steps.push("W2 tilt cancelled: an interpretive conflict disputes the direction.");
  } else {
    steps.push(`W2 no tilt: sentiment '${input.sentiment}' is not directional or classifier confidence < 0.5.`);
  }
  const tailTrigger = input.composite >= 70 || ((input.mechanisms.includes("credit") || input.mechanisms.includes("liquidity")) && input.sentiment === "risk_off");
  if (tailTrigger) {
    w = [w[0] - 5, w[1], w[2], w[3] + 5];
    steps.push(input.composite >= 70 ? `W3 tail +5 from base: impact composite ${input.composite} >= 70.` : "W3 tail +5 from base: credit/liquidity channel with risk-off reading.");
  } else {
    steps.push("W3 no tail adjustment.");
  }
  for (let i = 0; i < eff.shrinkSteps; i++) w = w.map((x) => 0.75 * x + 0.25 * 25);
  if (eff.shrinkSteps) steps.push(`W4 conflicts: ${eff.shrinkSteps} shrink step(s) of 25% toward equal weights.`);
  else steps.push("W4 no open conflicts.");
  const n = normalizeWeights(w);
  steps.push(`W5 normalised: ${n.join(" / ")} (sum 100).`);
  return { weights: [n[0], n[1], n[2], n[3]], steps };
}

export function computeConfidence(input: {
  classifierConfidence: number;
  tier: number;
  corroboratedSources: number;
  conflicts: { kind: "factual" | "interpretive" }[];
  ageHours: number | null;
}): { confidence: number; steps: string[] } {
  const steps: string[] = [];
  let c = Math.round(Math.max(0, Math.min(1, input.classifierConfidence)) * 100);
  steps.push(`C1 start from classifier confidence: ${c}.`);
  const cap = ({ 1: 70, 2: 60, 3: 50, 4: 40 } as Record<number, number>)[input.tier] ?? 40;
  if (c > cap) {
    c = cap;
    steps.push(`C1 capped at ${cap} for source tier ${input.tier}.`);
  }
  const pen = conflictEffect(input.conflicts).confidencePenalty;
  if (pen) {
    c -= pen;
    steps.push(`C2 conflicts: −${pen}.`);
  }
  if (input.tier >= 3 && input.corroboratedSources < 2 && c > 40) {
    c = 40;
    steps.push("C3 single uncorroborated tier-3 source: capped at 40.");
  }
  if (input.ageHours != null && input.ageHours > 24 * 7) {
    c -= 10;
    steps.push("C4 older than 7 days: −10.");
  }
  c = Math.max(10, c);
  steps.push(`Final: ${c} (floor 10).`);
  return { confidence: c, steps };
}

function primaryMechanism(a: EventAssessment): MechanismId | null {
  const t = a.interpretation.mechanisms.filter((m) => m.basis === "text_match");
  if (!t.length) return null;
  return [...t].sort((x, y) => y.matched.length - x.matched.length)[0].id;
}

const uniq = (xs: string[], n = 8) => Array.from(new Set(xs.filter(Boolean))).slice(0, n);

export function buildScenarioSetV2(input: {
  event: FinancialEvent;
  assessment: EventAssessment;
  assessmentId: number | null;
  mappings: MappingLite[];
  nowIso: string;
}): Scenario | null {
  const { event: e, assessment: a, mappings } = input;
  if (!a.material) return null;
  const primary = primaryMechanism(a);
  if (!primary) return null;
  const textMechs = a.interpretation.mechanisms.filter((m) => m.basis === "text_match").map((m) => m.id);
  const defs = textMechs.map((id) => MECHANISM_BY_ID[id]);
  const pdef = MECHANISM_BY_ID[primary];
  const conflicts = a.conflicts;
  const { weights, steps } = computeWeights({
    sentiment: e.classification.sentiment,
    classifierConfidence: Number(e.classification.confidence),
    composite: Number(e.impactScore?.composite ?? 0),
    mechanisms: textMechs,
    conflicts,
  });
  const pub = a.observation.source.sourcePublishedAt ?? e.publishedAt;
  const ageH = Number.isFinite(Date.parse(pub)) ? (Date.parse(input.nowIso) - Date.parse(pub)) / 3600_000 : null;
  const distinct = a.observation.corroboration.distinctSources.length;
  const conf = computeConfidence({ classifierConfidence: Number(e.classification.confidence), tier: e.sourceTier, corroboratedSources: distinct, conflicts, ageHours: ageH });

  const dqReasons: string[] = [];
  let dq: ScenarioSetV2["dqStatus"] = "ok";
  if (conflicts.length) {
    dq = "conflicted";
    dqReasons.push(`${conflicts.length} open conflict(s) on this event.`);
  }
  if (ageH != null && ageH > 24 * 7) {
    if (dq === "ok") dq = "stale";
    dqReasons.push("Event older than 7 days.");
  }
  if (e.sourceTier >= 3 && distinct < 2) {
    if (dq === "ok") dq = "limited";
    dqReasons.push("Single uncorroborated tier-3 source.");
  }
  if (!mappings.length) {
    if (dq === "ok") dq = "limited";
    dqReasons.push("No tracked instrument has a documented mapping for this channel and region.");
  }
  if (!dqReasons.length) dqReasons.push("Live source, no conflicts, documented instrument mappings.");

  const symbols = uniq(mappings.map((m) => m.symbol), 12);
  const drivers = uniq([
    ...defs.map((d) => `${d.label} (${INTERPRETATION_LABEL}): ${d.channel}`),
    ...mappings.map((m) => `${m.symbol} via ${MECHANISM_BY_ID[m.mechanism as MechanismId]?.label ?? m.mechanism}: ${m.rationale}${m.direction ? ` [direction ${m.direction}, conditional]` : ""}`),
  ], 10);
  const evidence = uniq([...a.verified.slice(0, 3), ...a.supportingEvidence.filter((s) => s.kind !== "source_item").map((s) => s.text)], 8);
  const assumptions = uniq([...defs.flatMap((d) => d.assumptions), ...mappings.flatMap((m) => m.assumptions)], 6);
  const indicators = uniq(defs.flatMap((d) => d.indicators), 8);
  const mechLabels = defs.map((d) => d.label);
  const horizon: TimeHorizon = mappings.find((m) => m.mechanism === primary)?.horizon ?? e.timeHorizon;
  const name = NAMES[primary];
  const mk = (key: ScenarioV2["key"], nm: string, desc: string, w: number, c: number, inval: string[]): ScenarioV2 => ({
    key,
    name: nm,
    description: desc,
    weight: w,
    horizon,
    evidence,
    assumptions,
    drivers,
    instruments: symbols,
    impactMechanisms: mechLabels,
    indicatorsToMonitor: indicators,
    invalidationConditions: uniq(inval, 6),
    confidence: Math.max(10, c),
  });
  const scenarios: ScenarioV2[] = [
    mk("base", `${pdef.label}: limited repricing`, `The reported item is absorbed with limited, short-lived effect through the ${pdef.label.toLowerCase()} channel. ${INTERPRETATION_LABEL}.`, weights[0], conf.confidence, [
      "Mapped instruments move well beyond their usual daily range in either direction",
      ...a.interpretation.invalidation.slice(0, 2),
    ]),
    mk("upside", name.up, `A risk-positive reading of the ${pdef.label.toLowerCase()} channel prevails. ${INTERPRETATION_LABEL}.`, weights[1], conf.confidence - 5, [
      "Mapped instruments move in the risk-negative direction",
      ...defs.flatMap((d) => d.invalidation).slice(0, 3),
    ]),
    mk("downside", name.down, `A risk-negative reading of the ${pdef.label.toLowerCase()} channel prevails. ${INTERPRETATION_LABEL}.`, weights[2], conf.confidence - 5, [
      "Mapped instruments move in the risk-positive direction",
      ...defs.flatMap((d) => d.invalidation).slice(0, 3),
    ]),
    mk("tail", `Tail: disorderly ${pdef.label.toLowerCase()} shock`, "A low-weight, high-impact path where the channel transmits abruptly (disorderly repricing or contagion). Listed for completeness, not because evidence points to it.", weights[3], Math.min(conf.confidence, 30), [
      "Volatility (VIX) stays within its recent range",
      "No follow-on reports of stress in the same channel",
    ]),
  ];

  const inputHash = createHash("sha256")
    .update(JSON.stringify([SCENARIO_V2_VERSION, SCENARIO_RULES_VERSION, a.inputHash, mappings.map((m) => `${m.symbol}:${m.mechanism}:${m.direction}`).sort()]))
    .digest("hex")
    .slice(0, 32);

  const set: ScenarioSetV2 = {
    modelVersion: SCENARIO_V2_VERSION,
    eventId: e.id,
    scenarios,
    exhaustive: false,
    exhaustivenessNote: EXHAUSTIVENESS_NOTE,
    weightRule: WEIGHT_RULE,
    weightSteps: steps,
    conflicts,
    confidence: conf.confidence,
    confidenceSteps: conf.steps,
    dqStatus: dq,
    dqReasons,
    interpretationLabel: INTERPRETATION_LABEL,
    assessmentId: input.assessmentId,
    lastUpdate: input.nowIso,
    inputHash,
  };

  const toBranch = (s: ScenarioV2, name: ScenarioBranch["name"]): ScenarioBranch => ({
    name,
    probability: s.weight,
    confidence: s.confidence,
    narrative: `${s.name}. ${s.description}`,
    supportingEvidence: s.evidence,
    contradictingEvidence: a.interpretation.competingInterpretations.slice(0, 4),
    keyAssumptions: s.assumptions,
    invalidationConditions: s.invalidationConditions,
    affectedAssets: s.instruments,
  });

  return {
    id: `scn2-${e.id}`,
    eventId: e.id,
    assetSymbol: symbols[0],
    title: `${e.title.slice(0, 110)} — ${pdef.label} scenarios`,
    base: toBranch(scenarios[0], "base"),
    bull: toBranch(scenarios[1], "bull"),
    bear: toBranch(scenarios[2], "bear"),
    tail: toBranch(scenarios[3], "tail"),
    timeHorizon: horizon,
    affectedAssets: symbols,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
    label: "estimate",
    schemaVersion: 2,
    v2: set,
  };
}
