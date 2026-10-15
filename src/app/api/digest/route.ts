import { NextResponse } from "next/server";
import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getOvernightDigest } from "@/lib/digest";

export const dynamic = "force-dynamic";

/** GET /api/digest?hours=12 — what changed in the stored data recently. */
export async function GET(req: Request) {
  ensureSeedData();
  const h = Number(new URL(req.url).searchParams.get("hours") || 12);
  return NextResponse.json(getOvernightDigest(Number.isFinite(h) && h > 0 && h <= 72 ? h : 12));
}
