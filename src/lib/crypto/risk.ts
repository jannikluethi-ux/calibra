import { getDb } from "../db";

/**
 * Crypto research score. Not a buy, sell, or exit signal.
 *
 * Ten factor slots. Only factors with a real input are scored.
 * Null factors are not filled with a default and do not raise the total.
 *
 * Total = arithmetic mean of the scored component scores (equal weights),
 * which is the weighted sum renormalized over the scored set.
 *
 * Bands (documented, not fitted to force a label):
 *   0–24 low
 *   25–44 moderate
 *   45–64 elevated
 *   65–84 high
 *   85–100 extreme
 *
 * If fewer than 2 market factors are scored (liquidity and 24h move),
 * the displayed band is capped at moderate. A coin with only information
 * risk is not labeled extreme.
 *
 * Liquidity (needs both volume_24h and market_cap on the instrument row):
 *   turnover = volume_24h / market_cap
 *   >= 5% -> 10
 *   >= 1% -> 30
 *   >= 0.2% -> 55
 *   >= 0.05% -> 75
 *   else -> 90
 *   Then a floor from absolute USD volume:
 *   volume < 100,000 -> at least 85
 *   volume < 1,000,000 -> at least 65
 *   volume < 10,000,000 -> at least 40
 *   Higher means more liquidity risk, not a warning to dump.
 *
 * Market behavior: absolute stored 24h percent change. This is a one-day
 * move, not historical volatility.
 *   < 2 -> 10
 *   < 5 -> 30
 *   < 10 -> 55
 *   < 20 -> 75
 *   else -> 90
 *
 * Information risk, from quote_status and canonical price n_sources:
 *   not a live quote -> 80
 *   live and n_sources = 0 -> 55 (instrument quote exists, no observation layer)
 *   live and n_sources = 1 -> 40
 *   live and n_sources >= 2 and disagreement -> 45
 *   live and n_sources >= 2 and no disagreement -> 20
 *
 * Unscored unless a future observation exists: tokenomics, holder
 * concentration, security, GitHub activity, regulatory, team identity,
 * unlock schedule.
 *
 * The scorer runs on quote_status = live crypto only.
 */
export const RISK_FACTORS = [
  "liquidity",
  "market_behavior_24h",
  "information_risk",
  "tokenomics",
  "holder_concentration",
  "security",
  "github_activity",
  "regulatory",
  "team_identity",
  "unlock_schedule",
] as const;

export const MARKET_FACTOR_KEYS = ["liquidity", "market_behavior_24h"] as const;

export const LIQUIDITY_RULE_TEXT =
  "Liquidity risk uses 24h volume and market cap only when both are non-null. Turnover = volume / market cap. Score 10 if turnover is at least 5%, 30 if at least 1%, 55 if at least 0.2%, 75 if at least 0.05%, otherwise 90. Absolute volume then floors the score: under 100,000 USD at least 85, under 1,000,000 at least 65, under 10,000,000 at least 40. A higher score means thinner liquidity, not a suggestion to sell.";

export const MOVE_RULE_TEXT =
  "Market behavior uses the absolute stored 24h percent change. It is a one-day move, not historical volatility. Score 10 under 2%, 30 under 5%, 55 under 10%, 75 under 20%, otherwise 90.";

export const INFO_RULE_TEXT =
  "Information risk is 80 when the quote is not live, 55 when a live quote has no canonical price source, 40 with one source, 45 with two or more sources that disagree, and 20 with two or more sources that agree.";

export const RISK_BAND_TEXT =
  "Bands: 0–24 low, 25–44 moderate, 45–64 elevated, 65–84 high, 85–100 extreme. The band is capped at moderate when fewer than 2 market factors (liquidity, 24h move) were scored.";

export type RiskBand = "low" | "moderate" | "elevated" | "high" | "extreme";

export function bandFor(total: number): RiskBand {
  if (total < 25) return "low";
  if (total < 45) return "moderate";
  if (total < 65) return "elevated";
  if (total < 85) return "high";
  return "extreme";
}

function liquidityScore(volume: number, mcap: number): number {
  const turnover = mcap > 0 ? volume / mcap : 0;
  let score = 90;
  if (turnover >= 0.05) score = 10;
  else if (turnover >= 0.01) score = 30;
  else if (turnover >= 0.002) score = 55;
  else if (turnover >= 0.0005) score = 75;
  if (volume < 100_000) score = Math.max(score, 85);
  else if (volume < 1_000_000) score = Math.max(score, 65);
  else if (volume < 10_000_000) score = Math.max(score, 40);
  return score;
}

