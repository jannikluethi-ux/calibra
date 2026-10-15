"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { brand } from "@/lib/brand";
import { BrandMark } from "@/components/brand/BrandMark";
import { AccountMenu } from "@/components/auth/AccountMenu";

const GROUPS = [
  {
    label: "Desk",
    items: [
      { href: "/", label: "Dashboard" },
      { href: "/digest", label: "Overnight digest" },
      { href: "/movers", label: "Elevated Prob." },
    ],
  },
  {
    label: "Crypto intelligence",
    items: [
      { href: "/crypto", label: "Overview", exact: true },
      { href: "/crypto/assets", label: "Assets" },
      { href: "/crypto/categories", label: "Categories" },
      { href: "/crypto/risk", label: "High-risk research" },
      { href: "/crypto/coverage", label: "Coverage" },
    ],
  },
  {
    label: "Research",
    items: [
      { href: "/events", label: "Events" },
      { href: "/scenarios", label: "Scenarios" },
      { href: "/map", label: "Causal Map" },
      { href: "/countries", label: "Countries" },
      { href: "/explorer", label: "Market explorer" },
      { href: "/assets", label: "Assets" },
      { href: "/warnings", label: "Warnings" },
      { href: "/forecasts", label: "Forecasts" },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/analyst", label: "AI Analyst" },
      { href: "/simulator", label: "Simulator" },
      { href: "/portfolio", label: "Portfolio" },
      { href: "/alerts", label: "Alerts" },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/settings/scheduler", label: "Scheduler" },
      { href: "/methodology", label: "Methodology" },
      { href: "/pricing", label: "Pricing" },
      { href: "/docs/api", label: "API Docs" },
    ],
  },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-terminal-border bg-terminal-panel/95 flex flex-col backdrop-blur-sm max-h-[38vh] md:max-h-none md:h-full">
      <div className="px-4 py-3.5 border-b border-terminal-border bg-hero-glow">
        <BrandMark size={32} showWordmark />
      </div>
      <nav className="flex-1 py-2 overflow-y-auto">
        {GROUPS.map((group) => (
          <div key={group.label} className="mb-1.5">
            <div className="px-4 pt-2.5 pb-1 text-2xs uppercase tracking-wide text-terminal-muted">
              {group.label}
            </div>
            {group.items.map((item) => {
              const active = ("exact" in item && item.exact) || item.href === "/" ? path === item.href : path.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "mx-2 mb-0.5 block rounded-md px-2.5 py-1.5 text-[13px] leading-5 transition-colors",
                    active
                      ? "bg-terminal-teal/12 text-terminal-text shadow-[inset_2px_0_0_0_#3dbeab]"
                      : "text-terminal-dim hover:text-terminal-text hover:bg-terminal-surface"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="px-3.5 py-3 border-t border-terminal-border space-y-2.5 hidden md:block">
        <AccountMenu variant="sidebar" />
        <div className="text-2xs text-terminal-muted leading-relaxed">
          {brand.evidenceChain}
          <div className="text-terminal-teal/80 mt-0.5">{brand.philosophy}</div>
        </div>
      </div>
    </aside>
  );
}
