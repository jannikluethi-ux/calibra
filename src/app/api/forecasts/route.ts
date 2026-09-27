import { NextResponse } from "next/server";
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

export async function POST() {
  const forecasts = refreshForecasts();
  return NextResponse.json({
    forecasts,
    calibration: computeCalibration(forecasts, "live"),
    pipeline: getResolvePipelineStatus(),
  });
}
