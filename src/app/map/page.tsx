import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getCausalGraph, persistCausalGraph } from "@/lib/causal/graph";
import { CausalMapClient } from "@/components/map/CausalMapClient";

export const dynamic = "force-dynamic";

export default function MapPage() {
  ensureSeedData();
  let graph = getCausalGraph();
  if (!graph.nodes?.length) graph = persistCausalGraph();

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">Causal Financial Map</h1>
        <p className="text-2xs text-terminal-muted mt-0.5">
          Interactive transmission network from curated causal_kg_v2 knowledge graph + event activations. Green edges strengthening, red weakening, gray stable. Click edges for mechanism, typical sign/horizon, examples, caveats. Correlations are regime-dependent.
        </p>
      </div>
      <CausalMapClient graph={graph} />
    </div>
  );
}
