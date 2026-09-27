import type {
  EventType,
  ImpactScore,
  ImpactScoreDimensionWhy,
  SourceTier,
  TimeHorizon,
} from "../types";

export const IMPACT_METHODOLOGY = `Impact composite = 0.25×Magnitude + 0.20×Probability + 0.20×MarketSensitivity + 0.15×TransmissionSpeed + 0.10×Persistence + 0.10×Confidence.
Each sub-score is 0–100 with an explicit "why" string. Inputs: source tier, event type, sentiment, keyword cues, transmission chain length, entity specificity.
These are inspectable heuristics — NOT calibrated probabilities and NOT model forecasts.
When evidence is thin, Confidence and Probability are capped and labeled low-confidence.`;

export function scoreImpact(input: {
  magnitude: number;
  probability: number;
  marketSensitivity: number;
  transmissionSpeed: number;
  persistence: number;
  confidence: number;
  dimensionWhy?: ImpactScoreDimensionWhy;
}): ImpactScore {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const m = clamp(input.magnitude);
  const p = clamp(input.probability);
  const ms = clamp(input.marketSensitivity);
  const ts = clamp(input.transmissionSpeed);
  const pe = clamp(input.persistence);
  const c = clamp(input.confidence);
  const composite = clamp(0.25 * m + 0.2 * p + 0.2 * ms + 0.15 * ts + 0.1 * pe + 0.1 * c);
  return {
    magnitude: m,
    probability: p,
    marketSensitivity: ms,
    transmissionSpeed: ts,
    persistence: pe,
    confidence: c,
    composite,
    methodology: IMPACT_METHODOLOGY,
    dimensionWhy: input.dimensionWhy,
  };
}

export function horizonFromKeywords(text: string): TimeHorizon {
  const t = text.toLowerCase();
  if (/\b(intraday|today|session|minutes?|hours?)\b/.test(t)) return "intraday";
  if (/\b(this week|next week|days?|1-7)\b/.test(t)) return "1-7d";
  if (/\b(weeks?|month|fomc|ecb meeting)\b/.test(t)) return "1-4w";
  if (/\b(quarter|q[1-4]|months?)\b/.test(t)) return "1-3m";
  if (/\b(year|annual|fy\d+)\b/.test(t)) return "3-12m";
  if (/\b(decade|structural|secular|long[- ]term)\b/.test(t)) return "1-5y";
  return "1-4w";
}

const TIER_BOOST: Record<SourceTier, number> = { 1: 22, 2: 14, 3: 7, 4: 0 };

const TYPE_SPEED: Partial<Record<EventType, number>> = {
  fx_regime: 82,
  liquidity: 78,
  monetary_policy: 70,
  commodity_supply: 75,
  geopolitics: 72,
  sanction: 68,
  credit: 70,
  inflation: 60,
  labor: 65,
  growth: 55,
  earnings: 58,
  fiscal: 50,
  regulation: 45,
  other: 40,
};

const TYPE_PERSIST: Partial<Record<EventType, number>> = {
  geopolitics: 72,
  sanction: 70,
  fiscal: 65,
  inflation: 62,
  regulation: 60,
  growth: 55,
  monetary_policy: 50,
  credit: 55,
  labor: 48,
  commodity_supply: 45,
  fx_regime: 40,
  liquidity: 42,
  earnings: 35,
  other: 35,
};

export function scoreImpactTransparent(args: {
  title: string;
  body: string;
  sourceTier: SourceTier;
  eventType: EventType;
  sentiment: string;
  confidence: number; // 0–1
  chainLength: number;
  entityCount: number;
  quality?: string;
}): ImpactScore {
  const text = `${args.title} ${args.body}`;
  const tierBoost = TIER_BOOST[args.sourceTier];
  const shockCue = /\b(emergency|crisis|shock|unprecedented|war|collapse|bailout)\b/i.test(text);
  const surpriseCue = /\b(surprise|unexpected|above consensus|below consensus|hotter|cooler)\b/i.test(text);
  const pricedInCue = /\b(priced in|as expected|in line|reaffirm)\b/i.test(text);

  const magnitude =
    28 +
    tierBoost +
    Math.min(20, args.chainLength * 3) +
    (shockCue ? 22 : 0) +
    (surpriseCue ? 8 : 0) -
    (pricedInCue ? 10 : 0);

  const probability =
    32 +
    args.confidence * 45 +
    (args.entityCount > 0 ? 8 : 0) +
    (args.quality === "demo" ? -8 : 0) -
    (args.eventType === "other" ? 12 : 0);

  const marketSensitivity =
    30 +
    tierBoost * 0.6 +
    Math.min(25, args.chainLength * 2.5) +
    (["monetary_policy", "fx_regime", "credit", "liquidity"].includes(args.eventType) ? 15 : 0) +
    (["hawkish", "dovish", "risk_off", "risk_on"].includes(args.sentiment) ? 8 : 0) -
    (pricedInCue ? 12 : 0);

  const transmissionSpeed = TYPE_SPEED[args.eventType] ?? 45;
  const persistence = TYPE_PERSIST[args.eventType] ?? 40;

  const confidencePct =
    args.confidence * 100 * (args.quality === "demo" ? 0.85 : 1) -
    (args.eventType === "other" ? 15 : 0);

  const dimensionWhy: ImpactScoreDimensionWhy = {
    magnitude: [
      `Tier ${args.sourceTier} boost +${tierBoost}.`,
      `Chain length ${args.chainLength} → breadth +${Math.min(20, args.chainLength * 3)}.`,
      shockCue ? "Shock/crisis keyword cue +22." : "No crisis keyword cue.",
      pricedInCue ? "Priced-in/in-line cue −10." : surpriseCue ? "Surprise cue +8." : "No surprise/priced-in cue.",
    ].join(" "),
    probability: [
      `Classifier confidence ${args.confidence} → +${Math.round(args.confidence * 45)}.`,
      `Entities=${args.entityCount}.`,
      args.eventType === "other" ? "Weak event-type ID −12." : `Event type ${args.eventType}.`,
      "Probability here = chance the framed development matters for markets — NOT a calibrated P(outcome).",
    ].join(" "),
    marketSensitivity: [
      `Type/sentiment sensitivity for ${args.eventType}/${args.sentiment}.`,
      pricedInCue ? "Priced-in cue reduces marginal sensitivity." : "No priced-in reduction.",
      `Transmission breadth (chain ${args.chainLength}) increases cross-asset sensitivity estimate.`,
    ].join(" "),
    transmissionSpeed: [
      `Default speed for event_type=${args.eventType} is ${TYPE_SPEED[args.eventType] ?? 45}.`,
      "FX/liquidity/geo shocks typically reprice faster than fiscal/regulation.",
    ].join(" "),
    persistence: [
      `Default persistence for event_type=${args.eventType} is ${TYPE_PERSIST[args.eventType] ?? 40}.`,
      "Geo/sanctions/fiscal tend to persist longer than single earnings prints.",
    ].join(" "),
    confidence: [
      `From classifier confidence_rationale (0–1 → %).`,
      args.quality === "demo" ? "Demo quality haircut applied." : "No demo haircut.",
      "Low confidence → treat directional calls as insufficient.",
    ].join(" "),
  };

  return scoreImpact({
    magnitude,
    probability,
    marketSensitivity,
    transmissionSpeed,
    persistence,
    confidence: confidencePct,
    dimensionWhy,
  });
}
