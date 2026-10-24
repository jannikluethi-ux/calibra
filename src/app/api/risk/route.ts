import { NextResponse } from "next/server";
import { runGuardedJob } from "@/lib/security/job-guard";
import { getRiskGauges, persistRiskGauges } from "@/lib/risk/gauges";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ gauges: getRiskGauges() });
}

/** Job trigger — guarded: Bearer $CALIBRA_JOB_TOKEN (see lib/security/job-guard). */
export async function POST(req: Request) {
  return runGuardedJob(req, "risk-persist", async () => {
    return NextResponse.json({ gauges: persistRiskGauges() });
  });
}
