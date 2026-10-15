import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getRiskGauges, persistRiskGauges } from "@/lib/risk/gauges";
import { getMarketSnapshots } from "@/lib/market/fetch";
import { getEvents } from "@/lib/ingestion/rss";
import { getWarnings } from "@/lib/warnings/detect";
import { getScenarios } from "@/lib/scenarios/engine";
import { getMeta } from "@/lib/db";
import { getOvernightDigest } from "@/lib/digest";
import { getForecasts, ensureForecasts } from "@/lib/forecast/distributions";
import { computeCalibration } from "@/lib/forecast/calibration";
import { MarketCards } from "@/components/dashboard/MarketCards";
import { MoversBoard } from "@/components/dashboard/MoversBoard";
import { RiskStrip } from "@/components/dashboard/RiskStrip";
import { rankMovers } from "@/lib/movers/rank";
import { Badge } from "@/components/ui/Badge";
import { ScenarioWeightBar, scenarioWeights } from "@/components/uncertainty/ScenarioWeightBar";
import { ProvenanceChip } from "@/components/uncertainty/ProvenanceChip";
import { MetricDelta } from "@/components/uncertainty/MetricDelta";
import { brand } from "@/lib/brand";
import { normalizeEventTitle } from "@/lib/ingestion/dedupe";
import { universeSymbolMatchesScenarioAsset } from "@/lib/market/scenarioSymbols";
import Link from "next/link";

export const dynamic = "force-dynamic";

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function SectionHead({ title, href, linkLabel, chip }: { title: string; href?: string; linkLabel?: string; chip?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {chip}
      </div>
      {href && (
        <Link href={href} className="text-caption text-accent hover:underline">
          {linkLabel ?? "View all"} →
        </Link>
      )}
    </div>
  );
}

