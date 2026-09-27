import type { RiskGauge } from "@/lib/types";
import clsx from "clsx";

function barColor(score: number) {
  if (score >= 70) return "bg-terminal-red";
  if (score >= 50) return "bg-terminal-amber";
  return "bg-terminal-green";
}

export function RiskGauges({ gauges }: { gauges: RiskGauge[] }) {
  return (
    <section className="hero-strip">
      <div className="px-3 py-2 border-b border-terminal-border/60 flex items-center justify-between">
        <span className="text-2xs uppercase tracking-wider text-terminal-dim">
          Global Risk Environment
        </span>
        <span className="text-2xs text-terminal-muted normal-case tracking-normal">
          Heuristic · hover for methodology
        </span>
      </div>
      <div className="p-3 grid grid-cols-2 md:grid-cols-5 gap-2">
        {gauges.map((g) => (
          <div
            key={g.id}
            className="bg-terminal-bg/50 border border-terminal-border/80 rounded-md p-2.5 group relative hover:border-terminal-teal/35 transition-colors"
            title={`${g.methodology}\nInputs: ${g.inputs.join(", ")}`}
          >
            <div className="flex items-start justify-between gap-1">
              <div className="text-2xs text-terminal-dim leading-tight">{g.name}</div>
              <div
                className={clsx(
                  "text-2xs",
                  g.direction === "rising" && "text-terminal-red",
                  g.direction === "falling" && "text-terminal-green",
                  g.direction === "stable" && "text-terminal-muted"
                )}
              >
                {g.direction === "rising" ? "↑" : g.direction === "falling" ? "↓" : "→"}
              </div>
            </div>
            <div className="num text-lg font-semibold mt-1 text-terminal-text">{g.score}</div>
            <div className="h-1 bg-terminal-border rounded mt-1 overflow-hidden">
              <div className={clsx("h-full", barColor(g.score))} style={{ width: `${g.score}%` }} />
            </div>
            <div className="text-2xs text-terminal-muted mt-1">conf {g.confidence}%</div>
            <div className="text-2xs text-terminal-dim mt-1 line-clamp-2">{g.rationale}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
