import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Badge, QualityBadge } from "@/components/ui/Badge";
import { BrandMark } from "@/components/brand/BrandMark";
import { brand } from "@/lib/brand";
import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getForecasts, ensureForecasts } from "@/lib/forecast/distributions";
import { computeCalibration } from "@/lib/forecast/calibration";
import { DisclaimerStrip } from "@/components/billing/UpgradeBanner";

export const dynamic = "force-dynamic";

export default function MethodologyPage() {
  ensureSeedData();
  ensureForecasts();
  const forecasts = getForecasts();
  const live = computeCalibration(forecasts, "live");
  const seed = computeCalibration(forecasts, "seed");
  const sampleResolved = forecasts
    .filter((f) => f.status === "resolved" && !f.isSeed)
    .slice(0, 8);
  const sampleSeed = forecasts.filter((f) => f.status === "resolved" && f.isSeed).slice(0, 3);

  return (
    <div className="space-y-3 max-w-4xl">
      <div className="hero-strip px-4 py-4">
        <div className="flex items-start gap-3">
          <BrandMark size={36} />
          <div>
            <h1 className="font-display text-base font-semibold">Methodology & track record</h1>
            <p className="text-2xs text-terminal-dim mt-1 max-w-2xl leading-relaxed">
              Diligence page for design partners and desks. {brand.name} is an intelligence tool —{" "}
              {brand.philosophy}. Never investment advice.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <Link
                href="/pricing"
                className="px-2.5 py-1 rounded border border-terminal-teal text-terminal-teal text-2xs hover:bg-terminal-teal/10"
              >
                Pro plans
              </Link>
              <Link
                href="/login"
                className="px-2.5 py-1 rounded border border-terminal-border text-2xs hover:border-terminal-teal"
              >
                Contact / login
              </Link>
            </div>
          </div>
        </div>
      </div>

      <Panel title="Product philosophy">
        <div className="text-xs space-y-2 text-terminal-text leading-relaxed">
          <p>
            Calibra is <strong>not a prediction machine</strong>. It organizes observed market and
            event evidence into scenario probabilities with explicit assumptions, invalidation
            conditions, and a calibration loop.
          </p>
          <p className="text-terminal-dim">
            Evidence chain: <span className="text-terminal-teal">{brand.evidenceChain}</span>. When
            evidence is thin, we say so — prefer uncertainty over false precision.
          </p>
        </div>
      </Panel>

      <Panel title="How scenarios & forecasts work">
        <ol className="list-decimal list-inside text-xs space-y-1.5 text-terminal-dim">
          <li>Ingest events (RSS / official sources) with source tier and citations.</li>
          <li>Classify transmission chains (Observed → Interpretation → Assumption → Estimate).</li>
          <li>Build scenario branches (base / bull / bear / tail) with probabilities and invalidators.</li>
          <li>
            Publish horizon-bounded forecast distributions over return buckets; resolve against{" "}
            <em>observed</em> prices only — never invent outcomes.
          </li>
          <li>Score with Brier / directional metrics; report Live vs SEED cohorts separately.</li>
        </ol>
      </Panel>

      <Panel title="Source tiers">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-2xs">
          {[
            { t: "T1", d: "Official / primary (central banks, agencies)" },
            { t: "T2", d: "Tier-1 wires & exchanges" },
            { t: "T3", d: "Reputable secondary research / press" },
            { t: "T4", d: "Weaker / demo / illustrative" },
          ].map((x) => (
            <div key={x.t} className="border border-terminal-border rounded p-2 bg-terminal-surface">
              <Badge tone="blue">{x.t}</Badge>
              <div className="mt-1 text-terminal-dim">{x.d}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Live calibration (Live cohort)"
        right={<QualityBadge quality="live" />}
      >
        <p className="text-2xs text-terminal-muted mb-2">
          Metrics below use <strong className="text-terminal-teal">non-seed</strong> forecasts only.
          SEED bootstrap is reported separately and must never be conflated in marketed accuracy.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Stat label="Resolved (live)" value={String(live.liveResolved)} />
          <Stat
            label="Avg Brier"
            value={live.avgBrier != null ? live.avgBrier.toFixed(3) : "n/a"}
          />
          <Stat
            label="Directional acc."
            value={
              live.directionalAccuracy != null
                ? `${(live.directionalAccuracy * 100).toFixed(1)}%`
                : "n/a"
            }
          />
          <Stat label="Open (live filter)" value={String(live.openCount)} />
        </div>
        {live.notes?.length > 0 && (
          <ul className="mt-2 text-2xs text-terminal-muted list-disc list-inside">
            {live.notes.slice(0, 4).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="SEED cohort (separated)" right={<Badge tone="amber">SEED</Badge>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Stat label="Resolved (seed)" value={String(seed.totalResolved)} />
          <Stat
            label="Avg Brier (seed)"
            value={seed.avgBrier != null ? seed.avgBrier.toFixed(3) : "n/a"}
          />
          <Stat label="Seed count" value={String(seed.seedCount)} />
          <Stat label="Unresolvable" value={String(seed.unresolvableCount)} />
        </div>
        <p className="text-2xs text-terminal-amber mt-2">
          SEED forecasts are transparent bootstrap / synthetic for UI demos — not marketed as live
          track record.
        </p>
      </Panel>

      <Panel title="Sample resolved forecasts (Live)">
        {sampleResolved.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-2xs">
              <thead className="text-terminal-dim uppercase tracking-wider">
                <tr className="border-b border-terminal-border">
                  <th className="text-left py-1 pr-2">Asset</th>
                  <th className="text-left py-1 pr-2">Horizon</th>
                  <th className="text-left py-1 pr-2">Bucket</th>
                  <th className="text-right py-1 pr-2">Return %</th>
                  <th className="text-right py-1">Brier</th>
                </tr>
              </thead>
              <tbody>
                {sampleResolved.map((f) => (
                  <tr key={f.id} className="border-b border-terminal-border/40">
                    <td className="py-1 pr-2 text-terminal-text">{f.assetSymbol}</td>
                    <td className="py-1 pr-2">{f.horizon}</td>
                    <td className="py-1 pr-2">{f.outcome?.outcomeBucket ?? "—"}</td>
                    <td className="py-1 pr-2 text-right num">
                      {f.outcome?.realizedReturnPct != null
                        ? f.outcome.realizedReturnPct.toFixed(2)
                        : "—"}
                    </td>
                    <td className="py-1 text-right num">
                      {f.outcome?.brierScore != null ? f.outcome.brierScore.toFixed(3) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-terminal-amber">
            No live-resolved forecasts yet — refresh data or wait for horizons to close. SEED samples
            may still appear below for illustration.
          </div>
        )}
        {sampleSeed.length > 0 && (
          <div className="mt-3">
            <div className="text-2xs text-terminal-amber mb-1">SEED samples (not live track record)</div>
            <ul className="text-2xs text-terminal-muted space-y-0.5">
              {sampleSeed.map((f) => (
                <li key={f.id}>
                  {f.assetSymbol} · {f.horizon} · bucket {f.outcome?.outcomeBucket} · Brier{" "}
                  {f.outcome?.brierScore?.toFixed(3)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <Panel title="Honest limitations">
        <ul className="text-xs text-terminal-dim space-y-1 list-disc list-inside">
          <li>Scenario probabilities are estimates conditional on stated assumptions.</li>
          <li>Market data may be delayed, proxied, or cached; quality badges are authoritative.</li>
          <li>Short live track record: small N means wide uncertainty on calibration stats.</li>
          <li>No portfolio advice, no execution, no guaranteed outcomes.</li>
          <li>API responses never invent missing observations — fields may be null.</li>
        </ul>
        <DisclaimerStrip />
      </Panel>

      <div className="flex flex-wrap gap-2 text-xs">
        <Link
          href="/pricing"
          className="px-3 py-2 rounded border border-terminal-teal text-terminal-teal hover:bg-terminal-teal/10"
        >
          Start Pro (demo)
        </Link>
        <Link
          href="/forecasts"
          className="px-3 py-2 rounded border border-terminal-border hover:border-terminal-teal"
        >
          Open forecasts
        </Link>
        <Link
          href="/docs/api"
          className="px-3 py-2 rounded border border-terminal-border hover:border-terminal-teal"
        >
          API docs
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-terminal-border rounded p-2 bg-terminal-surface">
      <div className="text-2xs text-terminal-muted uppercase tracking-wider">{label}</div>
      <div className="text-sm num text-terminal-teal mt-0.5">{value}</div>
    </div>
  );
}
