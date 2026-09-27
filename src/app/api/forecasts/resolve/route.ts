import { NextResponse } from "next/server";
import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { resolveDueForecasts, getResolvePipelineStatus } from "@/lib/forecast/resolve";
import { backfillHistoricalBars, countHistory } from "@/lib/market/history";
import { bootstrapShortHorizonForecasts } from "@/lib/forecast/distributions";
import { computeCalibration } from "@/lib/forecast/calibration";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  ensureSeedData();
  return NextResponse.json({ pipeline: getResolvePipelineStatus(), historyPoints: countHistory() });
}

export async function POST(req: Request) {
  ensureSeedData();
  let backfill = false;
  try {
    const body = await req.json().catch(() => ({}));
    backfill = Boolean((body as { backfill?: boolean }).backfill);
  } catch {
    backfill = false;
  }

  const errors: string[] = [];
  let historyInserted = 0;
  if (backfill || countHistory() < 40) {
    try {
      const bf = await backfillHistoricalBars();
      historyInserted = bf.inserted;
      errors.push(...bf.errors);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  try {
    bootstrapShortHorizonForecasts();
  } catch (e) {
    errors.push(`bootstrap: ${e instanceof Error ? e.message : String(e)}`);
  }

  const result = resolveDueForecasts();
  const calibration = computeCalibration(undefined, "live");

  return NextResponse.json({
    result,
    historyInserted,
    historyPoints: countHistory(),
    pipeline: getResolvePipelineStatus(),
    calibration,
    errors,
  });
}
