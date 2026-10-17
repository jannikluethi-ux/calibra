/**
 * Rule-based transmission-mechanism, region and industry tagging (event_intel_v1).
 *
 * This is NOT analysis produced by a language model. Every tag carries the exact rule and matched text that
 * produced it, and all output is labelled "interpretation (rule-based)". A tag says "this text mentions a
 * channel through which events of this kind are commonly discussed as affecting markets"; it never says the
 * event caused or will cause a move.
 */
import type { EventType } from "../types";

export const INTERPRETATION_LABEL = "interpretation (rule-based)" as const;
export const RULES_VERSION = "mech_rules_2026-10-17";

export type MechanismId =
  | "inflation"
  | "rate_expectations"
  | "growth"
  | "fiscal"
  | "trade"
  | "energy"
  | "supply_chain"
  | "fx"
  | "credit"
  | "liquidity"
  | "risk_appetite"
  | "regulation"
  | "capital_flows";

export interface MechanismDef {
  id: MechanismId;
  label: string;
  /** What the channel is, in plain language. */
  channel: string;
  patterns: RegExp[];
  /** Text that disqualifies a text match for this mechanism (documented false-positive guards). */
  exclude?: RegExp;
  /** classify_v2 event types that imply this mechanism (weaker basis than a text match). */
  impliedBy: EventType[];
  whyItMatters: string;
  assetClasses: string[];
  competing: MechanismId[];
  competingNote: string;
  invalidation: string[];
  indicators: string[];
  assumptions: string[];
}

const W = (s: string) => new RegExp(`\\b(?:${s})\\b`, "i");
/** Case-sensitive: acronyms such as US, Fed, SEC must not match ordinary words ("us", "fed"). */
const C = (s: string) => new RegExp(`\\b(?:${s})\\b`);

