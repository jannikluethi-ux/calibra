/**
 * Elevated scenario-probability ranking (movers board)
 * =====================================================
 * Transparent, evidence-only blend. NEVER invents instruments or prices.
 *
 * Upside score ≈ weighted:
 *   0.45 · forecast distribution mass on strong_up + mod_up
 *   0.30 · active bull scenario probability (avg over matching-horizon scenarios)
 *   0.20 · event impact composite with bullish / risk_on transmission
 *   0.05 · observed momentum (CONTEXT ONLY — labeled, never sole driver)
 *
 * Downside mirrors with severe_down + mod_down / bear / risk_off / hawkish.
 *
 * If evidence is thin for an instrument, it is omitted rather than padded.
 */

import type {
  FinancialEvent,
  Forecast,
  ImpactDirection,
  MarketSnapshot,
  Scenario,
  TimeHorizon,
} from "../types";
import { getMarketSnapshots } from "../market/fetch";
import { getForecasts } from "../forecast/distributions";
import { getScenarios } from "../scenarios/engine";
import { getEvents } from "../ingestion/rss";

export type MoverHorizon = "intraday" | "1-7d" | "1-4w" | "1-3m";
export type MoverSide = "up" | "down";

export const MOVER_HORIZONS: { id: MoverHorizon; label: string }[] = [
  { id: "intraday", label: "Intraday" },
  { id: "1-7d", label: "1–7d" },
  { id: "1-4w", label: "1–4w" },
  { id: "1-3m", label: "1–3m" },
];

/** Map board horizon → compatible forecast / event / scenario horizons */
function compatibleHorizons(h: MoverHorizon): TimeHorizon[] {
  switch (h) {
    case "intraday":
      return ["intraday", "1h", "1d"];
    case "1-7d":
      return ["1-7d", "1d", "2d", "intraday"];
    case "1-4w":
      return ["1-4w", "1-7d"];
    case "1-3m":
      return ["1-3m", "1-4w"];
    default:
      return ["1-4w"];
  }
}

function periodChange(snap: MarketSnapshot, horizon: MoverHorizon): number | null {
  switch (horizon) {
    case "intraday":
      return snap.change1d;
    case "1-7d":
      return snap.change1w ?? snap.change1d;
    case "1-4w":
      return snap.change1m ?? snap.change1w;
    case "1-3m":
      return snap.change1m;
    default:
      return snap.change1w;
  }
}

function bucketProb(f: Forecast, labels: string[]): number {
  return f.distribution
    .filter((b) => labels.includes(String(b.label)))
    .reduce((s, b) => s + (b.probability || 0), 0);
}

