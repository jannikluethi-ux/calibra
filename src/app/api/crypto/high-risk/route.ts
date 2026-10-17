import { NextResponse } from "next/server";
import { parseHighRiskQuery, toQueryString } from "@/lib/crypto/highrisk-query";
import { listHighRisk, highRiskFacets } from "@/lib/crypto/risk-store";
import { MODEL_VERSION } from "@/lib/crypto/risk-v2";
import { NON_ADVISORY } from "@/components/crypto/RiskBits";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = parseHighRiskQuery(url.searchParams);
  const list = listHighRisk(q);
  return NextResponse.json({
    model_version: MODEL_VERSION,
    query: q,
    query_string: toQueryString(q),
    ...list,
    facets: highRiskFacets(),
    methodology: "/crypto/methodology",
    disclaimer: NON_ADVISORY,
  });
}
