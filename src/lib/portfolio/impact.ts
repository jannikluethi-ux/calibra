import type { PortfolioHolding } from "../types";
import { upsertJson, getJsonById } from "../db";
import { getScenarios } from "../scenarios/engine";
import { getMarketSnapshots } from "../market/fetch";
import { getUniverseItem } from "../market/universe";

export function getPortfolio(): PortfolioHolding[] {
  const row = getJsonById<{ holdings: PortfolioHolding[] }>("portfolio", "id", "default");
  return row?.holdings ?? [];
}

export function savePortfolio(holdings: PortfolioHolding[]) {
  const normalized = holdings.map((h) => {
    const u = getUniverseItem(h.symbol.toUpperCase());
    return {
      symbol: (u?.symbol || h.symbol).toUpperCase(),
      name: h.name || u?.name || h.symbol,
      weight: h.weight,
      quantity: h.quantity,
      assetClass: h.assetClass || u?.category,
    };
  });
  upsertJson(
    "portfolio",
    "id",
    "default",
    { holdings: normalized },
    { updated_at: new Date().toISOString() }
  );
  return normalized;
}

export interface PortfolioImpactRow {
  holding: PortfolioHolding;
  matchedScenarios: {
    scenarioId: string;
    title: string;
    branchFocus: string;
    sensitivity: string;
    evidence: string[];
  }[];
  marketSnapshot?: {
    price: number | null;
    change1d: number | null;
    quality: string;
  };
}

export function analyzePortfolioImpact(holdings?: PortfolioHolding[]): {
  rows: PortfolioImpactRow[];
  disclaimer: string;
} {
  const h = holdings ?? getPortfolio();
  const scenarios = getScenarios();
  const markets = getMarketSnapshots();

  const rows: PortfolioImpactRow[] = h.map((holding) => {
    const matched: PortfolioImpactRow["matchedScenarios"] = [];
    for (const s of scenarios) {
      if (!s.affectedAssets.map((a) => a.toUpperCase()).includes(holding.symbol.toUpperCase())) continue;
      const worst = [s.bear, s.tail].sort((a, b) => b.probability - a.probability)[0];
      matched.push({
        scenarioId: s.id,
        title: s.title,
        branchFocus: `${worst.name} (~${worst.probability}%)`,
        sensitivity: `Horizon ${s.timeHorizon}; composite event-linked estimate — NOT advice.`,
        evidence: worst.supportingEvidence.slice(0, 2),
      });
    }
    const m = markets.find((x) => x.symbol === holding.symbol);
    return {
      holding,
      matchedScenarios: matched.slice(0, 5),
      marketSnapshot: m
        ? { price: m.price, change1d: m.change1d, quality: m.provenance.quality }
        : undefined,
    };
  });

  return {
    rows,
    disclaimer:
      "NO buy/sell advice. Mapping is scenario→exposure→sensitivity→evidence from the local store only. Weights are user-supplied.",
  };
}