function latestOpenForecast(
  forecasts: Forecast[],
  symbol: string,
  horizons: TimeHorizon[]
): Forecast | null {
  const matches = forecasts
    .filter(
      (f) =>
        f.assetSymbol === symbol &&
        f.status === "open" &&
        !f.isSeed &&
        horizons.includes(f.horizon)
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (matches.length) return matches[0];
  // Fallback: any open forecast for symbol (still labeled)
  const any = forecasts
    .filter((f) => f.assetSymbol === symbol && f.status === "open" && !f.isSeed)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return any[0] ?? null;
}

function eventTouchesSymbol(e: FinancialEvent, symbol: string): boolean {
  const sym = symbol.toLowerCase();
  const nameBits = `${e.title} ${e.summary} ${e.tags.join(" ")} ${e.causalChain.join(" ")}`.toLowerCase();
  if (e.tags.some((t) => t.toLowerCase() === sym)) return true;
  if (e.causalChain.some((c) => c.toLowerCase().includes(sym))) return true;
  const instruments = e.classification.structuredEntities?.instruments || [];
  if (
    instruments.some((i) => {
      const il = i.toLowerCase().trim();
      if (il.length < 3) return false;
      return il.includes(sym) || sym.includes(il) || il.includes(sym.replace(/_/g, " "));
    })
  )
    return true;
  // Soft match on common aliases
  const aliases: Record<string, RegExp> = {
    SPX: /\bs&p|spx|equit/i,
    NDX: /\bnasdaq|ndx|tech/i,
    BTC: /\bbitcoin|btc|crypto/i,
    ETH: /\bethereum|\beth\b/i,
    GOLD: /\bgold\b/i,
    OIL: /\boil|wti|brent|opec/i,
    US10Y: /\b10y|treasury|yield|duration/i,
    US2Y: /\b2y|short.?rate|t-?bill/i,
    EURUSD: /\beur\/?usd|euro\b/i,
    USDJPY: /\busd\/?jpy|yen|boj/i,
    DXY: /\bdxy|dollar index|usd\b/i,
    VIX: /\bvix|volatil/i,
    DAX: /\bdax|germany/i,
    SX5E: /\bstoxx|euro.?stoxx|europe/i,
    NKY: /\bnikkei|japan/i,
    HSI: /\bhang seng|hong kong|hsi/i,
    SILVER: /\bsilver\b/i,
    NATGAS: /\bnat(?:ural)?\s*gas|lng/i,
    UKX: /\bftse|ukx|britain/i,
    MSCI_WORLD: /\bmsci|acwi|world equit/i,
    DE10Y: /\bbund|german.?10|bund/i,
  };
  const re = aliases[symbol];
  if (re && re.test(nameBits)) return true;
  return false;
}

function eventDirection(e: FinancialEvent): ImpactDirection {
  const impacts = e.classification.expected_impact || [];
  const dirs = impacts.map((i) => i.direction);
  if (dirs.includes("bullish") && !dirs.includes("bearish")) return "bullish";
  if (dirs.includes("bearish") && !dirs.includes("bullish")) return "bearish";
  if (dirs.includes("mixed")) return "mixed";
  const sent = e.classification.sentiment;
  if (sent === "risk_on" || sent === "dovish") return "bullish";
  if (sent === "risk_off" || sent === "hawkish") return "bearish";
  return "unclear";
}

export interface MoverEvidenceBreakdown {
  forecastMass: number | null;
  forecastHorizon: TimeHorizon | null;
  scenarioBranchProb: number | null;
  scenarioCount: number;
  eventImpactAvg: number | null;
  eventCount: number;
  momentumPct: number | null;
  momentumLabel: string;
}

export interface MoverRow {
  rank: number;
  symbol: string;
  name: string;
  category: string;
  lastPrice: number | null;
  periodChangePct: number | null;
  /** 0–100 elevated-scenario score (estimate) */
  score: number;
  /** Bullish (or bearish) probability mass from latest live forecast distribution */
  directionalProb: number | null;
  strongBucketProb: number | null;
  keyCatalyst: string | null;
  confidence: number;
  /** Evidence → Reasoning → Scenario estimate → Uncertainty */
  evidence: string;
  reasoning: string;
  scenarioEstimate: string;
  invalidation: string;
  uncertaintyNote: string;
  dataQuality: string;
  isProxy?: boolean;
  insufficientEvidence: boolean;
  breakdown: MoverEvidenceBreakdown;
  href: string;
}

export interface MoversResult {
  horizon: MoverHorizon;
  side: MoverSide;
  generatedAt: string;
  methodology: string;
  disclaimer: string;
  rows: MoverRow[];
  truncatedNote: string | null;
  universeSize: number;
  scoredCount: number;
}

const METHODOLOGY = `Elevated scenario-probability score (0–100) = weighted blend of existing store data only:
• 45% — latest open live forecast distribution mass on strong_up+mod_up (upside) or severe_down+mod_down (downside)
• 30% — average bull (or bear) branch probability from active scenarios that list the instrument
• 20% — mean event impact composite for events touching the instrument with matching transmission direction
• 5% — observed period momentum as CONTEXT ONLY (not predictive; never sole driver)
Instruments with no forecast, scenario, or matching event evidence are omitted. Prefer "insufficient evidence" over false conviction. Estimates are labeled — not buy/sell recommendations.`;

function scoreInstrument(
  snap: MarketSnapshot,
  side: MoverSide,
  horizon: MoverHorizon,
  forecasts: Forecast[],
  scenarios: Scenario[],
  events: FinancialEvent[]
): MoverRow | null {
  const horizons = compatibleHorizons(horizon);
  const forecast = latestOpenForecast(forecasts, snap.symbol, horizons);

  const upLabels = ["strong_up", "mod_up"];
  const downLabels = ["severe_down", "mod_down"];
  const labels = side === "up" ? upLabels : downLabels;
  const strongLabel = side === "up" ? "strong_up" : "severe_down";

  let forecastMass: number | null = null;
  let strongBucketProb: number | null = null;
  let forecastHorizon: TimeHorizon | null = null;
  if (forecast) {
    forecastMass = bucketProb(forecast, labels);
    strongBucketProb = bucketProb(forecast, [strongLabel]);
    forecastHorizon = forecast.horizon;
  }

  const relatedScenarios = scenarios.filter(
    (s) =>
      s.affectedAssets.includes(snap.symbol) &&
      (horizons.includes(s.timeHorizon) || !s.timeHorizon)
  );
  const branchProbs = relatedScenarios.map((s) =>
    side === "up" ? s.bull.probability : s.bear.probability
  );
  const scenarioBranchProb =
    branchProbs.length > 0
      ? branchProbs.reduce((a, b) => a + b, 0) / branchProbs.length
      : null;

  const relatedEvents = events.filter((e) => eventTouchesSymbol(e, snap.symbol));
  const directionalEvents = relatedEvents.filter((e) => {
    const d = eventDirection(e);
    if (side === "up") return d === "bullish" || e.classification.sentiment === "risk_on";
    return d === "bearish" || e.classification.sentiment === "risk_off" || e.classification.sentiment === "hawkish";
  });
  // Prefer same-horizon events, else any touching
  const horizonEvents = directionalEvents.filter((e) => horizons.includes(e.timeHorizon));
  const eventPool = horizonEvents.length ? horizonEvents : directionalEvents;
  const eventImpactAvg =
    eventPool.length > 0
      ? eventPool.reduce((s, e) => s + (e.impactScore?.composite ?? 0), 0) / eventPool.length
      : null;

  const momentumPct = periodChange(snap, horizon);
  const momentumLabel =
    horizon === "intraday"
      ? "Observed 1D change (context only)"
      : horizon === "1-7d"
        ? "Observed 1W change (context only)"
        : horizon === "1-3m"
          ? "Observed 1M change (context only)"
          : "Observed ~1M change (context only)";

  // Require at least one primary evidence channel
  const hasPrimary =
    forecastMass != null || scenarioBranchProb != null || eventImpactAvg != null;
  if (!hasPrimary) return null;

  // Normalize components to 0–100
  const fComp = forecastMass != null ? Math.min(100, forecastMass) : null;
  const sComp = scenarioBranchProb != null ? Math.min(100, scenarioBranchProb) : null;
  const eComp = eventImpactAvg != null ? Math.min(100, eventImpactAvg) : null;
  // Momentum: map ±10% into 0–100 centered at 50; for downside invert
  let mComp: number | null = null;
  if (momentumPct != null && Number.isFinite(momentumPct)) {
    const raw = 50 + Math.max(-50, Math.min(50, momentumPct * 5));
    mComp = side === "up" ? raw : 100 - raw;
  }

  // Renormalize weights over available components (drop missing; keep momentum ≤5% of total)
  const weights: { w: number; v: number; kind: string }[] = [];
  if (fComp != null) weights.push({ w: 0.45, v: fComp, kind: "forecast" });
  if (sComp != null) weights.push({ w: 0.3, v: sComp, kind: "scenario" });
  if (eComp != null) weights.push({ w: 0.2, v: eComp, kind: "event" });
  if (mComp != null) weights.push({ w: 0.05, v: mComp, kind: "momentum" });

  // If only momentum would remain somehow, reject (shouldn't happen due to hasPrimary)
  const primaryW = weights.filter((x) => x.kind !== "momentum");
  if (!primaryW.length) return null;

  const wSum = weights.reduce((s, x) => s + x.w, 0);
  const score = Math.round(weights.reduce((s, x) => s + (x.w / wSum) * x.v, 0));

  // Confidence: more channels + higher forecast provenance quality
  let confidence = 25;
  if (fComp != null) confidence += 30;
  if (sComp != null) confidence += 20;
  if (eComp != null) confidence += 15;
  if (forecast?.provenance.quality === "live" || snap.provenance.quality === "live") confidence += 10;
  if (snap.provenance.quality === "demo") confidence = Math.min(confidence, 45);
  confidence = Math.min(85, confidence);

  const insufficientEvidence = confidence < 40 || (fComp == null && sComp == null);

  const topEvent = eventPool[0] || relatedEvents[0];
  const topScenario = relatedScenarios[0];
  const keyCatalyst =
    topEvent?.title?.slice(0, 120) ||
    topScenario?.title?.slice(0, 120) ||
    (forecast ? `Live forecast distribution (${forecast.horizon})` : null);

  const evidenceParts: string[] = [];
  if (forecast) {
    evidenceParts.push(
      `OBSERVED forecast store: open ${forecast.horizon} distribution for ${snap.symbol} (created ${forecast.createdAt.slice(0, 10)}, quality=${forecast.provenance.quality})`
    );
  }
  if (relatedScenarios.length) {
    evidenceParts.push(
      `OBSERVED scenario store: ${relatedScenarios.length} active set(s) listing ${snap.symbol}`
    );
  }
  if (eventPool.length) {
    evidenceParts.push(
      `OBSERVED events: ${eventPool.length} with matching ${side === "up" ? "bullish/risk-on" : "bearish/risk-off"} transmission (e.g. "${topEvent?.title?.slice(0, 80)}")`
    );
  }
  if (momentumPct != null) {
    evidenceParts.push(`${momentumLabel}: ${momentumPct.toFixed(2)}% — context, not predictive`);
  }
  if (!evidenceParts.length) {
    evidenceParts.push("Insufficient evidence in market/forecast/scenario/event stores.");
  }

  const reasoningParts: string[] = [];
  if (fComp != null) {
    reasoningParts.push(
      `Forecast mass on ${labels.join("+")} = ${fComp.toFixed(0)}% (weight 45%)`
    );
  } else {
    reasoningParts.push("No open live forecast for this horizon family — forecast weight dropped.");
  }
  if (sComp != null) {
    reasoningParts.push(
      `Avg ${side === "up" ? "bull" : "bear"} scenario branch = ${sComp.toFixed(0)}% across ${relatedScenarios.length} set(s) (weight 30%)`
    );
  }
  if (eComp != null) {
    reasoningParts.push(
      `Mean matching event impact composite = ${eComp.toFixed(0)} (weight 20%)`
    );
  }
  if (mComp != null) {
    reasoningParts.push(`Momentum context mapped to ${mComp.toFixed(0)}/100 (weight 5% max)`);
  }

  const sideWord = side === "up" ? "upside" : "downside";
  const scenarioEstimate = `SCENARIO ESTIMATE — Elevated ${sideWord} scenario probability score ${score}/100 for horizon ${horizon}. Directional forecast mass ${
    forecastMass != null ? forecastMass.toFixed(0) + "%" : "n/a"
  }. This ranks relative evidence density — it does NOT assert that price will move ${
    side === "up" ? "higher" : "lower"
  }.`;

  const invalidation =
    forecast?.invalidators?.[0] ||
    topScenario?.[side === "up" ? "bull" : "bear"]?.invalidationConditions?.[0] ||
    "Higher-tier contradictory data, regime break in liquidity/policy path, or loss of event confirmation within the horizon.";

  const uncertaintyNote = insufficientEvidence
    ? "Insufficient evidence for high conviction — score shown with low confidence; prefer omission over false precision."
    : `Uncertainty: model estimates only (heuristic blend). Provenance mix includes ${snap.provenance.quality} market data${
        forecast ? ` + ${forecast.provenance.quality} forecast` : ""
      }. Invalidation snip above.`;

  return {
    rank: 0,
    symbol: snap.symbol,
    name: snap.name,
    category: snap.category,
    lastPrice: snap.price,
    periodChangePct: momentumPct,
    score,
    directionalProb: forecastMass,
    strongBucketProb,
    keyCatalyst,
    confidence,
    evidence: evidenceParts.join(" · "),
    reasoning: reasoningParts.join(" · "),
    scenarioEstimate,
    invalidation,
    uncertaintyNote,
    dataQuality: snap.provenance.quality,
    isProxy: snap.isProxy,
    insufficientEvidence,
    breakdown: {
      forecastMass,
      forecastHorizon,
      scenarioBranchProb,
      scenarioCount: relatedScenarios.length,
      eventImpactAvg,
      eventCount: eventPool.length,
      momentumPct,
      momentumLabel,
    },
    href: `/assets/${snap.symbol}`,
  };
}

export function rankMovers(
  horizon: MoverHorizon = "1-4w",
  side: MoverSide = "up",
  limit = 10
): MoversResult {
  const snaps = getMarketSnapshots();
  const forecasts = getForecasts();
  const scenarios = getScenarios();
  const events = getEvents(200);

  const scored: MoverRow[] = [];
  for (const snap of snaps) {
    // Skip empty / broken quotes — never invent; also skip exact 0 which is almost always a bad bar
    if (snap.price == null || !Number.isFinite(snap.price) || snap.price === 0) continue;
    if (snap.provenance.quality === "insufficient") continue;
    const row = scoreInstrument(snap, side, horizon, forecasts, scenarios, events);
    if (row) scored.push(row);
  }

  scored.sort((a, b) => {
    // Evidence-rich rows first, then score, then confidence
    if (a.insufficientEvidence !== b.insufficientEvidence) {
      return a.insufficientEvidence ? 1 : -1;
    }
    if (b.score !== a.score) return b.score - a.score;
    return b.confidence - a.confidence;
  });

  // Prefer multi-channel evidence; only fall back to thin rows if the board would be empty
  const rich = scored.filter((r) => !r.insufficientEvidence);
  const pool = rich.length > 0 ? rich : scored.filter((r) => r.score >= 45);
  const top = pool.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));

  const truncatedNote =
    top.length < limit
      ? `Only ${top.length} instrument(s) have sufficient store evidence for horizon ${horizon} — not padded with invented names.`
      : null;

  return {
    horizon,
    side,
    generatedAt: new Date().toISOString(),
    methodology: METHODOLOGY,
    disclaimer:
      side === "up"
        ? "Elevated upside scenario probability — ranking of evidence density, not a buy recommendation or claim that prices will rise."
        : "Elevated downside scenario probability — ranking of evidence density, not a sell recommendation or claim that prices will fall.",
    rows: top,
    truncatedNote,
    universeSize: snaps.length,
    scoredCount: scored.length,
  };
}

export function parseMoverHorizon(raw: string | null): MoverHorizon {
  if (raw === "intraday" || raw === "1-7d" || raw === "1-4w" || raw === "1-3m") return raw;
  return "1-4w";
}

export function parseMoverSide(raw: string | null): MoverSide {
  return raw === "down" ? "down" : "up";
}
