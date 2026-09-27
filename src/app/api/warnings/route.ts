import { NextResponse } from "next/server";
import { getWarnings, persistWarnings } from "@/lib/warnings/detect";
import { ensureSeedData } from "@/lib/bootstrap/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureSeedData();
  return NextResponse.json({ warnings: getWarnings() });
}

export async function POST() {
  return NextResponse.json({ warnings: persistWarnings() });
}
