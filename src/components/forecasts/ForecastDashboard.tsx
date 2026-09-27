"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import type { Forecast } from "@/lib/types";
import type { CalibrationReport } from "@/lib/forecast/calibration";
import { Badge, QualityBadge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { fmtTime } from "@/lib/format";

type Cohort = "live" | "seed" | "all";

interface PipelineStatus {
  lastRun: string | null;
  openCount: number;
  resolvedCount: number;
  unresolvableCount: number;
  seedResolved: number;
  nextDue: string | null;
}

function countdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "due";
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

function resolutionBadge(f: Forecast) {
  const b = f.outcome?.resolutionBadge;
  if (b === "historical_bars") return <Badge tone="amber">Resolved via historical bars</Badge>;
  if (b === "live_snapshot") return <Badge tone="green">Resolved via live snapshot log</Badge>;
  if (b === "seed_synthetic") return <Badge tone="purple">SEED synthetic</Badge>;
  if (b === "unresolvable" || f.status === "expired_unresolvable")
    return <Badge tone="red">Unresolvable</Badge>;
  if (f.status === "resolved") return <Badge tone="green">Resolved</Badge>;
  return <Badge>Open</Badge>;
}

export function ForecastDashboard({
  forecasts,
  calibrationLive,
  calibrationSeed,
  calibrationAll,
  pipeline,
}: {
  forecasts: Forecast[];
  calibrationLive: CalibrationReport;
  calibrationSeed: CalibrationReport;
  calibrationAll: CalibrationReport;
  pipeline: PipelineStatus;
}) {
  const [cohort, setCohort] = useState<Cohort>("live");

  const cal =
    cohort === "live" ? calibrationLive : cohort === "seed" ? calibrationSeed : calibrationAll;

  const visible = useMemo(() => {
    if (cohort === "live") return forecasts.filter((f) => !f.isSeed);
    if (cohort === "seed") return forecasts.filter((f) => f.isSeed);
    return forecasts;
  }, [forecasts, cohort]);

  const resolved = visible.filter((f) => f.status === "resolved" && f.outcome);
  const open = visible.filter((f) => f.status === "open");
  const unresolvable = visible.filter((f) => f.status === "expired_unresolvable");

  const reliabilityIdeal = (cal.calibrationCurve || []).map((p) => ({
    ...p,
    ideal: p.predicted / 100,
    empiricalPct: p.empirical,
    predictedPct: p.predicted / 100,
  }));

  const brierByHorizon = (cal.byHorizon || []).map((h) => ({
    name: h.horizon,
    brier: Number(h.avgBrier.toFixed(3)),
    n: h.n,
  }));

  const brierByAsset = (cal.byAsset || []).map((a) => ({
    name: a.symbol,
    brier: Number(a.avgBrier.toFixed(3)),
    n: a.n,
  }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-start justify-between">
        <div>
          <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">
            Forecast Distributions & Accuracy
          </h1>
          <p className="text-2xs text-terminal-muted mt-0.5 max-w-3xl">
            Outcomes are observed market prices from stored snapshots / Yahoo bars — never invented.
            Seed and Live cohorts are scored separately. Default view = Live track record only.
          </p>
        </div>
        <div className="flex gap-1">
          {(["live", "seed", "all"] as Cohort[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCohort(c)}
              className={`px-2 py-1 rounded border text-2xs uppercase tracking-wide ${
                cohort === c
                  ? "border-terminal-accent text-terminal-accent bg-terminal-accent/10"
                  : "border-terminal-border text-terminal-muted hover:border-terminal-dim"
              }`}
            >
              {c === "live" ? "Live track record" : c === "seed" ? "Seed" : "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="text-2xs border border-terminal-amber/40 bg-terminal-amber/5 rounded p-2 text-terminal-amber">
        <strong>Disclaimer:</strong> Live track record (n={calibrationLive.totalResolved}) uses only
        fetched market history with timestamps and provenance. Seed / pipeline demo (n=
        {calibrationSeed.totalResolved}) is labeled and excluded from marketed accuracy by default.
        Backdated short-horizon demos show a <em>Resolved via historical bars</em> badge — not a
        silent production claim. Prefer &quot;insufficient evidence to resolve&quot; over fabricating a
        close. Bucket thresholds are horizon-scaled; see distribution cards for rangeMin/Max %.
      </div>

      <Panel
        title="Resolution pipeline"
        right={
          <span className="text-2xs text-terminal-muted num">
            last run {fmtTime(pipeline.lastRun)}
          </span>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
          <div className="bg-terminal-surface border border-terminal-border rounded p-2">
            <div className="text-2xs text-terminal-muted">Live resolved</div>
            <div className="num text-lg text-terminal-green">{pipeline.resolvedCount}</div>
          </div>
          <div className="bg-terminal-surface border border-terminal-border rounded p-2">
            <div className="text-2xs text-terminal-muted">Unresolvable</div>
            <div className="num text-lg text-terminal-amber">{pipeline.unresolvableCount}</div>
          </div>
          <div className="bg-terminal-surface border border-terminal-border rounded p-2">
            <div className="text-2xs text-terminal-muted">Open (live)</div>
            <div className="num text-lg">{pipeline.openCount}</div>
          </div>
          <div className="bg-terminal-surface border border-terminal-border rounded p-2">
            <div className="text-2xs text-terminal-muted">Next due</div>
            <div className="num text-sm">{pipeline.nextDue ? countdown(pipeline.nextDue) : "—"}</div>
            <div className="text-2xs text-terminal-muted truncate">{pipeline.nextDue ? fmtTime(pipeline.nextDue) : ""}</div>
          </div>
          <div className="bg-terminal-surface border border-terminal-border rounded p-2">
            <div className="text-2xs text-terminal-muted">Seed resolved (separate)</div>
            <div className="num text-lg text-terminal-purple">{pipeline.seedResolved}</div>
          </div>
        </div>
        <p className="text-2xs text-terminal-muted mt-2">
          Trigger: <code className="text-terminal-accent">POST /api/forecasts/resolve</code> or full{" "}
          <code className="text-terminal-accent">POST /api/refresh</code> (fetch → persist snapshots →
          forecasts → resolve → calibration).
        </p>
      </Panel>

      <Panel
        title={`${cohort === "live" ? "Live track record" : cohort === "seed" ? "Seed / pipeline demo" : "All cohorts"} — calibration`}
      >
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
          <div className="bg-terminal-surface border border-terminal-border rounded p-2">
            <div className="text-2xs text-terminal-muted">Resolved (cohort)</div>
            <div className="num text-lg">{cal.totalResolved}</div>
          </div>
          <div className="bg-terminal-surface border border-terminal-border rounded p-2">
            <div className="text-2xs text-terminal-muted">Open / Unresolvable</div>
            <div className="num text-lg">
              {cal.openCount} / {cal.unresolvableCount}
            </div>
          </div>
          <div className="bg-terminal-surface border border-terminal-border rounded p-2">
            <div className="text-2xs text-terminal-muted">Mean Brier (↓ better)</div>
            <div className="num text-lg">{cal.avgBrier?.toFixed(3) ?? "—"}</div>
          </div>
          <div className="bg-terminal-surface border border-terminal-border rounded p-2">
            <div className="text-2xs text-terminal-muted">Directional acc.</div>
            <div className="num text-lg">
              {cal.directionalAccuracy != null ? `${(cal.directionalAccuracy * 100).toFixed(0)}%` : "—"}
            </div>
          </div>
          <div className="bg-terminal-surface border border-terminal-border rounded p-2">
            <div className="text-2xs text-terminal-muted">Severe↓ FP / FN</div>
            <div className="num text-lg">
              {cal.severeDownFalsePositives} / {cal.severeDownFalseNegatives}
            </div>
          </div>
          <div className="bg-terminal-surface border border-terminal-border rounded p-2">
            <div className="text-2xs text-terminal-muted">Strong↑ FP / FN</div>
            <div className="num text-lg">
              {cal.strongUpFalsePositives} / {cal.strongUpFalseNegatives}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="h-56 border border-terminal-border rounded p-2 bg-terminal-surface">
            <div className="text-2xs text-terminal-accent mb-1">Reliability diagram (modal bucket)</div>
            {reliabilityIdeal.length ? (
              <ResponsiveContainer width="100%" height="90%">
                <LineChart data={reliabilityIdeal}>
                  <CartesianGrid stroke="#1e2733" />
                  <XAxis dataKey="label" tick={{ fill: "#8b95a8", fontSize: 10 }} />
                  <YAxis domain={[0, 1]} tick={{ fill: "#8b95a8", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: "#0f1419", border: "1px solid #1e2733", fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="predictedPct" name="Predicted" stroke="#60a5fa" dot />
                  <Line type="monotone" dataKey="empiricalPct" name="Empirical" stroke="#34d399" dot />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-terminal-amber text-2xs p-2">Need more resolved forecasts for reliability curve.</div>
            )}
          </div>
          <div className="h-56 border border-terminal-border rounded p-2 bg-terminal-surface">
            <div className="text-2xs text-terminal-accent mb-1">Brier by horizon</div>
            {brierByHorizon.length ? (
              <ResponsiveContainer width="100%" height="90%">
                <BarChart data={brierByHorizon}>
                  <CartesianGrid stroke="#1e2733" />
                  <XAxis dataKey="name" tick={{ fill: "#8b95a8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#8b95a8", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: "#0f1419", border: "1px solid #1e2733", fontSize: 11 }}
                  />
                  <Bar dataKey="brier" fill="#a78bfa" name="Avg Brier" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-terminal-amber text-2xs p-2">No resolved outcomes in this cohort yet.</div>
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-2xs">
          <div>
            <div className="text-terminal-accent mb-1">By asset</div>
            {brierByAsset.map((a) => (
              <div key={a.name} className="flex justify-between border-b border-terminal-border/50 py-0.5">
                <span>
                  {a.name} (n={a.n})
                </span>
                <span className="num">Brier {a.brier.toFixed(3)}</span>
              </div>
            ))}
            {!brierByAsset.length && <div className="text-terminal-amber">No resolved outcomes yet.</div>}
          </div>
          <div>
            <div className="text-terminal-accent mb-1">By asset class</div>
            {(cal.byAssetClass || []).map((a) => (
              <div key={a.assetClass} className="flex justify-between border-b border-terminal-border/50 py-0.5">
                <span>
                  {a.assetClass} (n={a.n})
                </span>
                <span className="num">
                  Brier {a.avgBrier.toFixed(3)} · dir {(a.dirAcc * 100).toFixed(0)}%
                </span>
              </div>
            ))}
            <div className="text-terminal-accent mt-2 mb-1">Notes</div>
            <ul className="list-disc ml-4 text-terminal-dim">
              {cal.notes.slice(0, 5).map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel title={`Resolved forecasts (${cohort})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-2xs">
            <thead className="text-terminal-muted text-left">
              <tr className="border-b border-terminal-border">
                <th className="py-1 pr-2">Created</th>
                <th className="py-1 pr-2">Symbol</th>
                <th className="py-1 pr-2">Horizon</th>
                <th className="py-1 pr-2">Dist (modal)</th>
                <th className="py-1 pr-2">Outcome</th>
                <th className="py-1 pr-2">Brier</th>
                <th className="py-1 pr-2">Dir</th>
                <th className="py-1 pr-2">Provenance</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((f) => {
                const maxP = Math.max(...f.distribution.map((b) => b.probability));
                const modal = f.distribution.find((b) => b.probability === maxP);
                return (
                  <tr key={f.id} className="border-b border-terminal-border/40 align-top">
                    <td className="py-1.5 pr-2 num whitespace-nowrap">{fmtTime(f.createdAt)}</td>
                    <td className="py-1.5 pr-2">
                      <div className="font-medium text-xs">{f.assetSymbol}</div>
                      {f.isSeed ? <Badge tone="purple">SEED</Badge> : <Badge tone="blue">LIVE</Badge>}
                    </td>
                    <td className="py-1.5 pr-2">{f.horizon}</td>
                    <td className="py-1.5 pr-2">
                      {modal?.label} {modal?.probability}%
                    </td>
                    <td className="py-1.5 pr-2">
                      <div>{f.outcome?.outcomeBucket}</div>
                      <div className="text-terminal-muted num">
                        {f.outcome?.realizedReturnPct?.toFixed?.(2)}% @ {f.outcome?.outcomeValue}
                      </div>
                    </td>
                    <td className="py-1.5 pr-2 num">{f.outcome?.brierScore?.toFixed?.(3)}</td>
                    <td className="py-1.5 pr-2">
                      {(f.outcome?.directionalHit ?? f.outcome?.directionalCorrect) ? (
                        <Badge tone="green">hit</Badge>
                      ) : (
                        <Badge tone="red">miss</Badge>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      {resolutionBadge(f)}
                      <div className="text-terminal-muted mt-0.5 max-w-[220px] truncate" title={f.outcome?.outcomeSource}>
                        {f.outcome?.outcomeSource}
                      </div>
                      <div className="text-terminal-muted num">{fmtTime(f.outcome?.outcomeAsof)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!resolved.length && (
            <div className="text-terminal-amber text-xs py-2">
              No resolved forecasts in this cohort. Run resolve after backfill / wait for horizon_end.
            </div>
          )}
        </div>
      </Panel>

      <Panel title={`Open forecasts — countdown to horizon_end (${open.length})`}>
        <div className="space-y-3">
          {open.slice(0, 30).map((f) => (
            <div key={f.id} className="border border-terminal-border rounded p-2 bg-terminal-surface">
              <div className="flex flex-wrap gap-1 items-center mb-1">
                <span className="text-xs font-medium">{f.assetSymbol}</span>
                <Badge>{f.horizon}</Badge>
                <QualityBadge quality={f.provenance.quality} />
                <Badge tone="amber">ESTIMATE</Badge>
                {f.isSeed ? <Badge tone="purple">SEED</Badge> : <Badge tone="blue">LIVE</Badge>}
                <span className="text-2xs text-terminal-muted num ml-auto">
                  ends {fmtTime(f.horizonEnd)} · {countdown(f.horizonEnd)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                {f.distribution.map((b) => (
                  <div key={b.label} className="text-2xs bg-terminal-bg border border-terminal-border rounded px-1.5 py-1">
                    <div className="text-terminal-muted">{b.label}</div>
                    <div className="num">{b.probability}%</div>
                    <div className="text-terminal-muted">
                      {b.rangeMinPct}%..{b.rangeMaxPct}%
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-2xs text-terminal-dim">{f.rationale}</div>
              {f.resolutionNote && (
                <div className="text-2xs text-terminal-amber mt-1">Note: {f.resolutionNote}</div>
              )}
              <div className="text-2xs mt-1 text-terminal-muted">
                origin={f.originPrice ?? f.asOfPrice} · created {fmtTime(f.createdAt)}
              </div>
            </div>
          ))}
          {!open.length && <div className="text-terminal-muted text-xs">No open forecasts in this cohort.</div>}
        </div>
      </Panel>

      {unresolvable.length > 0 && (
        <Panel title={`Expired unresolvable (${unresolvable.length}) — insufficient evidence`}>
          <div className="space-y-2">
            {unresolvable.map((f) => (
              <div key={f.id} className="border border-terminal-border rounded p-2 text-2xs">
                <div className="flex gap-1 items-center">
                  <Badge tone="red">UNRESOLVABLE</Badge>
                  <span className="font-medium text-xs">{f.assetSymbol}</span>
                  <span>{f.horizon}</span>
                  <span className="num ml-auto">{fmtTime(f.horizonEnd)}</span>
                </div>
                <div className="text-terminal-dim mt-1">{f.outcome?.notes}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
