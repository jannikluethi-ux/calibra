import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { listConflicts } from "@/lib/intel/store";
import { ConflictCard } from "@/components/intel/ConflictCard";

export const dynamic = "force-dynamic";

export default function ConflictsPage() {
  const conflicts = listConflicts(100);
  const factual = conflicts.filter((c) => c.kind === "factual").length;
  return (
    <div className="space-y-3 max-w-6xl">
      <div>
        <Link href="/events" className="text-2xs text-terminal-accent">← All events</Link>
        <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim mt-1">Conflicting evidence</h1>
        <p className="text-2xs text-terminal-muted mt-0.5 max-w-3xl">
          Disagreements between reports are preserved, not resolved. Factual conflicts (different reported figures) are verifiable against the primary release; interpretive conflicts (opposite directional readings) are not. Source tier and publication time are shown as context only. The system never picks the side that agrees with an existing forecast.
        </p>
      </div>
      <Panel title={`${conflicts.length} conflicts (${factual} factual, ${conflicts.length - factual} interpretive)`}>
        {!conflicts.length ? <p className="text-2xs text-terminal-dim">No conflicts detected so far.</p> : <div className="space-y-2" data-testid="conflict-list">{conflicts.map((c) => <ConflictCard key={c.id} c={c} />)}</div>}
      </Panel>
    </div>
  );
}
