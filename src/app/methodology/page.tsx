import Link from "next/link";
import { brand } from "@/lib/brand";
import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getForecasts, ensureForecasts } from "@/lib/forecast/distributions";
import { computeCalibration } from "@/lib/forecast/calibration";
import { normalizeForecast } from "@/lib/forecast/resolve";
import { DisclaimerStrip } from "@/components/billing/UpgradeBanner";
import { CONFIDENCE_FORMULA_TEXT, RELIABILITY_WEIGHTS } from "@/lib/sources/weights";
import { RISK_BAND_TEXT } from "@/lib/crypto/risk";
import { ProvenanceChip } from "@/components/uncertainty/ProvenanceChip";
import type { Forecast } from "@/lib/types";

export const dynamic = "force-dynamic";

const BUCKET_LABEL: Record<string, string> = {
  strong_up: "Strong up",
  mod_up: "Moderate up",
  range: "Range",
  mod_down: "Moderate down",
  severe_down: "Severe down",
};
const bl = (b?: string) => (b ? BUCKET_LABEL[b] ?? b : "—");

function modal(f: Forecast) {
  const maxP = Math.max(...f.distribution.map((b) => b.probability));
  const m = f.distribution.find((b) => b.probability === maxP);
  return { label: m?.label, p: maxP };
}

function sampleCaveat(n: number): { tone: string; text: string } {
  if (n === 0) return { tone: "text-ink-3", text: "No resolved live forecasts yet — no calibration claim can be made." };
  if (n < 30) return { tone: "text-dq-stale", text: `Only ${n} resolved — far too few to judge calibration. Treat every metric as anecdotal.` };
  if (n < 100) return { tone: "text-dq-stale", text: `${n} resolved — early sample. Metrics are indicative with wide uncertainty.` };
  return { tone: "text-ink-2", text: `${n} resolved — enough for rough calibration, still subject to regime dependence.` };
}

