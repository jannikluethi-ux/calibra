import { NextResponse } from "next/server";
import { cryptoOverview } from "@/lib/crypto/overview";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(cryptoOverview());
}
