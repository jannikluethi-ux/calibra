import { NextResponse } from "next/server";
import { runGuardedJob } from "@/lib/security/job-guard";
import { getMarketSnapshots, refreshMarketData } from "@/lib/market/fetch";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ markets: getMarketSnapshots() });
}

/** Job trigger — guarded: Bearer $CALIBRA_JOB_TOKEN (see lib/security/job-guard). */
export async function POST(req: Request) {
  return runGuardedJob(req, "market-refresh", async () => {
    const markets = await refreshMarketData();
    return NextResponse.json({ markets });
  });
}
