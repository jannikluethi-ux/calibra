import { NextResponse } from "next/server";
import { getEvents, ingestRssFeeds, ensureDemoEventsIfEmpty } from "@/lib/ingestion/rss";
import { ensureSeedData } from "@/lib/bootstrap/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureSeedData();
  ensureDemoEventsIfEmpty();
  return NextResponse.json({ events: getEvents(100) });
}

export async function POST() {
  const result = await ingestRssFeeds();
  return NextResponse.json(result);
}
