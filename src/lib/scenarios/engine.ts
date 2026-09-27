import { randomUUID } from "crypto";
import type { FinancialEvent, Scenario, ScenarioBranch } from "../types";
import { getDb, upsertJson, getJsonAll } from "../db";
import { getEvents } from "../ingestion/rss";

function branch(
  name: ScenarioBranch["name"],
  probability: number,
  confidence: number,
  narrative: string,
  support: string[],
  contradict: string[],
  assumptions: string[],
  invalidation: string[],
  assets: string[]
): ScenarioBranch {
  return {
    name,
    probability,
    confidence,
    narrative,
    supportingEvidence: support,
    contradictingEvidence: contradict,
    keyAssumptions: assumptions,
    invalidationConditions: invalidation,
    affectedAssets: assets,
  };
}

function normalizeProbs(b: number, bull: number, bear: number, tail: number) {
  const s = b + bull + bear + tail;
  if (s <= 0) return { b: 45, bull: 20, bear: 25, tail: 10 };
  return {
    b: Math.round((b / s) * 100),
    bull: Math.round((bull / s) * 100),
    bear: Math.round((bear / s) * 100),
    tail: Math.round((tail / s) * 100),
  };
}

export function generateScenarioFromEvent(event: FinancialEvent): Scenario {
  const assets = inferAssets(event);
  const sent = event.classification.sentiment;
  const baseP = 45;
  let bullP = 20;
  let bearP = 25;
  let tailP = 10;
  if (sent === "hawkish") {
    bearP = 30;
    bullP = 15;
  } else if (sent === "dovish") {
    bullP = 28;
    bearP = 20;
  } else if (sent === "risk_off") {
    bearP = 35;
    tailP = 15;
    bullP = 12;
  } else if (sent === "risk_on") {
    bullP = 32;
    bearP = 18;
  }

  const conf = Math.round(event.classification.confidence * 70);
  const p = normalizeProbs(baseP, bullP, bearP, tailP);
  const chainStr =
    event.classification.transmission_chain?.map((s) => s.node).join(" → ") ||
    event.causalChain.join(" → ");
  const support = [
    `OBSERVED: "${event.title}" (${event.sourceName}, tier ${event.sourceTier}, quality=${event.quality})`,
    `Classification: event_type=${event.classification.event_type || event.classification.categories[0]} (${event.classification.classifier_version || event.classification.method})`,
    `Transmission chain: ${chainStr}`,
  ];
  const contradict = [
    ...(event.classification.contradicting_evidence?.slice(0, 4) || [
      "Single-headline risk: subsequent data or guidance may reverse the narrative.",
      "Cross-asset confirmation not yet fully observed in this estimate.",
    ]),
  ];
  if (event.quality === "demo") {
    contradict.unshift("This event is a DEMO/ILLUSTRATIVE sample — not a live fact.");
  }

  const assumptions = [
    ...(event.classification.key_assumptions?.slice(0, 3) || [
      "MODEL ASSUMPTION: Historical transmission channels remain partially intact.",
      "MODEL ASSUMPTION: No simultaneous orthogonal shock dominates the horizon.",
    ]),
    `Time horizon locked to ${event.timeHorizon} — do not mix horizons.`,
  ];

  const invalidation = [
    "Official revision or clarification that removes the catalyst.",
    "Market prices a contradictory path with high conviction for >2 sessions.",
    "New higher-tier source (tier 1) contradicts the current interpretation.",
  ];

  return {
    id: randomUUID(),
    eventId: event.id,
    title: `Scenario set: ${event.title.slice(0, 100)}`,
    base: branch(
      "base",
      p.b,
      conf,
      `SCENARIO ESTIMATE — Base: Markets partially digest the event along the dominant transmission path (${chainStr}). Moderate cross-asset adjustment without regime break. ${event.classification.transmission_narrative ? "Narrative cue: " + event.classification.transmission_narrative.slice(0, 180) : ""}`,
      support,
      contradict,
      assumptions,
      invalidation,
      assets
    ),
    bull: branch(
      "bull",
      p.bull,
      Math.max(20, conf - 15),
      `SCENARIO ESTIMATE — Bull: Benign interpretation dominates; liquidity/risk appetite improves; adverse channels muted.`,
      [...support, "Interpretation: softer financial conditions relative to base."],
      [...contradict, "Risk-off confirmation would undermine this branch."],
      assumptions,
      [...invalidation, "Vol spike + credit widening simultaneous with equity drawdown."],
      assets
    ),
    bear: branch(
      "bear",
      p.bear,
      Math.max(20, conf - 10),
      `SCENARIO ESTIMATE — Bear: Adverse transmission amplifies (funding, FX, or growth scare). Correlation to 1 rises temporarily.`,
      [...support, "Interpretation: tighter financial conditions / higher risk premium."],
      [...contradict, "Quick official dovish/offsetting response would weaken this branch."],
      assumptions,
      [...invalidation, "Clear risk-on breadth across equities, credit, and crypto."],
      assets
    ),
    tail: branch(
      "tail",
      p.tail,
      Math.max(15, conf - 25),
      `SCENARIO ESTIMATE — Tail: Nonlinear amplification (liquidity air-pocket, policy error, or geopolitical escalation). Low probability, high impact — NOT a base-case forecast.`,
      [...support, "Historical analogy: prior stress episodes with similar channel structure (curated, illustrative)."],
      ["Most analogous historical episodes did NOT produce full tail outcomes."],
      [...assumptions, "MODEL ASSUMPTION: Tail requires secondary amplification not yet observed."],
      [...invalidation, "Stable funding markets and contained vol term-structure."],
      assets
    ),
    timeHorizon: event.timeHorizon,
    affectedAssets: assets,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    label: "estimate",
  };
}

