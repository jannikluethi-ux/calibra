import { NextResponse } from "next/server";
import { getEvent } from "@/lib/ingestion/rss";
import { assessmentHistory, conflictsForEvents, latestAssessment, mappingsForAssessment, scenarioRowForEvent } from "@/lib/intel/store";
import { scenarioSchemaStatus } from "@/lib/scenarios/engine";

export const dynamic = "force-dynamic";

/** Read-only: provenance, rule-based assessment, documented instrument mappings, conflicts and scenario for one event. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const e = getEvent(params.id);
  if (!e) return NextResponse.json({ error: "not found" }, { status: 404 });
  const sa = latestAssessment(e.id);
  const sc = scenarioRowForEvent(e.id);
  return NextResponse.json({
    event: { id: e.id, title: e.title, sourceName: e.sourceName, sourceTier: e.sourceTier, publishedAt: e.publishedAt, quality: e.quality, provenance: e.provenance ?? null },
    assessment: sa ? { id: sa.id, ...sa.assessment } : null,
    assessmentVersions: assessmentHistory(e.id),
    mappings: sa ? mappingsForAssessment(sa.id) : [],
    conflicts: conflictsForEvents([e.id]),
    scenario: sc ? { schemaStatus: scenarioSchemaStatus(sc.scenario), ...sc.scenario } : null,
  });
}
