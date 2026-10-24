import { NextResponse } from "next/server";
import { runGuardedJob } from "@/lib/security/job-guard";
import { getWarnings, persistWarnings } from "@/lib/warnings/detect";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ warnings: getWarnings() });
}

/** Job trigger — guarded: Bearer $CALIBRA_JOB_TOKEN (see lib/security/job-guard). */
export async function POST(req: Request) {
  return runGuardedJob(req, "warnings-persist", async () => {
    return NextResponse.json({ warnings: persistWarnings() });
  });
}
