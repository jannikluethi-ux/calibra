import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getEvents, ensureDemoEventsIfEmpty } from "@/lib/ingestion/rss";
import { requireApiKeyAuth, jsonWithProvenance } from "@/lib/api-keys/auth";
import { getPlan } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = requireApiKeyAuth(req);
  if (!gate.ok) return gate.response;
  ensureSeedData();
  ensureDemoEventsIfEmpty();
  const limit = getPlan(gate.auth.plan).limits.eventsPageSize;
  const events = getEvents(limit).map((e) => ({
    id: e.id,
    title: e.title,
    summary: e.summary,
    publishedAt: e.publishedAt,
    ingestedAt: e.ingestedAt,
    sourceTier: e.sourceTier,
    sourceName: e.sourceName,
    quality: e.quality,
    impactScore: e.impactScore,
    timeHorizon: e.timeHorizon,
    country: e.country,
    tags: e.tags,
    causalChain: e.causalChain,
  }));
  return jsonWithProvenance({ events, count: events.length }, gate.headers);
}
