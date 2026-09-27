import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getForecasts, ensureForecasts } from "@/lib/forecast/distributions";
import { computeCalibration } from "@/lib/forecast/calibration";
import { getResolvePipelineStatus, normalizeForecast } from "@/lib/forecast/resolve";
import { ForecastDashboard } from "@/components/forecasts/ForecastDashboard";

export const dynamic = "force-dynamic";

export default function ForecastsPage() {
  ensureSeedData();
  ensureForecasts();
  const forecasts = getForecasts().map(normalizeForecast);
  const calibrationLive = computeCalibration(forecasts, "live");
  const calibrationSeed = computeCalibration(forecasts, "seed");
  const calibrationAll = computeCalibration(forecasts, "all");
  const pipeline = getResolvePipelineStatus();

  return (
    <ForecastDashboard
      forecasts={forecasts}
      calibrationLive={calibrationLive}
      calibrationSeed={calibrationSeed}
      calibrationAll={calibrationAll}
      pipeline={pipeline}
    />
  );
}
