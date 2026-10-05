import { NextResponse } from "next/server";
import { suggestInstruments } from "@/lib/instruments/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") || "";
  const limit = Number(new URL(req.url).searchParams.get("limit") || "8");
  const items = suggestInstruments(q, Number.isFinite(limit) ? limit : 8);
  return NextResponse.json({
    items: items.map((i) => ({
      id: i.id,
      symbol: i.symbol,
      name: i.name,
      asset_type: i.asset_type,
      exchange: i.exchange,
      market_cap: i.market_cap,
      rank: i.rank,
      quote_status: i.quote_status,
    })),
  });
}
