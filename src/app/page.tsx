import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getRiskGauges, persistRiskGauges } from "@/lib/risk/gauges";
import { getMarketSnapshots } from "@/lib/market/fetch";
import { getEvents } from "@/lib/ingestion/rss";
import { getWarnings } from "@/lib/warnings/detect";
import { getScenarios } from "@/lib/scenarios/engine";
import { getMeta } from "@/lib/db";
import { RiskGauges } from "@/components/dashboard/RiskGauges";
import { MarketCards } from "@/components/dashboard/MarketCards";
import { MoversBoard } from "@/components/dashboard/MoversBoard";
import { rankMovers } from "@/lib/movers/rank";
import { Panel } from "@/components/ui/Panel";
import { Badge, QualityBadge } from "@/components/ui/Badge";
import { BrandMark } from "@/components/brand/BrandMark";
import { brand } from "@/lib/brand";
import Link from "next/link";
import { fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  ensureSeedData();
  let gauges = getRiskGauges();
  if (!gauges.length) gauges = persistRiskGauges();
  const markets = getMarketSnapshots();
  const events = getEvents(8);
  const warnings = getWarnings().slice(0, 4);
  const scenarios = getScenarios().slice(0, 3);
  const dataQuality = getMeta("dataQuality") || "insufficient";
  const initialMovers = rankMovers("1-4w", "up", 10);

  const enriched = markets.map((m) => {
    const s = scenarios.find((sc) => sc.affectedAssets.includes(m.symbol));
    return {
      ...m,
      scenarioSnippet: s
        ? `Base ${s.base.probability}% / Bear ${s.bear.probability}%`
        : undefined,
      catalysts: events
        .filter(
          (e) =>
            e.causalChain.some((c) => c.toLowerCase().includes(m.symbol.toLowerCase())) ||
            e.tags.includes(m.symbol.toLowerCase())
        )
        .slice(0, 2)
        .map((e) => e.title),
    };
  });

  return (
    <div className="space-y-3">
      {/* Hero: brand + live quality + framing */}
      <div className="hero-strip px-4 py-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <BrandMark size={36} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-base font-semibold tracking-wide text-terminal-text">
                {brand.name}
              </h1>
              <QualityBadge quality={dataQuality} />
              <Badge tone="blue">research terminal</Badge>
            </div>
            <p className="text-2xs text-terminal-dim mt-1 max-w-2xl leading-relaxed">
              {brand.tagline} Distinguishes Observed → Interpretation → Model assumption → Scenario
              estimate. {brand.philosophy}.
            </p>
          </div>
        </div>
        <div className="text-2xs text-terminal-muted text-right space-y-1">
          <div className="uppercase tracking-wider text-terminal-dim">Horizon focus</div>
          <div className="text-terminal-teal num mt-0.5">default 1–4w</div>
          <div className="text-terminal-muted mt-0.5">set on Elevated Prob. board</div>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Link href="/methodology" className="text-terminal-teal hover:underline">
              Methodology
            </Link>
            <Link href="/pricing" className="text-terminal-dim hover:text-terminal-text">
              Pricing
            </Link>
          </div>
        </div>
      </div>

      <RiskGauges gauges={gauges} />

      <MoversBoard initialHorizon="1-4w" initialData={initialMovers} />

      <MarketCards markets={enriched} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Panel
          title="Latest Events"
          right={
            <Link href="/events" className="text-terminal-accent normal-case tracking-normal">
              View all
            </Link>
          }
        >
          <div className="space-y-2">
            {events.map((e) => (
              <div key={e.id} className="border-b border-terminal-border/60 pb-2 last:border-0">
                <div className="flex items-center gap-1 mb-0.5">
                  <QualityBadge quality={e.quality} />
                  <Badge>T{e.sourceTier}</Badge>
                  <span className="text-2xs text-terminal-muted num">{fmtTime(e.publishedAt)}</span>
                </div>
                <div className="text-xs text-terminal-text leading-snug">{e.title}</div>
                <div className="text-2xs text-terminal-dim mt-0.5 truncate">
                  {e.causalChain.join(" → ")}
                </div>
              </div>
            ))}
            {!events.length && (
              <div className="text-terminal-amber text-xs">
                No events — refresh to ingest RSS or load demo samples.
              </div>
            )}
          </div>
        </Panel>

        <Panel
          title="Active Warnings"
          right={
            <Link href="/warnings" className="text-terminal-accent normal-case tracking-normal">
              Radar
            </Link>
          }
        >
          <div className="space-y-2">
            {warnings.map((w) => (
              <div key={w.id} className="border-b border-terminal-border/60 pb-2 last:border-0">
                <div className="flex items-center gap-1">
                  <Badge
                    tone={
                      w.severity === "high" || w.severity === "critical"
                        ? "red"
                        : w.severity === "medium"
                          ? "amber"
                          : "green"
                    }
                  >
                    {w.severity}
                  </Badge>
                  <span className="text-2xs text-terminal-muted">conf {w.confidence}%</span>
                </div>
                <div className="text-xs mt-0.5">{w.title}</div>
                <div className="text-2xs text-terminal-dim">{w.signal}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Scenario Sketches"
          right={
            <Link href="/scenarios" className="text-terminal-accent normal-case tracking-normal">
              Engine
            </Link>
          }
        >
          <div className="space-y-2">
            {scenarios.map((s) => (
              <div key={s.id} className="border-b border-terminal-border/60 pb-2 last:border-0">
                <div className="text-2xs text-terminal-amber mb-0.5">ESTIMATE · {s.timeHorizon}</div>
                <div className="text-xs line-clamp-2">{s.title}</div>
                <div className="num text-2xs text-terminal-dim mt-1">
                  Base {s.base.probability}% · Bull {s.bull.probability}% · Bear {s.bear.probability}% ·
                  Tail {s.tail.probability}%
                </div>
              </div>
            ))}
            {!scenarios.length && (
              <div className="text-xs text-terminal-amber">Insufficient events for scenarios.</div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
