import { NextResponse } from "next/server";
import { runGuardedJob } from "@/lib/security/job-guard";
import { getEvents, ingestRssFeeds } from "@/lib/ingestion/rss";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ events: getEvents(100) });
}

/** Job trigger — guarded: Bearer $CALIBRA_JOB_TOKEN (see lib/security/job-guard). */
export async function POST(req: Request) {
  return runGuardedJob(req, "rss-ingest", async () => {
    const result = await ingestRssFeeds();
    return NextResponse.json(result);
  });
}
