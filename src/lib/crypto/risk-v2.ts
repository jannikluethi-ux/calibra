/**
 * crypto_risk_v2: transparent multi-factor risk model (pure, no DB, no network).
 *
 * NOT a trading signal. A higher score means more ways the asset can fail or be hard to exit,
 * not that it will fall. Weights are expert-designed and NOT validated against outcomes.
 * Methodology: docs/crypto-risk-methodology.md (kept in sync with the constants below).
 *
 * Rules that keep it honest:
 *  - A factor without a real input is UNKNOWN (score null). Unknown never lowers the score and
 *    always lowers confidence. Unknown is never shown as safe.
 *  - Score (how risky) and confidence (how sure) are separate numbers.
 *  - "High risk" needs a structural factor (liquidity, size, dilution, security, peg). Volatility or a
 *    price decline alone never makes an asset high risk; it is labeled "volatility only".
 *  - Integer scores only (no false precision).
 */

export const MODEL_VERSION = "crypto_risk_v2";

export type Basis = "measured" | "reported" | "corroborated" | "model-derived" | "qualitative" | "unknown";

export type FactorKey =
  | "market_volatility"
  | "liquidity"
  | "market_size"
  | "dilution"
  | "security"
  | "stablecoin_peg"
  | "holder_concentration"
  | "governance"
  | "regulatory"
  | "transparency";

export interface FactorDef {
  key: FactorKey;
  label: string;
  weight: number;
  structural: boolean;
  applicable?: (i: RiskInputs) => boolean;
}

/** Expert-designed weights (not validated). Sum over applicable factors is renormalized. */
export const FACTORS: FactorDef[] = [
  { key: "market_volatility", label: "Market / volatility", weight: 0.15, structural: false },
  { key: "liquidity", label: "Liquidity", weight: 0.2, structural: true },
  { key: "market_size", label: "Market size (fragility)", weight: 0.1, structural: true },
  { key: "dilution", label: "Tokenomics / dilution", weight: 0.15, structural: true },
  { key: "security", label: "Security / protocol incidents", weight: 0.15, structural: true },
  { key: "stablecoin_peg", label: "Stablecoin peg", weight: 0.15, structural: true, applicable: (i) => isUsdStablecoin(i) },
  { key: "holder_concentration", label: "Holder concentration", weight: 0.1, structural: true },
  { key: "governance", label: "Governance", weight: 0.05, structural: true },
  { key: "regulatory", label: "Regulatory", weight: 0.1, structural: true },
  { key: "transparency", label: "Transparency", weight: 0.05, structural: true },
];

export const BANDS = [
  { band: "low", min: 0 },
  { band: "moderate", min: 25 },
  { band: "elevated", min: 45 },
  { band: "high", min: 65 },
  { band: "extreme", min: 85 },
] as const;
export type Band = (typeof BANDS)[number]["band"] | "insufficient_data";

export const MIN_COVERAGE = 0.35; // share of applicable weight that must be scored to assign a band
export const STRUCTURAL_THRESHOLD = 65;
export const STALE_MARKET_DATA_H = 36;

export type RiskType = "structural" | "volatility_only" | "none_flagged" | "insufficient_data";

export interface SecurityIncident {
  date: string; // ISO
  amountUsd: number | null;
  returnedUsd: number | null;
  classification: string | null;
  technique: string | null;
  name: string;
}

export interface RiskInputs {
  id: string;
  symbol: string;
  name: string;
  now: string;
  marketDataAt: string | null; // provider timestamp of the quote
  retrievedAt: string | null; // when Calibra fetched it
  price: number | null;
  marketCap: number | null;
  fdv: number | null;
  volume24h: number | null;
  circulating: number | null;
  total: number | null;
  max: number | null;
  change7d: number | null;
  change30d: number | null;
  athChangePct: number | null;
  vol30d: number | null; // annualized %, model-derived from daily history
  historyDays: number;
  categories: string[]; // known CoinGecko category memberships (absence = unknown)
  networks: string[]; // networks with a known contract address
  platformDataKnown: boolean; // true when the CoinGecko platform list was retrieved for this id
  symbolCollisions: number; // other instruments with the same ticker
  incidents: SecurityIncident[] | null; // null = not mapped to an incident database
  priceSources: number;
  priceDisagreement: boolean;
}

export interface FactorResult {
  key: FactorKey;
  label: string;
  weight: number;
  structural: boolean;
  applicable: boolean;
  score: number | null;
  basis: Basis;
  evidence: string[];
  asOf: string | null;
  source: string | null;
}

export interface RiskResult {
  modelVersion: string;
  score: number | null;
  band: Band;
  riskType: RiskType;
  highRisk: boolean;
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  confidenceParts: Record<string, number>;
  coverage: number;
  factors: FactorResult[];
  structuralKeys: FactorKey[];
  reasons: string[];
  flags: string[];
}

