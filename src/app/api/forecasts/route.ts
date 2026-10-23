import { NextResponse } from "next/server";
import { runGuardedJob } from "@/lib/security/job-guard";
import { getForecasts, refreshForecasts, ensureForecasts } from "@/lib/forecast/distributions";
import { computeCalibration } from "@/lib/forecast/calibration";
import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getResolvePipelineStatus } from "@/lib/forecast/resolve";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  ensureSeedData();
  ensureForecasts();
  const url = new URL(req.url);
  const cohort = (url.searchParams.get("cohort") as "live" | "seed" | "all") || "live";
  const forecasts = getForecasts();
  return NextResponse.json({
    forecasts,
    calibration: computeCalibration(forecasts, cohort),
    pipeline: getResolvePipelineStatus(),
  });
}

/** Job trigger — guarded: Bearer $CALIBRA_JOB_TOKEN (see lib/security/job-guard). */
export async function POST(req: Request) {
  return runGuardedJob(req, "forecasts-refresh", async () => {
    const forecasts = refreshForecasts();
    return NextResponse.json({
      forecasts,
      calibration: computeCalibration(forecasts, "live"),
      pipeline: getResolvePipelineStatus(),
    });
  });
}