function moveScore(absChange: number): number {
  if (absChange < 2) return 10;
  if (absChange < 5) return 30;
  if (absChange < 10) return 55;
  if (absChange < 20) return 75;
  return 90;
}

function infoScore(quoteStatus: string, nSources: number, disagreement: number): number {
  if (quoteStatus !== "live") return 80;
  if (nSources <= 0) return 55;
  if (nSources === 1) return 40;
  return disagreement ? 45 : 20;
}

interface QuoteRow {
  id: string;
  quote_status: string;
  volume_24h: number | null;
  market_cap: number | null;
  change_24h_pct: number | null;
  n_sources: number | null;
  disagreement: number | null;
}

export function scoreQuotedCrypto(): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT i.id, i.quote_status, i.volume_24h, i.market_cap, i.change_24h_pct,
              cf.n_sources, cf.disagreement
       FROM instruments i
       LEFT JOIN canonical_fields cf
         ON cf.instrument_id = i.id AND cf.field = 'price'
       WHERE i.asset_type = 'crypto' AND i.quote_status = 'live' AND i.price IS NOT NULL`
    )
    .all() as QuoteRow[];

  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO crypto_risk_assessments (
      instrument_id, computed_at, total, band, components_json, factors_scored,
      factors_possible, market_factors_scored, band_capped, cap_reason
    ) VALUES (?, ?, ?, ?, ?, ?, 10, ?, ?, ?)
    ON CONFLICT(instrument_id) DO UPDATE SET
      computed_at = excluded.computed_at,
      total = excluded.total,
      band = excluded.band,
      components_json = excluded.components_json,
      factors_scored = excluded.factors_scored,
      factors_possible = 10,
      market_factors_scored = excluded.market_factors_scored,
      band_capped = excluded.band_capped,
      cap_reason = excluded.cap_reason`
  );

  const tx = db.transaction(() => {
    for (const row of rows) {
      const components: Record<string, { score: number; detail: string } | null> = {};
      for (const key of RISK_FACTORS) components[key] = null;

      if (row.volume_24h != null && row.market_cap != null && row.market_cap > 0 && row.volume_24h >= 0) {
        const turnover = row.volume_24h / row.market_cap;
        components.liquidity = {
          score: liquidityScore(row.volume_24h, row.market_cap),
          detail: `24h volume / market cap = ${(turnover * 100).toFixed(3)}%. Volume ${row.volume_24h}. Market cap ${row.market_cap}. Thresholds are in the research score note.`,
        };
      }
      if (row.change_24h_pct != null && Number.isFinite(row.change_24h_pct)) {
        const abs = Math.abs(row.change_24h_pct);
        components.market_behavior_24h = {
          score: moveScore(abs),
          detail: `Absolute 24h move ${abs.toFixed(2)}%. This is one session change, not historical volatility.`,
        };
      }
      const nSources = row.n_sources ?? 0;
      const disagreement = row.disagreement ?? 0;
      components.information_risk = {
        score: infoScore(row.quote_status, nSources, disagreement),
        detail: `quote_status=${row.quote_status}, canonical price n_sources=${nSources}, disagreement=${disagreement}.`,
      };

      const scored = RISK_FACTORS.filter((k) => components[k] != null);
      const marketScored = MARKET_FACTOR_KEYS.filter((k) => components[k] != null).length;
      const totalRaw =
        scored.reduce((sum, key) => sum + (components[key] as { score: number }).score, 0) / scored.length;
      const total = Math.round(totalRaw * 100) / 100;
      let band = bandFor(total);
      let capped = 0;
      let capReason: string | null = null;
      if (marketScored < 2 && (band === "elevated" || band === "high" || band === "extreme")) {
        band = "moderate";
        capped = 1;
        capReason = `Only ${marketScored} market factor(s) scored. Band capped at moderate so thin inputs are not labeled high or extreme.`;
      }
      upsert.run(
        row.id,
        now,
        total,
        band,
        JSON.stringify(components),
        scored.length,
        marketScored,
        capped,
        capReason
      );
    }
  });
  tx();
  return rows.length;
}
