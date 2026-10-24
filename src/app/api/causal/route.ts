import { NextResponse } from "next/server";
import { runGuardedJob } from "@/lib/security/job-guard";
import { getCausalGraph, persistCausalGraph } from "@/lib/causal/graph";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getCausalGraph());
}

/** Job trigger — guarded: Bearer $CALIBRA_JOB_TOKEN (see lib/security/job-guard). */
export async function POST(req: Request) {
  return runGuardedJob(req, "causal-persist", async () => {
    return NextResponse.json(persistCausalGraph());
  });
}
