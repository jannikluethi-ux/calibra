import { getDb } from "./db";
import { getFiredAlerts } from "./alerts/store";
import { getRiskGauges } from "./risk/gauges";
import { getEvents } from "./ingestion/rss";
import { getMarketSnapshots } from "./market/fetch";
import { getSchedulerStatus } from "./scheduler/runner";

/** Factual summary of stored data changed in the last `hours`. No recommendations. */
export function getOvernightDigest(hours = 12) {
  getDb();
  const since = Date.now() - hours * 3600 * 1000;
  const after = (iso?: string) => !!iso && new Date(iso).getTime() >= since;
  const events = getEvents(500).filter((e) => after(e.ingestedAt));
  const seen = new Set<string>();
  const topEvents = [...events]
    .sort((a, b) => b.impactScore.composite - a.impactScore.composite)
    .filter((e) => (seen.has(e.title) ? false : (seen.add(e.title), true)))
    .sort((a, b) => b.impactScore.composite - a.impactScore.composite)
    .slice(0, 8)
    .map((e) => ({ id: e.id, title: e.title, composite: e.impactScore.composite, publishedAt: e.publishedAt }));
  const markets = getMarketSnapshots()
    .filter((m) => m.change1d != null)
    .sort((a, b) => Math.abs(b.change1d as number) - Math.abs(a.change1d as number))
    .slice(0, 8)
    .map((m) => ({ symbol: m.symbol, price: m.price, change1d: m.change1d }));
  const alerts = getFiredAlerts()
    .filter((a) => after(a.firedAt))
    .map((a) => ({ ruleName: a.ruleName, message: a.message, firedAt: a.firedAt }));
  const gauges = getRiskGauges().map((g) => ({ id: g.id, name: g.name, score: g.score, direction: g.direction }));
  const s = getSchedulerStatus();
  // Materiality heuristic (thresholds are editorial, not signals): surface only when something notable changed.
  const reasons: string[] = [];
  if (alerts.length > 0) reasons.push(`${alerts.length} alert(s) fired`);
  const hiEvents = topEvents.filter((e) => e.composite >= 65);
  if (hiEvents.length > 0) reasons.push(`${hiEvents.length} event(s) with impact >= 65`);
  const bigMoves = markets.filter((m) => Math.abs(m.change1d as number) >= 5);
  if (bigMoves.length > 0) reasons.push(`stored 1d move >= 5%: ${bigMoves.map((m) => m.symbol).join(", ")}`);
  const hotGauges = gauges.filter((g) => g.score >= 70);
  if (hotGauges.length > 0) reasons.push(`risk gauge >= 70: ${hotGauges.map((g) => g.name).join(", ")}`);
  if (s.dataQuality && s.dataQuality !== "live") reasons.push(`data quality: ${s.dataQuality}`);
  return {
    material: reasons.length > 0,
    materialReasons: reasons,
    windowHours: hours,
    generatedAt: new Date().toISOString(),
    lastTick: s.lastTick,
    dataQuality: s.dataQuality,
    lastMarketUpdate: s.lastMarketUpdate,
    lastEventUpdate: s.lastEventUpdate,
    newEventCount: events.length,
    topEvents,
    largestStoredMoves: markets,
    firedAlerts: alerts,
    riskGauges: gauges,
    disclaimer:
      "Summary of stored data only. Not investment advice and not a buy, sell or hold signal. Downside figures are scenario weights.",
  };
}
