/**
 * heuristic_v2 — deterministic + structured event classifier.
 * Rule/graph based. Does NOT invent facts, quotes, or URLs.
 * Separates Observed → Interpretation → Model assumption → Scenario estimate.
 */

import type {
  EventClassification,
  EventType,
  ExpectedImpactByAsset,
  FinancialEvent,
  ImpactDirection,
  ImpactScore,
  SourceTier,
  StructuredEntities,
  TimeHorizon,
  TransmissionChainStep,
} from "../types";
import {
  opposingForcesFromGraph,
  shockTagsToNodeIds,
  walkTransmission,
  GRAPH_VERSION,
} from "../causal/graph";
import { scoreImpactTransparent, horizonFromKeywords } from "../scoring/impact";

const EVENT_TYPE_PATTERNS: { type: EventType; re: RegExp; weight: number }[] = [
  { type: "monetary_policy", re: /\b(fed|fomc|ecb|boj|boe|snb|rba|pboc|central bank|rate decision|interest rate|policy rate|ycc|qt\b|qe\b|powell|lagarde|ueda|bailey)\b/i, weight: 3 },
  { type: "inflation", re: /\b(inflation|cpi|ppi|pce|core inflation|deflation|price pressure|hICP|flash cpi)\b/i, weight: 3 },
  { type: "labor", re: /\b(unemployment|payrolls|nfp|nonfarm|jobless|wages?|labor market|labour market|employment)\b/i, weight: 3 },
  { type: "growth", re: /\b(gdp|recession|growth|pmi|ism|retail sales|industrial production|soft landing)\b/i, weight: 2 },
  { type: "fiscal", re: /\b(fiscal|budget|deficit|debt ceiling|treasury auction|stimulus|tax cut|issuance|gilt)\b/i, weight: 2 },
  { type: "geopolitics", re: /\b(war|geopolitic|conflict|taiwan|ukraine|middle east|nato|missile|invasion|ceasefire)\b/i, weight: 3 },
  { type: "sanction", re: /\b(sanction|embargo|export control|sdn|secondary sanction)\b/i, weight: 3 },
  { type: "regulation", re: /\b(regulat(?:ion|ory)|sec\b|cftc|antitrust|basel|mifid|crypto bill|etf approval)\b/i, weight: 2 },
  { type: "earnings", re: /\b(earnings|eps|guidance|buyback|revenue beat|profit warning)\b/i, weight: 2 },
  { type: "credit", re: /\b(credit|default|spread|cds|downgrade|bank failure|liquidity crunch|funding stress|o\.?a\.?s)\b/i, weight: 3 },
  { type: "commodity_supply", re: /\b(oil|opec|brent|wti|natural gas|crude|supply cut|pipeline|energy shock)\b/i, weight: 2 },
  { type: "fx_regime", re: /\b(yen|dollar|euro|fx\b|currency|intervention|carry trade|usd\/jpy|eur\/usd|dxy)\b/i, weight: 2 },
  { type: "liquidity", re: /\b(liquidity|funding|repo|reserve drain|tga|rrP|money market stress)\b/i, weight: 2 },
];