export const MECHANISMS: MechanismDef[] = [
  {
    id: "inflation",
    label: "Inflation",
    channel: "Changes in realised or expected price growth.",
    patterns: [C("CPI|PCE|HICP"), W("inflation|disinflation|deflation|consumer prices|price pressures|core prices|price stability")],
    impliedBy: ["inflation"],
    whyItMatters: "Inflation news can shift expected policy rates and real yields, which feed into bond, FX and equity valuations.",
    assetClasses: ["Rates", "FX", "Commodities"],
    competing: ["growth", "energy"],
    competingNote: "A price move may reflect energy or one-off effects rather than persistent inflation; growth news can dominate the same data.",
    invalidation: ["Subsequent official data revise or contradict the reported price figures", "Market-implied inflation expectations do not change around the release"],
    indicators: ["Next CPI/PCE or HICP release", "US 10Y and short-rate proxy (US2Y)", "Breakeven inflation (not tracked here)"],
    assumptions: ["The reported figure differs from what markets already expected (the expectation itself is not observed here)"],
  },
  {
    id: "rate_expectations",
    label: "Rate expectations",
    channel: "Changes in the expected path of central-bank policy rates.",
    patterns: [
      W("interest rates?|policy rates?|rate (?:cut|cuts|hike|hikes|increase|decrease|decision|path)|monetary policy|basis points?|bps|discount rate|tightening|easing cycle|higher for longer|forward guidance|yields?"),
      C("FOMC"),
    ],
    impliedBy: ["monetary_policy"],
    whyItMatters: "Policy-rate expectations anchor short-term yields and the discount rate applied to other assets.",
    assetClasses: ["Rates", "FX", "Equities"],
    competing: ["growth", "inflation"],
    competingNote: "Yields can move on growth or term-premium news rather than on the policy path itself.",
    invalidation: ["Short-dated yields do not move around the release", "Follow-up central-bank communication contradicts the reading"],
    indicators: ["US2Y proxy (13-week bill) / short-dated yields", "Next policy meeting statement", "Central-bank speeches"],
    assumptions: ["The communication contained information not already priced"],
  },
  {
    id: "growth",
    label: "Growth",
    channel: "Changes in expected economic activity, output or employment.",
    patterns: [C("GDP|PMI"), W("recession|economic growth|slowdown|contraction|retail sales|industrial production|unemployment|payrolls|jobs report|labou?r market|economic outlook|consumer spending")],
    impliedBy: ["growth", "labor"],
    whyItMatters: "Growth expectations drive earnings expectations and, through the policy outlook, yields.",
    assetClasses: ["Equities", "Rates", "Commodities"],
    competing: ["rate_expectations", "risk_appetite"],
    competingNote: "Weak growth can be read as risk-negative (earnings) or risk-positive (easier policy); both readings are common.",
    invalidation: ["Later data revise the reported activity figures", "Equity and yield reactions point in the opposite direction to the growth reading"],
    indicators: ["Next PMI / GDP / payrolls release", "Equity index levels", "US 10Y"],
    assumptions: ["The reported figures are representative and not distorted by one-off factors"],
  },
  {
    id: "fiscal",
    label: "Fiscal",
    channel: "Government spending, taxation, deficits and debt issuance.",
    patterns: [W("budget|deficits?|fiscal|government spending|debt ceiling|stimulus|tax (?:cut|cuts|bill|increase|hike)s?|bond issuance|government shutdown|public debt")],
    impliedBy: ["fiscal"],
    whyItMatters: "Larger deficits can raise bond supply and term premium; fiscal stimulus can lift growth and inflation expectations.",
    assetClasses: ["Rates", "FX"],
    competing: ["growth", "rate_expectations"],
    competingNote: "Bond-market reaction to fiscal news is frequently dominated by monetary-policy expectations.",
    invalidation: ["Long-dated yields do not respond to the fiscal news", "The measure is withdrawn or not enacted"],
    indicators: ["US 10Y", "Treasury auction results (not tracked here)", "Budget office projections"],
    assumptions: ["The fiscal change is large relative to existing expectations"],
  },
  {
    id: "trade",
    label: "Trade",
    channel: "Tariffs, trade agreements and cross-border goods flows.",
    patterns: [W("tariffs?|trade (?:deal|war|talks|deficit|surplus|barriers|agreement)|exports?|imports?|market access|customs dut(?:y|ies)|sanctions?"), C("WTO")],
    impliedBy: ["sanction"],
    whyItMatters: "Trade barriers change import prices, corporate margins and the relative value of currencies.",
    assetClasses: ["FX", "Equities"],
    competing: ["fx", "growth"],
    competingNote: "Announced measures are often negotiated down; the market may treat them as bargaining positions.",
    invalidation: ["Measures are suspended, waived or not implemented", "Affected currencies and equity indices show no reaction"],
    indicators: ["Implementation dates and official texts", "Affected currency pairs and equity indices"],
    assumptions: ["The announced measure will be implemented broadly as described"],
  },
  {
    id: "energy",
    label: "Energy",
    channel: "Supply, demand or price of oil, gas and power.",
    patterns: [C("WTI|LNG|OPEC"), W("oil|crude|brent|natural gas|refiner(?:y|ies)|diesel|gasoline|energy prices|power prices|barrels?")],
    impliedBy: ["commodity_supply"],
    whyItMatters: "Energy prices feed headline inflation and the margins of energy-intensive industries.",
    assetClasses: ["Commodities", "Rates", "Equities"],
    competing: ["supply_chain", "risk_appetite"],
    competingNote: "Price moves may be driven by demand expectations or positioning rather than by the reported supply news.",
    invalidation: ["Reported disruption is resolved or proves smaller than described", "Crude and gas futures do not move"],
    indicators: ["WTI crude (OIL) and natural gas (NATGAS) futures", "OPEC+ statements", "Inventory data (not tracked here)"],
    assumptions: ["The supply or demand change is material relative to global volumes"],
  },
  {
    id: "supply_chain",
    label: "Supply chain",
    channel: "Disruption of shipping routes, production inputs or logistics.",
    patterns: [W("supply chains?|shipping|freight|strait of hormuz|hormuz|red sea|suez|semiconductor shortage|chip (?:export|shortage)s?|rare earths?|port (?:strike|closure)s?|shortages?")],
    impliedBy: [],
    whyItMatters: "Supply disruption raises input costs and delays, affecting inflation and sector earnings.",
    assetClasses: ["Commodities", "Equities"],
    competing: ["energy", "inflation"],
    competingNote: "Disruptions are often temporary; rerouting and inventories can absorb them.",
    invalidation: ["Routes or production reopen quickly", "Freight and input prices do not rise"],
    indicators: ["Freight rates (not tracked here)", "OIL for energy routes", "Sector earnings guidance"],
    assumptions: ["The disruption lasts long enough to affect costs"],
  },
  {
    id: "fx",
    label: "FX",
    channel: "Exchange-rate moves and currency policy.",
    patterns: [C("USD|FX"),
      W("currenc(?:y|ies)|exchange rates?|devaluation|currency intervention|dollar index|(?:strong|stronger|weak|weaker|soaring|sliding|falling|rising) (?:dollar|euro|yen|franc|sterling|pound|yuan)"),
      W("(?:dollar|euro|yen|franc|sterling|pound|yuan|renminbi)\\W+(?:\\w+\\W+){0,2}?(?:rises?|rose|falls?|fell|slides?|slid|gains?|gained|weakens?|weakened|strengthens?|strengthened|drops?|dropped|jumps?|jumped|climbs?|climbed|tumbles?|tumbled|rall(?:y|ies|ied)|strength|weakness|hits? (?:a )?(?:record|high|low))"),],
    impliedBy: ["fx_regime"],
    whyItMatters: "Currency moves change import prices, foreign earnings translation and cross-border capital returns.",
    assetClasses: ["FX"],
    competing: ["rate_expectations", "capital_flows"],
    competingNote: "Currency moves are usually explained by rate differentials; event-specific readings compete with that.",
    invalidation: ["The currency pair does not move or reverses", "Official intervention or statements contradict the reading"],
    indicators: ["DXY, EURUSD, USDJPY", "Central-bank FX statements"],
    assumptions: ["The currency mention is substantive, not incidental"],
  },
  {
    id: "credit",
    label: "Credit",
    channel: "Default risk, lending conditions and credit spreads.",
    patterns: [W("credit (?:markets?|spreads?|conditions|crunch|stress|ratings?|downgrades?|risk|losses|event|cycle)|(?:bond|yield|corporate) spreads?|defaults?|bankruptc(?:y|ies)|downgrades?|high[- ]yield|junk bonds?|private credit|loan losses|bank failures?|non-performing")],
    impliedBy: ["credit"],
    whyItMatters: "Wider credit spreads raise funding costs and often coincide with lower equity valuations.",
    assetClasses: ["Credit", "Equities"],
    competing: ["liquidity", "risk_appetite"],
    competingNote: "Isolated defaults may be idiosyncratic rather than a sign of broad credit deterioration.",
    invalidation: ["Credit spreads stay unchanged", "The issue is contained to a single issuer"],
    indicators: ["Credit spreads (not tracked here)", "VIX", "Bank equity indices"],
    assumptions: ["The credit event is not purely idiosyncratic"],
  },
  {
    id: "liquidity",
    label: "Liquidity",
    channel: "Central-bank balance sheets, funding markets and money supply.",
    patterns: [W("liquidity|balance sheet|quantitative (?:easing|tightening)|repo|bank reserves|funding (?:markets?|stress)|standing (?:repo )?facility|discount window|current account balances|money supply|swap lines?"), C("QE|QT")],
    impliedBy: ["liquidity"],
    whyItMatters: "Changes in system liquidity affect funding costs and are often discussed as a driver of risk-asset demand.",
    assetClasses: ["Rates", "Equities", "Crypto"],
    competing: ["rate_expectations", "risk_appetite"],
    competingNote: "The link between liquidity measures and asset prices is debated and unstable over time.",
    invalidation: ["Funding-market rates are unchanged", "Balance-sheet data show no change of the described size"],
    indicators: ["Short-dated yields", "Central-bank balance-sheet releases"],
    assumptions: ["The liquidity change is large relative to system size"],
  },
  {
    id: "risk_appetite",
    label: "Risk appetite",
    channel: "Investor willingness to hold risky assets.",
    patterns: [W("sell-?off|rally|fear gauge|volatility|risk appetite|risk-off|risk-on|worst week|best week|record high|rout|plunges?|tumbles?|slides?|surges?|safe[- ]haven"), C("VIX")],
    impliedBy: ["geopolitics"],
    whyItMatters: "Shifts in risk appetite move many risky assets together and raise implied volatility.",
    assetClasses: ["Equities", "Volatility", "Crypto"],
    competing: ["growth", "rate_expectations"],
    competingNote: "Text describing a market move reports an observation; the cause of the move is usually contested.",
    invalidation: ["Volatility normalises quickly", "Moves reverse within the next sessions"],
    indicators: ["VIX", "Equity indices (SPX, NDX)"],
    assumptions: ["The move reflects a broad change in risk appetite rather than a sector rotation"],
  },
  {
    id: "regulation",
    label: "Regulation",
    channel: "Rules, supervision and enforcement affecting market participants.",
    patterns: [C("SEC|CFTC"), W("regulat(?:ion|ions|ory|or|ors)|enforcement|(?:settles?|settled) charges|charged (?:with|by)|rulemaking|proposed rule|capital requirements|Basel|supervis(?:ion|ory)|antitrust|licen[cs]es?|compliance|consultation")],
    exclude: /\b(?:former employees?|termination of (?:an |the )?enforcement action)\b/i,
    impliedBy: ["regulation"],
    whyItMatters: "Rule changes alter costs, permitted activities or capital for specific sectors.",
    assetClasses: ["Equities", "Crypto"],
    competing: ["credit"],
    competingNote: "Most regulatory items are sector-specific; broad market relevance is the exception.",
    invalidation: ["The rule is withdrawn, delayed or materially changed", "The affected sector shows no reaction"],
    indicators: ["Final rule texts and effective dates", "Sector equity indices (not tracked here)"],
    assumptions: ["The rule is adopted broadly as proposed"],
  },
  {
    id: "capital_flows",
    label: "Capital flows",
    channel: "Cross-border investment, sanctions on assets, and fund flows.",
    patterns: [W("capital (?:flows?|outflows?|inflows?|controls)|foreign investment|outflows?|inflows?|sanctions?|asset freeze|frozen assets|reserve assets|portfolio flows|fund flows|ETF flows|repatriation")],
    impliedBy: ["sanction"],
    whyItMatters: "Changes in cross-border flows affect currencies and local asset prices of the countries involved.",
    assetClasses: ["FX", "Equities"],
    competing: ["trade", "fx"],
    competingNote: "Flow data are noisy and often revised; announced restrictions can be waived.",
    invalidation: ["Restrictions are waived or not enforced", "Flow data show no change"],
    indicators: ["Affected currencies", "Fund-flow reports (not tracked here)"],
    assumptions: ["The measure binds on a meaningful share of flows"],
  },
];

