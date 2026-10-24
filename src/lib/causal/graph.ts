import type {
  CausalGraph,
  CausalNode,
  CausalEdge,
  FinancialEvent,
  TimeHorizon,
  TransmissionChainStep,
} from "../types";
import { getEvents } from "../ingestion/rss";
import { getDb, upsertJson, getJsonById } from "../db";

/** Curated knowledge-graph version — bump when edges change materially */
export const GRAPH_VERSION = "causal_kg_v2.1";

export interface KnowledgeEdge {
  id: string;
  source: string;
  target: string;
  mechanism: string;
  typicalSign: "positive" | "negative" | "mixed";
  typicalHorizon: TimeHorizon;
  strength: number;
  caveats: string;
  /** Well-known public episodes only — labeled as examples, not live data */
  historicalExamples: string[];
  /** Keywords / shock tags that activate this edge when walking from a shock */
  activateOn: string[];
}

const CORE_NODES: CausalNode[] = [
  { id: "fed", label: "Fed / FOMC", type: "institution", group: "policy" },
  { id: "ecb", label: "ECB", type: "institution", group: "policy" },
  { id: "boj", label: "BOJ", type: "institution", group: "policy" },
  { id: "boe", label: "BOE", type: "institution", group: "policy" },
  { id: "pboc", label: "PBOC", type: "institution", group: "policy" },
  { id: "imf", label: "IMF", type: "institution", group: "policy" },
  { id: "opec", label: "OPEC+", type: "institution", group: "commodity" },
  { id: "us_inflation", label: "US Inflation", type: "indicator", group: "macro" },
  { id: "eu_inflation", label: "EU Inflation", type: "indicator", group: "macro" },
  { id: "jp_inflation", label: "Japan Inflation", type: "indicator", group: "macro" },
  { id: "growth", label: "Global Growth", type: "indicator", group: "macro" },
  { id: "labor", label: "Labor Market", type: "indicator", group: "macro" },
  { id: "fiscal", label: "Fiscal / Issuance", type: "indicator", group: "macro" },
  { id: "real_yields", label: "Real Yields", type: "indicator", group: "rates" },
  { id: "us10y", label: "US 10Y", type: "asset", group: "rates" },
  { id: "bunds", label: "Bunds", type: "asset", group: "rates" },
  { id: "jgbs", label: "JGBs", type: "asset", group: "rates" },
  { id: "dxy", label: "DXY", type: "asset", group: "fx" },
  { id: "usdjpy", label: "USD/JPY", type: "asset", group: "fx" },
  { id: "eurusd", label: "EUR/USD", type: "asset", group: "fx" },
  { id: "liquidity", label: "Global Liquidity", type: "indicator", group: "flows" },
  { id: "carry", label: "FX Carry", type: "indicator", group: "flows" },
  { id: "discount_rates", label: "Discount Rates", type: "indicator", group: "rates" },
  { id: "spx", label: "S&P 500", type: "asset", group: "equity" },
  { id: "growth_eq", label: "Growth Equities", type: "asset", group: "equity" },
  { id: "eu_eq", label: "EU Equities", type: "asset", group: "equity" },
  { id: "nky", label: "Nikkei", type: "asset", group: "equity" },
  { id: "em_eq", label: "EM Equities", type: "asset", group: "equity" },
  { id: "btc", label: "Bitcoin", type: "asset", group: "crypto" },
  { id: "gold", label: "Gold", type: "asset", group: "commodity" },
  { id: "oil", label: "Oil", type: "asset", group: "commodity" },
  { id: "vix", label: "VIX", type: "asset", group: "vol" },
  { id: "credit", label: "Credit Spreads", type: "indicator", group: "credit" },
  { id: "geo", label: "Geopolitics", type: "event", group: "risk" },
  { id: "sanctions", label: "Sanctions", type: "event", group: "risk" },
  { id: "regulation", label: "Regulation", type: "event", group: "risk" },
  { id: "earnings", label: "Corporate Earnings", type: "indicator", group: "equity" },
  { id: "us", label: "United States", type: "country", group: "country" },
  { id: "jp", label: "Japan", type: "country", group: "country" },
  { id: "eu", label: "Eurozone", type: "country", group: "country" },
  { id: "cn", label: "China", type: "country", group: "country" },
  { id: "gb", label: "United Kingdom", type: "country", group: "country" },
];

/**
 * Curated economically plausible edges.
 * Examples are well-known public episodes, labeled as historical analogies — not invented data.
 */
