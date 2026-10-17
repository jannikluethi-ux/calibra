import { NextResponse } from "next/server";
import { computeDataQualitySummary } from "@/lib/quality/summary";
import { getClusterMetrics } from "@/lib/ingestion/cluster";
import { computeEventMetrics } from "@/lib/quality/events";

export const dynamic = "force-dynamic";

/** Read-only data-quality summary: freshness, failing sources, gaps, stale/invalid values, affected outputs. */
export async function GET() {
  const summary = computeDataQualitySummary();
  let eventClusters = null;
  try {
    eventClusters = getClusterMetrics();
  } catch {
    eventClusters = null;
  }
  let eventMetrics = null;
  try {
    eventMetrics = computeEventMetrics();
  } catch {
    eventMetrics = null;
  }
  return NextResponse.json({ ...summary, eventClusters, eventMetrics });
}
