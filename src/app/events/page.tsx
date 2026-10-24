import { getEvents } from "@/lib/ingestion/rss";
import { Panel } from "@/components/ui/Panel";
import { Badge, QualityBadge } from "@/components/ui/Badge";
import { fmtTime } from "@/lib/format";
import type { FinancialEvent, TransmissionChainStep } from "@/lib/types";
import { getSessionUser, userPlanLimits } from "@/lib/auth/session";
import { UpgradeBanner } from "@/components/billing/UpgradeBanner";
import Link from "next/link";
import { eventListBadges } from "@/lib/intel/store";
import { AwaitingFirstRun } from "@/components/ui/AwaitingFirstRun";

export const dynamic = "force-dynamic";

function ChainSteps({ chain, steps }: { chain: string[]; steps?: TransmissionChainStep[] }) {
  const nodes = steps?.length
    ? steps
    : chain.map((node, i) => ({ node, edgeLabel: i === 0 ? undefined : undefined }));
  return (
    <div className="flex flex-wrap items-stretch gap-1 mt-1">
      {nodes.map((s, i) => (
        <div key={`${s.node}-${i}`} className="flex items-center gap-1">
          <div className="border border-terminal-accent/40 bg-terminal-accent/10 rounded px-2 py-1 max-w-[140px]">
            <div className="text-2xs font-medium text-terminal-text truncate" title={s.node}>
              {s.node}
            </div>
            {s.edgeLabel && (
              <div className="text-[10px] text-terminal-muted leading-tight mt-0.5 line-clamp-2" title={s.edgeLabel}>
                via: {s.edgeLabel}
              </div>
            )}
          </div>
          {i < nodes.length - 1 && <span className="text-terminal-accent text-xs">→</span>}
        </div>
      ))}
    </div>
  );
}

function ImpactBreakdown({ e }: { e: FinancialEvent }) {
  const why = e.impactScore.dimensionWhy;
  const rows = [
    ["Magnitude", e.impactScore.magnitude, why?.magnitude],
    ["Probability", e.impactScore.probability, why?.probability],
    ["Market Sensitivity", e.impactScore.marketSensitivity, why?.marketSensitivity],
    ["Transmission Speed", e.impactScore.transmissionSpeed, why?.transmissionSpeed],
    ["Persistence", e.impactScore.persistence, why?.persistence],
    ["Confidence", e.impactScore.confidence, why?.confidence],
  ] as const;
  return (
    <details className="mt-2 text-2xs">
      <summary className="cursor-pointer text-terminal-accent">
        Impact score breakdown · composite {e.impactScore.composite} ⓘ
      </summary>
      <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-1.5">
        {rows.map(([k, v, w]) => (
          <div key={k} className="bg-terminal-bg border border-terminal-border rounded px-1.5 py-1">
            <div className="flex justify-between gap-2">
              <span className="text-terminal-muted">{k}</span>
              <span className="num">{v}</span>
            </div>
            {w && <p className="text-terminal-dim mt-0.5 leading-snug">{w}</p>}
          </div>
        ))}
      </div>
      <p className="mt-2 text-terminal-muted leading-relaxed">{e.impactScore.methodology}</p>
    </details>
  );
}

