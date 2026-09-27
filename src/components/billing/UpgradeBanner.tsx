"use client";

import Link from "next/link";

export function UpgradeBanner({
  feature,
  requiredPlan = "Pro",
  compact = false,
}: {
  feature: string;
  requiredPlan?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "rounded border border-terminal-amber/40 bg-terminal-amber/10 px-3 py-2 text-xs"
          : "rounded-md border border-terminal-amber/40 bg-gradient-to-r from-terminal-amber/10 to-terminal-teal/5 px-4 py-3 text-xs"
      }
    >
      <div className="font-medium text-terminal-amber">
        {feature} is a {requiredPlan} feature
      </div>
      <p className="text-terminal-dim mt-1 leading-relaxed">
        Calibra is probabilistic market intelligence — not investment advice. Upgrade to unlock full
        desks workflows, or stay on Free for the teaser experience.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link
          href="/pricing"
          className="px-2.5 py-1 rounded border border-terminal-teal/50 text-terminal-teal hover:bg-terminal-teal/10"
        >
          View plans
        </Link>
        <Link
          href="/methodology"
          className="px-2.5 py-1 rounded border border-terminal-border text-terminal-dim hover:text-terminal-text"
        >
          Methodology
        </Link>
      </div>
    </div>
  );
}

export function DisclaimerStrip() {
  return (
    <p className="text-2xs text-terminal-muted leading-relaxed border-t border-terminal-border/60 pt-2 mt-2">
      Intelligence tool only — not investment advice, not a recommendation to buy or sell any
      instrument. Prefer uncertainty over false precision.
    </p>
  );
}
