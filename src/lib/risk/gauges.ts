import type { RiskGauge, MarketSnapshot, FinancialEvent } from "../types";
import { getMarketSnapshots } from "../market/fetch";
import { getEvents } from "../ingestion/rss";
import { getDb, upsertJson, getJsonAll, setMeta } from "../db";

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function find(snaps: MarketSnapshot[], sym: string) {
  return snaps.find((s) => s.symbol === sym);
}

export function computeRiskGauges(
  snaps?: MarketSnapshot[],
  events?: FinancialEvent[]
): RiskGauge[] {
  const markets = snaps ?? getMarketSnapshots();
  const evs = events ?? getEvents(30);
  const vix = find(markets, "VIX");
  const spx = find(markets, "SPX");
  const us10 = find(markets, "US10Y");
  const dxy = find(markets, "DXY");
  const gold = find(markets, "GOLD");
  const oil = find(markets, "OIL");
  const btc = find(markets, "BTC");

  const vixLevel = vix?.price ?? 18;
  const volScore = clamp((vixLevel / 40) * 100);

  const riskOff =
    (spx?.change1w != null && spx.change1w < -2 ? 25 : 0) +
    (vixLevel > 25 ? 25 : vixLevel > 20 ? 12 : 0) +
    (btc?.change1w != null && btc.change1w < -5 ? 15 : 0) +
    (gold?.change1w != null && gold.change1w > 2 ? 10 : 0);

  const hawkishEvents = evs.filter((e) => e.classification.sentiment === "hawkish").length;
  const dovishEvents = evs.filter((e) => e.classification.sentiment === "dovish").length;
  const geoEvents = evs.filter((e) => e.classification.categories.includes("geopolitics")).length;
  const inflEvents = evs.filter((e) => e.classification.categories.includes("inflation")).length;
  const creditEvents = evs.filter((e) => e.classification.categories.includes("credit")).length;

  const method =
    "Heuristic composite from Yahoo market snapshots + classified event store. Not a proprietary risk model. Scores are 0–100 estimates with explicit confidence.";

  const gauges: RiskGauge[] = [
    {
      id: "global_risk",
      name: "Global Risk Level",
      score: clamp(40 + riskOff + geoEvents * 5 + (vixLevel - 15)),
      direction: riskOff > 20 ? "rising" : riskOff < 10 ? "falling" : "stable",
      confidence: markets.length > 10 ? 55 : 30,
      rationale: `Vol (VIX≈${vixLevel.toFixed?.(1) ?? vixLevel}), equity/crypto weekly moves, geo event count=${geoEvents}.`,
      methodology: method,
      inputs: ["VIX", "SPX 1w", "BTC 1w", "geo events"],
    },
    {
      id: "risk_on_off",
      name: "Risk On / Off",
      score: clamp(50 + riskOff - (btc?.change1w ?? 0)),
      direction: riskOff > 15 ? "rising" : "stable",
      confidence: 50,
      rationale: `>50 = risk-off tilt. Driven by VIX, SPX/BTC weekly returns. OBSERVED market moves → INTERPRETATION of risk appetite.`,
      methodology: method,
      inputs: ["VIX", "SPX", "BTC"],
    },
    {
      id: "inflation",
      name: "Inflation Pressure",
      score: clamp(45 + inflEvents * 8 + (oil?.change1m ?? 0) * 0.8),
      direction: inflEvents > 1 || (oil?.change1m ?? 0) > 5 ? "rising" : "stable",
      confidence: 45,
      rationale: `Inflation-tagged events=${inflEvents}; oil 1m=${oil?.change1m?.toFixed?.(1) ?? "n/a"}%.`,
      methodology: method,
      inputs: ["inflation events", "OIL 1m"],
    },
    {
      id: "growth",
      name: "Growth Pressure",
      score: clamp(
        50 -
          (evs.filter((e) => e.classification.categories.includes("growth") && e.classification.sentiment !== "risk_on")
            .length *
            6) -
          (spx?.change1m != null && spx.change1m < 0 ? 10 : 0)
      ),
      direction: "stable",
      confidence: 40,
      rationale: "Higher score = more growth stress. Soft activity headlines + weak equity month raise score.",
      methodology: method,
      inputs: ["growth events", "SPX 1m"],
    },
    {
      id: "liquidity",
      name: "Liquidity Conditions",
      score: clamp(55 + (dxy?.change1w ?? 0) * 2 + (us10?.change1w ?? 0) * 3),
      direction: (dxy?.change1w ?? 0) > 1 ? "rising" : "stable",
      confidence: 42,
      rationale: "Higher = tighter. USD strength + yield backup used as coarse proxy (model assumption).",
      methodology: method,
      inputs: ["DXY 1w", "US10Y 1w"],
    },
    {
      id: "cb_policy",
      name: "CB Policy Direction",
      score: clamp(50 + hawkishEvents * 10 - dovishEvents * 10),
      direction: hawkishEvents > dovishEvents ? "rising" : dovishEvents > hawkishEvents ? "falling" : "stable",
      confidence: 48,
      rationale: `Hawkish events=${hawkishEvents}, dovish=${dovishEvents} in recent store. >50 = hawkish tilt.`,
      methodology: method,
      inputs: ["event sentiments"],
    },
    {
      id: "geopolitical",
      name: "Geopolitical Risk",
      score: clamp(35 + geoEvents * 15 + (oil?.change1w != null && oil.change1w > 3 ? 10 : 0)),
      direction: geoEvents > 0 ? "rising" : "stable",
      confidence: 40,
      rationale: `Geo-tagged events=${geoEvents}; energy spike confirmation checked.`,
      methodology: method,
      inputs: ["geopolitics events", "OIL"],
    },
    {
      id: "credit",
      name: "Credit Stress",
      score: clamp(30 + creditEvents * 20 + (vixLevel > 25 ? 15 : 0)),
      direction: creditEvents > 0 ? "rising" : "stable",
      confidence: 35,
      rationale: "Credit headlines sparse in free RSS — score often low-confidence. Insufficient direct spread data in MVP.",
      methodology: method,
      inputs: ["credit events", "VIX"],
    },
    {
      id: "volatility",
      name: "Volatility Regime",
      score: volScore,
      direction: vixLevel > 22 ? "rising" : vixLevel < 14 ? "falling" : "stable",
      confidence: vix?.price != null ? 70 : 25,
      rationale: `VIX level mapped linearly toward 40. OBSERVED: ${vix?.price ?? "insufficient"}.`,
      methodology: method,
      inputs: ["VIX"],
    },
    {
      id: "currency",
      name: "Currency Stress",
      score: clamp(
        40 +
          Math.abs(dxy?.change1w ?? 0) * 5 +
          Math.abs(find(markets, "USDJPY")?.change1w ?? 0) * 3
      ),
      direction: Math.abs(dxy?.change1w ?? 0) > 1.5 ? "rising" : "stable",
      confidence: 50,
      rationale: "Absolute weekly moves in DXY and USDJPY as stress proxies.",
      methodology: method,
      inputs: ["DXY", "USDJPY"],
    },
  ];

  return gauges;
}

export function persistRiskGauges(): RiskGauge[] {
  const gauges = computeRiskGauges();
  const now = new Date().toISOString();
  getDb();
  for (const g of gauges) {
    upsertJson("risk_gauges", "id", g.id, g, { updated_at: now });
  }
  setMeta("lastRiskUpdate", now);
  return gauges;
}

/** Read-only (B2 get-fix): stored gauges, [] when none yet. persistRiskGauges() runs only in guarded jobs / POST. */
export function getRiskGauges(): RiskGauge[] {
  return getJsonAll<RiskGauge>("risk_gauges");
}
