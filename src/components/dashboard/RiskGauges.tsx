import type { RiskGauge } from "@/lib/types";
import clsx from "clsx";

function barColor(score: number) {
  if (score >= 70) return "bg-terminal-red";
  if (score >= 50) return "bg-terminal-amber";
  return "bg-terminal-green";
}

export function RiskGauges({ gauges }: { gauges: RiskGauge[] }) {
  if (!gauges.length) {
    return (
      <section className="hero-strip">
        <div className="px-4 py-3 border-b border-terminal-border/70">
          <span className="text-xs font-medium uppercase tracking-wide text-terminal-dim">
            Global Risk Environment
          </span>
        </div>
        <div className="p-4">
          <div className="empty-state">
            No risk gauges yet. Figures stay blank until the heuristic has inputs — nothing is filled in.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="hero-strip">
      <div className="px-4 py-3 border-b border-terminal-border/70 flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-terminal-dim">
          Global Risk Environment
        </span>
        <span className="text-2xs text-terminal-muted normal-case tracking-normal">
          Heuristic · hover a gauge for methodology
        </span>
      </div>
      <div className="p-3 sm:p-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {gauges.map((g) => (
          <div
            key={g.id}
            className="bg-terminal-bg/45 border border-terminal-border/90 rounded-lg px-3 py-3 group relative hover:border-terminal-teal/40 transition-colors"
            title={`${g.methodology}\nInputs: ${g.inputs.join(", ")}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs text-terminal-dim leading-snug">{g.name}</div>
              <div
                className={clsx(
                  "text-xs font-medium tabular-nums",
                  g.direction === "rising" && "text-terminal-red",
                  g.direction === "falling" && "text-terminal-green",
                  g.direction === "stable" && "text-terminal-muted"
                )}
                aria-label={g.direction}
              >
                {g.direction === "rising" ? "↑" : g.direction === "falling" ? "↓" : "→"}
              </div>
            </div>
            <div className="num text-2xl font-semibold mt-2 text-terminal-text leading-none">{g.score}</div>
            <div className="h-1.5 bg-terminal-border/80 rounded-full mt-2.5 overflow-hidden">
              <div className={clsx("h-full rounded-full", barColor(g.score))} style={{ width: `${g.score}%` }} />
            </div>
            <div className="text-2xs text-terminal-muted mt-2">
              Confidence <span className="num text-terminal-dim">{g.confidence}%</span>
            </div>
            <div className="text-2xs text-terminal-dim mt-1.5 line-clamp-2 leading-relaxed">{g.rationale}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
