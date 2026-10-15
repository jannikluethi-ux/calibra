import { MarketExplorer } from "@/components/explorer/MarketExplorer";
import { getScenarios } from "@/lib/scenarios/engine";
import { scenarioWeights, type ScenarioWeights } from "@/components/uncertainty/ScenarioWeightBar";
import {
  expandScenarioWeightsToInstruments,
  instrumentSymbolsForScenarioAsset,
} from "@/lib/market/scenarioSymbols";

export const dynamic = "force-dynamic";

/**
 * Map recent scenario affectedAssets onto instrument lookup keys.
 * Uses the central scenario→instrument map so SPX/US10Y/DXY/VIX/EURUSD/etc. resolve
 * to real Yahoo/universe rows (and IXIC → NDX), not only BTC.
 */
function latestScenarioWeightMaps(): {
  byId: Record<string, ScenarioWeights>;
  bySymbolType: Record<string, ScenarioWeights>;
  coveredSymbols: string[];
} {
  const byScenario: Record<string, ScenarioWeights> = {};
  try {
    for (const s of getScenarios(40)) {
      for (const a of s.affectedAssets || []) {
        const k = a.toUpperCase();
        if (!byScenario[k]) byScenario[k] = scenarioWeights(s);
        // Also register under aliased instrument symbols (IXIC → NDX)
        for (const sym of instrumentSymbolsForScenarioAsset(k)) {
          if (!byScenario[sym]) byScenario[sym] = scenarioWeights(s);
        }
      }
    }
  } catch {
    /* no scenarios yet */
  }
  const expanded = expandScenarioWeightsToInstruments(byScenario);
  return { ...expanded, coveredSymbols: Object.keys(byScenario).sort() };
}

export default function ExplorerPage() {
  const maps = latestScenarioWeightMaps();
  return (
    <div className="space-y-6">
      <section className="pt-2">
        <div className="micro-label text-accent">Markets</div>
        <h1 className="mt-2 font-display text-display-l text-ink">Market explorer</h1>
        <p className="mt-2 text-sm text-ink-2 max-w-3xl">
          Search the full instrument universe. Prices come from stored provider quotes. A dash means the field
          isn&apos;t available, not zero. Scenario weights appear only when a recent event scenario covers that
          instrument (macro codes map to real index/FX/rates rows; colliding crypto tickers are excluded). They
          are model estimates, not signals.
        </p>
        {maps.coveredSymbols.length > 0 && (
          <p className="mt-2 text-caption text-ink-3">
            Scenario coverage on this load: {maps.coveredSymbols.join(", ")}.
          </p>
        )}
      </section>
      <MarketExplorer scenarioWeightMaps={maps} />
    </div>
  );
}