export function isUsdStablecoin(i: Pick<RiskInputs, "categories" | "symbol" | "name">): boolean {
  if (!i.categories.includes("stablecoins")) return false;
  return /usd|dollar/i.test(`${i.symbol} ${i.name}`);
}

const fmtUsd = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;

function step(value: number, cuts: [number, number][], last: number): number {
  for (const [lim, s] of cuts) if (value < lim) return s;
  return last;
}

function ageHours(iso: string | null, now: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (Date.parse(now) - t) / 3600_000 : null;
}

export function scoreFactors(i: RiskInputs): FactorResult[] {
  const asOf = i.marketDataAt ?? i.retrievedAt;
  const cg = "CoinGecko /coins/markets";
  const out: FactorResult[] = [];
  const push = (def: FactorDef, f: Omit<FactorResult, "key" | "label" | "weight" | "structural" | "applicable">) =>
    out.push({ key: def.key, label: def.label, weight: def.weight, structural: def.structural, applicable: def.applicable ? def.applicable(i) : true, ...f });

  for (const def of FACTORS) {
    switch (def.key) {
      case "market_volatility": {
        if (i.vol30d != null) {
          const s = step(i.vol30d, [[40, 15], [70, 35], [100, 55], [150, 75]], 90);
          push(def, { score: s, basis: "model-derived", evidence: [`30-day realized volatility ${i.vol30d.toFixed(0)}% annualized (from ${i.historyDays} daily prices)`], asOf, source: "CoinGecko daily prices" });
        } else if (i.change30d != null) {
          const a = Math.abs(i.change30d);
          const s = step(a, [[10, 20], [25, 40], [50, 60], [100, 80]], 90);
          push(def, { score: s, basis: "reported", evidence: [`30-day price change ${i.change30d.toFixed(1)}% (reported; no daily history yet, so this is a single-period move, not volatility)`], asOf, source: cg });
        } else {
          push(def, { score: null, basis: "unknown", evidence: ["No price history or 30-day change available"], asOf: null, source: null });
        }
        if (i.athChangePct != null && out[out.length - 1].score != null) {
          out[out.length - 1].evidence.push(`${i.athChangePct.toFixed(0)}% from all-time high (context only; a price decline alone does not raise structural risk)`);
        }
        break;
      }
      case "liquidity": {
        if (i.volume24h != null && i.marketCap != null && i.marketCap > 0) {
          const t = i.volume24h / i.marketCap;
          let s = t >= 0.05 ? 10 : t >= 0.01 ? 30 : t >= 0.002 ? 55 : t >= 0.0005 ? 75 : 90;
          if (i.volume24h < 100_000) s = Math.max(s, 85);
          else if (i.volume24h < 1_000_000) s = Math.max(s, 65);
          else if (i.volume24h < 10_000_000) s = Math.max(s, 40);
          // Deep absolute volume caps the score: low turnover on a very large asset is not illiquidity.
          if (i.volume24h >= 1e9) s = Math.min(s, 15);
          else if (i.volume24h >= 1e8) s = Math.min(s, 30);
          else if (i.volume24h >= 2.5e7) s = Math.min(s, 45);
          push(def, { score: s, basis: "reported", evidence: [`24h volume ${fmtUsd(i.volume24h)}; turnover ${(t * 100).toFixed(2)}% of market cap`, "Aggregated reported volume; exchange-level depth and wash trading are not verified"], asOf, source: cg });
        } else if (i.volume24h != null) {
          const s = i.volume24h < 100_000 ? 85 : i.volume24h < 1_000_000 ? 65 : null;
          push(def, s == null
            ? { score: null, basis: "unknown", evidence: [`24h volume ${fmtUsd(i.volume24h)} but market cap not reported, so turnover cannot be computed`], asOf, source: cg }
            : { score: s, basis: "reported", evidence: [`24h volume only ${fmtUsd(i.volume24h)} (market cap not reported)`], asOf, source: cg });
        } else {
          push(def, { score: null, basis: "unknown", evidence: ["24h volume not reported"], asOf: null, source: null });
        }
        break;
      }
      case "market_size": {
        if (i.marketCap != null && i.marketCap > 0) {
          const s = step(i.marketCap, [[10e6, 85], [50e6, 65], [250e6, 45], [1e9, 30]], 15);
          push(def, { score: s, basis: "reported", evidence: [`Market cap ${fmtUsd(i.marketCap)} (reported; depends on reported circulating supply)`], asOf, source: cg });
        } else {
          push(def, { score: null, basis: "unknown", evidence: ["Market cap not reported (circulating supply unverified)"], asOf: null, source: null });
        }
        break;
      }
      case "dilution": {
        let ratio: number | null = null;
        let how = "";
        if (i.marketCap != null && i.fdv != null && i.fdv > 0) {
          ratio = i.marketCap / i.fdv;
          how = `market cap / fully diluted valuation = ${(ratio * 100).toFixed(0)}%`;
        } else if (i.circulating != null && i.max != null && i.max > 0) {
          ratio = i.circulating / i.max;
          how = `circulating / max supply = ${(ratio * 100).toFixed(0)}%`;
        } else if (i.circulating != null && i.total != null && i.total > 0) {
          ratio = i.circulating / i.total;
          how = `circulating / total supply = ${(ratio * 100).toFixed(0)}% (no max supply reported)`;
        }
        if (ratio != null && Number.isFinite(ratio)) {
          const r = Math.min(ratio, 1);
          const s = r >= 0.9 ? 10 : r >= 0.7 ? 25 : r >= 0.5 ? 45 : r >= 0.3 ? 65 : r >= 0.15 ? 80 : 92;
          const ev = [`${how}; ${(100 - r * 100).toFixed(0)}% of supply not yet circulating`];
          if (i.max == null) ev.push("No max supply reported (uncapped or unknown)");
          ev.push("Unlock and emission schedules are not available from a free source; timing of new supply is UNKNOWN");
          push(def, { score: s, basis: "reported", evidence: ev, asOf, source: cg });
        } else {
          push(def, { score: null, basis: "unknown", evidence: ["Supply figures not reported; dilution cannot be assessed"], asOf: null, source: null });
        }
        break;
      }
      case "security": {
        if (i.incidents == null) {
          push(def, { score: null, basis: "unknown", evidence: ["Not mapped to a protocol in the DefiLlama hacks database; no audit data source is configured"], asOf: null, source: null });
          break;
        }
        const recent = i.incidents
          .map((x) => ({ ...x, ageD: (Date.parse(i.now) - Date.parse(x.date)) / 86400_000 }))
          .filter((x) => x.ageD >= 0 && x.ageD <= 3 * 365)
          .sort((a, b) => a.ageD - b.ageD);
        if (!recent.length) {
          push(def, {
            score: null,
            basis: "unknown",
            evidence: [i.incidents.length ? `Only incidents older than 3 years recorded (${i.incidents.length})` : "No incident recorded in the DefiLlama hacks database for the mapped protocol. This is not an audit and does not mean the code is safe"],
            asOf: null,
            source: "DefiLlama hacks",
          });
          break;
        }
        const x = recent[0];
        const fullyReturned = x.amountUsd != null && x.returnedUsd != null && x.returnedUsd >= x.amountUsd;
        const s = x.ageD <= 365 ? (fullyReturned ? 65 : 85) : 60;
        push(def, {
          score: s,
          basis: "reported",
          evidence: recent.slice(0, 3).map((r) => `${r.date.slice(0, 10)}: ${r.name} — ${r.classification ?? "incident"}${r.technique ? ` (${r.technique})` : ""}${r.amountUsd != null ? `, loss ${fmtUsd(r.amountUsd)}` : ""}${r.returnedUsd ? `, returned ${fmtUsd(r.returnedUsd)}` : ""}`),
          asOf: x.date,
          source: "DefiLlama hacks",
        });
        break;
      }
      case "stablecoin_peg": {
        if (!isUsdStablecoin(i)) {
          push(def, { score: null, basis: "unknown", evidence: ["Not applicable (not a known USD stablecoin)"], asOf: null, source: null });
        } else if (i.price != null) {
          const d = Math.abs(i.price - 1);
          const s = step(d, [[0.005, 10], [0.01, 30], [0.03, 60], [0.1, 85]], 95);
          push(def, { score: s, basis: i.priceSources >= 2 && !i.priceDisagreement ? "corroborated" : "reported", evidence: [`Price $${i.price.toFixed(4)}, ${(d * 100).toFixed(2)}% from the $1 peg`, "Reserve quality and redemption are not verified"], asOf, source: cg });
        } else {
          push(def, { score: null, basis: "unknown", evidence: ["USD stablecoin without a current price"], asOf: null, source: null });
        }
        break;
      }
      case "holder_concentration":
        push(def, { score: null, basis: "unknown", evidence: ["No free, keyless holder-distribution source is configured"], asOf: null, source: null });
        break;
      case "governance":
        push(def, { score: null, basis: "unknown", evidence: ["Governance structure (admin keys, upgradeability, voting) is not sourced"], asOf: null, source: null });
        break;
      case "regulatory":
        push(def, { score: null, basis: "unknown", evidence: ["No structured, free regulatory-action source is configured; absence of data is not clearance"], asOf: null, source: null });
        break;
      case "transparency":
        push(def, { score: null, basis: "unknown", evidence: ["Team, disclosures and reporting are not sourced"], asOf: null, source: null });
        break;
    }
  }
  return out;
}

