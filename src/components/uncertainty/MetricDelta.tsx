import clsx from "clsx";

/** Renders a change only when real data exists. Neutral colouring: a move is not a verdict. */
export function MetricDelta({
  value,
  unit = "pts",
  since,
  digits = 1,
}: {
  value: number | null | undefined;
  unit?: "pts" | "%";
  since?: string;
  digits?: number;
}) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="text-caption text-ink-3">no prior reading</span>;
  }
  const up = value > 0;
  const flat = Math.abs(value) < Math.pow(10, -digits) / 2;
  const arrow = flat ? "■" : up ? "▲" : "▼";
  const mag = Math.abs(value).toFixed(digits);
  return (
    <span className={clsx("inline-flex items-baseline gap-1 text-caption", flat ? "text-ink-3" : "text-ink-2")}>
      <span className={clsx("num font-medium", !flat && "text-ink")}>
        {arrow} {mag}
        {unit === "%" ? "%" : ` ${unit}`}
      </span>
      {since && <span className="text-ink-3">since {since}</span>}
    </span>
  );
}
