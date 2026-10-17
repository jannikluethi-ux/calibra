import { NextResponse } from "next/server";
import { getScenarios, rebuildScenariosFromEvents, ensureScenarios, scenarioSchemaStatus } from "@/lib/scenarios/engine";
import { ensureSeedData } from "@/lib/bootstrap/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureSeedData();
  ensureScenarios();
  return NextResponse.json({ scenarios: getScenarios().map((s) => ({ ...s, schemaStatus: scenarioSchemaStatus(s) })) });
}

export async function POST() {
  const scenarios = rebuildScenariosFromEvents(15);
  return NextResponse.json({ scenarios });
}
