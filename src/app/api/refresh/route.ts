import { NextResponse } from "next/server";
import { runGuardedJob } from "@/lib/security/job-guard";
import { fullRefresh, getStatus, ensureSeedData } from "@/lib/bootstrap/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET /api/refresh — data status for the StatusBar. Read-only (B2.2): no seeding, no jobs. */
export async function GET() {
  return NextResponse.json({ status: getStatus() });
}

/** POST /api/refresh — full external refresh + derive. Guarded: Bearer $CALIBRA_JOB_TOKEN. */
export async function POST(req: Request) {
  return runGuardedJob(req, "full-refresh", async () => {
    ensureSeedData();
    const result = await fullRefresh();
    return NextResponse.json({ result, status: getStatus() });
  });
}
