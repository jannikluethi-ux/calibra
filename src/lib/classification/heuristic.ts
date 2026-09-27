/**
 * Classification facade.
 * New ingest uses heuristic_v2 (classify_v2).
 * v1 helpers retained for backward compatibility / audit diffs.
 */

import type { EventClassification, TimeHorizon, ImpactScore } from "../types";
import { horizonFromKeywords, scoreImpact } from "../scoring/impact";
import { classifyEventV2 } from "./classify_v2";

export { classifyEventV2, reclassifyEventV2 } from "./classify_v2";

const CATEGORY_PATTERNS: { cat: string; re: RegExp }[] = [
  { cat: "central_bank", re: /\b(fed|fomc|ecb|boj|boe|snb|rba|pboc|central bank|rate decision|interest rate|powell|lagarde|ueda)\b/i },
  { cat: "inflation", re: /\b(inflation|cpi|ppi|pce|core inflation|deflation|price pressure)\b/i },
  { cat: "growth", re: /\b(gdp|recession|growth|unemployment|payrolls|nfp|pmi|ism|retail sales)\b/i },
  { cat: "geopolitics", re: /\b(war|sanction|geopolitic|conflict|taiwan|ukraine|middle east|nato|tariff|trade war)\b/i },
  { cat: "credit", re: /\b(credit|default|spread|cds|downgrade|bank failure|liquidity crunch)\b/i },
  { cat: "fx", re: /\b(yen|dollar|euro|fx|currency|intervention|carry trade)\b/i },
  { cat: "crypto", re: /\b(bitcoin|btc|ethereum|eth|crypto|stablecoin|etf)\b/i },
  { cat: "energy", re: /\b(oil|opec|natural gas|brent|wti|energy)\b/i },
  { cat: "equities", re: /\b(equity|stock|s&p|nasdaq|earnings|ipo|buyback)\b/i },
  { cat: "fiscal", re: /\b(fiscal|budget|deficit|debt ceiling|treasury|stimulus|tax)\b/i },
];

const ENTITY_PATTERNS: { entity: string; re: RegExp }[] = [
  { entity: "Fed", re: /\b(fed|fomc|federal reserve|powell)\b/i },
  { entity: "ECB", re: /\b(ecb|lagarde|eurozone)\b/i },
  { entity: "BOJ", re: /\b(boj|bank of japan|ueda)\b/i },
  { entity: "BOE", re: /\b(boe|bank of england)\b/i },
  { entity: "IMF", re: /\b(imf|international monetary)\b/i },
  { entity: "OPEC", re: /\b(opec)\b/i },
  { entity: "China", re: /\b(china|pboc|beijing)\b/i },
  { entity: "Japan", re: /\b(japan|tokyo|yen)\b/i },
  { entity: "US", re: /\b(u\.?s\.?|united states|washington|treasury)\b/i },
  { entity: "Eurozone", re: /\b(eurozone|euro area|germany|france)\b/i },
  { entity: "Bitcoin", re: /\b(bitcoin|btc)\b/i },
];

const CHAIN_TEMPLATES: Record<string, string[]> = {
  central_bank: ["CB decision", "policy rates", "real rates", "FX", "liquidity", "risk assets", "bonds"],
  inflation: ["inflation print", "real rates", "CB reaction function", "yields", "duration", "equities", "gold"],
  growth: ["growth data", "earnings expectations", "equity beta", "credit", "cyclicals"],
  geopolitics: ["geopolitical shock", "risk premium", "safe havens", "energy", "FX", "equities"],
  credit: ["credit stress", "funding", "bank equities", "spreads", "risk-off", "vol"],
  fx: ["FX move", "carry unwind", "cross-asset liquidity", "EM", "equities", "crypto"],
  crypto: ["crypto event", "risk appetite", "liquidity", "correlated risk assets"],
  energy: ["energy price", "inflation impulse", "terms of trade", "FX", "equities", "rates"],
  equities: ["equity move", "wealth effect", "sentiment", "vol", "credit"],
  fiscal: ["fiscal impulse", "issuance", "term premium", "yields", "FX", "equities"],
};

