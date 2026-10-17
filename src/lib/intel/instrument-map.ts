/**
 * Curated mechanism -> tracked-instrument map (event_map_v1).
 *
 * Audit finding (Batch 3): the legacy scenario engine's inferAssets() attached instruments by headline
 * keywords (e.g. /fed|us|usd/ matched "us" inside ordinary words and attached SPX/US10Y/DXY; any
 * "bitcoin" mention attached BTC; a fallback attached SPX/VIX/US10Y to everything). That is replaced
 * for v2 scenarios by this table. A mapping is produced only when
 *   (1) the event has a TEXT-MATCHED transmission mechanism (classifier-implied tags are not enough), and
 *   (2) the event concerns a region in the entry's scope (text match or issuing institution), and
 *   (3) for entries with `requires`, the text also names the specific object of the mechanism
 *       (e.g. natural gas for NATGAS) - this refines a mechanism, it never creates one on its own.
 * Crypto assets are linked to events only by a contract address found in the event text (matched to
 * crypto_contracts) or by an explicit CoinGecko coin id/URL - never by ticker or name alone.
 *
 * Direction is given only when it is supportable from the observed classification (directional sentiment
 * with classifier confidence >= 0.5) or from an explicit supply-disruption statement; otherwise null.
 * "up" means the instrument's quoted level rises (for yields: the yield rises).
 */
import type { TimeHorizon } from "../types";
import type { MechanismId, RegionId } from "./mechanisms";

export const MAP_VERSION = "event_map_v1";

export type Direction = "up" | "down" | null;
export type Sentiment = "hawkish" | "dovish" | "risk_on" | "risk_off" | "neutral" | "mixed";

export interface MapEntry {
  mechanism: MechanismId;
  regions: RegionId[];
  symbol: string;
  relation: string;
  horizon: TimeHorizon;
  confidence: "low" | "medium";
  /** Direction by sentiment; omitted keys mean no supportable direction. */
  directionBySentiment?: Partial<Record<Sentiment, Direction>>;
  /** Optional refinement: text must also name the object of the mechanism. */
  requires?: RegExp;
  /** Direction when the text explicitly describes a supply disruption. */
  disruptionDirection?: Direction;
  assumptions: string[];
  evidenceLimits: string[];
  competing: string[];
}

const HAWK_UP = { hawkish: "up", dovish: "down" } as const;
const RISK_OFF_UP = { risk_off: "up", risk_on: "down" } as const;
const RISK_OFF_DOWN = { risk_off: "down", risk_on: "up" } as const;

const NO_SURPRISE = "The surprise versus market expectations is not observed; only the reported content is.";
const MOVE_NOT_CAUSE = "A co-occurring price move would not show that this event caused it.";

