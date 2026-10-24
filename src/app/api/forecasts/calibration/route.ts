import { NextResponse } from "next/server";
import { getForecasts } from "@/lib/forecast/distributions";
import { computeCalibration, type CohortFilter } from "@/lib/forecast/calibration";
import { getResolvePipelineStatus } from "@/lib/forecast/resolve";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cohort = (url.searchParams.get("cohort") as CohortFilter) || "live";
  const forecasts = getForecasts();
  return NextResponse.json({
    calibration: computeCalibration(forecasts, cohort),
    pipeline: getResolvePipelineStatus(),
    counts: {
      total: forecasts.length,
      live: forecasts.filter((f) => !f.isSeed).length,
      seed: forecasts.filter((f) => f.isSeed).length,
    },
  });
}
