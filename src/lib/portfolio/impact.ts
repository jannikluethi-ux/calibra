import type { PortfolioHolding } from "../types";
import { upsertJson, getJsonById } from "../db";
import { getScenarios } from "../scenarios/engine";
import { getMarketSnapshots } from "../market/fetch";
import { getUniverseItem } from "../market/universe";
import { getInstrument, resolveSymbol, type InstrumentRow } from "../instruments/store";

export function getPortfolio(): PortfolioHolding[] {
  const row = getJsonById<{ holdings: PortfolioHolding[] }>("portfolio", "id", "default");
  return row?.holdings ?? [];
}

export interface PortfolioResolution {
  input: string;
  status: "resolved" | "ambiguous" | "unresolved" | "by_id";
  instrumentId?: string;
  candidates: { id: string; symbol: string; name: string; asset_type: string; exchange: string | null; data_source: string }[];
}

function slim(row: InstrumentRow) {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    asset_type: row.asset_type,
    exchange: row.exchange,
    data_source: row.data_source,
  };
}

export function savePortfolio(holdings: PortfolioHolding[]): { holdings: PortfolioHolding[]; resolutions: PortfolioResolution[] } {
  const resolutions: PortfolioResolution[] = [];
  const normalized = holdings.map((h) => {
    const typed = (h.symbol || "").trim();
    if (h.instrumentId) {
      const inst = getInstrument(h.instrumentId);
      if (inst) {
        const symbol = inst.legacy_symbol || inst.symbol;
        resolutions.push({ input: typed || symbol, status: "by_id", instrumentId: inst.id, candidates: [slim(inst)] });
        return {
          symbol,
          instrumentId: inst.id,
          name: h.name || inst.name,
          weight: h.weight,
          quantity: h.quantity,
          assetClass: h.assetClass || inst.asset_type,
        };
      }
    }
    const resolved = resolveSymbol(typed);
    if (resolved.status === "resolved" && resolved.instrument) {
      const inst = resolved.instrument;
      const symbol = inst.legacy_symbol || inst.symbol;
      resolutions.push({ input: typed, status: "resolved", instrumentId: inst.id, candidates: [slim(inst)] });
      return {
        symbol,
        instrumentId: inst.id,
        name: h.name || inst.name,
        weight: h.weight,
        quantity: h.quantity,
        assetClass: h.assetClass || inst.asset_type,
      };
    }
    if (resolved.status === "ambiguous") {
      // Do not pick a venue. Keep the typed symbol so existing scenario matching still sees BTC/SPX/etc.
      const u = getUniverseItem(typed.toUpperCase());
      resolutions.push({ input: typed, status: "ambiguous", candidates: resolved.candidates.map(slim) });
      return {
        symbol: u && u.symbol.toUpperCase() === typed.toUpperCase() ? u.symbol : typed.toUpperCase(),
        name: h.name || u?.name || typed,
        weight: h.weight,
        quantity: h.quantity,
        assetClass: h.assetClass || u?.category,
      };
    }
    const u = getUniverseItem(typed.toUpperCase());
    resolutions.push({ input: typed, status: "unresolved", candidates: [] });
    return {
      symbol: (u?.symbol || typed).toUpperCase(),
      name: h.name || u?.name || typed,
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
  return { holdings: normalized, resolutions };
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
  instrument?: {
    id: string;
    name: string;
    asset_type: string;
    price: number | null;
    quote_status: string;
    exchange: string | null;
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
    const inst = holding.instrumentId ? getInstrument(holding.instrumentId) : null;
    return {
      holding,
      matchedScenarios: matched.slice(0, 5),
      marketSnapshot: m
        ? { price: m.price, change1d: m.change1d, quality: m.provenance.quality }
        : undefined,
      instrument: inst
        ? {
            id: inst.id,
            name: inst.name,
            asset_type: inst.asset_type,
            price: inst.price,
            quote_status: inst.quote_status,
            exchange: inst.exchange,
          }
        : undefined,
    };
  });

  return {
    rows,
    disclaimer:
      "NO buy/sell advice. Mapping is scenario→exposure→sensitivity→evidence from the local store only. Weights are user-supplied.",
  };
}
