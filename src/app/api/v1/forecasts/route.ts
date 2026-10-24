import { getForecasts } from "@/lib/forecast/distributions";
import { requireApiKeyAuth, jsonWithProvenance } from "@/lib/api-keys/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = requireApiKeyAuth(req);
  if (!gate.ok) return gate.response;
  const url = new URL(req.url);
  const includeSeed = url.searchParams.get("includeSeed") === "1";
  const forecasts = getForecasts()
    .filter((f) => includeSeed || !f.isSeed)
    .map((f) => ({
      id: f.id,
      assetSymbol: f.assetSymbol,
      assetName: f.assetName,
      horizon: f.horizon,
      horizonEnd: f.horizonEnd,
      createdAt: f.createdAt,
      status: f.status,
      isSeed: f.isSeed,
      distribution: f.distribution,
      asOfPrice: f.asOfPrice,
      outcome: f.outcome
        ? {
            resolvedAt: f.outcome.resolvedAt,
            outcomeValue: f.outcome.outcomeValue,
            realizedReturnPct: f.outcome.realizedReturnPct,
            outcomeBucket: f.outcome.outcomeBucket,
            brierScore: f.outcome.brierScore,
            resolutionMethod: f.outcome.resolutionMethod,
          }
        : null,
      provenance: f.provenance,
    }));
  return jsonWithProvenance({ forecasts, count: forecasts.length }, gate.headers);
}