export const KNOWLEDGE_EDGES: KnowledgeEdge[] = [
  {
    id: "ke_us_infl_fed",
    source: "us_inflation",
    target: "fed",
    mechanism: "Inflation surprise shifts Fed reaction function / path odds",
    typicalSign: "positive",
    typicalHorizon: "1-4w",
    strength: 0.85,
    caveats: "Historical correlation; reaction function can shift with dual-mandate trade-offs.",
    historicalExamples: ["EXAMPLE: 2021–2023 hiking cycle after CPI surge", "EXAMPLE: 2010s low-inflation policy patience"],
    activateOn: ["inflation", "cpi", "pce", "monetary_policy", "fed", "us"],
  },
  {
    id: "ke_fed_real_yields",
    source: "fed",
    target: "real_yields",
    mechanism: "Policy path expectations reprice real yields and front-end rates",
    typicalSign: "positive",
    typicalHorizon: "1-7d",
    strength: 0.8,
    caveats: "Fiscal supply / QT can dominate temporarily.",
    historicalExamples: ["EXAMPLE: Taper tantrum 2013", "EXAMPLE: 2022 real-yield surge"],
    activateOn: ["monetary_policy", "fed", "rates", "hawkish", "dovish"],
  },
  {
    id: "ke_real_yields_discount",
    source: "real_yields",
    target: "discount_rates",
    mechanism: "Higher real yields raise equity discount rates",
    typicalSign: "positive",
    typicalHorizon: "1-4w",
    strength: 0.75,
    caveats: "Growth-driven yield rises can be equity-positive even as discount rates rise.",
    historicalExamples: ["EXAMPLE: 2022 duration-sensitive multiple compression"],
    activateOn: ["inflation", "monetary_policy", "rates"],
  },
  {
    id: "ke_discount_growth_eq",
    source: "discount_rates",
    target: "growth_eq",
    mechanism: "Long-duration growth equities sensitive to discount-rate shocks",
    typicalSign: "negative",
    typicalHorizon: "1-4w",
    strength: 0.7,
    caveats: "Idiosyncratic earnings can dominate over 1–3m+.",
    historicalExamples: ["EXAMPLE: 2022 Nasdaq drawdown vs rising real yields"],
    activateOn: ["inflation", "monetary_policy", "equities"],
  },
  {
    id: "ke_fed_us10y",
    source: "fed",
    target: "us10y",
    mechanism: "Policy path + QT/issuance → term premium / curve",
    typicalSign: "mixed",
    typicalHorizon: "1-4w",
    strength: 0.8,
    caveats: "Fiscal supply can dominate policy expectations temporarily.",
    historicalExamples: ["EXAMPLE: Taper tantrum 2013", "EXAMPLE: 2022 hiking"],
    activateOn: ["monetary_policy", "fed", "fiscal", "rates"],
  },
  {
    id: "ke_fed_dxy",
    source: "fed",
    target: "dxy",
    mechanism: "Rate differentials and risk appetite drive USD",
    typicalSign: "positive",
    typicalHorizon: "1-7d",
    strength: 0.7,
    caveats: "Relative (not absolute) policy matters vs peers.",
    historicalExamples: ["EXAMPLE: USD strength 2022"],
    activateOn: ["monetary_policy", "fed", "fx_regime"],
  },
  {
    id: "ke_dxy_liquidity",
    source: "dxy",
    target: "liquidity",
    mechanism: "Strong USD tightens global dollar funding conditions",
    typicalSign: "negative",
    typicalHorizon: "1-4w",
    strength: 0.65,
    caveats: "Not mechanical for all regimes; FX hedge demand varies.",
    historicalExamples: ["EXAMPLE: EM stress episodes under USD spikes"],
    activateOn: ["fx_regime", "liquidity", "monetary_policy"],
  },
  {
    id: "ke_dxy_em",
    source: "dxy",
    target: "em_eq",
    mechanism: "USD strength typically pressured EM FX/equities via funding and local rates",
    typicalSign: "negative",
    typicalHorizon: "1-4w",
    strength: 0.6,
    caveats: "Commodity EM exporters can diverge.",
    historicalExamples: ["EXAMPLE: 2013 taper / EM selloff cluster"],
    activateOn: ["fx_regime", "monetary_policy", "growth"],
  },
  {
    id: "ke_jp_boj",
    source: "jp",
    target: "boj",
    mechanism: "Domestic inflation/wage data and FX stability feed BOJ policy debate",
    typicalSign: "mixed",
    typicalHorizon: "1-3m",
    strength: 0.7,
    caveats: "BOJ reaction function has been highly regime-specific.",
    historicalExamples: ["EXAMPLE: 2022–2024 gradual normalization debate"],
    activateOn: ["japan", "boj", "monetary_policy", "jp"],
  },
  {
    id: "ke_boj_jgbs",
    source: "boj",
    target: "jgbs",
    mechanism: "YCC / purchase-pace changes reprice JGB curve",
    typicalSign: "mixed",
    typicalHorizon: "1-7d",
    strength: 0.85,
    caveats: "Intervention and guidance can interrupt trends.",
    historicalExamples: ["EXAMPLE: 2022–2023 YCC adjustments"],
    activateOn: ["boj", "monetary_policy", "japan", "rates"],
  },
  {
    id: "ke_boj_usdjpy",
    source: "boj",
    target: "usdjpy",
    mechanism: "BOJ normalization / yield differential shifts → JPY",
    typicalSign: "negative",
    typicalHorizon: "intraday",
    strength: 0.9,
    caveats: "MoF intervention can interrupt FX trends abruptly.",
    historicalExamples: ["EXAMPLE: 2022–2024 yen moves", "EXAMPLE: Aug 2024 carry-related volatility"],
    activateOn: ["boj", "fx_regime", "japan", "monetary_policy"],
  },
  {
    id: "ke_usdjpy_carry",
    source: "usdjpy",
    target: "carry",
    mechanism: "JPY as funding currency; FX vol kills carry",
    typicalSign: "mixed",
    typicalHorizon: "intraday",
    strength: 0.75,
    caveats: "Positioning data imperfect; may not persist.",
    historicalExamples: ["EXAMPLE: Aug 2024 carry flush (illustrative precedent)"],
    activateOn: ["fx_regime", "boj", "liquidity", "carry"],
  },
  {
    id: "ke_carry_liquidity",
    source: "carry",
    target: "liquidity",
    mechanism: "Carry unwind reduces cross-asset liquidity provision",
    typicalSign: "negative",
    typicalHorizon: "1-7d",
    strength: 0.6,
    caveats: "Correlations are not permanent across regimes.",
    historicalExamples: ["EXAMPLE: Risk-parity / vol-targeting deleveraging analogies"],
    activateOn: ["fx_regime", "liquidity", "carry"],
  },
  {
    id: "ke_liquidity_spx",
    source: "liquidity",
    target: "spx",
    mechanism: "Easier financial conditions support equity multiples/flows",
    typicalSign: "positive",
    typicalHorizon: "1-4w",
    strength: 0.7,
    caveats: "Earnings can dominate liquidity over longer horizons.",
    historicalExamples: ["EXAMPLE: Post-2020 liquidity boom"],
    activateOn: ["liquidity", "monetary_policy", "equities"],
  },
  {
    id: "ke_liquidity_btc",
    source: "liquidity",
    target: "btc",
    mechanism: "Crypto as high-beta liquidity barometer (interpretation)",
    typicalSign: "positive",
    typicalHorizon: "1-7d",
    strength: 0.65,
    caveats: "Idiosyncratic crypto catalysts can dominate.",
    historicalExamples: ["EXAMPLE: 2020–2021 boom", "EXAMPLE: 2022 bust"],
    activateOn: ["liquidity", "crypto", "fx_regime"],
  },
  {
    id: "ke_liquidity_nky",
    source: "liquidity",
    target: "nky",
    mechanism: "JPY liquidity/carry linked to Japanese equity beta",
    typicalSign: "positive",
    typicalHorizon: "1-7d",
    strength: 0.55,
    caveats: "Domestic policy and corporate reform matter too.",
    historicalExamples: ["EXAMPLE: Yen-driven Nikkei swings"],
    activateOn: ["liquidity", "japan", "boj", "equities"],
  },
  {
    id: "ke_us10y_spx",
    source: "us10y",
    target: "spx",
    mechanism: "Discount-rate channel for duration-sensitive equities",
    typicalSign: "negative",
    typicalHorizon: "1-4w",
    strength: 0.6,
    caveats: "Growth-driven yield rises can be equity-positive.",
    historicalExamples: ["EXAMPLE: 2022 multiple compression"],
    activateOn: ["rates", "equities", "monetary_policy"],
  },
  {
    id: "ke_us10y_gold",
    source: "real_yields",
    target: "gold",
    mechanism: "Opportunity-cost / real-yield channel for gold",
    typicalSign: "negative",
    typicalHorizon: "1-4w",
    strength: 0.55,
    caveats: "Geopolitical / central-bank demand can dominate.",
    historicalExamples: ["EXAMPLE: 2022 gold vs rising real yields tension"],
    activateOn: ["inflation", "monetary_policy", "gold"],
  },
  {
    id: "ke_geo_oil",
    source: "geo",
    target: "oil",
    mechanism: "Supply-risk premium in energy",
    typicalSign: "positive",
    typicalHorizon: "intraday",
    strength: 0.7,
    caveats: "Spare capacity / strategic reserves mute pass-through.",
    historicalExamples: ["EXAMPLE: Various Middle East risk episodes (public)"],
    activateOn: ["geopolitics", "commodity_supply", "oil", "sanction"],
  },
  {
    id: "ke_oil_us_infl",
    source: "oil",
    target: "us_inflation",
    mechanism: "Energy → headline CPI; core pass-through uncertain",
    typicalSign: "positive",
    typicalHorizon: "1-3m",
    strength: 0.55,
    caveats: "Base effects and demand destruction matter.",
    historicalExamples: ["EXAMPLE: 2021–2022 energy shock"],
    activateOn: ["commodity_supply", "inflation", "oil", "geopolitics"],
  },
  {
    id: "ke_oil_hawkish_odds",
    source: "us_inflation",
    target: "fed",
    mechanism: "Oil-driven inflation expectations can lift hawkish CB odds",
    typicalSign: "positive",
    typicalHorizon: "1-4w",
    strength: 0.5,
    caveats: "CB may look through transitory energy shocks — contested.",
    historicalExamples: ["EXAMPLE: 2022 energy + Fed hiking overlap"],
    activateOn: ["commodity_supply", "inflation", "monetary_policy"],
  },
  {
    id: "ke_geo_gold",
    source: "geo",
    target: "gold",
    mechanism: "Safe-haven / uncertainty demand",
    typicalSign: "positive",
    typicalHorizon: "1-7d",
    strength: 0.5,
    caveats: "Real yields often dominate gold over medium horizons.",
    historicalExamples: ["EXAMPLE: Geopolitical spikes in gold (public episodes)"],
    activateOn: ["geopolitics", "sanction"],
  },
  {
    id: "ke_geo_vix",
    source: "geo",
    target: "vix",
    mechanism: "Uncertainty premium lifts implied vol",
    typicalSign: "positive",
    typicalHorizon: "intraday",
    strength: 0.55,
    caveats: "Vol can mean-revert quickly if shock contained.",
    historicalExamples: ["EXAMPLE: Flash geo risk-off sessions"],
    activateOn: ["geopolitics", "sanction"],
  },
  {
    id: "ke_spx_vix",
    source: "spx",
    target: "vix",
    mechanism: "Equity drawdowns lift implied vol",
    typicalSign: "negative",
    typicalHorizon: "intraday",
    strength: 0.75,
    caveats: "Vol can rise without large spot moves (vol-of-vol).",
    historicalExamples: ["EXAMPLE: Classic inverse SPX/VIX"],
    activateOn: ["equities", "liquidity", "credit"],
  },
  {
    id: "ke_vix_credit",
    source: "vix",
    target: "credit",
    mechanism: "Risk aversion → spread widening",
    typicalSign: "positive",
    typicalHorizon: "1-7d",
    strength: 0.6,
    caveats: "MVP lacks live OAS feed — interpretive edge.",
    historicalExamples: ["EXAMPLE: COVID March 2020"],
    activateOn: ["credit", "liquidity", "risk_off"],
  },
  {
    id: "ke_credit_spx",
    source: "credit",
    target: "spx",
    mechanism: "Wider spreads tighten financial conditions → equity beta",
    typicalSign: "negative",
    typicalHorizon: "1-4w",
    strength: 0.65,
    caveats: "Bank-specific vs systemic credit stress differ.",
    historicalExamples: ["EXAMPLE: 2008 credit crunch", "EXAMPLE: March 2023 regional bank stress"],
    activateOn: ["credit", "liquidity"],
  },
  {
    id: "ke_eu_infl_ecb",
    source: "eu_inflation",
    target: "ecb",
    mechanism: "CPI/wage data feed ECB reaction function",
    typicalSign: "positive",
    typicalHorizon: "1-4w",
    strength: 0.8,
    caveats: "Fragmentation risk can alter policy.",
    historicalExamples: ["EXAMPLE: 2022–2024 disinflation path"],
    activateOn: ["inflation", "ecb", "monetary_policy", "eu"],
  },
  {
    id: "ke_ecb_bunds",
    source: "ecb",
    target: "bunds",
    mechanism: "ECB path reprices EUR rates / bunds",
    typicalSign: "mixed",
    typicalHorizon: "1-7d",
    strength: 0.75,
    caveats: "Issuance and PEPP/APP runoff matter.",
    historicalExamples: ["EXAMPLE: ECB hiking 2022–2023"],
    activateOn: ["ecb", "monetary_policy", "rates"],
  },
  {
    id: "ke_ecb_eurusd",
    source: "ecb",
    target: "eurusd",
    mechanism: "Relative ECB vs Fed path drives EUR/USD",
    typicalSign: "positive",
    typicalHorizon: "1-7d",
    strength: 0.7,
    caveats: "Relative policy — Fed can dominate.",
    historicalExamples: ["EXAMPLE: EUR weakness during 2022 Fed-ahead hiking"],
    activateOn: ["ecb", "fx_regime", "monetary_policy"],
  },
  {
    id: "ke_ecb_eu_eq",
    source: "ecb",
    target: "eu_eq",
    mechanism: "ECB path → EUR financial conditions → EU equities",
    typicalSign: "mixed",
    typicalHorizon: "1-4w",
    strength: 0.65,
    caveats: "Fiscal and energy idiosyncratic shocks matter in EU.",
    historicalExamples: ["EXAMPLE: ECB hiking 2022–2023"],
    activateOn: ["ecb", "monetary_policy", "equities"],
  },
  {
    id: "ke_labor_growth",
    source: "labor",
    target: "growth",
    mechanism: "Labor softening feeds growth / recession odds",
    typicalSign: "positive",
    typicalHorizon: "1-3m",
    strength: 0.7,
    caveats: "Lagging indicator; revisions common.",
    historicalExamples: ["EXAMPLE: Soft-landing vs recession debates 2023–2024"],
    activateOn: ["labor", "growth", "nfp", "unemployment"],
  },
  {
    id: "ke_labor_fed",
    source: "labor",
    target: "fed",
    mechanism: "Employment mandate: softer labor raises ease odds (contested if inflation sticky)",
    typicalSign: "mixed",
    typicalHorizon: "1-4w",
    strength: 0.75,
    caveats: "Inflation still elevated can mute dovish response.",
    historicalExamples: ["EXAMPLE: 2024 labor-cooling / cut-pricing episodes"],
    activateOn: ["labor", "monetary_policy", "growth", "fed"],
  },
  {
    id: "ke_growth_earnings",
    source: "growth",
    target: "earnings",
    mechanism: "Growth outlook feeds earnings expectations",
    typicalSign: "positive",
    typicalHorizon: "1-3m",
    strength: 0.7,
    caveats: "Margins and sector mix matter.",
    historicalExamples: ["EXAMPLE: 2020 earnings collapse/recovery"],
    activateOn: ["growth", "earnings", "labor"],
  },
  {
    id: "ke_earnings_spx",
    source: "earnings",
    target: "spx",
    mechanism: "Earnings revisions drive equity fundamentals channel",
    typicalSign: "positive",
    typicalHorizon: "1-3m",
    strength: 0.75,
    caveats: "Multiples can move independently of near-term EPS.",
    historicalExamples: ["EXAMPLE: Post-COVID earnings rebound"],
    activateOn: ["earnings", "growth", "equities"],
  },
  {
    id: "ke_fiscal_us10y",
    source: "fiscal",
    target: "us10y",
    mechanism: "Issuance / deficit impulse can lift term premium",
    typicalSign: "positive",
    typicalHorizon: "1-3m",
    strength: 0.55,
    caveats: "Demand from official / bank channels can absorb supply.",
    historicalExamples: ["EXAMPLE: 2023 US Treasury supply / term-premium debate"],
    activateOn: ["fiscal", "rates", "treasury"],
  },
  {
    id: "ke_sanctions_geo",
    source: "sanctions",
    target: "geo",
    mechanism: "Sanctions escalate geopolitical risk premium",
    typicalSign: "positive",
    typicalHorizon: "1-7d",
    strength: 0.7,
    caveats: "Market often prices anticipation ahead of formal action.",
    historicalExamples: ["EXAMPLE: 2022 Russia sanctions energy/FX channels"],
    activateOn: ["sanction", "geopolitics"],
  },
  {
    id: "ke_sanctions_oil",
    source: "sanctions",
    target: "oil",
    mechanism: "Energy or shipping sanctions alter supply/routes",
    typicalSign: "positive",
    typicalHorizon: "1-4w",
    strength: 0.6,
    caveats: "Enforcement gaps and shadow fleets complicate pass-through.",
    historicalExamples: ["EXAMPLE: 2022–2023 oil trade rerouting under sanctions"],
    activateOn: ["sanction", "commodity_supply", "oil"],
  },
  {
    id: "ke_regulation_btc",
    source: "regulation",
    target: "btc",
    mechanism: "Crypto regulatory clarity/enforcement shifts risk appetite and access",
    typicalSign: "mixed",
    typicalHorizon: "1-4w",
    strength: 0.55,
    caveats: "Jurisdiction-specific; ETF/flow channels idiosyncratic.",
    historicalExamples: ["EXAMPLE: US spot Bitcoin ETF approval narrative 2024"],
    activateOn: ["regulation", "crypto"],
  },
  {
    id: "ke_cn_pboc",
    source: "cn",
    target: "pboc",
    mechanism: "China growth/property stress feeds PBOC easing bias",
    typicalSign: "mixed",
    typicalHorizon: "1-3m",
    strength: 0.65,
    caveats: "Policy transmission via banks/property is imperfect.",
    historicalExamples: ["EXAMPLE: Post-2021 property stress easing packages"],
    activateOn: ["china", "pboc", "growth", "monetary_policy"],
  },
  {
    id: "ke_pboc_em",
    source: "pboc",
    target: "em_eq",
    mechanism: "China liquidity/growth impulse spills to EM risk assets",
    typicalSign: "positive",
    typicalHorizon: "1-3m",
    strength: 0.5,
    caveats: "Commodity vs manufacturing EM diverge.",
    historicalExamples: ["EXAMPLE: China reopening risk-on clusters"],
    activateOn: ["china", "pboc", "growth", "liquidity"],
  },
  {
    id: "ke_gb_boe",
    source: "gb",
    target: "boe",
    mechanism: "UK inflation/labor data feed BOE path",
    typicalSign: "positive",
    typicalHorizon: "1-4w",
    strength: 0.75,
    caveats: "Fiscal credibility episodes can dominate rates (e.g. gilt stress).",
    historicalExamples: ["EXAMPLE: Autumn 2022 gilt / LDI stress (fiscal+rates)"],
    activateOn: ["uk", "boe", "monetary_policy", "inflation"],
  },
];