const INSTITUTION_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "Fed", re: /\b(fed|fomc|federal reserve|powell)\b/i },
  { name: "ECB", re: /\b(ecb|lagarde|eurozone central)\b/i },
  { name: "BOJ", re: /\b(boj|bank of japan|ueda)\b/i },
  { name: "BOE", re: /\b(boe|bank of england|bailey)\b/i },
  { name: "SNB", re: /\b(snb|swiss national)\b/i },
  { name: "PBOC", re: /\b(pboc|people'?s bank of china)\b/i },
  { name: "IMF", re: /\b(imf|international monetary)\b/i },
  { name: "OPEC", re: /\b(opec\+?)\b/i },
  { name: "Treasury", re: /\b(u\.?s\.? treasury|treasury department)\b/i },
  { name: "SEC", re: /\b(\bsec\b|securities and exchange)\b/i },
];

const COUNTRY_PATTERNS: { country: string; region: string; code: string; re: RegExp }[] = [
  { country: "United States", region: "North America", code: "US", re: /\b(united states|u\.?s\.?a?\.?|america|washington|fed|fomc)\b/i },
  { country: "Japan", region: "Asia", code: "JP", re: /\b(japan|tokyo|boj|yen|nikkei)\b/i },
  { country: "China", region: "Asia", code: "CN", re: /\b(china|beijing|pboc|yuan|renminbi)\b/i },
  { country: "Eurozone", region: "Europe", code: "EU", re: /\b(eurozone|euro area|ecb)\b/i },
  { country: "Germany", region: "Europe", code: "DE", re: /\b(germany|berlin|bund|dax)\b/i },
  { country: "United Kingdom", region: "Europe", code: "GB", re: /\b(united kingdom|\buk\b|boe|sterling|gilt)\b/i },
  { country: "Switzerland", region: "Europe", code: "CH", re: /\b(switzerland|snb|swiss)\b/i },
  { country: "India", region: "Asia", code: "IN", re: /\b(india|rbi|mumbai)\b/i },
  { country: "Brazil", region: "LatAm", code: "BR", re: /\b(brazil|bcb|brasil)\b/i },
];

const SECTOR_PATTERNS: { sector: string; re: RegExp }[] = [
  { sector: "Energy", re: /\b(oil|energy|opec|gas|refiner)\b/i },
  { sector: "Financials", re: /\b(bank|financials|lender|insurance)\b/i },
  { sector: "Technology", re: /\b(tech|semiconductor|software|ai\b|nasdaq)\b/i },
  { sector: "Rates", re: /\b(rates|bonds?|yields?|duration|treasur)\b/i },
  { sector: "FX", re: /\b(fx|currency|yen|dollar|euro|sterling)\b/i },
  { sector: "Crypto", re: /\b(bitcoin|crypto|ethereum|stablecoin)\b/i },
  { sector: "Commodities", re: /\b(gold|copper|commodity|wheat|brent|wti)\b/i },
  { sector: "Real Estate", re: /\b(property|real estate|housing|mortgage|reit)\b/i },
];

const ASSET_CLASS_PATTERNS: { ac: string; re: RegExp }[] = [
  { ac: "Equities", re: /\b(equity|equities|stock|s&p|nasdaq|nikkei|dax)\b/i },
  { ac: "Rates", re: /\b(bond|yield|treasury|bund|jgb|duration|rates)\b/i },
  { ac: "FX", re: /\b(fx|currency|yen|dollar|euro|dxy|usd\/)\b/i },
  { ac: "Credit", re: /\b(credit|cds|spread|hyg|ig\b)\b/i },
  { ac: "Commodities", re: /\b(oil|gold|copper|commodity|brent|wti)\b/i },
  { ac: "Crypto", re: /\b(bitcoin|btc|ethereum|eth|crypto)\b/i },
  { ac: "Vol", re: /\b(vix|volatility|implied vol)\b/i },
];

const INSTRUMENT_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "S&P 500", re: /\b(s&p\s*500|spx|spy)\b/i },
  { name: "Nasdaq", re: /\b(nasdaq|qqq|ndx)\b/i },
  { name: "Nikkei", re: /\b(nikkei|nky)\b/i },
  { name: "US 10Y", re: /\b(us\s*10[\s-]*y|10[\s-]*year treasury|ust 10)\b/i },
  { name: "USD/JPY", re: /\b(usd\/jpy|dollar[\s-]yen|usdjpy)\b/i },
  { name: "EUR/USD", re: /\b(eur\/usd|euro[\s-]dollar|eurusd)\b/i },
  { name: "Bitcoin", re: /\b(bitcoin|\bbtc\b)\b/i },
  { name: "Gold", re: /\b(\bgold\b|xau)\b/i },
  { name: "Brent", re: /\b(brent)\b/i },
  { name: "WTI", re: /\b(\bwti\b|west texas)\b/i },
  { name: "VIX", re: /\b(\bvix\b)\b/i },
];

const TEXT_CONTRADICTION_CUES: { re: RegExp; note: string }[] = [
  { re: /\b(however|but|despite|although|offset|counter|mixed|uncertain|unclear)\b/i, note: "Source text contains hedging/contrast cues (however/despite/mixed)." },
  { re: /\b(below consensus|miss|weaker than|cooler than|soft(?:er)? than expected)\b/i, note: "Softer-than-expected cue may weaken hawkish / risk-off interpretations." },
  { re: /\b(above consensus|hotter|stronger than|firmer than expected|upside surprise)\b/i, note: "Hotter/stronger cue may weaken dovish / risk-on interpretations." },
  { re: /\b(transitory|look through|one[- ]off|base effect)\b/i, note: "Transitory/look-through language weakens persistent-inflation narratives." },
  { re: /\b(reaffirm|unchanged|as expected|in line|priced in)\b/i, note: "In-line / priced-in cues reduce marginal market sensitivity." },
];

