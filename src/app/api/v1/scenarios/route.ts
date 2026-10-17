import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getScenarios, ensureScenarios, scenarioSchemaStatus } from "@/lib/scenarios/engine";
import { requireApiKeyAuth, jsonWithProvenance } from "@/lib/api-keys/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = requireApiKeyAuth(req);
  if (!gate.ok) return gate.response;
  ensureSeedData();
  ensureScenarios();
  const scenarios = getScenarios().map((s) => ({
    id: s.id,
    title: s.title,
    timeHorizon: s.timeHorizon,
    affectedAssets: s.affectedAssets,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    label: s.label,
    schemaStatus: scenarioSchemaStatus(s),
    v2: s.v2 ?? null,
    base: { probability: s.base.probability, confidence: s.base.confidence, narrative: s.base.narrative },
    bull: { probability: s.bull.probability, confidence: s.bull.confidence, narrative: s.bull.narrative },
    bear: { probability: s.bear.probability, confidence: s.bear.confidence, narrative: s.bear.narrative },
    tail: { probability: s.tail.probability, confidence: s.tail.confidence, narrative: s.tail.narrative },
  }));
  return jsonWithProvenance({ scenarios, count: scenarios.length }, gate.headers);
}
