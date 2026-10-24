import { NextResponse } from "next/server";
import {
  parseMoverHorizon,
  parseMoverSide,
  rankMovers,
} from "@/lib/movers/rank";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const horizon = parseMoverHorizon(url.searchParams.get("horizon"));
  const side = parseMoverSide(url.searchParams.get("side"));
  const limitRaw = Number(url.searchParams.get("limit") || "10");
  const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(1, Math.floor(limitRaw))) : 10;
  const result = rankMovers(horizon, side, limit);
  return NextResponse.json(result);
}
