import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getScenarios, ensureScenarios } from "@/lib/scenarios/engine";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { getSessionUser, userPlanLimits } from "@/lib/auth/session";
import { UpgradeBanner } from "@/components/billing/UpgradeBanner";
import Link from "next/link";
import { ScenarioV2View, PreV2Badge, DqBadge } from "@/components/intel/ScenarioV2View";

export const dynamic = "force-dynamic";

function BranchCard({
  name,
  probability,
  confidence,
  narrative,
  supportingEvidence,
  contradictingEvidence,
  keyAssumptions,
  invalidationConditions,
  tone,
}: {
  name: string;
  probability: number;
  confidence: number;
  narrative: string;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  keyAssumptions: string[];
  invalidationConditions: string[];
  tone: "blue" | "green" | "red" | "amber";
}) {
  return (
    <div className="border border-terminal-border rounded p-2 bg-terminal-bg">
      <div className="flex items-center justify-between mb-1">
        <Badge tone={tone}>{name.toUpperCase()}</Badge>
        <span className="num text-xs">
          {probability}% · conf {confidence}%
        </span>
      </div>
      <p className="text-2xs text-terminal-dim leading-relaxed">{narrative}</p>
      <details className="mt-2 text-2xs">
        <summary className="cursor-pointer text-terminal-accent">Evidence / assumptions / invalidation</summary>
        <div className="mt-1 space-y-1 text-terminal-dim">
          <div>
            <span className="text-terminal-green">Supporting:</span>
            <ul className="list-disc ml-4">{supportingEvidence.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
          <div>
            <span className="text-terminal-red">Contradicting:</span>
            <ul className="list-disc ml-4">{contradictingEvidence.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
          <div>
            <span className="text-terminal-amber">Assumptions:</span>
            <ul className="list-disc ml-4">{keyAssumptions.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
          <div>
            <span className="text-terminal-purple">Invalidation:</span>
            <ul className="list-disc ml-4">{invalidationConditions.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        </div>
      </details>
    </div>
  );
}

export default function ScenariosPage() {
  ensureSeedData();
  ensureScenarios();
  const user = getSessionUser();
  const limits = userPlanLimits(user);
  const isFree = !user || user.plan === "free";
  const all = getScenarios();
  const scenarios = isFree ? all.slice(0, limits.scenariosTeaser) : all;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">Scenario Engine</h1>
        <p className="text-2xs text-terminal-muted mt-0.5">
          Structured scenario sets (<strong className="text-terminal-accent">v2</strong>) are built from rule-based event assessments and documented instrument mappings. Weights are
          relative among the listed paths (documented rules W1–W5), not probabilities and not expected returns; sets are not exhaustive. Rows written before v2 are kept as stored and marked{" "}
          <strong>PRE-V2</strong>. Not predictions.
          {isFree && <span className="text-terminal-amber"> Free teaser: {limits.scenariosTeaser} scenarios.</span>}
        </p>
      </div>
      {isFree && <UpgradeBanner feature="Full scenario engine" compact />}
      {scenarios.map((s) => (
        <Panel
          key={s.id}
          title={s.title}
          right={
            <span className="normal-case tracking-normal flex gap-1 items-center">
              <Badge tone="amber">ESTIMATE</Badge>
              {s.schemaVersion === 2 && s.v2 ? <DqBadge status={s.v2.dqStatus} /> : <PreV2Badge />}
              <Badge>{s.timeHorizon}</Badge>
            </span>
          }
        >
          <div className="text-2xs text-terminal-muted mb-2">
            {s.schemaVersion === 2 ? "Instruments (documented mappings)" : "Affected (pre-v2 keyword mapping)"}: {s.affectedAssets.join(", ") || "none mapped"}
            {s.eventId && (
              <>
                {" · "}
                <Link className="text-terminal-accent" href={`/events/${s.eventId}`}>source event</Link>
              </>
            )}
          </div>
          {s.schemaVersion === 2 && s.v2 ? (
            <ScenarioV2View s={s} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
              <BranchCard {...s.base} tone="blue" />
              <BranchCard {...s.bull} tone="green" />
              <BranchCard {...s.bear} tone="red" />
              <BranchCard {...s.tail} tone="amber" />
            </div>
          )}
        </Panel>
      ))}
      {!scenarios.length && (
        <Panel title="Empty">
          <div className="text-terminal-amber text-xs">Insufficient evidence for scenario estimates. Refresh events first.</div>
        </Panel>
      )}
    </div>
  );
}
