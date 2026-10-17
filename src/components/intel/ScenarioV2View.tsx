import type { Scenario, ScenarioV2 } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { fmtTime } from "@/lib/format";

const TONE: Record<ScenarioV2["key"], "blue" | "green" | "red" | "amber"> = { base: "blue", upside: "green", downside: "red", tail: "amber" };

function List({ label, items, cls }: { label: string; items: string[]; cls: string }) {
  if (!items.length) return null;
  return (
    <div>
      <span className={cls}>{label}:</span>
      <ul className="list-disc ml-4">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

export function DqBadge({ status }: { status: string }) {
  const tone = status === "ok" ? "green" : status === "conflicted" ? "red" : "amber";
  return <Badge tone={tone}>DQ {status}</Badge>;
}

export function PreV2Badge() {
  return (
    <span title="Written before scenario_v2 (Batch 3). Kept exactly as stored; structured fields are missing.">
      <Badge tone="neutral">PRE-V2</Badge>
    </span>
  );
}

/** Structured scenario set (schemaVersion 2). */
export function ScenarioV2View({ s }: { s: Scenario }) {
  const v = s.v2;
  if (!v) return null;
  return (
    <div className="space-y-2" data-testid="scenario-v2">
      <div className="flex flex-wrap items-center gap-1.5 text-2xs">
        <Badge tone="purple">v2 · {v.interpretationLabel}</Badge>
        <DqBadge status={v.dqStatus} />
        <Badge>set confidence {v.confidence}</Badge>
        <span className="text-terminal-muted">last update {fmtTime(v.lastUpdate)}</span>
      </div>
      <p className="text-2xs text-terminal-amber leading-relaxed">{v.exhaustivenessNote}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
        {v.scenarios.map((x) => (
          <div key={x.key} className="border border-terminal-border rounded p-2 bg-terminal-bg min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <Badge tone={TONE[x.key]}>{x.key.toUpperCase()}</Badge>
              <span className="num text-xs whitespace-nowrap" title="Relative weight among the listed scenarios; not a probability, not an expected return">
                weight {x.weight} · conf {x.confidence}
              </span>
            </div>
            <div className="text-xs font-medium text-terminal-text">{x.name}</div>
            <p className="text-2xs text-terminal-dim leading-relaxed mt-0.5">{x.description}</p>
            <div className="text-2xs text-terminal-muted mt-1">Horizon {x.horizon} · Instruments: {x.instruments.join(", ") || "none mapped"}</div>
            <details className="mt-1 text-2xs">
              <summary className="cursor-pointer text-terminal-accent">Evidence · assumptions · drivers · indicators · invalidation</summary>
              <div className="mt-1 space-y-1 text-terminal-dim break-words">
                <List label="Evidence" items={x.evidence} cls="text-terminal-green" />
                <List label="Assumptions" items={x.assumptions} cls="text-terminal-amber" />
                <List label="Drivers" items={x.drivers} cls="text-terminal-accent" />
                <List label="Impact mechanisms" items={x.impactMechanisms} cls="text-terminal-accent" />
                <List label="Indicators to monitor" items={x.indicatorsToMonitor} cls="text-terminal-cyan" />
                <List label="Invalidation" items={x.invalidationConditions} cls="text-terminal-purple" />
              </div>
            </details>
          </div>
        ))}
      </div>
      <details className="text-2xs">
        <summary className="cursor-pointer text-terminal-accent">How the weights and confidence were set</summary>
        <div className="mt-1 text-terminal-dim space-y-1">
          <div>Rule: {v.weightRule}</div>
          <ul className="list-disc ml-4">{v.weightSteps.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <ul className="list-disc ml-4">{v.confidenceSteps.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <div>Data quality: {v.dqReasons.join(" ")}</div>
          {v.conflicts.length > 0 && (
            <div>
              <span className="text-terminal-red">Conflicts lowering confidence:</span>
              <ul className="list-disc ml-4">{v.conflicts.map((c) => <li key={c.id}>[{c.kind}] {c.summary}</li>)}</ul>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
