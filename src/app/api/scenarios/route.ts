import { NextResponse } from "next/server";
import { runGuardedJob } from "@/lib/security/job-guard";
import { getScenarios, rebuildScenariosFromEvents, ensureScenarios, scenarioSchemaStatus } from "@/lib/scenarios/engine";
import { ensureSeedData } from "@/lib/bootstrap/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureSeedData();
  ensureScenarios();
  return NextResponse.json({ scenarios: getScenarios().map((s) => ({ ...s, schemaStatus: scenarioSchemaStatus(s) })) });
}

/** Job trigger — guarded: Bearer $CALIBRA_JOB_TOKEN (see lib/security/job-guard). */
export async function POST(req: Request) {
  return runGuardedJob(req, "scenarios-rebuild", async () => {
    const scenarios = rebuildScenariosFromEvents(15);
    return NextResponse.json({ scenarios });
  });
}