export interface ClassifyV2Input {
  title: string;
  body: string;
  sourceTier: SourceTier;
  sourceName: string;
  quality?: string;
}

export interface ClassifyV2Result {
  classification: EventClassification;
  causalChain: string[];
  transmissionMechanism: string;
  expectedImpact: string;
  timeHorizon: TimeHorizon;
  impactScore: ImpactScore;
  country?: string;
  region?: string;
  sector?: string;
  assetClass?: string;
  tags: string[];
  evidenceLayers: NonNullable<FinancialEvent["evidenceLayers"]>;
}

function detectEventTypes(title: string, body: string): { primary: EventType; all: EventType[]; scores: Record<string, number> } {
  const scores: Record<string, number> = {};
  for (const p of EVENT_TYPE_PATTERNS) {
    if (p.re.test(title)) scores[p.type] = (scores[p.type] || 0) + p.weight * 2; // title dominates
    else if (p.re.test(body)) scores[p.type] = (scores[p.type] || 0) + p.weight;
  }
  // Specificity boosts: oil/supply headlines should not lose to generic "inflation" mentions in body
  if (/\b(oil|brent|wti|opec|crude)\b/i.test(title)) {
    scores["commodity_supply"] = (scores["commodity_supply"] || 0) + 5;
  }
  if (/\b(war|sanction|ceasefire|missile|invasion|attack)\b/i.test(title)) {
    scores["geopolitics"] = (scores["geopolitics"] || 0) + 5;
  } else if (/\b(middle east|ukraine|taiwan)\b/i.test(title) && !/\b(oil|brent|wti|crude)\b/i.test(title)) {
    scores["geopolitics"] = (scores["geopolitics"] || 0) + 3;
  } else if (/\b(middle east|ukraine|taiwan)\b/i.test(title)) {
    scores["geopolitics"] = (scores["geopolitics"] || 0) + 2; // oil+region: geo is context, supply is primary
  }
  if (/\b(fed|fomc|ecb|boj|boe|rate decision|holds rates|hikes?|cuts?)\b/i.test(title)) {
    scores["monetary_policy"] = (scores["monetary_policy"] || 0) + 4;
  }
  const PRIORITY: EventType[] = [
    "sanction",
    "monetary_policy",
    "commodity_supply",
    "fx_regime",
    "geopolitics",
    "credit",
    "labor",
    "inflation",
    "fiscal",
    "liquidity",
    "earnings",
    "regulation",
    "growth",
    "other",
  ];
  const sorted = Object.entries(scores).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return PRIORITY.indexOf(a[0] as EventType) - PRIORITY.indexOf(b[0] as EventType);
  });
  if (!sorted.length) return { primary: "other", all: ["other"], scores };
  return {
    primary: sorted[0][0] as EventType,
    all: sorted.map(([t]) => t as EventType),
    scores,
  };
}

function detectSentiment(text: string, types: EventType[]): EventClassification["sentiment"] {
  if (/\b(hawkish|hike|tighten|higher for longer|restrictive|less accommodative)\b/i.test(text)) return "hawkish";
  if (/\b(dovish|cut|ease|accommodative|pivot toward easing|more accommodative)\b/i.test(text)) return "dovish";
  if (/\b(risk-off|selloff|flight to safety|panic|crash|unwind)\b/i.test(text)) return "risk_off";
  if (/\b(risk-on|rally|melt-up|euphoria|risk appetite)\b/i.test(text)) return "risk_on";
  if (types.length > 2) return "mixed";
  return "neutral";
}

function extractEntities(text: string): StructuredEntities {
  const countries = COUNTRY_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.country);
  const institutions = INSTITUTION_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
  const sectors = SECTOR_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.sector);
  const assetClasses = ASSET_CLASS_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.ac);
  const instruments = INSTRUMENT_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
  return {
    countries: uniq(countries),
    institutions: uniq(institutions),
    sectors: uniq(sectors),
    assetClasses: uniq(assetClasses.length ? assetClasses : inferAssetClassesFromTypes(text)),
    instruments: uniq(instruments),
  };
}