/** @deprecated Prefer classifyEventV2 — retained for audit diffs */
export function classifyText(title: string, body: string): EventClassification {
  const text = `${title} ${body}`;
  const categories = CATEGORY_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.cat);
  const entities = ENTITY_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.entity);

  let sentiment: EventClassification["sentiment"] = "neutral";
  if (/\b(hawkish|hike|tighten|higher for longer|restrictive)\b/i.test(text)) sentiment = "hawkish";
  else if (/\b(dovish|cut|ease|accommodative|pivot)\b/i.test(text)) sentiment = "dovish";
  else if (/\b(risk-off|selloff|flight to safety|panic|crash)\b/i.test(text)) sentiment = "risk_off";
  else if (/\b(risk-on|rally|melt-up|euphoria)\b/i.test(text)) sentiment = "risk_on";
  else if (categories.length > 2) sentiment = "mixed";

  const confidence = Math.min(0.95, 0.35 + categories.length * 0.12 + entities.length * 0.08);

  return {
    categories: categories.length ? categories : ["general"],
    entities,
    sentiment,
    confidence: Math.round(confidence * 100) / 100,
    method: "heuristic_v1",
    classifier_version: "heuristic_v1",
  };
}

/** @deprecated Prefer classifyEventV2 */
export function buildCausalChain(
  classification: EventClassification,
  title: string
): { chain: string[]; explanation: string } {
  const primary = classification.categories[0] ?? "general";
  const template = CHAIN_TEMPLATES[primary] ?? ["event", "sentiment", "risk assets", "vol"];
  const countryHint =
    classification.entities.find((e) => ["Japan", "US", "China", "Eurozone"].includes(e)) ??
    classification.entities[0];

  const chain = countryHint ? [countryHint, ...template] : template;

  const explanation = [
    `INTERPRETATION (heuristic_v1): Primary category="${primary}", sentiment="${classification.sentiment}".`,
    `Propagation sketch: ${chain.join(" → ")}.`,
    `This is a stylized transmission map, not a prediction. Correlations and channels are regime-dependent.`,
    `Title cue: "${title.slice(0, 120)}"`,
  ].join(" ");

  return { chain, explanation };
}

/** @deprecated Prefer classifyEventV2 */
export function estimateImpactFromText(
  title: string,
  body: string,
  sourceTier: 1 | 2 | 3 | 4,
  classification: EventClassification
): { impact: ImpactScore; horizon: TimeHorizon } {
  const text = `${title} ${body}`;
  const tierBoost = { 1: 25, 2: 15, 3: 8, 4: 0 }[sourceTier];
  const catBoost = classification.categories.length * 8;
  const mag =
    30 +
    tierBoost +
    catBoost +
    (/\b(emergency|crisis|shock|unprecedented|war)\b/i.test(text) ? 25 : 0);
  const speed =
    classification.categories.includes("fx") || classification.categories.includes("crypto")
      ? 75
      : classification.categories.includes("central_bank")
        ? 65
        : 45;
  const persistence = classification.categories.includes("geopolitics")
    ? 70
    : classification.categories.includes("inflation")
      ? 60
      : 40;

  return {
    impact: scoreImpact({
      magnitude: mag,
      probability: 40 + classification.confidence * 40,
      marketSensitivity: 35 + catBoost + tierBoost / 2,
      transmissionSpeed: speed,
      persistence,
      confidence: classification.confidence * 100,
    }),
    horizon: horizonFromKeywords(text),
  };
}

export function detectCountry(text: string): { country?: string; region?: string } {
  const map: { re: RegExp; country: string; region: string }[] = [
    { re: /\b(united states|u\.?s\.?|america|washington|fed)\b/i, country: "US", region: "North America" },
    { re: /\b(japan|tokyo|boj|yen)\b/i, country: "JP", region: "Asia" },
    { re: /\b(china|beijing|pboc|yuan)\b/i, country: "CN", region: "Asia" },
    { re: /\b(germany|berlin|bund)\b/i, country: "DE", region: "Europe" },
    { re: /\b(eurozone|ecb|euro area)\b/i, country: "EU", region: "Europe" },
    { re: /\b(united kingdom|uk|boe|sterling)\b/i, country: "GB", region: "Europe" },
    { re: /\b(switzerland|snb|swiss)\b/i, country: "CH", region: "Europe" },
    { re: /\b(india|rbi|mumbai)\b/i, country: "IN", region: "Asia" },
    { re: /\b(brazil|bcb|brasil)\b/i, country: "BR", region: "LatAm" },
  ];
  for (const m of map) {
    if (m.re.test(text)) return { country: m.country, region: m.region };
  }
  return {};
}

/** Convenience: run v2 and return the shape previously built by v1 helpers */
export function classifyAndEnrich(
  title: string,
  body: string,
  sourceTier: 1 | 2 | 3 | 4,
  sourceName: string,
  quality?: string
) {
  return classifyEventV2({ title, body, sourceTier, sourceName, quality });
}
