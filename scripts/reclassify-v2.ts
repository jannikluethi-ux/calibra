/**
 * Reclassify stored events with heuristic_v2 and rebuild scenarios + causal graph.
 * Usage: npx tsx scripts/reclassify-v2.ts
 */
import { getDb } from "../src/lib/db";
import { reclassifyEventsV2, getEvents, ensureDemoEventsIfEmpty } from "../src/lib/ingestion/rss";
import { rebuildScenariosFromEvents } from "../src/lib/scenarios/engine";
import { persistCausalGraph } from "../src/lib/causal/graph";
import { persistWarnings } from "../src/lib/warnings/detect";

async function main() {
  getDb();
  ensureDemoEventsIfEmpty();
  const result = reclassifyEventsV2({ limit: 200, onlyOutdated: false });
  console.log(`Reclassified ${result.updated}/${result.total} events → heuristic_v2`);

  const scenarios = rebuildScenariosFromEvents(15);
  console.log(`Rebuilt ${scenarios.length} scenarios from v2 chains`);

  const graph = persistCausalGraph();
  console.log(`Causal graph ${graph.graphVersion}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

  const warnings = persistWarnings();
  console.log(`Warnings: ${warnings.length}`);

  const sample = getEvents(5);
  for (const e of sample) {
    console.log("---");
    console.log(e.title.slice(0, 80));
    console.log(`  version=${e.classification.classifier_version} type=${e.classification.event_type}`);
    console.log(`  chain: ${e.causalChain.join(" → ")}`);
    console.log(`  composite=${e.impactScore.composite} conf=${e.classification.confidence}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
