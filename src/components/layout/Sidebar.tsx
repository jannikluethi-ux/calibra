"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { BrandMark } from "@/components/brand/BrandMark";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { PRIMARY, SECONDARY, isActive } from "./nav";

function MoreList({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return (
    <div className="space-y-3">
      {SECONDARY.map((g) => (
        <div key={g.label}>
          <div className="px-3 pb-1 micro-label">{g.label}</div>
          {g.items.map((item) => {
            const active = item.exact ? path === item.href : path.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={clsx(
                  "block rounded-md px-3 py-1.5 text-[13px] transition-colors duration-[120ms]",
                  active ? "text-ink bg-surface-2" : "text-ink-2 hover:text-ink hover:bg-surface-2"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Desktop: slim 5-section rail + collapsible "More". Mobile: bottom tab bar + "More" sheet. */
export function Sidebar() {
  const path = usePathname();
  const inSecondary = SECONDARY.some((g) => g.items.some((i) => path.startsWith(i.href) && i.href !== "/"));
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  useEffect(() => setSheet(false), [path]);

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden md:flex md:w-56 shrink-0 h-full min-h-0 flex-col border-r border-line bg-surface-1">
        <div className="px-4 py-4">
          <BrandMark size={28} showWordmark />
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto px-2 pb-4" aria-label="Primary">
          {PRIMARY.map((item) => {
            const active = isActive(item, path);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "mb-0.5 flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors duration-[120ms]",
                  active ? "bg-accent/12 text-ink shadow-[inset_2px_0_0_0_#3dbeab]" : "text-ink-2 hover:text-ink hover:bg-surface-2"
                )}
              >
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen || inSecondary}
            className="mt-3 flex w-full items-center justify-between rounded-md px-3 py-2 text-sm text-ink-3 hover:text-ink hover:bg-surface-2"
          >
            <span>More</span>
            <span aria-hidden className="text-xs">{moreOpen || inSecondary ? "−" : "+"}</span>
          </button>
          {(moreOpen || inSecondary) && (
            <div className="mt-1 pb-2">
              <MoreList path={path} />
            </div>
          )}
        </nav>
        <div className="shrink-0 border-t border-line px-3.5 py-3">
          <AccountMenu variant="sidebar" />
        </div>
      </aside>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Primary"
        className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-1/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-6">
          {PRIMARY.map((item) => {
            const active = isActive(item, path);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex flex-col items-center justify-center py-2.5 text-[11px] font-medium",
                  active ? "text-accent" : "text-ink-2"
                )}
              >
                <span className={clsx("mb-1 h-0.5 w-5 rounded-full", active ? "bg-accent" : "bg-transparent")} />
                {item.short || item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setSheet(true)}
            className={clsx("flex flex-col items-center justify-center py-2.5 text-[11px] font-medium", inSecondary ? "text-accent" : "text-ink-2")}
          >
            <span className="mb-1 h-0.5 w-5" />
            More
          </button>
        </div>
      </nav>
      {sheet && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="More pages">
          <button aria-label="Close" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSheet(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-hero border-t border-line-strong bg-surface-1 p-4 pb-8 rise-in">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">More</span>
              <button onClick={() => setSheet(false)} className="text-ink-2 text-sm">Close</button>
            </div>
            <MoreList path={path} onNavigate={() => setSheet(false)} />
            <div className="mt-4 border-t border-line pt-3">
              <AccountMenu variant="sidebar" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
