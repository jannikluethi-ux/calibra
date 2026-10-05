import { NextResponse } from "next/server";
import { resolveSymbol } from "@/lib/instruments/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol") || "";
  const result = resolveSymbol(symbol);
  return NextResponse.json({
    query: symbol,
    status: result.status,
    instrument: result.instrument ?? null,
    candidates: result.candidates.map((c) => ({
      id: c.id,
      symbol: c.symbol,
      name: c.name,
      asset_type: c.asset_type,
      exchange: c.exchange,
      data_source: c.data_source,
      provider_id: c.provider_id,
      legacy_symbol: c.legacy_symbol,
      market_cap: c.market_cap,
    })),
  });
}
