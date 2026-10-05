import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { prepareCryptoStore } from "@/lib/sources/prepare";
import { INFO_RULE_TEXT, LIQUIDITY_RULE_TEXT, MOVE_RULE_TEXT, RISK_BAND_TEXT } from "@/lib/crypto/risk";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  prepareCryptoStore();
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));
  const db = getDb();
  const bands = db
    .prepare(`SELECT band, COUNT(*) AS c FROM crypto_risk_assessments GROUP BY band`)
    .all();
  const top = db
    .prepare(
      `SELECT r.instrument_id, r.total, r.band, r.factors_scored, r.market_factors_scored, r.band_capped, r.cap_reason, r.components_json,
              i.symbol, i.name, i.rank
       FROM crypto_risk_assessments r
       JOIN instruments i ON i.id = r.instrument_id
       ORDER BY r.total DESC, i.market_cap DESC
       LIMIT ?`
    )
    .all(limit);
  const highest = top[0] || null;
  return NextResponse.json({
    bands,
    scored: (db.prepare(`SELECT COUNT(*) AS c FROM crypto_risk_assessments`).get() as { c: number }).c,
    highest,
    rules: { liquidity: LIQUIDITY_RULE_TEXT, move: MOVE_RULE_TEXT, information: INFO_RULE_TEXT, bands: RISK_BAND_TEXT },
    note: "Research score only. Not a buy or sell signal.",
  });
}
