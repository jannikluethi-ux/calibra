import { NextResponse } from "next/server";
import { getMarketSnapshots, refreshMarketData } from "@/lib/market/fetch";
import { ensureSeedData } from "@/lib/bootstrap/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureSeedData();
  return NextResponse.json({ markets: getMarketSnapshots() });
}

export async function POST() {
  const markets = await refreshMarketData();
  return NextResponse.json({ markets });
}