function EvidenceLayers({ e }: { e: FinancialEvent }) {
  const layers = e.evidenceLayers;
  const contradict = e.classification.contradicting_evidence || [];
  const assumptions = e.classification.key_assumptions || [];
  return (
    <div className="mt-2 space-y-2 text-2xs">
      {layers && (
        <details>
          <summary className="cursor-pointer text-terminal-accent">
            Evidence layers (Observed → Interpretation → Assumption → Estimate)
          </summary>
          <div className="mt-1 space-y-1 text-terminal-dim">
            <div>
              <span className="text-terminal-green">Observed fact</span>
              <ul className="list-disc ml-4">{layers.observed.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
            <div>
              <span className="text-terminal-accent">Interpretation</span>
              <ul className="list-disc ml-4">{layers.interpretation.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
            <div>
              <span className="text-terminal-amber">Model assumption</span>
              <ul className="list-disc ml-4">{layers.modelAssumptions.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
            <div>
              <span className="text-terminal-purple">Scenario estimate</span>
              <ul className="list-disc ml-4">{layers.scenarioEstimates.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          </div>
        </details>
      )}
      <div>
        <div className="text-terminal-red">Contradicting evidence</div>
        <ul className="list-disc ml-4 text-terminal-dim">
          {contradict.length ? (
            contradict.map((x, i) => <li key={i}>{x}</li>)
          ) : (
            <li>No contradicting evidence in source; interpretation may be one-sided.</li>
          )}
        </ul>
      </div>
      {assumptions.length > 0 && (
        <details>
          <summary className="cursor-pointer text-terminal-amber">Key assumptions</summary>
          <ul className="list-disc ml-4 text-terminal-dim mt-1">
            {assumptions.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </details>
      )}
      {e.classification.expected_impact && e.classification.expected_impact.length > 0 && (
        <details>
          <summary className="cursor-pointer text-terminal-accent">Expected impact by asset class (horizon-labeled)</summary>
          <div className="mt-1 space-y-1">
            {e.classification.expected_impact.map((imp, i) => (
              <div key={i} className="border border-terminal-border rounded px-2 py-1 bg-terminal-bg">
                <div className="flex gap-2 items-center">
                  <span className="font-medium">{imp.assetClass}</span>
                  <Badge
                    tone={
                      imp.direction === "bullish"
                        ? "green"
                        : imp.direction === "bearish"
                          ? "red"
                          : imp.direction === "mixed"
                            ? "amber"
                            : "neutral"
                    }
                  >
                    {imp.direction}
                  </Badge>
                </div>
                <ul className="mt-0.5 text-terminal-dim">
                  {Object.entries(imp.horizons).map(([h, note]) => (
                    <li key={h}>
                      <span className="text-terminal-muted num">[{h}]</span> {note}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export default function EventsPage() {
  const user = getSessionUser();
  const limits = userPlanLimits(user);
  const isFree = !user || user.plan === "free";
  const events = getEvents(limits.eventsPageSize);
  const badges = eventListBadges(events.map((e) => e.id));

  return (
    <div className="space-y-3">
      {!events.length && <AwaitingFirstRun what="events" />}
      <div>
        <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">Global Event Intelligence</h1>
        <p className="text-2xs text-terminal-muted mt-0.5">
          RSS + heuristic_v2 graph transmission maps. Demo samples are labeled — never presented as live facts. Source
          tiers 1–4 downweight unverified. Claims separated: Observed → Interpretation → Assumption → Estimate.
          {isFree && (
            <span className="text-terminal-amber"> Free plan shows last {limits.eventsPageSize} events.</span>
          )}
        </p>
      </div>
      {isFree && <UpgradeBanner feature="Full events history & filters" compact />}
      <Panel
        title={`${events.length} events`}
        right={
          <span className="normal-case tracking-normal text-terminal-muted">
            Use status bar Refresh to re-ingest · classifier heuristic_v2 ·{" "}
            <Link href="/events/conflicts" className="text-terminal-accent">conflicts</Link>
          </span>
        }
      >
        <div className="space-y-3">
          {events.map((e) => (
            <article key={e.id} className="border border-terminal-border rounded bg-terminal-surface p-3">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <QualityBadge quality={e.quality} />
                <Badge tone="blue">Tier {e.sourceTier}</Badge>
                <Badge tone="purple">
                  {e.classification.classifier_version || e.classification.method}
                </Badge>
                {e.classification.event_type && <Badge>{e.classification.event_type}</Badge>}
                <Badge>{e.timeHorizon}</Badge>
                {e.country && <Badge tone="purple">{e.country}</Badge>}
                <Badge
                  tone={
                    e.classification.sentiment === "hawkish" || e.classification.sentiment === "risk_off"
                      ? "red"
                      : e.classification.sentiment === "dovish" || e.classification.sentiment === "risk_on"
                        ? "green"
                        : "neutral"
                  }
                >
                  {e.classification.sentiment}
                </Badge>
                <span className="text-2xs text-terminal-muted num ml-auto">{fmtTime(e.publishedAt)}</span>
              </div>
              <h2 className="text-sm font-medium">
                <Link href={`/events/${e.id}`} className="hover:text-terminal-accent">{e.title}</Link>
              </h2>
              {(() => {
                const b = badges.get(e.id);
                const p = e.provenance;
                return (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-terminal-muted" data-testid="event-source-line">
                    <span>
                      Source: {e.sourceName}
                      {p ? ` · ${p.sourceId} · retrieved ${fmtTime(p.retrievedAt)}${p.sourcePublishedAt ? "" : " · no source publish time"}` : " · pre-provenance record"}
                    </span>
                    {b && b.groupSize > 1 && <Badge tone="blue">{b.canonical ? `canonical of ${b.groupSize}` : `duplicate (group of ${b.groupSize})`}</Badge>}
                    {b?.material === true && <Badge tone="green">material</Badge>}
                    {b && b.conflicts > 0 && <Badge tone="red">{b.conflicts} conflict{b.conflicts > 1 ? "s" : ""}</Badge>}
                    {b?.scenario && <Badge tone={b.scenario === "v2" ? "purple" : "neutral"}>scenario {b.scenario}</Badge>}
                    <Link href={`/events/${e.id}`} className="text-terminal-accent underline">details · provenance · consequences</Link>
                  </div>
                );
              })()}
              <p className="text-xs text-terminal-dim mt-1">{e.summary}</p>

              {(e.classification.structuredEntities?.institutions?.length ||
                e.classification.structuredEntities?.instruments?.length) && (
                <div className="mt-1.5 flex flex-wrap gap-1 text-2xs">
                  {(e.classification.structuredEntities?.institutions || []).map((x) => (
                    <Badge key={x} tone="blue">
                      {x}
                    </Badge>
                  ))}
                  {(e.classification.structuredEntities?.instruments || []).map((x) => (
                    <Badge key={x}>{x}</Badge>
                  ))}
                </div>
              )}

              <div className="mt-2 text-2xs">
                <div className="text-terminal-accent">Transmission chain</div>
                <ChainSteps chain={e.causalChain} steps={e.classification.transmission_chain} />
              </div>

              {e.classification.transmission_narrative && (
                <div className="mt-2 text-2xs text-terminal-dim">
                  <span className="text-terminal-muted">Narrative: </span>
                  {e.classification.transmission_narrative}
                </div>
              )}

              {!e.classification.transmission_narrative && (
                <div className="mt-2 text-2xs text-terminal-dim">
                  <span className="text-terminal-muted">Transmission: </span>
                  {e.transmissionMechanism}
                </div>
              )}

              <div className="mt-2 grid grid-cols-3 md:grid-cols-6 gap-1 text-2xs">
                {(
                  [
                    ["Mag", e.impactScore.magnitude],
                    ["Prob", e.impactScore.probability],
                    ["Sens", e.impactScore.marketSensitivity],
                    ["Speed", e.impactScore.transmissionSpeed],
                    ["Persist", e.impactScore.persistence],
                    ["Conf", e.impactScore.confidence],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="bg-terminal-bg border border-terminal-border rounded px-1.5 py-1">
                    <div className="text-terminal-muted">{k}</div>
                    <div className="num">{v}</div>
                  </div>
                ))}
              </div>

              <ImpactBreakdown e={e} />
              <EvidenceLayers e={e} />

              {e.classification.confidence_rationale && (
                <div className="mt-2 text-2xs text-terminal-muted">
                  Confidence {e.classification.confidence}: {e.classification.confidence_rationale}
                </div>
              )}

              <div className="mt-2 text-2xs text-terminal-muted flex flex-wrap gap-2">
                <span>{e.sourceName}</span>
                {e.citationUrl && (
                  <a href={e.citationUrl} target="_blank" rel="noreferrer" className="text-terminal-accent underline">
                    citation
                  </a>
                )}
                {e.classification.previous_classification && (
                  <span title="Prior classifier retained for audit">
                    prev: {e.classification.previous_classification.method}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