function inferAssetClassesFromTypes(text: string): string[] {
  const { all } = detectEventTypes(text, "");
  const ac: string[] = [];
  if (all.includes("monetary_policy") || all.includes("inflation") || all.includes("fiscal")) ac.push("Rates", "FX");
  if (all.includes("growth") || all.includes("labor") || all.includes("earnings")) ac.push("Equities");
  if (all.includes("commodity_supply") || all.includes("geopolitics")) ac.push("Commodities");
  if (all.includes("credit") || all.includes("liquidity")) ac.push("Credit", "Vol");
  if (all.includes("fx_regime")) ac.push("FX");
  if (/\bcrypto|bitcoin\b/i.test(text)) ac.push("Crypto");
  return uniq(ac.length ? ac : ["Equities", "Rates"]);
}

function detectGeo(text: string): { country?: string; region?: string; code?: string } {
  for (const m of COUNTRY_PATTERNS) {
    if (m.re.test(text)) return { country: m.code, region: m.region, code: m.code };
  }
  return {};
}

function buildExpectedImpact(
  eventType: EventType,
  sentiment: EventClassification["sentiment"],
  entities: StructuredEntities,
  chain: TransmissionChainStep[]
): ExpectedImpactByAsset[] {
  const out: ExpectedImpactByAsset[] = [];
  const dir = (bull: ImpactDirection, bear: ImpactDirection): ImpactDirection => {
    if (sentiment === "hawkish" || sentiment === "risk_off") return bear;
    if (sentiment === "dovish" || sentiment === "risk_on") return bull;
    if (sentiment === "mixed") return "mixed";
    return "unclear";
  };

  const add = (assetClass: string, direction: ImpactDirection, horizons: ExpectedImpactByAsset["horizons"]) => {
    out.push({ assetClass, direction, horizons });
  };

  if (eventType === "monetary_policy" || eventType === "inflation") {
    add("Rates", dir("bullish", "bearish"), {
      intraday: "INTERPRETATION: Front-end / yields reprice path odds immediately.",
      "1-4w": "INTERPRETATION: Term premium and real yields adjust if data confirm.",
      "1-3m": "MODEL ASSUMPTION: Persistence depends on subsequent prints — not locked by one headline.",
    });
    add("FX", dir("bearish", "bullish"), {
      "1-7d": "INTERPRETATION: Rate differentials typically move USD vs peers.",
      "1-3m": "Caveat: relative policy vs ECB/BOJ can dominate absolute moves.",
    });
    add("Equities", dir("bullish", "bearish"), {
      intraday: "INTERPRETATION: Discount-rate channel; growth equities often more sensitive.",
      "1-3m": "OPPOSING: Soft-landing easing can be equity-positive even with lower growth odds.",
    });
    add("Crypto", dir("bullish", "bearish"), {
      "1-7d": "INTERPRETATION: High-beta liquidity proxy — may track risk appetite, not rates directly.",
    });
  } else if (eventType === "fx_regime" || entities.institutions.includes("BOJ")) {
    add("FX", dir("mixed", "mixed"), {
      intraday: "INTERPRETATION: Spot FX and vol reprice first.",
      "1-7d": "INTERPRETATION: Carry / positioning channels can amplify.",
    });
    add("Equities", "mixed", {
      "1-7d": "INTERPRETATION: Carry unwind can hit high-beta equities; local Nikkei may diverge with JPY.",
    });
    add("Crypto", "bearish", {
      "1-7d": "INTERPRETATION: Often trades as high-beta liquidity; unclear if idiosyncratic crypto news dominate.",
    });
    add("Rates", "unclear", {
      "1-4w": "MODEL ASSUMPTION: Cross-market rates spillover via global duration — low confidence without corroboration.",
    });
  } else if (eventType === "commodity_supply" || eventType === "geopolitics" || eventType === "sanction") {
    add("Commodities", "bullish", {
      intraday: "INTERPRETATION: Supply-risk premium can lift energy prices quickly.",
      "1-4w": "Caveat: spare capacity / diplomacy can reverse premium.",
    });
    add("Equities", "mixed", {
      "1-7d": "INTERPRETATION: Energy longs vs consumer / airline shorts — index direction often mixed.",
    });
    add("Rates", "unclear", {
      "1-3m": "INTERPRETATION: Oil→inflation→hawkish CB odds is contested; CB may look through energy.",
    });
    add("Vol", "bullish", {
      intraday: "INTERPRETATION: Uncertainty premium lifts implied vol if shock is acute.",
    });
  } else if (eventType === "labor" || eventType === "growth") {
    add("Rates", dir("bullish", "bearish"), {
      "1-7d": "INTERPRETATION: Softer labor often priced as easier path — if inflation allows.",
      "1-3m": "OPPOSING: Sticky inflation can keep CB restrictive despite cooling labor.",
    });
    add("Equities", "mixed", {
      "1-4w": "INTERPRETATION: Growth-scare vs easing tug-of-war — scenarios diverge.",
    });
  } else if (eventType === "credit" || eventType === "liquidity") {
    add("Credit", "bearish", {
      "1-7d": "INTERPRETATION: Spreads / funding stress typically widen first.",
    });
    add("Equities", "bearish", {
      "1-7d": "INTERPRETATION: Tighter financial conditions → equity beta.",
    });
    add("Vol", "bullish", {
      intraday: "INTERPRETATION: Risk aversion lifts vol.",
    });
  } else if (eventType === "fiscal") {
    add("Rates", "bearish", {
      "1-4w": "INTERPRETATION: Issuance / deficit impulse can lift term premium (bonds bearish).",
      "1-3m": "Caveat: official demand can absorb supply.",
    });
    add("FX", "unclear", {
      "1-4w": "INTERPRETATION: Fiscal credibility shocks can dominate rate differentials.",
    });
  } else {
    add("Equities", "unclear", {
      "1-4w": "Insufficient specificity for directional call — low confidence.",
    });
    add("Rates", "unclear", {
      "1-4w": "Insufficient specificity for directional call — low confidence.",
    });
  }

  // Annotate that chain length informs breadth
  if (chain.length >= 6) {
    out.push({
      assetClass: "Cross-asset",
      direction: "mixed",
      horizons: {
        "1-7d": `INTERPRETATION: Long transmission chain (${chain.length} nodes) implies broader spillover potential — still an estimate.`,
      },
    });
  }

  return out;
}

