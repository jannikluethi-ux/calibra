import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { computeDataQualitySummary } from "@/lib/quality/summary";
import { fmtTime } from "@/lib/format";
import { computeEventMetrics } from "@/lib/quality/events";

export const dynamic = "force-dynamic";

const fmtAge = (h: number | null) => (h == null ? "unknown age" : h < 1 ? "<1 h old" : `${Math.round(h)} h old`);

export default function DataQualityPage() {
  const s = computeDataQualitySummary();
  const { markets, events, crypto } = s.inputs;
  const em = computeEventMetrics();
  const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
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
      <Panel title="Event freshness by source">
        <div className="overflow-x-auto">
          <table className="w-full text-caption" data-testid="dq-event-freshness">
            <thead className="uppercase text-ink-3"><tr><th className="p-1 text-left">Source</th><th className="p-1 text-right">Tier</th><th className="p-1 text-left">Newest item</th><th className="p-1 text-right">24 h</th><th className="p-1 text-right">7 d</th><th className="p-1 text-right">30 d</th><th className="p-1 text-right">All</th></tr></thead>
            <tbody>{em.freshness.perSource.map((r) => (
              <tr key={r.sourceName} className="border-t border-line">
                <td className="p-1 text-ink">{r.sourceName}{r.active === false ? <span className="ml-1 text-ink-3">(inactive)</span> : null}</td>
                <td className="p-1 text-right">{r.tier ?? "—"}</td>
                <td className="p-1">{r.newestPublishedAt ? `${fmtTime(r.newestPublishedAt)} (${fmtAge(r.newestAgeHours)})` : "no items stored yet"}</td>
                <td className="p-1 text-right">{r.last24h}</td><td className="p-1 text-right">{r.last7d}</td><td className="p-1 text-right">{r.last30d}</td><td className="p-1 text-right">{r.total}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-1 text-caption text-ink-3">Live events: {em.freshness.live24h} in the last 24 h, {em.freshness.live7d} in 7 days. Newest published {fmtTime(em.freshness.newestPublishedAt)}.</p>
      </Panel>
      <Panel title="Event source concentration">
        <table className="w-full text-sm" data-testid="dq-event-concentration">
          <thead className="text-caption uppercase text-ink-3"><tr><th className="p-1 text-left">Window</th><th className="p-1 text-right">Items</th><th className="p-1 text-left">Top source</th><th className="p-1 text-right">Top share</th><th className="p-1 text-right">Official share</th><th className="p-1 text-right">HHI</th></tr></thead>
          <tbody>
            {([["7 days", em.concentration.window7d], ["30 days", em.concentration.window30d]] as const).map(([k, w]) => (
              <tr key={k} className="border-t border-line"><td className="p-1">{k}</td><td className="p-1 text-right">{w.total}</td><td className="p-1">{w.topSource ?? "—"}</td><td className="p-1 text-right">{pct(w.topShare)}</td><td className="p-1 text-right">{pct(w.officialShare)}</td><td className="p-1 text-right">{w.hhi ?? "—"}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-caption text-ink-3">{em.concentration.note}</p>
      </Panel>
      <Panel title="Event duplicates and intelligence coverage">
        <ul className="list-disc pl-5 text-sm text-ink-2" data-testid="dq-event-duplicates">
          <li>Duplicate groups: {em.duplicates.groups} ({em.duplicates.multiSourceGroups} with 2+ distinct sources); {em.duplicates.nonCanonicalMembers} items linked as duplicates of a canonical event; 30-day duplicate rate {pct(em.duplicates.duplicateRate30d)}.</li>
          <li className="text-ink-3">{em.duplicates.method}</li>
          <li>Event assessments: {em.intelligence.eventsAssessed} events assessed ({em.intelligence.assessments} versions), {em.intelligence.materialEvents} currently material; {em.intelligence.mappings} documented instrument mappings.</li>
          <li>Conflicts preserved: {em.intelligence.conflicts.factual} factual, {em.intelligence.conflicts.interpretive} interpretive. <Link className="text-accent" href="/events/conflicts">View conflicts</Link></li>
          <li>Scenarios: {em.intelligence.scenariosV2} structured (v2), {em.intelligence.scenariosPreV2} pre-v2 rows kept as stored. Last intelligence run {fmtTime(em.intelligence.lastRunAt)}.</li>
        </ul>
      </Panel>
      <Panel title="Corroboration">
        <ul className="list-disc pl-5 text-sm text-ink-2">{s.corroboration.map((c) => <li key={c.pair}>{c.pair}: {c.note}</li>)}</ul>
      </Panel>
    </div>
  );
}
