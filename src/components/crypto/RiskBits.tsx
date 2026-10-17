import clsx from "clsx";

const BAND_CLS: Record<string, string> = {
  low: "border-line text-ink-2",
  moderate: "border-line-strong text-ink",
  elevated: "border-terminal-amber/60 text-terminal-amber",
  high: "border-terminal-red/60 text-terminal-red",
  extreme: "border-terminal-red text-terminal-red font-semibold",
  insufficient_data: "border-dashed border-line-strong text-ink-3",
};

export function BandBadge({ band }: { band: string }) {
  return <span className={clsx("badge", BAND_CLS[band] ?? "border-line text-ink-3")}>{band === "insufficient_data" ? "insufficient data" : band}</span>;
}

const TYPE_TEXT: Record<string, string> = {
  structural: "structural",
  volatility_only: "volatility only",
  none_flagged: "none flagged",
  insufficient_data: "insufficient data",
};

export function RiskTypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="badge border-line text-ink-3">n/a</span>;
  return (
    <span className={clsx("badge", type === "structural" ? "border-terminal-red/50 text-terminal-red" : type === "volatility_only" ? "border-terminal-amber/50 text-terminal-amber" : "border-line text-ink-3")}>
      {TYPE_TEXT[type] ?? type}
    </span>
  );
}

const BASIS_CLS: Record<string, string> = {
  measured: "border-epi-observed/60 text-epi-observed",
  reported: "border-epi-observed/40 text-ink-2",
  corroborated: "border-dq-fresh/60 text-dq-fresh",
  "model-derived": "border-epi-model/60 text-epi-model",
  qualitative: "border-epi-interpreted/60 text-epi-interpreted",
  unknown: "border-dashed border-line-strong text-ink-3",
};

export function BasisBadge({ basis }: { basis: string }) {
  return <span className={clsx("badge uppercase", BASIS_CLS[basis] ?? "border-line text-ink-3")}>{basis}</span>;
}

export function ConfidenceBadge({ value, label }: { value: number | null; label: string | null }) {
  if (value == null) return <span className="badge border-line text-ink-3">confidence n/a</span>;
  return (
    <span className={clsx("badge", label === "high" ? "border-dq-fresh/60 text-dq-fresh" : label === "medium" ? "border-dq-stale/60 text-dq-stale" : "border-dashed border-line-strong text-ink-3")}>
      confidence {label} ({Math.round(value)})
    </span>
  );
}

export function StaleBadge({ stale }: { stale: boolean }) {
  return stale ? <span className="badge border-dq-stale/60 text-dq-stale">stale</span> : <span className="badge border-dq-fresh/40 text-dq-fresh">fresh</span>;
}

export const NON_ADVISORY =
  "Research only. Risk scores describe data-backed risk characteristics and their uncertainty; they are not buy, sell or hold signals, not trading signals and not a validated predictor of losses.";
