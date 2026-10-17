import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { fmtTime } from "@/lib/format";
import type { StoredConflict } from "@/lib/intel/store";

export function ConflictCard({ c }: { c: StoredConflict }) {
  const sides = [c.detail.a, c.detail.b];
  return (
    <div className="border border-terminal-border rounded p-2 bg-terminal-bg text-2xs" data-testid="conflict-card">
      <div className="flex flex-wrap gap-1.5 items-center mb-1">
        <Badge tone={c.kind === "factual" ? "red" : "amber"}>{c.kind}</Badge>
        <Badge tone={c.verifiable ? "green" : "neutral"}>{c.verifiable ? "verifiable" : "not verifiable"}</Badge>
        <span className="text-terminal-muted">{c.topicKey} · {c.detail.resolution}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {sides.map((s) => (
          <div key={s.eventId} className="border border-terminal-border rounded p-1.5 min-w-0">
            <div className="text-terminal-muted">{s.sourceName} · tier {s.tier} · {fmtTime(s.publishedAt)}</div>
            <div className="text-terminal-text break-words">{s.claim}</div>
            <Link className="text-terminal-accent" href={`/events/${s.eventId}`}>event</Link>
          </div>
        ))}
      </div>
      <ul className="list-disc ml-4 mt-1 text-terminal-dim">
        <li>{c.detail.sourceComparison}</li>
        <li>{c.detail.timeComparison}</li>
        <li>{c.detail.verificationNote}</li>
        <li>Effect: scenarios for both events lower confidence and move weights toward equal (rules W4/C2). No side is chosen.</li>
      </ul>
    </div>
  );
}