export const INSTRUMENT_MAP: MapEntry[] = [
  // Rate expectations
  { mechanism: "rate_expectations", regions: ["US"], symbol: "US2Y", relation: "Short-dated US yields price the expected Fed policy path.", horizon: "1-7d", confidence: "medium", directionBySentiment: HAWK_UP, assumptions: ["The communication changes the expected policy path"], evidenceLimits: ["US2Y is proxied by the 13-week T-bill (^IRX), which reacts to the near-term path only", NO_SURPRISE], competing: ["Growth data released the same day", "Bill supply effects"] },
  { mechanism: "rate_expectations", regions: ["US"], symbol: "US10Y", relation: "Long yields partly reflect the expected policy path.", horizon: "1-4w", confidence: "low", directionBySentiment: HAWK_UP, assumptions: ["Term premium is broadly unchanged"], evidenceLimits: ["Long yields are dominated by term premium and growth expectations on many days", NO_SURPRISE], competing: ["Term premium / fiscal supply", "Growth expectations"] },
  { mechanism: "rate_expectations", regions: ["US"], symbol: "DXY", relation: "Relative policy-rate expectations are a standard driver of the dollar.", horizon: "1-4w", confidence: "low", directionBySentiment: HAWK_UP, assumptions: ["Other central banks' expectations are unchanged"], evidenceLimits: ["DXY is weighted ~58% to EUR; ECB news can dominate", NO_SURPRISE], competing: ["Risk appetite (safe-haven demand)", "ECB/BoJ policy news"] },
  { mechanism: "rate_expectations", regions: ["US"], symbol: "SPX", relation: "Discount-rate channel for equity valuations.", horizon: "1-4w", confidence: "low", assumptions: ["Earnings expectations unchanged"], evidenceLimits: ["Sign is ambiguous: easier policy can signal weaker growth", MOVE_NOT_CAUSE], competing: ["Earnings season", "Growth news"] },
  { mechanism: "rate_expectations", regions: ["EA"], symbol: "EURUSD", relation: "ECB policy expectations relative to the Fed drive EUR/USD.", horizon: "1-4w", confidence: "low", directionBySentiment: HAWK_UP, assumptions: ["Fed expectations unchanged over the same window"], evidenceLimits: [NO_SURPRISE], competing: ["US data and Fed communication"] },
  { mechanism: "rate_expectations", regions: ["EA"], symbol: "DE10Y", relation: "Bund yields reflect the expected ECB path.", horizon: "1-4w", confidence: "low", directionBySentiment: HAWK_UP, assumptions: ["Term premium unchanged"], evidenceLimits: ["DE10Y source quality is an open owner decision (Bundesbank swap)", NO_SURPRISE], competing: ["Fiscal supply", "Global yields"] },
  { mechanism: "rate_expectations", regions: ["EA"], symbol: "SX5E", relation: "Discount-rate channel for euro-area equities.", horizon: "1-4w", confidence: "low", assumptions: ["Earnings expectations unchanged"], evidenceLimits: ["Sign ambiguous", MOVE_NOT_CAUSE], competing: ["Earnings", "Energy prices"] },
  { mechanism: "rate_expectations", regions: ["JP"], symbol: "USDJPY", relation: "BoJ policy expectations versus the Fed drive USD/JPY.", horizon: "1-4w", confidence: "low", directionBySentiment: { hawkish: "down", dovish: "up" }, assumptions: ["Fed expectations unchanged"], evidenceLimits: ["Hawkish here means hawkish BoJ; classifier sentiment does not record which bank", NO_SURPRISE], competing: ["Fed communication", "MoF intervention"] },
  { mechanism: "rate_expectations", regions: ["UK"], symbol: "UKX", relation: "Discount-rate channel for UK equities.", horizon: "1-4w", confidence: "low", assumptions: ["Earnings expectations unchanged"], evidenceLimits: ["FTSE 100 earnings are largely foreign; GBP effects offset", MOVE_NOT_CAUSE], competing: ["Sterling moves", "Commodity prices"] },
  // Inflation (direction depends on surprise -> not supportable)
  { mechanism: "inflation", regions: ["US"], symbol: "US2Y", relation: "Inflation news shifts the expected Fed path.", horizon: "1-7d", confidence: "low", assumptions: ["The figure differs from expectations"], evidenceLimits: [NO_SURPRISE, "^IRX proxy"], competing: ["Growth data"] },
  { mechanism: "inflation", regions: ["US"], symbol: "US10Y", relation: "Inflation expectations are a component of nominal yields.", horizon: "1-4w", confidence: "low", assumptions: ["The figure differs from expectations"], evidenceLimits: [NO_SURPRISE], competing: ["Term premium", "Growth"] },
  { mechanism: "inflation", regions: ["US", "GLOBAL"], symbol: "GOLD", relation: "Gold is commonly discussed as an inflation hedge.", horizon: "1-3m", confidence: "low", assumptions: ["Real yields do not rise by more than inflation expectations"], evidenceLimits: ["Gold's link to inflation is weak and unstable at short horizons", NO_SURPRISE], competing: ["Real yields", "Safe-haven demand", "Central-bank purchases"] },
  { mechanism: "inflation", regions: ["EA"], symbol: "DE10Y", relation: "Euro-area inflation shifts the expected ECB path.", horizon: "1-4w", confidence: "low", assumptions: ["The figure differs from expectations"], evidenceLimits: [NO_SURPRISE], competing: ["Energy prices"] },
  // Growth
  { mechanism: "growth", regions: ["US"], symbol: "SPX", relation: "Growth expectations drive earnings expectations.", horizon: "1-4w", confidence: "low", assumptions: ["The data are not offset by policy expectations"], evidenceLimits: ["Weak data can lift equities via easier policy", NO_SURPRISE], competing: ["Rate expectations"] },
  { mechanism: "growth", regions: ["US"], symbol: "US10Y", relation: "Growth expectations feed real yields.", horizon: "1-4w", confidence: "low", assumptions: ["Inflation expectations unchanged"], evidenceLimits: [NO_SURPRISE], competing: ["Inflation", "Term premium"] },
  { mechanism: "growth", regions: ["EA"], symbol: "SX5E", relation: "Euro-area growth expectations drive earnings expectations.", horizon: "1-4w", confidence: "low", assumptions: ["No offsetting policy response"], evidenceLimits: [NO_SURPRISE], competing: ["Rate expectations"] },
  { mechanism: "growth", regions: ["JP"], symbol: "NKY", relation: "Japanese growth expectations drive earnings expectations.", horizon: "1-4w", confidence: "low", assumptions: ["Yen broadly unchanged"], evidenceLimits: ["Nikkei is heavily exposed to the yen and global demand"], competing: ["FX"] },
  { mechanism: "growth", regions: ["CN"], symbol: "HSI", relation: "Chinese growth expectations drive Hong Kong-listed earnings.", horizon: "1-4w", confidence: "low", assumptions: ["No offsetting policy stimulus"], evidenceLimits: ["Policy and regulatory news often dominate"], competing: ["Regulation", "Stimulus"] },
  { mechanism: "growth", regions: ["GLOBAL"], symbol: "MSCI_WORLD", relation: "Global growth expectations drive aggregate earnings expectations.", horizon: "1-3m", confidence: "low", assumptions: ["The assessment is representative of global activity"], evidenceLimits: ["Multilateral outlooks are slow-moving and widely anticipated"], competing: ["Rate expectations"] },
  // Fiscal
  { mechanism: "fiscal", regions: ["US"], symbol: "US10Y", relation: "Deficits and issuance can raise term premium on long yields.", horizon: "1-3m", confidence: "low", assumptions: ["Issuance expectations change"], evidenceLimits: ["Effect usually small and slow; widely anticipated"], competing: ["Rate expectations", "Growth"] },
  // Trade
  { mechanism: "trade", regions: ["CN"], symbol: "HSI", relation: "Trade measures affecting China change Hong Kong-listed earnings expectations.", horizon: "1-4w", confidence: "low", assumptions: ["Measures are implemented"], evidenceLimits: ["Announcements are often negotiated or waived"], competing: ["Domestic stimulus"] },
  { mechanism: "trade", regions: ["US"], symbol: "SPX", relation: "Tariffs change import costs and margins for US companies.", horizon: "1-4w", confidence: "low", assumptions: ["Measures are implemented"], evidenceLimits: ["Sign and size depend on scope and retaliation"], competing: ["Rate expectations", "Earnings"] },
  // Energy (direct price object)
  { mechanism: "energy", regions: ["US", "MIDEAST", "RU_UA", "GLOBAL", "EA", "CN", "UK", "JP", "CA", "CH"], symbol: "OIL", relation: "Crude supply/demand news acts directly on crude futures.", horizon: "1-7d", confidence: "medium", requires: /\b(?:oil|crude|brent|wti|opec\+?|barrels?|refiner(?:y|ies)|diesel)\b/i, disruptionDirection: "up", assumptions: ["The volume affected is material relative to global supply"], evidenceLimits: ["WTI futures (CL=F) differ from Brent; the text may refer to Brent", MOVE_NOT_CAUSE], competing: ["Demand expectations", "OPEC+ policy", "Positioning"] },
  { mechanism: "energy", regions: ["US", "EA", "UK", "RU_UA", "MIDEAST", "GLOBAL"], symbol: "NATGAS", relation: "Gas supply/demand news acts directly on gas futures.", horizon: "1-7d", confidence: "medium", requires: /\b(?:natural gas|lng|gas prices?|gas supply)\b/i, disruptionDirection: "up", assumptions: ["The affected volume is material for the relevant hub"], evidenceLimits: ["NG=F is the US Henry Hub contract; European gas (TTF) is not tracked"], competing: ["Weather", "Storage levels"] },
  // Supply chain (energy routes only; other disruptions have no tracked instrument)
  { mechanism: "supply_chain", regions: ["MIDEAST"], symbol: "OIL", relation: "Disruption of energy shipping routes can restrict crude supply.", horizon: "1-7d", confidence: "low", requires: /\b(?:hormuz|red sea|suez|tankers?)\b/i, disruptionDirection: "up", assumptions: ["Shipping is actually curtailed"], evidenceLimits: ["Rerouting and inventories can absorb disruption", MOVE_NOT_CAUSE], competing: ["Demand expectations"] },
  // FX
  { mechanism: "fx", regions: ["US"], symbol: "DXY", relation: "Dollar-specific news acts on the dollar index.", horizon: "1-7d", confidence: "low", assumptions: ["The dollar mention is substantive"], evidenceLimits: ["DXY is EUR-heavy"], competing: ["Rate expectations"] },
  { mechanism: "fx", regions: ["EA"], symbol: "EURUSD", relation: "Euro-specific news acts on EUR/USD.", horizon: "1-7d", confidence: "low", assumptions: ["The euro mention is substantive"], evidenceLimits: ["Also driven by US news"], competing: ["Rate expectations"] },
  { mechanism: "fx", regions: ["JP"], symbol: "USDJPY", relation: "Yen-specific news (incl. intervention) acts on USD/JPY.", horizon: "1-7d", confidence: "low", assumptions: ["The yen mention is substantive"], evidenceLimits: ["Also driven by US yields"], competing: ["Rate expectations"] },
  // Credit
  { mechanism: "credit", regions: ["US", "GLOBAL"], symbol: "VIX", relation: "Credit stress and equity implied volatility tend to rise together.", horizon: "1-4w", confidence: "low", assumptions: ["The credit issue is not idiosyncratic"], evidenceLimits: ["Credit spreads themselves are not tracked here", MOVE_NOT_CAUSE], competing: ["Risk appetite"] },
  // Liquidity
  { mechanism: "liquidity", regions: ["US"], symbol: "US2Y", relation: "Fed balance-sheet and funding conditions affect short-dated rates.", horizon: "1-4w", confidence: "low", assumptions: ["The change is large relative to reserves"], evidenceLimits: ["^IRX proxy"], competing: ["Rate expectations"] },
  { mechanism: "liquidity", regions: ["US"], symbol: "BTC", relation: "USD liquidity conditions are often discussed as a driver of crypto demand.", horizon: "1-3m", confidence: "low", assumptions: ["The liquidity change is broad-based"], evidenceLimits: ["Linked by CoinGecko id 'bitcoin' through the mechanism, not by any mention", "The liquidity-crypto relationship is empirically unstable"], competing: ["Crypto-specific flows and news", "Risk appetite"] },
  { mechanism: "liquidity", regions: ["JP"], symbol: "USDJPY", relation: "BoJ balance-sheet and reserve conditions affect yen funding.", horizon: "1-4w", confidence: "low", assumptions: ["The change is material"], evidenceLimits: ["Routine statistical releases rarely move markets"], competing: ["Rate expectations"] },
  // Risk appetite
  { mechanism: "risk_appetite", regions: ["US", "GLOBAL", "MIDEAST", "RU_UA"], symbol: "VIX", relation: "VIX measures implied volatility on the S&P 500, a standard risk-appetite gauge.", horizon: "1-7d", confidence: "medium", directionBySentiment: RISK_OFF_UP, assumptions: ["The described shift is broad rather than sector-specific"], evidenceLimits: ["Text describing a move reports an observation, not a cause", MOVE_NOT_CAUSE], competing: ["Scheduled events (options expiry, data)"] },
  { mechanism: "risk_appetite", regions: ["US", "GLOBAL"], symbol: "SPX", relation: "Broad risk appetite moves the main US equity index.", horizon: "1-7d", confidence: "low", directionBySentiment: RISK_OFF_DOWN, assumptions: ["The shift is broad"], evidenceLimits: [MOVE_NOT_CAUSE], competing: ["Earnings", "Rate expectations"] },
];

