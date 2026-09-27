"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { brand } from "@/lib/brand";
import { BrandMark } from "@/components/brand/BrandMark";
import { AccountMenu } from "@/components/auth/AccountMenu";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/movers", label: "Elevated Prob." },
  { href: "/events", label: "Events" },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/map", label: "Causal Map" },
  { href: "/countries", label: "Countries" },
  { href: "/assets", label: "Assets" },
  { href: "/warnings", label: "Warnings" },
  { href: "/forecasts", label: "Forecasts" },
  { href: "/analyst", label: "AI Analyst" },
  { href: "/simulator", label: "Simulator" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/alerts", label: "Alerts" },
  { href: "/settings/scheduler", label: "Scheduler" },
  { href: "/methodology", label: "Methodology" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs/api", label: "API Docs" },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="w-52 shrink-0 border-r border-terminal-border bg-terminal-panel/95 flex flex-col backdrop-blur-sm">
      <div className="px-3 py-3 border-b border-terminal-border bg-hero-glow">
        <BrandMark size={30} showWordmark />
        <div className="text-2xs text-terminal-muted mt-2 leading-snug line-clamp-2">
          {brand.tagline}
        </div>
      </div>
      <nav className="flex-1 py-2 overflow-y-auto">
        {NAV.map((item) => {
          const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "block px-3 py-1.5 text-xs border-l-2 transition-colors",
                active
                  ? "border-terminal-teal bg-terminal-teal/10 text-terminal-text"
                  : "border-transparent text-terminal-dim hover:text-terminal-text hover:bg-terminal-surface"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-3 py-2 border-t border-terminal-border space-y-2">
        <AccountMenu variant="sidebar" />
        <div className="text-2xs text-terminal-muted leading-relaxed">
          {brand.evidenceChain}
          <br />
          <span className="text-terminal-teal/70">{brand.philosophy}</span>
        </div>
      </div>
    </aside>
  );
}
