import clsx from "clsx";

export interface ScenarioWeights {
  base: number;
  upside: number;
  downside: number;
  tail: number;
}

const SEGS = [
  { key: "base", label: "Base", cls: "bg-scenario-base" },
  { key: "upside", label: "Upside", cls: "bg-scenario-upside" },
  { key: "downside", label: "Downside scenario", cls: "bg-scenario-downside" },
  { key: "tail", label: "Tail", cls: "bg-scenario-tail" },
] as const;

/** 100% stacked bar of scenario weights. Downside = scenario weight, never a sell signal. */
export function ScenarioWeightBar({
  weights,
  size = "md",
  showLegend = true,
}: {
  weights: ScenarioWeights;
  size?: "sm" | "md" | "lg";
  showLegend?: boolean;
}) {
  const total = SEGS.reduce((s, x) => s + Math.max(0, weights[x.key] || 0), 0) || 1;
  const label = SEGS.map((s) => `${s.label} ${weights[s.key]}%`).join(", ");
  return (
    <div>
      <div
        role="img"
        aria-label={`Scenario weights: ${label}`}
        className={clsx(
          "flex w-full overflow-hidden rounded-full bg-surface-2 gap-px",
          size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2"
        )}
      >
        {SEGS.map((s) => {
          const v = Math.max(0, weights[s.key] || 0);
          if (!v) return null;
          return (
            <div
              key={s.key}
              className={clsx(s.cls, "h-full")}
              style={{ width: `${(v / total) * 100}%` }}
              title={`${s.label} ${v}%`}
            />
          );
        })}
      </div>
      {showLegend && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-caption text-ink-2">
          {SEGS.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className={clsx("inline-block h-2 w-2 rounded-sm", s.cls)} />
              {s.label} <span className="num text-ink">{weights[s.key]}%</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function scenarioWeights(s: {
  base: { probability: number };
  bull: { probability: number };
  bear: { probability: number };
  tail: { probability: number };
}): ScenarioWeights {
  return {
    base: s.base.probability,
    upside: s.bull.probability,
    downside: s.bear.probability,
    tail: s.tail.probability,
  };
}