const NODE_LABEL: Record<string, string> = Object.fromEntries(
  CORE_NODES.map((n) => [n.id, n.label])
);

export function getKnowledgeNodes(): CausalNode[] {
  return CORE_NODES.map((n) => ({ ...n }));
}

export function getKnowledgeEdges(): KnowledgeEdge[] {
  return KNOWLEDGE_EDGES.map((e) => ({ ...e }));
}

export function getEdgeById(id: string): KnowledgeEdge | undefined {
  return KNOWLEDGE_EDGES.find((e) => e.id === id);
}

/** Map classifier shock tags → starting graph node ids */
export function shockTagsToNodeIds(tags: string[]): string[] {
  const list = tags.map((x) => x.toLowerCase());
  const t = new Set(list);
  const nodes: string[] = [];
  const push = (id: string) => {
    if (!nodes.includes(id)) nodes.push(id);
  };

  // Honor explicit primary event_type if provided as first tag
  const primary = list[0];
  if (primary === "commodity_supply" || primary === "oil") {
    push("oil");
  } else if (primary === "geopolitics") {
    push("geo");
  } else if (primary === "sanction" || primary === "sanctions") {
    push("sanctions");
  } else if (primary === "monetary_policy") {
    if (t.has("boj") || t.has("japan") || t.has("jp")) {
      push("jp");
      push("boj");
    } else if (t.has("ecb") || t.has("eu") || t.has("eurozone")) {
      if (t.has("inflation")) push("eu_inflation");
      push("ecb");
    } else if (t.has("boe") || t.has("uk") || t.has("gb")) {
      push("gb");
      push("boe");
    } else {
      push("fed");
    }
  } else if (primary === "inflation") {
    if (t.has("eu") || t.has("ecb")) push("eu_inflation");
    else if (t.has("japan") || t.has("boj") || t.has("jp")) push("jp_inflation");
    else push("us_inflation");
  } else if (primary === "labor") {
    push("labor");
  } else if (primary === "fx_regime") {
    if (t.has("yen") || t.has("jpy") || t.has("boj") || t.has("japan")) push("usdjpy");
    else if (t.has("euro") || t.has("ecb")) push("eurusd");
    else push("dxy");
  } else if (primary === "credit") {
    push("credit");
  } else if (primary === "liquidity") {
    push("liquidity");
  } else if (primary === "fiscal") {
    push("fiscal");
  } else if (primary === "earnings") {
    push("earnings");
  } else if (primary === "regulation") {
    push("regulation");
  } else if (primary === "growth") {
    push("growth");
  }

  // Priority: causal shock origin first (primary walk seed)
  if (t.has("sanction") || t.has("sanctions")) push("sanctions");
  if (t.has("geopolitics") || t.has("war") || t.has("conflict")) push("geo");
  if (t.has("commodity_supply") || t.has("oil") || t.has("opec")) {
    push("oil");
    if (t.has("opec")) push("opec");
  }
  if (t.has("boj") || t.has("japan") || t.has("jp")) {
    push("jp");
    push("boj");
  }
  if (t.has("fed") || t.has("fomc") || (t.has("us") && t.has("monetary_policy"))) push("fed");
  if (t.has("ecb") || t.has("eurozone") || t.has("eu")) {
    if (t.has("inflation")) push("eu_inflation");
    push("ecb");
    push("eu");
  }
  if (t.has("boe") || t.has("uk") || t.has("gb")) {
    push("gb");
    push("boe");
  }
  if (t.has("pboc") || t.has("china") || t.has("cn")) {
    push("cn");
    push("pboc");
  }
  if (t.has("imf")) push("imf");
  if (t.has("inflation") || t.has("cpi") || t.has("pce")) {
    if (t.has("eu") || t.has("ecb")) push("eu_inflation");
    else if (t.has("japan") || t.has("boj") || t.has("jp")) push("jp_inflation");
    else push("us_inflation");
  }
  if (t.has("labor") || t.has("nfp") || t.has("unemployment") || t.has("payrolls")) push("labor");
  if (t.has("growth") || t.has("gdp") || t.has("recession") || t.has("pmi")) push("growth");
  if (t.has("fiscal") || t.has("deficit") || t.has("debt ceiling") || t.has("treasury")) push("fiscal");
  
  if (t.has("regulation") || t.has("regulatory")) push("regulation");
  if (t.has("earnings") || t.has("eps")) push("earnings");
  if (t.has("credit") || t.has("default") || t.has("cds")) push("credit");
  if (t.has("liquidity") || t.has("funding")) push("liquidity");
  if (t.has("fx_regime") || t.has("fx") || t.has("yen") || t.has("dollar")) {
    if (t.has("yen") || t.has("jpy") || t.has("boj")) push("usdjpy");
    else if (t.has("euro") || t.has("ecb")) push("eurusd");
    else push("dxy");
  }
  if (t.has("crypto") || t.has("bitcoin") || t.has("btc")) push("btc");

  if (nodes.length === 0) push("spx");
  return nodes;
}

