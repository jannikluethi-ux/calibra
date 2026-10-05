import { NextResponse } from "next/server";
import { instrumentFacets, queryInstruments } from "@/lib/instruments/store";

export const dynamic = "force-dynamic";

function numOrNull(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams;
  const result = queryInstruments({
    q: q.get("q") || "",
    asset_type: q.get("asset_type") || "",
    country: q.get("country") || "",
    category: q.get("category") || "",
    exchange: q.get("exchange") || "",
    market_cap_min: numOrNull(q.get("market_cap_min")),
    volume_min: numOrNull(q.get("volume_min")),
    sort: q.get("sort") || "market_cap",
    dir: q.get("dir") || "",
    page: Number(q.get("page") || "1"),
    pageSize: Number(q.get("pageSize") || q.get("page_size") || "50"),
    cursor: q.get("cursor"),
  });
  const facets = q.get("facets") === "0" ? undefined : instrumentFacets();
  return NextResponse.json({ ...result, facets });
}
