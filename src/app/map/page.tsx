import { getCausalGraph } from "@/lib/causal/graph";
import { CausalMapClient } from "@/components/map/CausalMapClient";
import { AwaitingFirstRun } from "@/components/ui/AwaitingFirstRun";

export const dynamic = "force-dynamic";

export default function MapPage() {
  const graph = getCausalGraph();

  return (
    <div className="space-y-3">
      {!graph.nodes?.length && <AwaitingFirstRun what="causal-graph data" />}
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