export interface WalkResult {
  chain: TransmissionChainStep[];
  edgesUsed: KnowledgeEdge[];
  narrativeParts: string[];
}

/**
 * BFS/priority walk from shock nodes through the knowledge graph.
 * Prefer high-strength edges matching activate tags; cap depth to keep chains readable.
 */
export function walkTransmission(
  startNodeIds: string[],
  activateTags: string[],
  opts?: { maxDepth?: number; maxNodes?: number }
): WalkResult {
  const maxDepth = opts?.maxDepth ?? 8;
  const maxNodes = opts?.maxNodes ?? 9;
  const tags = activateTags.map((x) => x.toLowerCase());

  const adj = new Map<string, KnowledgeEdge[]>();
  for (const e of KNOWLEDGE_EDGES) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e);
  }
  for (const list of Array.from(adj.values())) {
    list.sort((a, b) => scoreEdge(b, tags) - scoreEdge(a, tags));
  }

  const visited = new Set<string>();
  const chain: TransmissionChainStep[] = [];
  const edgesUsed: KnowledgeEdge[] = [];
  const narrativeParts: string[] = [];

  // Primary path: greedy best-edge walk from the first shock node (keeps chain coherent)
  const primary = startNodeIds[0];
  if (primary) {
    visited.add(primary);
    chain.push({ node: NODE_LABEL[primary] ?? primary, graphNodeId: primary });
    let cur = primary;
    for (let d = 0; d < maxDepth && chain.length < maxNodes; d++) {
      const outs = (adj.get(cur) || []).filter((e) => !visited.has(e.target));
      if (!outs.length) break;
      const edge = outs[0];
      if (scoreEdge(edge, tags) < 0.2 && d > 1) break;
      visited.add(edge.target);
      edgesUsed.push(edge);
      chain.push({
        node: NODE_LABEL[edge.target] ?? edge.target,
        edgeLabel: edge.mechanism,
        graphNodeId: edge.target,
      });
      narrativeParts.push(
        `${NODE_LABEL[edge.source] ?? edge.source} → ${NODE_LABEL[edge.target] ?? edge.target}: ${edge.mechanism} (${edge.typicalSign}, typical ${edge.typicalHorizon}). Caveat: ${edge.caveats}`
      );
      cur = edge.target;
    }
  }

  // If primary was a country node with a direct institution child also in starts, ensure institution is next
  if (startNodeIds.length > 1 && chain.length >= 1) {
    const second = startNodeIds[1];
    if (!visited.has(second)) {
      const bridge = (adj.get(chain[0].graphNodeId!) || []).find((e) => e.target === second);
      if (bridge) {
        visited.add(second);
        edgesUsed.push(bridge);
        chain.splice(1, 0, {
          node: NODE_LABEL[second] ?? second,
          edgeLabel: bridge.mechanism,
          graphNodeId: second,
        });
        // Continue walk from institution if we inserted it and primary path was short
        let cur = second;
        while (chain.length < maxNodes) {
          const outs = (adj.get(cur) || []).filter((e) => !visited.has(e.target));
          if (!outs.length) break;
          const edge = outs[0];
          if (scoreEdge(edge, tags) < 0.2) break;
          visited.add(edge.target);
          edgesUsed.push(edge);
          chain.push({
            node: NODE_LABEL[edge.target] ?? edge.target,
            edgeLabel: edge.mechanism,
            graphNodeId: edge.target,
          });
          narrativeParts.push(
            `${NODE_LABEL[edge.source] ?? edge.source} → ${NODE_LABEL[edge.target] ?? edge.target}: ${edge.mechanism}`
          );
          cur = edge.target;
        }
      }
    }
  }

  // Deduplicate nodes that may appear twice after bridge insert
  const seenNodes = new Set<string>();
  const deduped: TransmissionChainStep[] = [];
  for (const step of chain) {
    const key = step.graphNodeId || step.node;
    if (seenNodes.has(key)) continue;
    seenNodes.add(key);
    deduped.push(step);
  }

  return { chain: deduped.slice(0, maxNodes), edgesUsed, narrativeParts };
}

