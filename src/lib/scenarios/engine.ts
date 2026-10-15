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

/** Largest-remainder rounding so weights always sum to exactly 100. */
function normalizeProbs(b: number, bull: number, bear: number, tail: number) {
  const raw = [b, bull, bear, tail].map((x) => Math.max(0.01, x));
  const s = raw.reduce((a, x) => a + x, 0);
  const exact = raw.map((x) => (x / s) * 100);
  const floors = exact.map(Math.floor);
  let rem = 100 - floors.reduce((a, x) => a + x, 0);
  const order = exact.map((x, i) => [x - floors[i], i] as const).sort((a, z) => z[0] - a[0]);
  for (const [, i] of order) {
    if (rem <= 0) break;
    floors[i]++;
    rem--;
  }
  return { b: floors[0], bull: floors[1], bear: floors[2], tail: floors[3] };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);

/** Higher-convexity assets widen the tail branch (MODEL ASSUMPTION, not measured). */
const ASSET_TAIL_BETA: Record<string, number> = {
  VIX: 1.0, BTC: 1.0, OIL: 0.7, USDJPY: 0.5, NKY: 0.4, IXIC: 0.4, NDX: 0.4,
  GOLD: 0.2, SPX: 0.2, SX5E: 0.25, DAX: 0.25, DXY: 0.1, EURUSD: 0.1, US10Y: 0.15,
};

/** Event types whose historical analogues skew towards nonlinear outcomes (curated prior). */
const EVENT_TYPE_TAIL: Partial<Record<string, number>> = {
  geopolitics: 4, sanction: 3, credit: 4, liquidity: 4, commodity_supply: 2,
  fx_regime: 3, monetary_policy: 1, earnings: -1, labor: -1, growth: 0, inflation: 1,
};

/**
 * Scenario weight MODEL ESTIMATE (scenario_weights_v2).
 *
 * Inputs actually present on the event — never market prices:
 *  - sentiment (direction prior)
 *  - expected_impact[] bullish/bearish vote count (direction tilt)
 *  - impactScore.composite / magnitude / persistence (how far mass leaves Base)
 *  - classification.confidence, source tier, data quality (how sharp the tilt is)
 *  - event_type + inferred asset mix (tail width)
 * Weights are differentiated heuristic estimates, documented on /methodology.
 */
export function estimateScenarioWeights(event: FinancialEvent, assets: string[]) {
  const c = event.classification;
  const imp = event.impactScore || ({} as FinancialEvent["impactScore"]);
  const composite = clamp(num(imp.composite, 50), 0, 100) / 100;
  const magnitude = clamp(num(imp.magnitude, 50), 0, 100) / 100;
  const persistence = clamp(num(imp.persistence, 50), 0, 100) / 100;
  const clsConf = clamp(num(c.confidence, 0.5), 0, 1);
  const tierW = ({ 1: 1, 2: 0.85, 3: 0.65, 4: 0.5 } as Record<number, number>)[Number(event.sourceTier)] ?? 0.6;
  const qualW = event.quality === "demo" ? 0.5 : event.quality === "live" ? 1 : 0.8;
  const evidence = clsConf * tierW * qualW; // 0..1 sharpness

  // Direction in [-1, 1]: + = benign (upside), - = adverse (downside)
  const sentDir: Record<string, number> = {
    hawkish: -0.45, dovish: 0.45, risk_off: -0.7, risk_on: 0.6, neutral: 0, mixed: 0,
  };
  let dir = sentDir[c.sentiment] ?? 0;
  const votes = c.expected_impact || [];
  if (votes.length) {
    const bull = votes.filter((v) => v.direction === "bullish").length;
    const bear = votes.filter((v) => v.direction === "bearish").length;
    dir = 0.6 * dir + 0.4 * ((bull - bear) / votes.length);
  }
  dir = clamp(dir, -1, 1);

  // Mass leaving Base grows with impact; low-evidence events stay closer to Base.
  const offBase = clamp(0.3 + 0.35 * composite + 0.1 * magnitude, 0.3, 0.75);
  const base = 1 - offBase;

  const tailBeta = assets.length
    ? assets.reduce((a, s) => a + (ASSET_TAIL_BETA[s] ?? 0.2), 0) / assets.length
    : 0.2;
  let tail =
    0.04 + 0.08 * magnitude + 0.04 * persistence + 0.05 * tailBeta +
    (EVENT_TYPE_TAIL[c.event_type || "other"] ?? 0) / 100 +
    (c.sentiment === "risk_off" ? 0.03 : 0);
  tail = clamp(tail, 0.03, Math.min(0.25, offBase - 0.1));

  const split = offBase - tail;
  const tilt = dir * (0.35 + 0.55 * evidence); // evidence sharpens the tilt
  const upShare = clamp(0.5 + tilt / 2, 0.12, 0.88);
  const bull = split * upShare;
  const bear = split * (1 - upShare);

  const p = normalizeProbs(base, bull, bear, tail);
  const rationale = [
    `Weights are a MODEL ESTIMATE (scenario_weights_v2), not market-implied probabilities.`,
    `Direction ${dir >= 0 ? "+" : ""}${dir.toFixed(2)} from sentiment=${c.sentiment}${votes.length ? ` and ${votes.length} asset-class impact votes` : ""}.`,
    `Impact composite ${Math.round(composite * 100)} moves ${Math.round(offBase * 100)}% of weight off Base.`,
    `Evidence sharpness ${evidence.toFixed(2)} (classifier conf ${clsConf.toFixed(2)} × tier ${event.sourceTier} × quality ${event.quality}).`,
    `Tail width from magnitude, persistence, event type (${c.event_type || "other"}) and asset convexity (${assets.join(", ")}).`,
  ];
  return { p, evidence, rationale };
}