export interface CandidateMapping {
  symbol: string;
  mechanism: MechanismId;
  linkBasis: "mechanism_region_map" | "contract_address" | "coingecko_id";
  direction: Direction;
  directionBasis: string;
  horizon: TimeHorizon;
  confidence: "low" | "medium";
  rationale: string;
  assumptions: string[];
  evidenceLimits: string[];
  competing: string[];
  instrumentId?: string | null;
  matched?: string;
}

const DISRUPTION = /\b(?:attacks?|disrupt(?:ion|ed|s)?|halt(?:s|ed)?|outages?|shut(?:s|down)?|blockade|cuts? (?:output|production|supply)|escalat(?:es|ed|ion))\b/i;

export function mapEventToInstruments(input: {
  text: string;
  mechanisms: { id: MechanismId; basis: string }[];
  regions: RegionId[];
  sentiment: Sentiment;
  classifierConfidence: number;
}): CandidateMapping[] {
  const textMech = new Set(input.mechanisms.filter((m) => m.basis === "text_match").map((m) => m.id));
  const regions = new Set(input.regions);
  const directional = input.classifierConfidence >= 0.5 && ["hawkish", "dovish", "risk_on", "risk_off"].includes(input.sentiment);
  const out: CandidateMapping[] = [];
  for (const e of INSTRUMENT_MAP) {
    if (!textMech.has(e.mechanism)) continue;
    if (!e.regions.some((r) => regions.has(r))) continue;
    if (e.requires && !e.requires.test(input.text)) continue;
    let direction: Direction = null;
    let directionBasis = "No supportable direction: depends on information not observed (surprise vs expectations, other drivers).";
    if (directional && e.directionBySentiment && e.directionBySentiment[input.sentiment] !== undefined) {
      direction = e.directionBySentiment[input.sentiment] ?? null;
      directionBasis = `Conditional on classifier sentiment '${input.sentiment}' (heuristic, confidence ${input.classifierConfidence.toFixed(2)}); not an observed move.`;
    } else if (e.disruptionDirection && DISRUPTION.test(input.text)) {
      direction = e.disruptionDirection;
      directionBasis = "Text describes a supply disruption; direction applies only if the disruption is real and material.";
    }
    out.push({
      symbol: e.symbol,
      mechanism: e.mechanism,
      linkBasis: "mechanism_region_map",
      direction,
      directionBasis,
      horizon: e.horizon,
      confidence: e.confidence,
      rationale: e.relation,
      assumptions: e.assumptions,
      evidenceLimits: e.evidenceLimits,
      competing: e.competing,
    });
  }
  // One row per symbol+mechanism (entries are unique on that pair by construction).
  return out;
}

/** EVM contract addresses and explicit CoinGecko coin URLs/ids in text. Tickers and names are ignored by design. */
export function extractCryptoIdentifiers(text: string): { contracts: string[]; coingeckoIds: string[] } {
  const contracts = Array.from(new Set((text.match(/\b0x[a-fA-F0-9]{40}\b/g) || []).map((s) => s.toLowerCase())));
  const ids = new Set<string>();
  for (const m of Array.from(text.matchAll(/coingecko\.com\/(?:[a-z]{2}\/)?coins\/([a-z0-9-]+)/gi))) ids.add(m[1].toLowerCase());
  for (const m of Array.from(text.matchAll(/\bcoingecko[_ -]id[:=\s]+([a-z0-9-]+)/gi))) ids.add(m[1].toLowerCase());
  return { contracts, coingeckoIds: Array.from(ids) };
}