function scoreEdge(edge: KnowledgeEdge, tags: string[]): number {
  let s = edge.strength;
  const hits = edge.activateOn.filter((a) =>
    tags.some((t) => t === a || t.includes(a) || a.includes(t))
  ).length;
  s += hits * 0.12;
  return s;
}

/** Contradicting / opposing forces from graph caveats + reverse-sign siblings */
export function opposingForcesFromGraph(
  edgesUsed: KnowledgeEdge[],
  startTags: string[]
): string[] {
  const out: string[] = [];
  for (const e of edgesUsed.slice(0, 6)) {
    if (e.caveats) {
      out.push(`GRAPH CAVEAT (${e.source}→${e.target}): ${e.caveats}`);
    }
  }
  // Known opposing channels
  const tags = new Set(startTags.map((x) => x.toLowerCase()));
  if (tags.has("inflation") || tags.has("monetary_policy")) {
    out.push(
      "OPPOSING FORCE: Growth scare can dominate discount-rate channel (yields down + equities down together)."
    );
  }
  if (tags.has("boj") || tags.has("fx_regime") || tags.has("japan")) {
    out.push(
      "OPPOSING FORCE: MoF FX intervention or sudden BOJ guidance shift can interrupt JPY/carry transmission."
    );
  }
  if (tags.has("geopolitics") || tags.has("commodity_supply") || tags.has("oil")) {
    out.push(
      "OPPOSING FORCE: Spare capacity, SPR releases, or demand destruction can mute oil→inflation pass-through."
    );
  }
  if (tags.has("labor") || tags.has("growth")) {
    out.push(
      "OPPOSING FORCE: Sticky services inflation can prevent dovish CB response despite softer labor."
    );
  }
  if (tags.has("liquidity") || tags.has("credit")) {
    out.push(
      "OPPOSING FORCE: Official liquidity backstops can sever credit→equity transmission quickly."
    );
  }
  return Array.from(new Set(out)).slice(0, 8);
}

