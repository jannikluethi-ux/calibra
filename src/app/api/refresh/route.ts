import { NextResponse } from "next/server";
import { fullRefresh, getStatus, ensureSeedData } from "@/lib/bootstrap/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  ensureSeedData();
  return NextResponse.json({ status: getStatus() });
}

export async function POST() {
  ensureSeedData();
  const result = await fullRefresh();
  return NextResponse.json({ result, status: getStatus() });
}
