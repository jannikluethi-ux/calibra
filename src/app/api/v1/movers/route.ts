import { parseMoverHorizon, parseMoverSide, rankMovers } from "@/lib/movers/rank";
import { requireApiKeyAuth, jsonWithProvenance } from "@/lib/api-keys/auth";
import { getPlan } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = requireApiKeyAuth(req);
  if (!gate.ok) return gate.response;
  const url = new URL(req.url);
  const horizon = parseMoverHorizon(url.searchParams.get("horizon"));
  const side = parseMoverSide(url.searchParams.get("side"));
  const max = getPlan(gate.auth.plan).limits.moversLimit;
  const limitRaw = Number(url.searchParams.get("limit") || String(max));
  const limit = Number.isFinite(limitRaw) ? Math.min(max, Math.max(1, Math.floor(limitRaw))) : max;
  const result = rankMovers(horizon, side, limit);
  return jsonWithProvenance(
    {
      ...result,
      limit,
      disclaimer:
        "Elevated scenario probability ranking — not a prediction that prices will rise or fall. Not investment advice.",
    },
    gate.headers
  );
}
