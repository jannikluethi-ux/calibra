import { NextResponse } from "next/server";
import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { runSchedulerTick } from "@/lib/scheduler/runner";
import { startScheduler } from "@/lib/scheduler/boot";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * POST /api/scheduler/tick — run due jobs now (also callable by external cron).
 * Explicit POST always evaluates due jobs (bypasses soft UI disable).
 * Auto-loop still respects CALIBRA_SCHEDULER=0 and UI toggle.
 */
export async function POST() {
  ensureSeedData();
  // Ensure in-process loop is alive when hit via API (dev HMR / missing instrumentation)
  startScheduler();

  const tick = await runSchedulerTick({ force: true });
  return NextResponse.json({
    ran: tick.ran,
    skipped: tick.skipped,
    quality: tick.quality,
    firedAlerts: tick.firedAlerts,
    noteworthy: tick.noteworthy,
    summary: tick.summary,
    details: tick.details,
  });
}