export const MECHANISM_BY_ID: Record<MechanismId, MechanismDef> = Object.fromEntries(MECHANISMS.map((m) => [m.id, m])) as Record<MechanismId, MechanismDef>;

export interface MechanismTag {
  id: MechanismId;
  label: string;
  basis: "text_match" | "classifier_event_type";
  matched: string[];
  rule: string;
}

function matchesOf(re: RegExp, text: string): string[] {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const out = new Set<string>();
  for (const m of Array.from(text.matchAll(g))) {
    out.add(m[0].toLowerCase());
    if (out.size >= 5) break;
  }
  return Array.from(out);
}

/** Tags mechanisms from the observed text (title + summary) and, separately, from the classifier event type. */
export function tagMechanisms(text: string, eventType?: EventType): MechanismTag[] {
  const tags: MechanismTag[] = [];
  for (const m of MECHANISMS) {
    const matched = m.exclude && m.exclude.test(text) ? [] : m.patterns.flatMap((p) => matchesOf(p, text));
    if (matched.length) {
      tags.push({ id: m.id, label: m.label, basis: "text_match", matched: Array.from(new Set(matched)).slice(0, 5), rule: `${RULES_VERSION}:${m.id}:text` });
    } else if (eventType && m.impliedBy.includes(eventType)) {
      tags.push({ id: m.id, label: m.label, basis: "classifier_event_type", matched: [], rule: `${RULES_VERSION}:${m.id}:event_type=${eventType}` });
    }
  }
  return tags;
}

