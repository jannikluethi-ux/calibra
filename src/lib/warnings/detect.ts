import { randomUUID } from "crypto";
import type { WarningSignal, MarketSnapshot, FinancialEvent } from "../types";
import { getMarketSnapshots } from "../market/fetch";
import { getEvents } from "../ingestion/rss";
import { getDb, upsertJson, getJsonAll } from "../db";

export function detectWarnings(
  snaps?: MarketSnapshot[],
  events?: FinancialEvent[]
): WarningSignal[] {
  const markets = snaps ?? getMarketSnapshots();
  const evs = events ?? getEvents(40);
  const warnings: WarningSignal[] = [];
  const now = new Date().toISOString();

  const vix = markets.find((m) => m.symbol === "VIX");
  const spx = markets.find((m) => m.symbol === "SPX");
  const us10 = markets.find((m) => m.symbol === "US10Y");
  const dxy = markets.find((m) => m.symbol === "DXY");
  const oil = markets.find((m) => m.symbol === "OIL");
  const usdjpy = markets.find((m) => m.symbol === "USDJPY");

  const hawkish = evs.filter((e) => e.classification.sentiment === "hawkish");
  const infl = evs.filter(
    (e) =>
      e.classification.event_type === "inflation" ||
      e.classification.categories.includes("inflation")
  );
  const credit = evs.filter(
    (e) =>
      e.classification.event_type === "credit" ||
      e.classification.categories.includes("credit")
  );
  const geo = evs.filter(
    (e) =>
      e.classification.event_type === "geopolitics" ||
      e.classification.event_type === "sanction" ||
      e.classification.categories.includes("geopolitics")
  );
  const fxRegime = evs.filter(
    (e) =>
      e.classification.event_type === "fx_regime" ||
      e.classification.categories.includes("fx") ||
      (e.classification.structuredEntities?.institutions || []).includes("BOJ")
  );
  const liquidityEv = evs.filter(
    (e) =>
      e.classification.event_type === "liquidity" ||
      e.causalChain.some((n) => /liquidity|carry/i.test(n))
  );

  if (infl.length > 0 && hawkish.length > 0 && (us10?.change1w ?? 0) > 0) {
    warnings.push({
      id: randomUUID(),
      title: "Inflation ↑ + Yields ↑ + Hawkish CB tone",
      signal: "Multi-signal policy-tightening cluster",
      evidence: [
        `Inflation-tagged events: ${infl.length}`,
        `Hawkish-classified events: ${hawkish.length}`,
        `US10Y 1w change: ${us10?.change1w?.toFixed?.(2) ?? "n/a"}% (OBSERVED if live)`,
      ],
      historicalPrecedent:
        "2022: inflation persistence + hawkish Fed coincided with duration and equity multiple compression.",
      transmission: "Inflation data → CB reaction → real rates → USD/liquidity → equities/credit",
      confidence: 55,
      severity: "medium",
      relatedAssets: ["US10Y", "DXY", "SPX", "GOLD"],
      createdAt: now,
      active: true,
    });
  }

  if ((vix?.price ?? 0) > 22 && (spx?.change1w ?? 0) < -1.5) {
    warnings.push({
      id: randomUUID(),
      title: "Elevated vol + equity weekly decline",
      signal: "Risk-off confirmation pair",
      evidence: [`VIX≈${vix?.price}`, `SPX 1w=${spx?.change1w?.toFixed?.(2)}%`],
      historicalPrecedent:
        "Vol spikes with negative equity weeks often coincide with deleveraging feedback loops.",
      transmission: "Equity decline → vol → VaR/vol targeting → further selling → credit widening",
      confidence: 60,
      severity: vix && vix.price && vix.price > 30 ? "high" : "medium",
      relatedAssets: ["SPX", "VIX", "BTC"],
      createdAt: now,
      active: true,
    });
  }

  if (Math.abs(usdjpy?.change1w ?? 0) > 2 && (dxy?.change1w ?? 0) > 0.8) {
    warnings.push({
      id: randomUUID(),
      title: "USD strength with large USD/JPY weekly move",
      signal: "Potential carry / funding stress sketch",
      evidence: [
        `USDJPY 1w=${usdjpy?.change1w?.toFixed?.(2)}%`,
        `DXY 1w=${dxy?.change1w?.toFixed?.(2)}%`,
      ],
      historicalPrecedent:
        "Carry unwind episodes (e.g. illustrative 2024 volatility) showed cross-asset liquidity effects.",
      transmission: "FX vol → carry unwind → liquidity → high-beta equities/crypto",
      confidence: 48,
      severity: "medium",
      relatedAssets: ["USDJPY", "NKY", "BTC", "SPX"],
      createdAt: now,
      active: true,
    });
  }

  if (geo.length > 0 && (oil?.change1w ?? 0) > 3) {
    warnings.push({
      id: randomUUID(),
      title: "Geopolitics headlines + oil weekly rise",
      signal: "Energy risk-premium cluster",
      evidence: [`Geo events=${geo.length}`, `Oil 1w=${oil?.change1w?.toFixed?.(2)}%`],
      historicalPrecedent:
        "Supply-risk spikes can lift headline inflation expectations and sector dispersion.",
      transmission: "Geo → oil → inflation impulse → CB path uncertainty → FX/equities",
      confidence: 50,
      severity: "medium",
      relatedAssets: ["OIL", "GOLD", "SPX", "EURUSD"],
      createdAt: now,
      active: true,
    });
  }

  if (credit.length > 0 && (vix?.price ?? 0) > 20) {
    warnings.push({
      id: randomUUID(),
      title: "Credit headlines + elevated VIX",
      signal: "Credit-vol pairing (sparse data caveat)",
      evidence: [
        `Credit-tagged events=${credit.length}`,
        `VIX≈${vix?.price}`,
        "NOTE: MVP lacks live OAS — confidence capped.",
      ],
      historicalPrecedent:
        "Credit events with rising vol historically preceded wider risk-asset drawdowns.",
      transmission: "Credit stress → funding → equity beta → vol",
      confidence: 40,
      severity: "medium",
      relatedAssets: ["SPX", "VIX", "US10Y"],
      createdAt: now,
      active: true,
    });
  }

  // Multi-event graph pattern: BOJ/FX + liquidity + risk assets
  if (fxRegime.length > 0 && liquidityEv.length > 0) {
    const sample = fxRegime[0];
    warnings.push({
      id: randomUUID(),
      title: "FX-regime + liquidity transmission cluster",
      signal: "Graph pattern: FX shock → carry/liquidity → risk assets",
      evidence: [
        `FX-regime / BOJ-linked events: ${fxRegime.length}`,
        `Liquidity-chain events: ${liquidityEv.length}`,
        sample?.classification.transmission_chain
          ? `Sample chain: ${sample.classification.transmission_chain.map((s) => s.node).join(" → ")}`
          : `Sample: ${sample?.title || "n/a"}`,
        "INTERPRETATION from classifier graph walk — not a live positioning feed.",
      ],
      historicalPrecedent:
        "EXAMPLE: Carry/FX vol episodes (e.g. illustrative Aug 2024) showed cross-asset liquidity effects.",
      transmission:
        sample?.classification.transmission_narrative?.slice(0, 280) ||
        "FX vol → carry unwind → liquidity → high-beta equities/crypto",
      confidence: 52,
      severity: "medium",
      relatedAssets: ["USDJPY", "NKY", "BTC", "SPX"],
      createdAt: now,
      active: true,
    });
  }

  // Monetary + inflation cluster using event_type
  const monetary = evs.filter((e) => e.classification.event_type === "monetary_policy");
  if (monetary.length >= 2 && infl.length >= 1) {
    warnings.push({
      id: randomUUID(),
      title: "Repeated monetary-policy + inflation event cluster",
      signal: "Multi-event CB reaction-function pressure",
      evidence: [
        `monetary_policy events: ${monetary.length}`,
        `inflation events: ${infl.length}`,
        ...monetary.slice(0, 2).map((e) => `OBSERVED: ${e.title} (${e.sourceName})`),
      ],
      historicalPrecedent:
        "EXAMPLE: 2022 inflation persistence + hawkish CB coincidence with duration/equity compression.",
      transmission: "Inflation data → CB reaction → real rates → USD/liquidity → equities/credit",
      confidence: 58,
      severity: "medium",
      relatedAssets: ["US10Y", "DXY", "SPX"],
      createdAt: now,
      active: true,
    });
  }

  if (warnings.length === 0) {
    warnings.push({
      id: randomUUID(),
      title: "No multi-signal cluster currently active",
      signal: "Watch mode",
      evidence: [
        "Scanned inflation+hawkish+yields, vol+equity, USDJPY+DXY, geo+oil, credit+vol combinations.",
        "Insufficient combination strength to fire a warning.",
      ],
      historicalPrecedent: "Quiet regimes can flip quickly — absence of warning ≠ absence of risk.",
      transmission: "n/a",
      confidence: 70,
      severity: "low",
      relatedAssets: [],
      createdAt: now,
      active: true,
    });
  }

  return warnings;
}

export function persistWarnings(): WarningSignal[] {
  const warnings = detectWarnings();
  const db = getDb();
  db.prepare("DELETE FROM warnings").run();
  for (const w of warnings) {
    upsertJson("warnings", "id", w.id, w, {
      created_at: w.createdAt,
      active: w.active ? 1 : 0,
    });
  }
  return warnings;
}

/** Read-only (B2 get-fix): stored warnings, [] when none yet. persistWarnings() runs only in guarded jobs / POST. */
export function getWarnings(): WarningSignal[] {
  return getJsonAll<WarningSignal>("warnings");
}