export function generateScenarioFromEvent(event: FinancialEvent): Scenario {
  const assets = inferAssets(event);
  const { p, rationale } = estimateScenarioWeights(event, assets);

  const conf = Math.round(event.classification.confidence * 70);
  const chainStr =
    event.classification.transmission_chain?.map((s) => s.node).join(" → ") ||
    event.causalChain.join(" → ");
  const support = [
    `OBSERVED: "${event.title}" (${event.sourceName}, tier ${event.sourceTier}, quality=${event.quality})`,
    `Classification: event_type=${event.classification.event_type || event.classification.categories[0]} (${event.classification.classifier_version || event.classification.method})`,
    `Transmission chain: ${chainStr}`,
  ];
  const assumptionsWeights = rationale;
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
    ...assumptionsWeights,
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
      Nasdaq: "NDX",
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

function findScenarioByEventId(eventId: string): Scenario | null {
  const row = getDb()
    .prepare(
      `SELECT data FROM scenarios WHERE json_extract(data, '$.eventId') = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(eventId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Scenario) : null;
}

/** Rebuild/refresh scenarios for recent events.
 *  Upserts by eventId: reuses the existing scenario row (stable id) when one
 *  already exists for that event, so repeated derive/refresh ticks do not
 *  append unbounded duplicate rows. */
export function rebuildScenariosFromEvents(limit = 12): Scenario[] {
  const events = getEvents(limit);
  getDb();
  const scenarios: Scenario[] = [];
  const now = new Date().toISOString();
  for (const event of events) {
    const fresh = generateScenarioFromEvent(event);
    const existing = findScenarioByEventId(event.id);
    if (existing) {
      fresh.id = existing.id;
      fresh.createdAt = existing.createdAt;
      fresh.updatedAt = now;
    }
    upsertJson("scenarios", "id", fresh.id, fresh, { created_at: fresh.createdAt });
    scenarios.push(fresh);
  }
  return scenarios;
}

export function getScenarios(limit?: number): Scenario[] {
  if (limit == null) {
    return getJsonAll<Scenario>("scenarios", "created_at DESC");
  }
  // Optional cap matches getScenarios().slice(0, n) (created_at DESC).
  const n = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const rows = getDb()
    .prepare(`SELECT data FROM scenarios ORDER BY created_at DESC LIMIT ?`)
    .all(n) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Scenario);
}

export function getScenario(id: string): Scenario | null {
  return getScenarios().find((s) => s.id === id) ?? null;
}

export function ensureScenarios() {
  // Existence check only — do not parse the full scenarios table on every page view.
  const row = getDb().prepare(`SELECT 1 AS ok FROM scenarios LIMIT 1`).get();
  if (!row) rebuildScenariosFromEvents();
}
