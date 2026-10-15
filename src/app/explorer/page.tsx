import { MarketExplorer } from "@/components/explorer/MarketExplorer";
import { getScenarios } from "@/lib/scenarios/engine";
import { scenarioWeights, type ScenarioWeights } from "@/components/uncertainty/ScenarioWeightBar";

export const dynamic = "force-dynamic";

/** Map tracked symbols to the most recent scenario that lists them. Crypto symbols map BTC only (what scenarios cover). */
function latestScenarioBySymbol(): Record<string, ScenarioWeights> {
  const out: Record<string, ScenarioWeights> = {};
  try {
    for (const s of getScenarios(40)) {
      for (const a of s.affectedAssets || []) {
        const k = a.toUpperCase();
        if (!out[k]) out[k] = scenarioWeights(s);
      }
    }
  } catch {
    /* no scenarios yet: column shows dashes */
  }
  return out;
}

export default function ExplorerPage() {
  const scenarioBySymbol = latestScenarioBySymbol();
  return (
    <div className="space-y-6">
      <section className="pt-2">
        <div className="micro-label text-accent">Markets</div>
        <h1 className="mt-2 font-display text-display-l text-ink">Market explorer</h1>
        <p className="mt-2 text-sm text-ink-2 max-w-3xl">
          Search the full instrument universe. Prices come from stored provider quotes. A dash means the field
          isn&apos;t available, not zero. Scenario weights appear only when a recent event scenario covers that symbol.
          They are model estimates, not signals.
        </p>
      </section>
      <MarketExplorer scenarioBySymbol={scenarioBySymbol} />
    </div>
  );
}
