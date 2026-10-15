import type { RiskGauge } from "@/lib/types";
import { ProvenanceChip } from "../uncertainty/ProvenanceChip";

/** Compact risk-gauge strip. Heuristic model output; colour stays neutral (a score is not a verdict). */
export function RiskStrip({ gauges, at }: { gauges: RiskGauge[]; at?: string | null }) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <h2 className="text-sm font-semibold text-ink">Risk environment</h2>
        <ProvenanceChip kind="model" at={at} source="Calibra risk heuristic" />
      </div>
      {!gauges.length ? (
        <div className="p-5"><div className="empty-state">No risk gauges yet. Figures stay blank until the heuristic has inputs.</div></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px p-5 pt-3">
          {gauges.map((g) => (
            <div key={g.id} className="py-2 pr-4" title={`${g.rationale}\n\n${g.methodology}\nInputs: ${g.inputs.join(", ")}`}>
              <div className="text-caption text-ink-2 truncate">{g.name}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="num text-metric text-ink">{g.score}</span>
                <span className="text-caption text-ink-3">
                  {g.direction === "rising" ? "▲ rising" : g.direction === "falling" ? "▼ falling" : "■ stable"}
                </span>
              </div>
              <div className="mt-2 h-1 rounded-full bg-surface-2 overflow-hidden">
                <div className={`h-full rounded-full ${g.score >= 70 ? "bg-epi-model" : "bg-ink-3"}`} style={{ width: `${g.score}%` }} />
              </div>
              <div className="mt-1 text-[11px] text-ink-3">conf. <span className="num">{g.confidence}%</span></div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