export default function TodayPage() {
  ensureSeedData();
  let gauges = getRiskGauges();
  if (!gauges.length) gauges = persistRiskGauges();
  const markets = getMarketSnapshots();
  const events = getEvents(6);
  const warnings = getWarnings().slice(0, 4);
  // Dedupe scenario cards: same eventId or normalized headline (strip "Scenario set:") → one card.
  const seenKeys = new Set<string>();
  const scenarios = getScenarios(24).filter((s) => {
    const headline = s.title.replace(/^Scenario set:\s*/i, "");
    const key = s.eventId
      ? `event:${s.eventId}`
      : `title:${normalizeEventTitle(headline)}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  }).slice(0, 12);
  const dataQuality = getMeta("dataQuality") || "insufficient";
  const lastRisk = getMeta("lastRiskUpdate");
  const initialMovers = rankMovers("1-4w", "up", 10);
  const digest = safe(() => getOvernightDigest(12), null);
  const calib = safe(() => {
    ensureForecasts();
    return computeCalibration(getForecasts(), "live");
  }, null);

  // Lead scenario: one linked to the highest-impact overnight event if any, else the most recent sketch.
  const topEventIds = new Set((digest?.topEvents ?? []).map((e) => e.id));
  const lead = scenarios.find((s) => s.eventId && topEventIds.has(s.eventId)) ?? scenarios[0];
  const others = scenarios.filter((s) => s !== lead).slice(0, 4);
  const hotGauges = gauges.filter((g) => g.score >= 70);
  const moves = (digest?.largestStoredMoves ?? []).slice(0, 3);

  const enriched = markets.map((m) => {
    const s = scenarios.find((sc) =>
      (sc.affectedAssets || []).some((a) => universeSymbolMatchesScenarioAsset(m.symbol, a))
    );
    return { ...m, scenarioWeights: s ? scenarioWeights(s) : undefined };
  });

  const resolved = calib?.totalResolved ?? 0;
  const brier = calib && resolved > 0 && Number.isFinite(calib.avgBrier) ? calib.avgBrier : null;
  const proof: { label: string; value: string; note?: string }[] = [
    {
      label: "Forecasts resolved",
      value: String(resolved),
      note: resolved < 50 ? "small sample — too few to judge calibration" : undefined,
    },
    { label: "Avg. Brier score", value: brier != null ? brier.toFixed(3) : "—", note: brier != null ? "lower is better · uniform guess = 0.160" : "needs resolved forecasts" },
    { label: "Open forecasts", value: String(calib?.openCount ?? 0) },
    { label: "Markets tracked", value: String(markets.length) },
    { label: "Events in last 12h", value: String(digest?.newEventCount ?? 0) },
  ];

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-8 items-start pt-2 rise-in">
        <div>
          <div className="micro-label text-accent">Probabilistic market intelligence</div>
          <h1 className="mt-3 font-display text-display-xl text-ink max-w-xl">
            Probabilities, not predictions.
          </h1>
          <p className="mt-4 text-body-l text-ink-2 max-w-xl">
            Calibra turns overnight news and market data into weighted scenarios — every number tagged as
            observed, interpreted, modelled or estimated, and every forecast scored in public. {brand.philosophy}.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/digest" className="inline-flex items-center rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-surface-0 hover:bg-accent/90 transition-colors duration-[120ms]">
              Open overnight digest
            </Link>
            <Link href="/methodology" className="inline-flex items-center rounded-md border border-line-strong px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface-2 transition-colors duration-[120ms]">
              See track record
            </Link>
          </div>
          <p className="mt-5 text-caption text-ink-3 max-w-xl">
            Not investment advice. Scenario weights describe uncertainty; a Downside scenario weight is not a sell
            signal and an Upside weight is not a buy signal.
          </p>
        </div>

        {/* Hero object */}
        <div className="card-hero p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="micro-label">Today&apos;s probability picture</span>
            <ProvenanceChip kind="estimate" at={lead?.updatedAt} source="Calibra scenario engine" />
          </div>
          {lead ? (
            <>
              <Link href="/scenarios" className="mt-3 block text-title text-ink hover:text-accent transition-colors line-clamp-3">
                {lead.title}
              </Link>
              <div className="mt-1 text-caption text-ink-3">Horizon {lead.timeHorizon}</div>
              <div className="mt-5 flex items-end gap-6">
                <div>
                  <div className="num text-metric-xl text-ink">{lead.base.probability}%</div>
                  <div className="text-caption text-ink-2">Base scenario weight</div>
                </div>
                <div>
                  <div className="num text-metric text-ink">{lead.bear.probability}%</div>
                  <div className="text-caption text-ink-2">Downside scenario weight</div>
                </div>
              </div>
              <div className="mt-4">
                <ScenarioWeightBar weights={scenarioWeights(lead)} size="lg" />
              </div>
            </>
          ) : (
            <div className="mt-4 empty-state">
              No scenario sketches yet. Estimates appear only when there are events to condition on.
            </div>
          )}

          <div className="mt-6 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="micro-label">Overnight change · last {digest?.windowHours ?? 12}h</span>
              <ProvenanceChip kind="observed" at={digest?.lastMarketUpdate} compact />
            </div>
            {digest ? (
              <ul className="mt-3 space-y-2 text-sm">
                <li className="flex justify-between gap-3">
                  <span className="text-ink-2">New events ingested</span>
                  <span className="num text-ink">{digest.newEventCount}</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-ink-2">Alerts fired</span>
                  <span className="num text-ink">{digest.firedAlerts.length}</span>
                </li>
                {hotGauges.length > 0 && (
                  <li className="flex justify-between gap-3">
                    <span className="text-ink-2">Risk gauges ≥ 70</span>
                    <span className="text-ink text-right">{hotGauges.map((g) => g.name).join(", ")}</span>
                  </li>
                )}
                {moves.map((m) => (
                  <li key={m.symbol} className="flex justify-between gap-3">
                    <span className="text-ink-2">{m.symbol} stored 1-day move</span>
                    <MetricDelta value={m.change1d} unit="%" digits={2} since="prior close" />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3 text-caption text-ink-3">Digest unavailable right now.</div>
            )}
          </div>
        </div>
      </section>

      {/* Proof strip — real counts only */}
      <section aria-label="Track record" className="card px-5 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {proof.map((p) => (
            <div key={p.label}>
              <div className="num text-metric text-ink">{p.value}</div>
              <div className="text-caption text-ink-2">{p.label}</div>
              {p.note && <div className="text-[11px] text-ink-3 mt-0.5">{p.note}</div>}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-caption text-ink-3">
          <span>
            Live cohort only; misses included. Data quality: <span className="text-ink-2">{dataQuality}</span>.
          </span>
          <Link href="/methodology" className="text-accent hover:underline">Calibration & methodology →</Link>
        </div>
      </section>

      {/* Elevated scenarios */}
      <section>
        <SectionHead title="More scenario sketches" href="/scenarios" linkLabel="All scenarios" chip={<ProvenanceChip kind="estimate" compact />} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {others.map((s) => (
            <div key={s.id} className="card p-4">
              <div className="flex items-center justify-between gap-2 text-caption text-ink-3">
                <span>Horizon {s.timeHorizon}</span>
                <ProvenanceChip kind="estimate" at={s.updatedAt} compact />
              </div>
              <div className="mt-1.5 text-sm text-ink leading-snug line-clamp-2">{s.title}</div>
              <div className="mt-3">
                <ScenarioWeightBar weights={scenarioWeights(s)} />
              </div>
            </div>
          ))}
          {!others.length && (
            <div className="empty-state md:col-span-2">Not enough events for further scenario sketches.</div>
          )}
        </div>
      </section>

      <RiskStrip gauges={gauges} at={lastRisk} />

      <MoversBoard initialHorizon="1-4w" initialData={initialMovers} />

      <MarketCards markets={enriched} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="card p-5">
          <SectionHead title="Latest events" href="/events" chip={<ProvenanceChip kind="observed" compact />} />
          <div>
            {events.map((e) => (
              <div key={e.id} className="border-b border-line py-3 first:pt-0 last:border-0 last:pb-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <ProvenanceChip kind="observed" at={e.publishedAt} source={`Source tier ${e.sourceTier}`} compact />
                  <span className="text-[11px] text-ink-3" title="Source tier: 1 = primary/official, 4 = low reliability">Tier {e.sourceTier}</span>
                </div>
                <div className="mt-1 text-sm text-ink leading-snug">{e.title}</div>
                {e.causalChain.length > 0 && (
                  <div className="mt-1 text-caption text-ink-3 truncate" title="Interpreted transmission chain">
                    {e.causalChain.join(" → ")}
                  </div>
                )}
              </div>
            ))}
            {!events.length && <div className="empty-state">No events yet. Nothing is invented in the meantime.</div>}
          </div>
        </section>

        <section className="card p-5">
          <SectionHead title="Warnings radar" href="/warnings" linkLabel="Radar" chip={<ProvenanceChip kind="interpreted" compact />} />
          <div>
            {warnings.map((w) => (
              <div key={w.id} className="border-b border-line py-3 first:pt-0 last:border-0 last:pb-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone={w.severity === "high" || w.severity === "critical" ? "amber" : "neutral"}>{w.severity}</Badge>
                  <span className="text-[11px] text-ink-3">confidence <span className="num">{w.confidence}%</span></span>
                </div>
                <div className="text-sm mt-1.5 text-ink leading-snug">{w.title}</div>
                <div className="text-caption text-ink-2 mt-1 leading-relaxed">{w.signal}</div>
              </div>
            ))}
            {!warnings.length && <div className="empty-state">No active warnings. The radar stays empty rather than inventing signals.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
