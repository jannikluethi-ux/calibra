import clsx from "clsx";

export type ProvenanceKind = "observed" | "interpreted" | "model" | "estimate";

const META: Record<ProvenanceKind, { letter: string; label: string; cls: string; tip: string }> = {
  observed: { letter: "O", label: "Observed", cls: "text-epi-observed border-epi-observed/40", tip: "Reported or measured fact from a source" },
  interpreted: { letter: "I", label: "Interpreted", cls: "text-epi-interpreted border-epi-interpreted/40", tip: "Our reading of observed facts" },
  model: { letter: "M", label: "Model", cls: "text-epi-model border-epi-model/40", tip: "Output of a model with stated assumptions" },
  estimate: { letter: "E", label: "Estimate", cls: "text-epi-estimate border-epi-estimate/50 border-dashed", tip: "Scenario estimate — uncertain by design" },
};

export function ageLabel(iso?: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ProvenanceChip({
  kind,
  at,
  source,
  compact = false,
}: {
  kind: ProvenanceKind;
  at?: string | null;
  source?: string;
  compact?: boolean;
}) {
  const m = META[kind];
  const age = ageLabel(at);
  return (
    <span
      title={[m.tip, source ? `Source: ${source}` : null, at ? `As of ${at}` : null].filter(Boolean).join(" · ")}
      className={clsx(
        "inline-flex items-center gap-1 rounded-chip border px-1.5 py-0.5 text-[11px] leading-none font-medium bg-surface-0/60",
        m.cls
      )}
    >
      <span className="font-semibold">{m.letter}</span>
      {!compact && <span>{m.label}</span>}
      {age && <span className="text-ink-3 num">· {age}</span>}
    </span>
  );
}
