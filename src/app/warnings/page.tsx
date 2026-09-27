import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getWarnings, persistWarnings } from "@/lib/warnings/detect";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default function WarningsPage() {
  ensureSeedData();
  let warnings = getWarnings();
  if (!warnings.length) warnings = persistWarnings();

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">Early Warning Radar</h1>
        <p className="text-2xs text-terminal-muted mt-0.5">
          Multi-signal combinations only — not single noisy points. Structure: Signal → Evidence → Historical precedent → Transmission → Confidence.
        </p>
      </div>
      {warnings.map((w) => (
        <Panel
          key={w.id}
          title={w.title}
          right={
            <span className="normal-case tracking-normal flex gap-1">
              <Badge tone={w.severity === "high" || w.severity === "critical" ? "red" : w.severity === "medium" ? "amber" : "green"}>
                {w.severity}
              </Badge>
              <Badge>conf {w.confidence}%</Badge>
            </span>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-2xs text-terminal-accent uppercase">Signal</div>
              <div className="text-terminal-text">{w.signal}</div>
              <div className="text-2xs text-terminal-accent uppercase mt-2">Evidence</div>
              <ul className="list-disc ml-4 text-terminal-dim">
                {w.evidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-2xs text-terminal-accent uppercase">Historical precedent</div>
              <div className="text-terminal-dim">{w.historicalPrecedent}</div>
              <div className="text-2xs text-terminal-accent uppercase mt-2">Transmission</div>
              <div className="num text-terminal-text">{w.transmission}</div>
              <div className="text-2xs text-terminal-muted mt-2">
                Assets: {w.relatedAssets.join(", ") || "n/a"}
              </div>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}
