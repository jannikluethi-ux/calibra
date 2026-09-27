import { NextResponse } from "next/server";
import { getRiskGauges, persistRiskGauges } from "@/lib/risk/gauges";
import { ensureSeedData } from "@/lib/bootstrap/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureSeedData();
  return NextResponse.json({ gauges: getRiskGauges() });
}

export async function POST() {
  return NextResponse.json({ gauges: persistRiskGauges() });
}
