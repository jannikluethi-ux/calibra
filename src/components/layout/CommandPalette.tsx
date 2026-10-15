"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { PRIMARY, SECONDARY } from "./nav";

const ITEMS = [
  ...PRIMARY.map((i) => ({ href: i.href, label: i.label, group: "Sections" })),
  ...SECONDARY.flatMap((g) => g.items.map((i) => ({ href: i.href, label: i.label, group: g.label }))),
].filter((x, i, a) => a.findIndex((y) => y.href === x.href) === i);

/** ⌘K / Ctrl+K navigation palette fed by the nav config. Navigation only. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? ITEMS.filter((i) => `${i.label} ${i.group} ${i.href}`.toLowerCase().includes(t)) : ITEMS;
  }, [q]);

  if (!open) return null;
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh] px-4" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Go to page"
        className="w-full max-w-lg rounded-card border border-line-strong bg-surface-1 shadow-card overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIdx((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" && results[idx]) go(results[idx].href);
          }}
          placeholder="Go to…"
          className="w-full bg-transparent px-4 py-3.5 text-sm text-ink placeholder:text-ink-3 outline-none border-b border-line"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.map((r, i) => (
            <li key={r.href}>
              <button
                type="button"
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(r.href)}
                className={clsx("flex w-full items-center justify-between px-4 py-2 text-left text-sm", i === idx ? "bg-surface-2 text-ink" : "text-ink-2")}
              >
                <span>{r.label}</span>
                <span className="text-caption text-ink-3">{r.group}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-4 py-3 text-sm text-ink-3">No matching page.</li>}
        </ul>
        <div className="px-4 py-2 border-t border-line text-[11px] text-ink-3">↑↓ to move · Enter to open · Esc to close</div>
      </div>
    </div>
  );
}
