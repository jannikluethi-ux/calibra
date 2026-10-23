import { NextResponse } from "next/server";
import { runGuardedJob } from "@/lib/security/job-guard";
import { getEvents, ingestRssFeeds, ensureDemoEventsIfEmpty } from "@/lib/ingestion/rss";
import { ensureSeedData } from "@/lib/bootstrap/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureSeedData();
  ensureDemoEventsIfEmpty();
  return NextResponse.json({ events: getEvents(100) });
}

/** Job trigger — guarded: Bearer $CALIBRA_JOB_TOKEN (see lib/security/job-guard). */
export async function POST(req: Request) {
  return runGuardedJob(req, "rss-ingest", async () => {
    const result = await ingestRssFeeds();
    return NextResponse.json(result);
  });
}
