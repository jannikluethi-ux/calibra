/**
 * Transparent source weights and consensus rules.
 * These are fixed constants, not fitted parameters. They are shown on
 * /crypto/coverage and /methodology. They do not change scenario math.
 *
 * source_class              reliability_weight   meaning
 * primary_official          1.00                 protocol or issuer's own domain
 * regulated_government      0.95                 central bank or market regulator
 * institutional             0.85                 IMF / similar official institution
 * established_market_data   0.75                 exchange public ticker or the Yahoo chart path
 * reputable_news            0.60                 named news-desk RSS already stored
 * secondary_aggregator      0.50                 CoinGecko, DefiLlama (they aggregate others)
 * community                 0.25                 forums / social, unused this pass
 * unverified                0.10                 no provenance, unused this pass
 *
 * Weights are disclosed for methodology. The numeric confidence score below
 * does NOT multiply by the weight, so a reader can see the two ideas separately.
 * Confidence uses only n_sources, freshness, and disagreement.
 */
export const RELIABILITY_WEIGHTS = {
  primary_official: 1,
  regulated_government: 0.95,
  institutional: 0.85,
  established_market_data: 0.75,
  reputable_news: 0.6,
  secondary_aggregator: 0.5,
  community: 0.25,
  unverified: 0.1,
} as const;

export type SourceClass = keyof typeof RELIABILITY_WEIGHTS;

/** Relative spread (max-min)/median above which disagreement=1. Originals are kept. */
export const DISAGREEMENT_THRESHOLDS: Record<string, number> = {
  price: 0.01,
  market_cap: 0.02,
  volume_24h: 0.02,
  circulating_supply: 0.02,
  total_supply: 0.02,
  max_supply: 0.02,
  tvl_usd: 0.05,
};

/** Absolute percentage-point gap for 24h change (not a relative spread). */
export const CHANGE_24H_DISAGREEMENT_PP = 1;

export const MARKET_FIELDS = new Set([
  "price",
  "market_cap",
  "volume_24h",
  "change_24h_pct",
  "tvl_usd",
  "circulating_supply",
  "total_supply",
  "max_supply",
]);

/** Market quotes older than this are stale. Descriptive fields use 7 days. */
export const MARKET_STALE_MS = 6 * 60 * 60 * 1000;
export const DESCRIPTIVE_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * freshness in [0,1] from the newest contributing observation:
 *   <= 15 min -> 1
 *   <= 60 min -> 0.8
 *   <= 6 h    -> 0.55
 *   <= 24 h   -> 0.3
 *   else      -> 0.1
 *
 * confidence =
 *   0.50 * min(n_sources, 3) / 3
 * + 0.30 * freshness
 * + 0.20 * (disagreement ? 0 : 1)
 * Clamped to [0, 1].
 */
export function freshnessFactor(ageMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0.1;
  if (ageMs <= 15 * 60 * 1000) return 1;
  if (ageMs <= 60 * 60 * 1000) return 0.8;
  if (ageMs <= 6 * 60 * 60 * 1000) return 0.55;
  if (ageMs <= 24 * 60 * 60 * 1000) return 0.3;
  return 0.1;
}

export function confidenceFromSignals(nSources: number, ageMs: number, disagreement: boolean): number {
  const n = Math.max(0, nSources);
  const raw =
    0.5 * (Math.min(n, 3) / 3) + 0.3 * freshnessFactor(ageMs) + 0.2 * (disagreement ? 0 : 1);
  return Math.round(Math.max(0, Math.min(1, raw)) * 10000) / 10000;
}

export const CONFIDENCE_FORMULA_TEXT =
  "confidence = 0.50 * min(n_sources, 3) / 3 + 0.30 * freshness + 0.20 * (1 if sources agree, else 0). Freshness is 1 within 15 minutes, 0.8 within 1 hour, 0.55 within 6 hours, 0.3 within 24 hours, otherwise 0.1. Reliability weights are disclosed separately and are not multiplied into this score.";

export function freshnessLabel(ageMs: number | null): "Live" | "minutes" | "hours" | "days" | "Unknown" {
  if (ageMs == null || !Number.isFinite(ageMs)) return "Unknown";
  if (ageMs <= 15 * 60 * 1000) return "Live";
  if (ageMs < 60 * 60 * 1000) return "minutes";
  if (ageMs < 24 * 60 * 60 * 1000) return "hours";
  return "days";
}