export function bandFor(score: number): Exclude<Band, "insufficient_data"> {
  let b: Exclude<Band, "insufficient_data"> = "low";
  for (const x of BANDS) if (score >= x.min) b = x.band;
  return b;
}

export function computeRisk(i: RiskInputs): RiskResult {
  const factors = scoreFactors(i);
  const applicable = factors.filter((f) => f.applicable);
  const totalW = applicable.reduce((s, f) => s + f.weight, 0);
  const scored = applicable.filter((f) => f.score != null);
  const scoredW = scored.reduce((s, f) => s + f.weight, 0);
  const coverage = totalW > 0 ? scoredW / totalW : 0;
  const raw = scoredW > 0 ? scored.reduce((s, f) => s + f.weight * (f.score as number), 0) / scoredW : null;
  const score = raw == null ? null : Math.round(raw);

  const structural = scored.filter((f) => f.structural && (f.score as number) >= STRUCTURAL_THRESHOLD);
  const vol = factors.find((f) => f.key === "market_volatility");
  const volHigh = vol?.score != null && vol.score >= STRUCTURAL_THRESHOLD;

  let band: Band = score == null || coverage < MIN_COVERAGE ? "insufficient_data" : bandFor(score);
  const riskType: RiskType =
    band === "insufficient_data" ? "insufficient_data" : structural.length ? "structural" : volHigh ? "volatility_only" : "none_flagged";

  // Volatility alone can never produce a high/extreme band.
  if ((band === "high" || band === "extreme") && !structural.length) band = "elevated";

  const peg = factors.find((f) => f.key === "stablecoin_peg");
  const sec = factors.find((f) => f.key === "security");
  const redFlag = (peg?.score ?? 0) >= 60 || (sec?.score ?? 0) >= 85;
  const highRisk = riskType === "structural" && (band === "high" || band === "extreme" || redFlag);

  // Confidence (separate from score)
  const age = ageHours(i.marketDataAt ?? i.retrievedAt, i.now);
  const freshness = age == null ? 0.2 : age <= 12 ? 1 : age <= STALE_MARKET_DATA_H ? 0.8 : age <= 72 ? 0.6 : 0.3;
  const sources = i.priceDisagreement ? 0.7 : i.priceSources >= 2 ? 1 : 0.85;
  const history = i.vol30d != null ? 1 : 0.85;
  const identity = i.platformDataKnown ? 1 : 0.9;
  const confidence = Math.round(100 * coverage * freshness * sources * history * identity);
  const confidenceLabel = confidence >= 70 ? "high" : confidence >= 45 ? "medium" : "low";

  const reasons = structural
    .sort((a, b) => (b.score as number) - (a.score as number))
    .map((f) => `${f.label}: ${f.evidence[0]}`);
  if (riskType === "volatility_only" && vol) reasons.push(`Volatility only (not structural): ${vol.evidence[0]}`);

  const flags: string[] = [];
  if (i.marketCap == null) flags.push("Market cap not reported");
  if (i.circulating == null && i.total == null && i.max == null) flags.push("Supply not reported");
  if (i.fdv == null) flags.push("Fully diluted valuation not reported");
  if (i.volume24h == null) flags.push("Volume not reported");
  if (!i.platformDataKnown) flags.push("Contract/platform identity not retrieved yet");
  else if (!i.networks.length) flags.push("No token contract listed (native coin or contract unknown)");
  if (i.symbolCollisions > 0) flags.push(`Ticker ${i.symbol} is shared with ${i.symbolCollisions} other asset(s); identify by CoinGecko id or contract, not ticker`);
  if (age == null) flags.push("No market-data timestamp");
  else if (age > STALE_MARKET_DATA_H) flags.push(`Market data is ${Math.round(age)} h old (stale)`);
  if (i.priceSources <= 1) flags.push("Price from a single source (not corroborated)");
  if (i.priceDisagreement) flags.push("Price sources disagree");
  const unknownW = applicable.filter((f) => f.score == null).reduce((s, f) => s + f.weight, 0);
  if (unknownW > 0) flags.push(`${Math.round((unknownW / totalW) * 100)}% of the model weight is UNKNOWN (${applicable.filter((f) => f.score == null).map((f) => f.label).join(", ")})`);

  return {
    modelVersion: MODEL_VERSION,
    score,
    band,
    riskType,
    highRisk,
    confidence,
    confidenceLabel,
    confidenceParts: { coverage: Math.round(coverage * 100) / 100, freshness, sources, history, identity },
    coverage: Math.round(coverage * 100) / 100,
    factors,
    structuralKeys: structural.map((f) => f.key),
    reasons,
    flags,
  };
}
