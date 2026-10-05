import { NextResponse } from "next/server";
import { queryInstruments } from "@/lib/instruments/store";
import { cryptoTier } from "@/lib/crypto/format";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") || 1);
  const pageSize = Number(url.searchParams.get("pageSize") || 50);
  const result = queryInstruments({
    q: url.searchParams.get("q") || "",
    asset_type: "crypto",
    sort: url.searchParams.get("sort") || "rank",
    dir: url.searchParams.get("dir") || "asc",
    page,
    pageSize,
  });
  return NextResponse.json({
    ...result,
    items: result.items.map((row) => ({ ...row, tier: cryptoTier(row) })),
  });
}