function formatExpectedImpactSummary(impacts: ExpectedImpactByAsset[]): string {
  if (!impacts.length) return "Insufficient evidence for directional impact estimates.";
  return impacts
    .map((i) => {
      const hs = Object.entries(i.horizons)
        .map(([h, note]) => `[${h}] ${note}`)
        .join(" ");
      return `${i.assetClass}: ${i.direction}. ${hs}`;
    })
    .join(" | ");
}

function contradictingFromText(text: string): string[] {
  return TEXT_CONTRADICTION_CUES.filter((c) => c.re.test(text)).map((c) => c.note);
}

function confidenceScore(
  sourceTier: SourceTier,
  types: EventType[],
  entities: StructuredEntities,
  textCues: number,
  quality?: string
): { confidence: number; rationale: string } {
  const tierBase = { 1: 0.55, 2: 0.45, 3: 0.35, 4: 0.25 }[sourceTier];
  const specificity =
    Math.min(0.25, types.length * 0.05) +
    Math.min(0.15, entities.institutions.length * 0.04) +
    Math.min(0.1, entities.instruments.length * 0.05);
  const cueBoost = Math.min(0.08, textCues * 0.02);
  let conf = tierBase + specificity + cueBoost;
  if (quality === "demo") conf = Math.min(conf, 0.5);
  if (types[0] === "other" && entities.institutions.length === 0) conf = Math.min(conf, 0.3);
  conf = Math.max(0.15, Math.min(0.92, conf));
  const rationale = [
    `Source tier ${sourceTier} base=${tierBase}.`,
    `Event-type hits=${types.join(",") || "none"}; institutions=${entities.institutions.join(",") || "none"}.`,
    `Specificity/cue contribution≈${(specificity + cueBoost).toFixed(2)}.`,
    quality === "demo" ? "Demo/illustrative quality caps confidence." : "Live/cache quality — still heuristic, not calibrated probability.",
    conf < 0.4 ? "LOW CONFIDENCE: thin evidence or low specificity." : "Confidence reflects source tier + textual specificity, not forecast skill.",
  ].join(" ");
  return { confidence: Math.round(conf * 100) / 100, rationale };
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function chainToLabels(chain: TransmissionChainStep[]): string[] {
  return chain.map((s) => s.node);
}

function narrativeFromWalk(
  eventType: EventType,
  sentiment: EventClassification["sentiment"],
  walk: ReturnType<typeof walkTransmission>,
  title: string
): string {
  const path = walk.chain.map((s, i) => (i === 0 ? s.node : `${s.node}`)).join(" → ");
  const mechanisms = walk.chain
    .filter((s) => s.edgeLabel)
    .slice(0, 3)
    .map((s) => s.edgeLabel)
    .join("; ");
  const s1 = `INTERPRETATION (heuristic_v2 / ${GRAPH_VERSION}): Classified as ${eventType} with sentiment ${sentiment}. Shock propagates along: ${path}.`;
  const s2 = mechanisms
    ? `Key mechanisms: ${mechanisms}.`
    : "Transmission path is short — limited graph activation from detected shock nodes.";
  const s3 =
    "This explains HOW a stylized shock may propagate; it is not a news summary and not a prediction. Channels are regime-dependent.";
  const s4 = `Title cue (observed): "${title.slice(0, 100)}${title.length > 100 ? "…" : ""}".`;
  return [s1, s2, s3, s4].join(" ");
}

/**
 * Main v2 classifier entry — pure function over title/body + source metadata.
 */
export function classifyEventV2(input: ClassifyV2Input): ClassifyV2Result {
  const text = `${input.title} ${input.body}`;
  const { primary, all } = detectEventTypes(input.title, input.body);
  const entities = extractEntities(text);
  const sentiment = detectSentiment(text, all);
  const geo = detectGeo(text);

  const activateTags = uniq([
    primary,
    ...all,
    ...entities.institutions.map((i) => i.toLowerCase()),
    ...entities.countries.map((c) => c.toLowerCase()),
    geo.code?.toLowerCase() || "",
    ...entities.sectors.map((s) => s.toLowerCase()),
    sentiment,
  ]).filter(Boolean);

  // Seed walk from primary type first so chain origin matches classification
  const startNodes = shockTagsToNodeIds([primary, ...activateTags]);
  const walk = walkTransmission(startNodes, activateTags, { maxDepth: 7, maxNodes: 10 });

  const textContradict = contradictingFromText(text);
  const graphOppose = opposingForcesFromGraph(walk.edgesUsed, activateTags);
  let contradicting = uniq([...textContradict, ...graphOppose]);
  if (!textContradict.length && !graphOppose.length) {
    contradicting = [
      "No contradicting evidence in source; interpretation may be one-sided.",
    ];
  } else if (!textContradict.length) {
    contradicting = [
      "No contradicting evidence in source; graph-based opposing forces listed below.",
      ...contradicting,
    ];
  }

  const { confidence, rationale } = confidenceScore(
    input.sourceTier,
    all,
    entities,
    textContradict.length + (/\d/.test(text) ? 1 : 0),
    input.quality
  );

  const expected_impact = buildExpectedImpact(primary, sentiment, entities, walk.chain);
  const transmission_narrative = narrativeFromWalk(primary, sentiment, walk, input.title);

  const key_assumptions = [
    "MODEL ASSUMPTION: Historical transmission channels in the curated knowledge graph remain partially intact.",
    "MODEL ASSUMPTION: No simultaneous orthogonal shock dominates the stated horizon.",
    `MODEL ASSUMPTION: Graph version ${GRAPH_VERSION} edges are stylized — labeled examples are analogies, not live data.`,
    primary === "other"
      ? "MODEL ASSUMPTION: Event type weakly identified — chain may be generic."
      : `MODEL ASSUMPTATION: Primary event type "${primary}" correctly captures the dominant shock.`,
  ];

  const categories = uniq([primary, ...all, ...entities.sectors.map((s) => s.toLowerCase())]).slice(0, 8);
  const flatEntities = uniq([
    ...entities.institutions,
    ...entities.countries,
    ...entities.instruments,
  ]);

  const regions = uniq(
    COUNTRY_PATTERNS.filter((p) => entities.countries.includes(p.country)).map((p) => p.region)
  );

  const classification: EventClassification = {
    categories,
    entities: flatEntities,
    sentiment,
    confidence,
    method: "heuristic_v2",
    event_type: primary,
    taxonomy: {
      countries: entities.countries,
      regions: regions.length ? regions : geo.region ? [geo.region] : [],
      sectors: entities.sectors,
      assetClasses: entities.assetClasses,
    },
    structuredEntities: entities,
    transmission_chain: walk.chain,
    transmission_narrative,
    expected_impact,
    contradicting_evidence: contradicting,
    key_assumptions,
    confidence_rationale: rationale,
    classifier_version: "heuristic_v2",
  };

  const horizon = horizonFromKeywords(text);
  const impactScore = scoreImpactTransparent({
    title: input.title,
    body: input.body,
    sourceTier: input.sourceTier,
    eventType: primary,
    sentiment,
    confidence,
    chainLength: walk.chain.length,
    entityCount: flatEntities.length,
    quality: input.quality,
  });

  const evidenceLayers = {
    observed: [
      `OBSERVED: Headline "${input.title}" from ${input.sourceName} (tier ${input.sourceTier}${input.quality ? `, quality=${input.quality}` : ""}).`,
      input.body.trim()
        ? `OBSERVED: Source snippet (truncated): "${input.body.slice(0, 220)}${input.body.length > 220 ? "…" : ""}"`
        : "OBSERVED: No body snippet available beyond title.",
    ],
    interpretation: [
      `INTERPRETATION: event_type=${primary}, sentiment=${sentiment}.`,
      `INTERPRETATION: Transmission narrative — ${transmission_narrative}`,
    ],
    modelAssumptions: key_assumptions,
    scenarioEstimates: [
      `SCENARIO ESTIMATE: ${formatExpectedImpactSummary(expected_impact).slice(0, 500)}`,
      "SCENARIO ESTIMATE labels are not forecasts; see Scenarios page for base/bull/bear/tail branches.",
    ],
  };

  return {
    classification,
    causalChain: chainToLabels(walk.chain),
    transmissionMechanism: transmission_narrative,
    expectedImpact: formatExpectedImpactSummary(expected_impact),
    timeHorizon: horizon,
    impactScore,
    country: geo.country,
    region: geo.region,
    sector: entities.sectors[0] || primary,
    assetClass: entities.assetClasses.join(" / ") || categories.join(" / "),
    tags: uniq([
      ...categories,
      ...entities.institutions.map((e) => e.toLowerCase()),
      primary,
    ]),
    evidenceLayers,
  };
}

/** Reclassify an existing event with v2, preserving prior classification for audit */
export function reclassifyEventV2(event: FinancialEvent): FinancialEvent {
  const result = classifyEventV2({
    title: event.title,
    body: event.rawText || event.summary,
    sourceTier: event.sourceTier,
    sourceName: event.sourceName,
    quality: event.quality,
  });

  const prev = event.classification;
  const prevSans: Omit<EventClassification, "previous_classification"> = {
    categories: prev.categories,
    entities: prev.entities,
    sentiment: prev.sentiment,
    confidence: prev.confidence,
    method: prev.method,
    event_type: prev.event_type,
    taxonomy: prev.taxonomy,
    structuredEntities: prev.structuredEntities,
    transmission_chain: prev.transmission_chain,
    transmission_narrative: prev.transmission_narrative,
    expected_impact: prev.expected_impact,
    contradicting_evidence: prev.contradicting_evidence,
    key_assumptions: prev.key_assumptions,
    confidence_rationale: prev.confidence_rationale,
    classifier_version: prev.classifier_version,
  };

  return {
    ...event,
    country: result.country ?? event.country,
    region: result.region ?? event.region,
    sector: result.sector,
    assetClass: result.assetClass,
    transmissionMechanism: result.transmissionMechanism,
    causalChain: result.causalChain,
    expectedImpact: result.expectedImpact,
    timeHorizon: result.timeHorizon,
    impactScore: result.impactScore,
    tags: result.tags,
    classification: {
      ...result.classification,
      previous_classification:
        prev.method === "heuristic_v2" && prev.classifier_version === "heuristic_v2"
          ? prev.previous_classification
          : prevSans,
    },
    evidenceLayers: result.evidenceLayers,
  };
}
