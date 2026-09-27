import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getForecasts, ensureForecasts } from "@/lib/forecast/distributions";
import { computeCalibration, type CohortFilter } from "@/lib/forecast/calibration";
import { getResolvePipelineStatus } from "@/lib/forecast/resolve";
import { requireApiKeyAuth, jsonWithProvenance } from "@/lib/api-keys/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = requireApiKeyAuth(req);
  if (!gate.ok) return gate.response;
  ensureSeedData();
  ensureForecasts();
  const url = new URL(req.url);
  const cohort = (url.searchParams.get("cohort") as CohortFilter) || "live";
  const forecasts = getForecasts();
  return jsonWithProvenance(
    {
      calibration: computeCalibration(forecasts, cohort),
      seedCalibration: computeCalibration(forecasts, "seed"),
      pipeline: getResolvePipelineStatus(),
      counts: {
        total: forecasts.length,
        live: forecasts.filter((f) => !f.isSeed).length,
        seed: forecasts.filter((f) => f.isSeed).length,
      },
      note: "Live and SEED cohorts are never conflated in marketed accuracy numbers.",
    },
    gate.headers
  );
}