function evidenceFromEvents(events: FinancialEvent[], keywords: string[]): string[] {
  const hits = events
    .filter((e) => {
      const t = `${e.title} ${e.tags.join(" ")} ${(e.classification.event_type || "")}`.toLowerCase();
      return keywords.some((k) => t.includes(k.toLowerCase()));
    })
    .slice(0, 3)
    .map((e) => `[${e.quality}] ${e.title} (${e.sourceName})`);
  return hits.length ? hits : ["Insufficient current event evidence for this edge."];
}

function trendFromEvents(events: FinancialEvent[], edge: KnowledgeEdge): CausalEdge["trend"] {
  const recent = events.slice(0, 15);
  const hits = recent.filter((e) => {
    const tags = [
      ...e.tags,
      e.classification.event_type || "",
      ...(e.classification.categories || []),
    ].map((x) => x.toLowerCase());
    return edge.activateOn.some((a) => tags.some((t) => t.includes(a)));
  }).length;
  if (hits >= 3) return "strengthening";
  if (hits === 0) return "stable";
  return "stable";
}

export function buildCausalGraph(events?: FinancialEvent[]): CausalGraph {
  const evs = events ?? getEvents(40);
  const edges: CausalEdge[] = KNOWLEDGE_EDGES.map((e) => {
    const activating = evs
      .filter((ev) => {
        const tags = [
          ...ev.tags,
          ev.classification.event_type || "",
          ...(ev.classification.categories || []),
        ].map((x) => x.toLowerCase());
        return e.activateOn.some((a) => tags.some((t) => t.includes(a)));
      })
      .slice(0, 5);
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      strength: e.strength,
      trend: trendFromEvents(evs, e),
      mechanism: e.mechanism,
      historicalExamples: e.historicalExamples,
      currentEvidence: evidenceFromEvents(evs, [e.source, e.target, ...e.activateOn.slice(0, 3)]),
      caveats: e.caveats,
      typicalSign: e.typicalSign,
      typicalHorizon: e.typicalHorizon,
      graphVersion: GRAPH_VERSION,
      activatedByEventIds: activating.map((a) => a.id),
    };
  });

  const nodes = [...CORE_NODES];
  for (const ev of evs.slice(0, 6)) {
    if (ev.impactScore.composite < 55) continue;
    const nid = `evt_${ev.id.slice(0, 8)}`;
    nodes.push({
      id: nid,
      label: ev.title.slice(0, 42),
      type: "event",
      group: "headline",
    });
    const shockTags = [
      ev.classification.event_type || "",
      ...ev.classification.categories,
      ...ev.tags,
      ev.country || "",
    ];
    const starts = shockTagsToNodeIds(shockTags);
    const target = starts[0] || "spx";
    edges.push({
      id: `edge_${nid}`,
      source: nid,
      target,
      strength: ev.impactScore.composite / 100,
      trend: "strengthening",
      mechanism:
        ev.classification.transmission_narrative?.slice(0, 240) ||
        ev.transmissionMechanism.slice(0, 240),
      historicalExamples: ["See event transmission chain (classifier output)"],
      currentEvidence: [`${ev.quality}: ${ev.title}`],
      caveats: "Event→node links are classifier activations, not proven causality.",
      typicalSign: "mixed",
      typicalHorizon: ev.timeHorizon,
      graphVersion: GRAPH_VERSION,
      activatedByEventIds: [ev.id],
    });
  }

  return { nodes, edges, updatedAt: new Date().toISOString(), graphVersion: GRAPH_VERSION };
}

export function persistCausalGraph(): CausalGraph {
  const g = buildCausalGraph();
  getDb();
  upsertJson("causal_graph", "id", "current", g, { updated_at: g.updatedAt });
  return g;
}

/**
 * Read-only (B2 get-fix): returns the stored graph, or an empty graph (updatedAt "") when none is stored yet.
 * The graph is built and stored only by persistCausalGraph() in the guarded refresh/derive jobs or the token-guarded
 * POST /api/causal.
 */
export function getCausalGraph(): CausalGraph {
  return getJsonById<CausalGraph>("causal_graph", "id", "current") ?? { nodes: [], edges: [], updatedAt: "" };
}