export type RegionId = "US" | "EA" | "UK" | "JP" | "CN" | "CH" | "CA" | "RU_UA" | "MIDEAST" | "GLOBAL";

export const REGIONS: { id: RegionId; label: string; patterns: RegExp[] }[] = [
  { id: "US", label: "United States", patterns: [C("U\\.S\\.|US|USA|Fed|FOMC|SEC|CFTC"), W("United States|American?|Federal Reserve|Treasury|Wall Street|Nasdaq|S&P 500|Dow Jones|White House|Congress|Powell|Trump")] },
  { id: "EA", label: "Euro area", patterns: [C("ECB|EU"), W("euro ?(?:zone|area)|Lagarde|Eurogroup|European Central Bank|European Union|Germany|German|France|French|Italy|Italian|Spain|Spanish|Bunds?")] },
  { id: "UK", label: "United Kingdom", patterns: [C("BoE|UK"), W("Bank of England|Britain|British|United Kingdom|sterling|FTSE|gilts?")] },
  { id: "JP", label: "Japan", patterns: [C("BoJ|BOJ|JGBs?"), W("Bank of Japan|Japan(?:ese)?|yen|Nikkei")] },
  { id: "CN", label: "China", patterns: [C("PBOC|PBoC"), W("China|Chinese|Beijing|yuan|renminbi|Hong Kong|Hang Seng")] },
  { id: "CH", label: "Switzerland", patterns: [C("SNB(?! Bancshares)"), W("Swiss National Bank|Switzerland|Swiss|Swiss franc")] },
  { id: "CA", label: "Canada", patterns: [W("Bank of Canada|Canada|Canadian")] },
  { id: "RU_UA", label: "Russia / Ukraine", patterns: [W("Russia(?:n)?|Ukrain(?:e|ian)|Kremlin|Putin")] },
  { id: "MIDEAST", label: "Middle East", patterns: [C("OPEC"), W("Iran(?:ian)?|Israel(?:i)?|Hormuz|Saudi|Persian Gulf|Red Sea|Yemen|Houthis?")] },
  { id: "GLOBAL", label: "Global / multilateral", patterns: [C("IMF|BIS|FSB|G20|G7|IMFC"), W("Basel Committee|Financial Stability Board|World Bank|global economy")] },
];