function inferAssets(event: FinancialEvent): string[] {
  const assets = new Set<string>();
  const se = event.classification.structuredEntities;
  const instruments = se?.instruments || [];
  for (const inst of instruments) {
    const m: Record<string, string> = {
      "S&P 500": "SPX",
      Nasdaq: "IXIC",
      Nikkei: "NKY",
      "US 10Y": "US10Y",
      "USD/JPY": "USDJPY",
      "EUR/USD": "EURUSD",
      Bitcoin: "BTC",
      Gold: "GOLD",
      Brent: "OIL",
      WTI: "OIL",
      VIX: "VIX",
    };
    if (m[inst]) assets.add(m[inst]);
  }
  for (const ac of event.classification.expected_impact || []) {
    if (ac.assetClass === "Equities") assets.add("SPX");
    if (ac.assetClass === "Rates") assets.add("US10Y");
    if (ac.assetClass === "FX") assets.add("DXY");
    if (ac.assetClass === "Crypto") assets.add("BTC");
    if (ac.assetClass === "Commodities") assets.add("OIL");
    if (ac.assetClass === "Vol") assets.add("VIX");
    if (ac.assetClass === "Credit") assets.add("VIX");
  }
  const t = `${event.title} ${event.tags.join(" ")} ${event.classification.categories.join(" ")} ${event.classification.event_type || ""}`.toLowerCase();
  if (/fed|us|usd|s&p|nasdaq/.test(t)) {
    assets.add("SPX");
    assets.add("US10Y");
    assets.add("DXY");
  }
  if (/ecb|euro|germany|dax/.test(t)) {
    assets.add("SX5E");
    assets.add("DAX");
    assets.add("EURUSD");
  }
  if (/boj|japan|yen|nikkei/.test(t)) {
    assets.add("NKY");
    assets.add("USDJPY");
  }
  if (/oil|energy|opec/.test(t)) assets.add("OIL");
  if (/bitcoin|crypto|btc/.test(t)) assets.add("BTC");
  if (/gold|inflation|geopolitic/.test(t)) assets.add("GOLD");
  if (/vol|vix|risk/.test(t)) assets.add("VIX");
  if (assets.size === 0) {
    assets.add("SPX");
    assets.add("VIX");
    assets.add("US10Y");
  }
  return Array.from(assets);
}

export function rebuildScenariosFromEvents(limit = 12): Scenario[] {
  const events = getEvents(limit);
  const scenarios = events.map(generateScenarioFromEvent);
  getDb();
  for (const s of scenarios) {
    upsertJson("scenarios", "id", s.id, s, { created_at: s.createdAt });
  }
  return scenarios;
}

export function getScenarios(): Scenario[] {
  return getJsonAll<Scenario>("scenarios", "created_at DESC");
}

export function getScenario(id: string): Scenario | null {
  return getScenarios().find((s) => s.id === id) ?? null;
}

export function ensureScenarios() {
  if (getScenarios().length === 0) rebuildScenariosFromEvents();
}
