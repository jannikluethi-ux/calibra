import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { computeDataQualitySummary } from "@/lib/quality/summary";
import { fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const fmtAge = (h: number | null) => (h == null ? "unknown age" : h < 1 ? "<1 h old" : `${Math.round(h)} h old`);

export default function DataQualityPage() {
  const s = computeDataQualitySummary();
  const { markets, events, crypto } = s.inputs;
  return (
    <div className="space-y-3 max-w-5xl">
      <div>
        <div className="micro-label text-accent">Reference · data quality</div>
        <h1 className="mt-2 font-display text-display-l text-ink">Data quality</h1>
        <p className="mt-2 text-sm text-ink-2 max-w-3xl">
          Read-only view of <code>/api/data-quality</code>. Overall: <b data-testid="dq-overall">{s.overall}</b>. Generated {fmtTime(s.generatedAt)}.
        </p>
      </div>
      {s.reasons.length > 0 && (
        <Panel title="Why it is not fully live">
          <ul className="list-disc pl-5 text-sm text-ink-2">{s.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Panel>
      )}
      <Panel title="Inputs">
        <table className="w-full text-sm" data-testid="dq-inputs">
          <tbody>
            <tr className="border-t border-line"><td className="p-1 text-ink-3">Markets</td><td className="p-1">{markets.status}</td><td className="p-1 text-ink-2">last success {fmtTime(markets.lastSuccessAt)} ({fmtAge(markets.ageHours)}); valid {markets.valid}/{markets.total}, carried forward {markets.carriedForward}, missing/invalid {markets.missingOrInvalid}</td></tr>
            <tr className="border-t border-line"><td className="p-1 text-ink-3">Events</td><td className="p-1">{events.status}</td><td className="p-1 text-ink-2">last live ingest {fmtTime(events.lastLiveIngestAt)}; newest published {fmtTime(events.newestPublishedAt)}; live last 48 h {events.liveLast48h}{events.topSourceShare30d ? `; top source ${events.topSourceShare30d.source} ${Math.round(events.topSourceShare30d.share * 100)}%` : ""}</td></tr>
            <tr className="border-t border-line"><td className="p-1 text-ink-3">Crypto</td><td className="p-1">{crypto.status}</td><td className="p-1 text-ink-2">last observation {fmtTime(crypto.lastObservationAt)} ({fmtAge(crypto.ageHours)}); risk scores computed {fmtTime(crypto.riskScoresComputedAt)}. <Link className="text-accent" href="/crypto/high-risk">High-risk crypto</Link></td></tr>
          </tbody>
        </table>
      </Panel>
      <Panel title={`Failing or degraded sources (${s.failingSources.length})`}>
        {s.failingSources.length === 0 ? <p className="text-sm text-ink-2">None.</p> : (
          <table className="w-full text-caption" data-testid="dq-sources">
            <thead className="uppercase text-ink-3"><tr><th className="p-1 text-left">Source</th><th className="p-1 text-left">Status</th><th className="p-1 text-right">Failures</th><th className="p-1 text-left">Last success</th><th className="p-1 text-left">Affects</th></tr></thead>
            <tbody>{s.failingSources.map((f) => (
              <tr key={f.sourceId} className="border-t border-line align-top">
                <td className="p-1 text-ink">{f.name}{f.critical ? <span className="ml-1 badge border-terminal-red/50 text-terminal-red">critical</span> : null}</td>
                <td className="p-1">{f.status} · {f.errorClass ?? "—"}</td>
                <td className="p-1 text-right">{f.consecutiveFailures}</td>
                <td className="p-1">{fmtTime(f.lastSuccessAt)}</td>
                <td className="p-1 text-ink-2">{f.downstream.join(", ")}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
      <Panel title="Affected outputs and skipped calculations">
        <ul className="list-disc pl-5 text-sm text-ink-2">
          {s.affectedOutputs.map((o) => <li key={o}>Affected: {o}</li>)}
          {s.skippedCalculations.map((o, i) => <li key={i}>Skipped: {o}</li>)}
          {s.affectedOutputs.length + s.skippedCalculations.length === 0 && <li>None.</li>}
        </ul>
      </Panel>
      <Panel title={`Stale or missing values (${s.staleValues.length})`}>
        {s.staleValues.length === 0 ? <p className="text-sm text-ink-2">None.</p> : (
          <table className="w-full text-caption"><tbody>{s.staleValues.map((v) => (
            <tr key={v.symbol} className="border-t border-line"><td className="p-1 text-ink">{v.symbol}</td><td className="p-1">{v.state}</td><td className="p-1">last valid {fmtTime(v.lastValidAt)}</td><td className="p-1 text-ink-2">{v.note ?? ""}</td></tr>
          ))}</tbody></table>
        )}
      </Panel>
      <Panel title="Corroboration">
        <ul className="list-disc pl-5 text-sm text-ink-2">{s.corroboration.map((c) => <li key={c.pair}>{c.pair}: {c.note}</li>)}</ul>
      </Panel>
    </div>
  );
}
