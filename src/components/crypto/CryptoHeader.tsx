"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const TABS = [
  { href: "/crypto", label: "Overview", exact: true },
  { href: "/crypto/assets", label: "Assets" },
  { href: "/crypto/categories", label: "Categories" },
  { href: "/crypto/high-risk", label: "High-risk" },
  { href: "/crypto/coverage", label: "Coverage" },
  { href: "/crypto/methodology", label: "Methodology" },
];

/** Shared crypto section header + tab bar. Copy stays research-only, non-advisory. */
export function CryptoHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  const path = usePathname() || "";
  return (
    <div className="space-y-4">
      <div>
        <div className="micro-label text-accent">Crypto intelligence · research only</div>
        <h1 className="mt-2 font-display text-display-l text-ink">{title}</h1>
        {children && <div className="mt-2 text-sm text-ink-2 max-w-3xl">{children}</div>}
      </div>
      <nav aria-label="Crypto sections" className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => {
          const active = t.exact ? path === t.href : path.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "whitespace-nowrap px-3 py-2 text-sm border-b-2 -mb-px transition-colors duration-[120ms]",
                active ? "border-accent text-ink font-medium" : "border-transparent text-ink-3 hover:text-ink"
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
