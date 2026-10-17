import Link from "next/link";
import { notFound } from "next/navigation";
import { getEvent } from "@/lib/ingestion/rss";
import { getDb } from "@/lib/db";
import { Panel } from "@/components/ui/Panel";
import { Badge, QualityBadge } from "@/components/ui/Badge";
import { fmtTime } from "@/lib/format";
import { assessmentHistory, conflictsForEvents, latestAssessment, mappingsForAssessment, scenarioRowForEvent } from "@/lib/intel/store";
import { ensureIntelTables } from "@/lib/intel/schema";
import { ScenarioV2View, PreV2Badge } from "@/components/intel/ScenarioV2View";
import { ConflictCard } from "@/components/intel/ConflictCard";

export const dynamic = "force-dynamic";

interface ClusterRow {
  event_id: string;
  canonical_event_id: string;
  method: string;
  score: number | null;
  reasons_json: string | null;
  linked_at: string;
}

function groupFor(eventId: string) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM event_clusters WHERE event_id = ?`).get(eventId) as ClusterRow | undefined;
  if (!row) return null;
  const members = db
    .prepare(
      `SELECT c.event_id, c.canonical_event_id, c.method, c.score, c.reasons_json, c.linked_at,
              json_extract(e.data,'$.title') AS title, json_extract(e.data,'$.sourceName') AS source, json_extract(e.data,'$.sourceTier') AS tier,
              e.published_at, json_extract(e.data,'$.citationUrl') AS url
       FROM event_clusters c LEFT JOIN events e ON e.id = c.event_id WHERE c.canonical_event_id = ? ORDER BY e.published_at`
    )
    .all(row.canonical_event_id) as (ClusterRow & { title: string | null; source: string | null; tier: number | null; published_at: string | null; url: string | null })[];
  return { canonical: row.canonical_event_id, members };
}

export default function EventDetailPage({ params }: { params: { id: string } }) {
  const e = getEvent(params.id);
  if (!e) notFound();
  ensureIntelTables();
  const sa = latestAssessment(e.id);
  const a = sa?.assessment ?? null;
  const maps = sa ? mappingsForAssessment(sa.id) : [];
  const conflicts = conflictsForEvents([e.id]);
  const group = groupFor(e.id);
  const sc = scenarioRowForEvent(e.id);
  const hist = assessmentHistory(e.id);
  const p = e.provenance;

  return (
    <div className="space-y-3 max-w-6xl">
      <div>
        <Link href="/events" className="text-2xs text-terminal-accent">← All events</Link>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <QualityBadge quality={e.quality} />
          <Badge tone="blue">Tier {e.sourceTier}</Badge>
          {a && <Badge tone={a.material ? "green" : "neutral"}>{a.material ? "material" : "not material"}</Badge>}
          {e.classification.event_type && <Badge>{e.classification.event_type}</Badge>}
          <span className="text-2xs text-terminal-muted num">{fmtTime(e.publishedAt)}</span>
        </div>
        <h1 className="text-base font-semibold mt-1 break-words" data-testid="event-title">{e.title}</h1>
      </div>

      <Panel title="Observation (as reported by the source)">
        <div className="text-xs space-y-2" data-testid="event-observation">
          {e.summary && e.summary !== e.title && <p className="text-terminal-dim">{e.summary}</p>}
          {a && (
            <>
              <div>
                <div className="text-terminal-green text-2xs uppercase">Directly verified</div>
                <ul className="list-disc ml-4 text-terminal-dim text-2xs break-words">{a.verified.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
              <div>
                <div className="text-terminal-amber text-2xs uppercase">Uncertain</div>
                <ul className="list-disc ml-4 text-terminal-dim text-2xs">{a.uncertain.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            </>
          )}
        </div>
      </Panel>

      <Panel title="Source record / provenance">
        <table className="w-full text-2xs" data-testid="event-provenance">
          <tbody>
            {[
              ["Source", `${e.sourceName} (tier ${e.sourceTier})${p?.sourceId ? ` · ${p.sourceId}` : ""}`],
              ["Item URL", p?.itemUrl ?? e.citationUrl ?? "missing"],
              ["Feed URL", p?.feedUrl ?? "not recorded (stored before provenance tracking)"],
              ["Source publish time", p ? (p.sourcePublishedAt ? fmtTime(p.sourcePublishedAt) : "missing in source") : `${fmtTime(e.publishedAt)} (pre-provenance record)`],
              ["Retrieved", p?.retrievedAt ? fmtTime(p.retrievedAt) : fmtTime(e.ingestedAt)],
              ["Pipeline", p?.pipeline ?? "not recorded"],
              ["Transformations", p?.transformations?.join(" → ") ?? "not recorded"],
              ["Field status", p ? Object.entries(p.fields).map(([k, v]) => `${k}: ${v}`).join(", ") : "not recorded"],
            ].map(([k, v]) => (
              <tr key={k} className="border-t border-terminal-border align-top">
                <td className="p-1 text-terminal-muted whitespace-nowrap">{k}</td>
                <td className="p-1 break-all">{typeof v === "string" && v.startsWith("http") ? <a className="text-terminal-accent underline" href={v} target="_blank" rel="noreferrer">{v}</a> : v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title={group ? `Duplicate group (${group.members.length} items)` : "Duplicate group"}>
        {!group ? (
          <p className="text-2xs text-terminal-dim">Not linked to any same-story group (event_cluster_v1). No duplicates detected.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-2xs" data-testid="event-duplicates">
              <thead className="text-terminal-muted uppercase"><tr><th className="p-1 text-left">Item</th><th className="p-1 text-left">Source</th><th className="p-1 text-left">Published</th><th className="p-1 text-left">Role</th><th className="p-1 text-right">Score</th><th className="p-1 text-left">Why linked</th></tr></thead>
              <tbody>
                {group.members.map((m) => {
                  let reasons = "";
                  try {
                    const r = m.reasons_json ? JSON.parse(m.reasons_json) : null;
                    reasons = Array.isArray(r) ? r.join("; ") : r ? JSON.stringify(r) : "";
                  } catch {
                    reasons = "";
                  }
                  return (
                    <tr key={m.event_id} className="border-t border-terminal-border align-top">
                      <td className="p-1 min-w-[180px]">{m.event_id === e.id ? <b>{m.title ?? m.event_id}</b> : <Link className="text-terminal-accent" href={`/events/${m.event_id}`}>{m.title ?? m.event_id}</Link>}</td>
                      <td className="p-1 whitespace-nowrap">{m.source ?? "—"}{m.tier ? ` (t${m.tier})` : ""}</td>
                      <td className="p-1 whitespace-nowrap">{fmtTime(m.published_at)}</td>
                      <td className="p-1">{m.event_id === m.canonical_event_id ? "canonical" : "duplicate"}</td>
                      <td className="p-1 text-right num">{m.score != null ? m.score.toFixed(2) : "—"}</td>
                      <td className="p-1 text-terminal-dim">{m.method}{reasons ? ` · ${reasons}` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-2xs text-terminal-muted mt-1">Originals are kept; duplicates are linked, never merged or deleted.</p>
          </div>
        )}
      </Panel>

      <Panel title="Financial consequences · interpretation (rule-based)">
        {!a ? (
          <p className="text-2xs text-terminal-amber">No assessment yet (assessments run with the derive job for live events from the last 21 days).</p>
        ) : (
          <div className="space-y-2 text-2xs" data-testid="event-assessment">
            <p className="text-terminal-amber">{a.causalDisclaimer}</p>
            <div className="text-terminal-muted">{a.materialityReasons.join(" ")}</div>
            {a.interpretation.whyItMatters.length > 0 && (
              <div>
                <div className="text-terminal-accent uppercase">Why it may matter</div>
                <ul className="list-disc ml-4 text-terminal-dim">{a.interpretation.whyItMatters.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            <div>
              <div className="text-terminal-accent uppercase">Transmission mechanisms</div>
              {a.interpretation.mechanisms.length ? (
                <ul className="list-disc ml-4 text-terminal-dim">
                  {a.interpretation.mechanisms.map((m) => (
                    <li key={m.id}>
                      <b className="text-terminal-text">{m.label}</b> — {m.channel}{" "}
                      <span className="text-terminal-muted">[{m.basis === "text_match" ? `matched: ${m.matched.map((x) => `"${x}"`).join(", ")}` : "implied by classifier event type only (not used for mappings)"}]</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-terminal-dim">None matched.</p>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div><div className="text-terminal-muted uppercase">Exposed regions</div><div className="text-terminal-dim">{a.interpretation.regions.map((r) => `${r.label}${r.basis === "issuing_institution" ? " (issuer)" : ""}`).join(", ") || "none identified"}</div></div>
              <div><div className="text-terminal-muted uppercase">Exposed industries</div><div className="text-terminal-dim">{a.interpretation.industries.map((r) => r.label).join(", ") || "none identified"}</div></div>
              <div><div className="text-terminal-muted uppercase">Asset classes</div><div className="text-terminal-dim">{a.interpretation.assetClasses.join(", ") || "none"}</div></div>
            </div>
            <div>
              <div className="text-terminal-accent uppercase">Supporting evidence</div>
              <ul className="list-disc ml-4 text-terminal-dim break-words">{a.supportingEvidence.map((s, i) => <li key={i}>{s.url ? <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.text}</a> : s.text}</li>)}</ul>
            </div>
            <div>
              <div className="text-terminal-red uppercase">Competing interpretations</div>
              <ul className="list-disc ml-4 text-terminal-dim">{a.interpretation.competingInterpretations.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-terminal-purple uppercase">What would invalidate this assessment</div>
              <ul className="list-disc ml-4 text-terminal-dim">{a.interpretation.invalidation.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
            <div className="text-terminal-muted">
              Classifier reading: {a.interpretation.classifierReading.method}, type {a.interpretation.classifierReading.eventType ?? "—"}, sentiment {a.interpretation.classifierReading.sentiment}, confidence {a.interpretation.classifierReading.confidence.toFixed(2)}. Assessment {a.modelVersion} ({a.rulesVersion}), {hist.length} version(s) kept.
            </div>
          </div>
        )}
      </Panel>

      <Panel title={`Tracked instruments (${maps.length} documented mappings)`}>
        {!maps.length ? (
          <p className="text-2xs text-terminal-dim">{a?.material ? "No tracked instrument has a documented relationship for the matched channel and region." : "Mappings are recorded only for material events."} Instruments are never attached by headline keywords alone.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-2xs" data-testid="event-mappings">
              <thead className="text-terminal-muted uppercase"><tr><th className="p-1 text-left">Instrument</th><th className="p-1 text-left">Mechanism</th><th className="p-1 text-left">Direction</th><th className="p-1 text-left">Horizon</th><th className="p-1 text-left">Confidence</th><th className="p-1 text-left">Rationale, assumptions, limits, competing</th></tr></thead>
              <tbody>
                {maps.map((m) => (
                  <tr key={m.id} className="border-t border-terminal-border align-top">
                    <td className="p-1 whitespace-nowrap font-medium">{m.symbol}<div className="text-terminal-muted font-normal">{m.linkBasis}</div></td>
                    <td className="p-1">{m.mechanism}</td>
                    <td className="p-1" title={m.detail.directionBasis}>{m.direction ?? "not supportable"}</td>
                    <td className="p-1">{m.horizon}</td>
                    <td className="p-1">{m.confidence}</td>
                    <td className="p-1 text-terminal-dim min-w-[260px]">
                      {m.rationale}
                      <div><span className="text-terminal-muted">Direction basis:</span> {m.detail.directionBasis}</div>
                      <div><span className="text-terminal-muted">Assumptions:</span> {m.detail.assumptions.join("; ")}</div>
                      <div><span className="text-terminal-muted">Evidence limits:</span> {m.detail.evidenceLimits.join("; ")}</div>
                      <div><span className="text-terminal-muted">Competing:</span> {m.detail.competing.join("; ")}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={`Conflicting evidence (${conflicts.length})`}>
        {!conflicts.length ? <p className="text-2xs text-terminal-dim">No conflicting reports detected for this event (conflict_v1).</p> : <div className="space-y-2">{conflicts.map((c) => <ConflictCard key={c.id} c={c} />)}</div>}
      </Panel>

      <Panel title="Scenarios" right={sc ? (sc.schemaVersion === 2 ? <Badge tone="purple">v2</Badge> : <PreV2Badge />) : undefined}>
        {!sc ? (
          <p className="text-2xs text-terminal-dim">No scenario for this event{a && !a.material ? " (not material)" : ""}.</p>
        ) : sc.schemaVersion === 2 && sc.scenario.v2 ? (
          <ScenarioV2View s={sc.scenario} />
        ) : (
          <div className="text-2xs text-terminal-dim space-y-1">
            <p>Pre-v2 scenario kept exactly as stored. Structured fields (drivers, indicators, DQ status, documented weight rule) are missing; its asset list came from the retired keyword-based mapping.</p>
            <p>Base {sc.scenario.base.probability}% · Bull {sc.scenario.bull.probability}% · Bear {sc.scenario.bear.probability}% · Tail {sc.scenario.tail.probability}% — assets: {sc.scenario.affectedAssets.join(", ")}</p>
            <Link className="text-terminal-accent" href="/scenarios">All scenarios</Link>
          </div>
        )}
      </Panel>
    </div>
  );
}