export const INDUSTRIES: { id: string; label: string; pattern: RegExp }[] = [
  { id: "banks", label: "Banks & financials", pattern: W("banks?|banking|lenders?|financial institutions?|brokers?|asset managers?|insurers?|Citigroup|JPMorgan|Mastercard|Visa|payments?") },
  { id: "energy", label: "Energy", pattern: W("oil|gas|energy|refiner(?:y|ies)|OPEC\\+?|crude|LNG|utilities") },
  { id: "technology", label: "Technology & semiconductors", pattern: W("artificial intelligence|AI trade|tech(?:nology)?|semiconductors?|chips?|software|Nvidia|Apple|Microsoft|cloud") },
  { id: "autos", label: "Autos", pattern: W("autos?|automakers?|car makers?|vehicles?|electric vehicles?|Tesla") },
  { id: "real_estate", label: "Real estate", pattern: W("real estate|housing|mortgages?|property|home ?builders?") },
  { id: "consumer", label: "Consumer", pattern: W("consumers?|retail(?:ers)?|spending|restaurants?|streaming|travel|airlines?") },
  { id: "industrials", label: "Industrials & defence", pattern: W("industrials?|manufactur(?:ing|ers?)|defen[cs]e|aerospace|machinery") },
  { id: "materials", label: "Materials & mining", pattern: W("metals?|mining|miners?|copper|steel|aluminium|aluminum|rare earths?|gold|silver") },
  { id: "transport", label: "Transport & shipping", pattern: W("shipping|freight|ports?|tankers?|logistics|rail") },
  { id: "healthcare", label: "Healthcare", pattern: W("health ?care|pharma(?:ceutical)?s?|drugs?|biotech|hospitals?") },
  { id: "digital_assets", label: "Digital assets", pattern: W("crypto(?:currenc(?:y|ies))?|bitcoin|ether(?:eum)?|stablecoins?|tokens?|blockchain|digital assets?|DeFi") },
  { id: "agriculture", label: "Agriculture", pattern: W("agricultur(?:e|al)|grain|wheat|corn|soybeans?|fertili[sz]ers?") },
];

export function tagRegions(text: string, sourceRegion?: RegionId | null): { id: RegionId; label: string; basis: "text_match" | "issuing_institution"; matched: string[] }[] {
  const out: { id: RegionId; label: string; basis: "text_match" | "issuing_institution"; matched: string[] }[] = [];
  for (const r of REGIONS) {
    const matched = r.patterns.flatMap((p) => matchesOf(p, text));
    if (matched.length) out.push({ id: r.id, label: r.label, basis: "text_match", matched: matched.slice(0, 4) });
  }
  if (sourceRegion && !out.some((r) => r.id === sourceRegion)) {
    const r = REGIONS.find((x) => x.id === sourceRegion);
    if (r) out.unshift({ id: r.id, label: r.label, basis: "issuing_institution", matched: [] });
  }
  return out;
}

export function tagIndustries(text: string): { id: string; label: string; matched: string[] }[] {
  const out: { id: string; label: string; matched: string[] }[] = [];
  for (const ind of INDUSTRIES) {
    const matched = matchesOf(ind.pattern, text);
    if (matched.length) out.push({ id: ind.id, label: ind.label, matched: matched.slice(0, 4) });
  }
  return out;
}
