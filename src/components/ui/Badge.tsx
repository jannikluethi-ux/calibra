import clsx from "clsx";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "green" | "red" | "amber" | "blue" | "purple";
}) {
  return (
    <span
      className={clsx(
        "badge",
        tone === "neutral" && "border-terminal-border text-terminal-dim bg-terminal-bg/60",
        tone === "green" && "border-terminal-green/35 text-terminal-green bg-terminal-green/10",
        tone === "red" && "border-terminal-red/35 text-terminal-red bg-terminal-red/10",
        tone === "amber" && "border-terminal-amber/35 text-terminal-amber bg-terminal-amber/10",
        tone === "blue" && "border-terminal-accent/35 text-terminal-accent bg-terminal-accent/10",
        tone === "purple" && "border-terminal-purple/40 text-terminal-purple bg-terminal-purple/10"
      )}
    >
      {children}
    </span>
  );
}

export function QualityBadge({ quality }: { quality: string }) {
  const tone =
    quality === "live"
      ? "green"
      : quality === "cached"
        ? "blue"
        : quality === "demo" || quality === "degraded" || quality === "stale"
          ? "amber"
          : quality === "proxy"
            ? "purple"
            : "neutral";
  return <Badge tone={tone as "green"}>{quality.toUpperCase()}</Badge>;
}
