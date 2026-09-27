/**
 * One-shot: backfill Yahoo historical bars → short-horizon live forecasts → resolve.
 * Run: npx tsx scripts/bootstrap-resolve.ts
 */
import { getDb, setMeta } from "../src/lib/db";
import { getMarketSnapshots } from "../src/lib/market/fetch";
import { backfillHistoricalBars, countHistory } from "../src/lib/market/history";
import {
  ensureForecasts,
  bootstrapShortHorizonForecasts,
  getForecasts,
  refreshForecasts,
} from "../src/lib/forecast/distributions";
import { resolveDueForecasts, getResolvePipelineStatus } from "../src/lib/forecast/resolve";
import { computeCalibration } from "../src/lib/forecast/calibration";

async function main() {
  getDb();
  ensureForecasts();

  console.log("market snapshots:", getMarketSnapshots().length);
  console.log("history before:", countHistory());

  if (process.env.FORCE_BOOTSTRAP === "1") {
    setMeta("shortHorizonBootstrapped", "0");
  }

  const bf = await backfillHistoricalBars();
  console.log("backfill inserted:", bf.inserted, "errors:", bf.errors);

  refreshForecasts();
  const created = bootstrapShortHorizonForecasts();
  console.log("short-horizon created/ensured:", created.length);

  const result = resolveDueForecasts();
  console.log("resolve:", JSON.stringify(result, null, 2));

  const calLive = computeCalibration(undefined, "live");
  const calSeed = computeCalibration(undefined, "seed");
  console.log("LIVE calibration:", {
    resolved: calLive.totalResolved,
    open: calLive.openCount,
    unresolvable: calLive.unresolvableCount,
    avgBrier: calLive.avgBrier,
    dirAcc: calLive.directionalAccuracy,
  });
  console.log("SEED calibration:", {
    resolved: calSeed.totalResolved,
    avgBrier: calSeed.avgBrier,
  });
  console.log("pipeline:", getResolvePipelineStatus());
  console.log("history after:", countHistory());
  console.log("total forecasts:", getForecasts().length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