export default function MethodologyPage() {
  ensureSeedData();
  ensureForecasts();
  const forecasts = getForecasts().map(normalizeForecast);
  const live = computeCalibration(forecasts, "live");
  const seed = computeCalibration(forecasts, "seed");
  const n = live.liveResolved;
  const caveat = sampleCaveat(n);
  const log = forecasts
    .filter((f) => f.status === "resolved" && f.outcome && !f.isSeed)
    .sort((a, b) => (b.outcome!.resolvedAt || "").localeCompare(a.outcome!.resolvedAt || ""))
    .slice(0, 40);
  const misses = log.filter((f) => modal(f).label !== f.outcome?.outcomeBucket).length;
  const seedLog = forecasts.filter((f) => f.status === "resolved" && f.isSeed && f.outcome).slice(0, 5);

  return (
    <div className="space-y-12 max-w-5xl">
      {/* Hero */}
      <section className="pt-2 rise-in">
        <div className="micro-label text-accent">Track record</div>
        <h1 className="mt-3 font-display text-display-xl text-ink max-w-2xl">Every forecast, scored in public.</h1>
        <p className="mt-4 text-body-l text-ink-2 max-w-2xl">
          We publish how often our probability estimates match what happened, misses included. Scored only against
          observed prices. Seed and demo forecasts are kept apart from live ones. {brand.philosophy}.
        </p>
      </section>

      {/* Proof stats */}
      <section>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Live forecasts resolved" value={String(n)} />
          <Stat label="Avg. Brier score" value={live.avgBrier != null ? live.avgBrier.toFixed(3) : "—"} note="0 = perfect · lower is better" />
          <Stat
            label="Directional accuracy"
            value={live.directionalAccuracy != null ? `${(live.directionalAccuracy * 100).toFixed(1)}%` : "—"}
            note="Sign of modal bucket vs realised return"
          />
          <Stat label="Open (awaiting horizon)" value={String(live.openCount)} />
        </div>
        <p className={`mt-3 text-sm ${caveat.tone}`}>{caveat.text}</p>
        <p className="mt-1 text-caption text-ink-3">
          Brier here is the mean squared error across 5 return buckets (0 = perfect). For reference, a uniform 20% guess on
          every bucket scores 0.160. Lower than that means the forecasts carried information.
        </p>
      </section>

      {/* Reliability */}
      <section>
        <Head title="Calibration — stated vs observed" chip={<ProvenanceChip kind="observed" compact />} />
        {live.calibrationCurve.length ? (
          <div className="card p-5">
            <p className="text-caption text-ink-3 mb-4">
              For each confidence bin of the most likely bucket: how often that bucket actually happened. Well calibrated
              means the bars match. Bins with few forecasts tell you very little.
            </p>
            <div className="space-y-3">
              {live.calibrationCurve.map((pt) => (
                <div key={pt.label} className="grid grid-cols-[5rem_1fr_4rem] items-center gap-3 text-caption">
                  <span className="text-ink-2 num">{pt.label}</span>
                  <div className="space-y-1">
                    <Bar pct={pt.predicted} cls="bg-scenario-base" title="Stated (bin midpoint)" />
                    <Bar pct={pt.empirical * 100} cls="bg-accent" title="Observed hit rate" />
                  </div>
                  <span className={`num text-right ${pt.n < 10 ? "text-dq-stale" : "text-ink-2"}`}>n={pt.n}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-4 text-caption text-ink-3">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-scenario-base" />Stated</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent" />Observed</span>
              <span>Amber n = fewer than 10 in bin</span>
            </div>
          </div>
        ) : (
          <Empty text="No resolved live forecasts yet, so there is nothing to plot. We won't draw a curve until real outcomes exist." />
        )}
      </section>

      {/* Breakdown */}
      {(live.byHorizon.length > 0 || live.byAssetClass.length > 0) && (
        <section className="grid md:grid-cols-2 gap-6">
          {live.byHorizon.length > 0 && (
            <div>
              <Head title="By horizon" />
              <MiniTable rows={live.byHorizon.map((r) => ({ k: r.horizon, n: r.n, brier: r.avgBrier, dir: r.dirAcc }))} />
            </div>
          )}
          {live.byAssetClass.length > 0 && (
            <div>
              <Head title="By asset class" />
              <MiniTable rows={live.byAssetClass.map((r) => ({ k: r.assetClass, n: r.n, brier: r.avgBrier, dir: r.dirAcc }))} />
            </div>
          )}
        </section>
      )}

      {/* Log */}
      <section>
        <Head
          title="Resolved forecast log"
          chip={log.length ? <span className="text-caption text-ink-3">{log.length} most recent · {misses} misses shown</span> : undefined}
        />
        {log.length ? (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-caption text-ink-3 uppercase tracking-wider">
                <tr className="border-b border-line">
                  <th className="text-left py-2.5 px-4">Asset</th>
                  <th className="text-left py-2.5 pr-3">Horizon</th>
                  <th className="text-left py-2.5 pr-3">Most likely (stated)</th>
                  <th className="text-left py-2.5 pr-3">Observed</th>
                  <th className="text-right py-2.5 pr-3">Return</th>
                  <th className="text-right py-2.5 pr-3">Brier</th>
                  <th className="text-left py-2.5 pr-4">Result</th>
                </tr>
              </thead>
              <tbody>
                {log.map((f) => {
                  const m = modal(f);
                  const hit = m.label === f.outcome?.outcomeBucket;
                  return (
                    <tr key={f.id} className="border-b border-line/50 hover:bg-surface-2/40">
                      <td className="py-2 px-4 text-ink font-medium">{f.assetSymbol}</td>
                      <td className="py-2 pr-3 text-ink-2">{f.horizon}</td>
                      <td className="py-2 pr-3 text-ink-2">
                        {bl(m.label)} <span className="num text-ink-3">{m.p}%</span>
                      </td>
                      <td className="py-2 pr-3 text-ink-2">{bl(f.outcome?.outcomeBucket)}</td>
                      <td className="py-2 pr-3 text-right num text-ink-2">
                        {f.outcome?.realizedReturnPct != null ? `${f.outcome.realizedReturnPct.toFixed(2)}%` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right num text-ink-2">{f.outcome?.brierScore?.toFixed(3) ?? "—"}</td>
                      <td className="py-2 pr-4">
                        <span className={`text-caption font-medium ${hit ? "text-dq-fresh" : "text-scenario-downside"}`}>
                          {hit ? "Hit" : "Miss"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="No live forecasts have resolved yet. Resolution only runs against observed prices once each horizon closes." />
        )}
        {seedLog.length > 0 && (
          <div className="mt-4 rounded-card border border-dashed border-line-strong p-4">
            <div className="text-caption font-medium text-dq-stale">
              Seed cohort (synthetic bootstrap). Not part of the track record.
            </div>
            <div className="mt-1 text-caption text-ink-3">
              {seed.totalResolved} resolved seed forecasts · avg Brier {seed.avgBrier != null ? seed.avgBrier.toFixed(3) : "—"}.
              These exist only so the UI works in demos and are never added to the live numbers above.
            </div>
          </div>
        )}
      </section>

      {/* Scenario weights */}
      <section>
        <Head title="How scenario weights are estimated" chip={<ProvenanceChip kind="estimate" compact />} />
        <div className="card p-5 text-sm text-ink-2 space-y-3 leading-relaxed">
          <p>
            Each event gets four scenario weights: Base, Upside, Downside scenario and Tail. They are{" "}
            <strong className="text-ink">model estimates</strong> (scenario_weights_v2), not market-implied probabilities,
            and they never use invented prices. A Downside weight describes a scenario. It is not a sell signal.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-ink-2">
            <li><span className="text-ink">Off-Base share</span>: higher impact composite and magnitude move more weight from Base (30–75%) into the other branches.</li>
            <li><span className="text-ink">Direction</span>: sentiment (hawkish, dovish, risk-on, risk-off) blended with per-asset-class impact votes tilts weight between Upside and Downside.</li>
            <li><span className="text-ink">Evidence sharpness</span>: classifier confidence × source tier × data quality. Thin or demo evidence keeps the split close to even.</li>
            <li><span className="text-ink">Tail width</span>: magnitude, persistence, event type (credit, liquidity and geopolitics run wider) and asset convexity (VIX, BTC and oil run wider), capped at 25%.</li>
          </ul>
          <p className="text-caption text-ink-3">
            Events with identical inputs get identical weights by design. Each scenario page lists the full rationale
            under its key assumptions.
          </p>
        </div>
      </section>

      {/* Pipeline + tiers */}
      <section className="grid md:grid-cols-2 gap-6">
        <div>
          <Head title="Pipeline" />
          <ol className="list-decimal pl-5 text-sm space-y-1.5 text-ink-2">
            <li>Ingest events (RSS / official) with source tier and citation.</li>
            <li>Classify transmission chains: {brand.evidenceChain}.</li>
            <li>Estimate scenario weights with assumptions and invalidators.</li>
            <li>Publish horizon-bounded return-bucket distributions.</li>
            <li>Resolve against observed prices only; score with Brier and direction.</li>
          </ol>
        </div>
        <div>
          <Head title="Source tiers" />
          <div className="grid grid-cols-2 gap-2 text-caption">
            {[
              { t: "T1", d: "Official / primary (central banks, agencies)" },
              { t: "T2", d: "Tier-1 wires & exchanges" },
              { t: "T3", d: "Reputable secondary press / research" },
              { t: "T4", d: "Weaker / demo / illustrative" },
            ].map((x) => (
              <div key={x.t} className="card p-3">
                <div className="text-ink font-medium">{x.t}</div>
                <div className="mt-0.5 text-ink-3">{x.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <Head title="Crypto source weights" />
        <p className="text-caption text-ink-3 mb-1">{CONFIDENCE_FORMULA_TEXT}</p>
        <p className="text-caption text-ink-3 mb-3">{RISK_BAND_TEXT}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-caption">
          {Object.entries(RELIABILITY_WEIGHTS).map(([name, w]) => (
            <div key={name} className="card p-3 flex justify-between">
              <span className="text-ink-2">{name}</span>
              <span className="num text-ink">{w.toFixed(2)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-caption text-ink-3">
          Fixed constants, not fitted scores. <Link href="/crypto/coverage" className="text-accent hover:underline">Coverage and formula →</Link>
        </p>
      </section>

      <section>
        <Head title="Honest limitations" />
        <ul className="list-disc pl-5 text-sm text-ink-2 space-y-1">
          <li>Scenario weights are estimates that depend on the stated assumptions.</li>
          <li>Market data may be delayed, proxied or cached. The quality badge on each item says which.</li>
          <li>A short live record means wide uncertainty on every calibration figure.</li>
          <li>No portfolio advice, no execution, no guaranteed outcomes.</li>
          <li>Missing observations stay null. They are never filled in.</li>
        </ul>
        <div className="mt-4"><DisclaimerStrip /></div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/forecasts" className="inline-flex items-center rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-surface-0 hover:bg-accent/90">Open forecasts</Link>
          <Link href="/pricing" className="inline-flex items-center rounded-md border border-line-strong px-4 py-2.5 text-sm text-ink hover:bg-surface-2">Plans</Link>
          <Link href="/docs/api" className="inline-flex items-center rounded-md border border-line-strong px-4 py-2.5 text-sm text-ink hover:bg-surface-2">API docs</Link>
        </div>
      </section>
    </div>
  );
}

function Head({ title, chip }: { title: string; chip?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {chip}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card p-4">
      <div className="micro-label text-ink-3">{label}</div>
      <div className="mt-2 font-display text-display-l num text-ink">{value}</div>
      {note && <div className="mt-1 text-caption text-ink-3">{note}</div>}
    </div>
  );
}

function Bar({ pct, cls, title }: { pct: number; cls: string; title: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 rounded-full bg-surface-2 overflow-hidden" title={`${title}: ${w.toFixed(0)}%`}>
      <div className={`h-full ${cls}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function MiniTable({ rows }: { rows: { k: string; n: number; brier: number; dir: number }[] }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-caption text-ink-3 uppercase tracking-wider">
          <tr className="border-b border-line">
            <th className="text-left py-2 px-4">Group</th>
            <th className="text-right py-2 pr-3">n</th>
            <th className="text-right py-2 pr-3">Brier</th>
            <th className="text-right py-2 pr-4">Dir. acc.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} className="border-b border-line/50">
              <td className="py-2 px-4 text-ink">{r.k}</td>
              <td className={`py-2 pr-3 text-right num ${r.n < 10 ? "text-dq-stale" : "text-ink-2"}`}>{r.n}</td>
              <td className="py-2 pr-3 text-right num text-ink-2">{Number.isFinite(r.brier) ? r.brier.toFixed(3) : "—"}</td>
              <td className="py-2 pr-4 text-right num text-ink-2">{Number.isFinite(r.dir) ? `${(r.dir * 100).toFixed(0)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-card border border-dashed border-line-strong p-5 text-sm text-ink-3">{text}</div>;
}
