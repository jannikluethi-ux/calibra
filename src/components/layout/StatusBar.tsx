"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { QualityBadge } from "../ui/Badge";
import { fmtTime } from "@/lib/format";
import { brand } from "@/lib/brand";
import { BrandMark } from "@/components/brand/BrandMark";
import { AccountMenu } from "@/components/auth/AccountMenu";

interface Status {
  lastMarketUpdate: string | null;
  lastEventUpdate: string | null;
  dataQuality: string;
  marketCount: number;
  eventCount: number;
}

interface SchedBrief {
  enabled: boolean;
  inFastSession: boolean;
  lastRuns: Record<string, string | null>;
}

export function StatusBar() {
  const [status, setStatus] = useState<Status | null>(null);
  const [sched, setSched] = useState<SchedBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/refresh");
      const j = await r.json();
      setStatus(j.status);
    } catch {
      /* ignore */
    }
    try {
      const r = await fetch("/api/scheduler/status");
      const j = await r.json();
      setSched({
        enabled: !!j.enabled,
        inFastSession: !!j.inFastSession,
        lastRuns: j.lastRuns || {},
      });
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  async function refresh() {
    setBusy(true);
    setMsg("Refreshing markets + events…");
    try {
      const r = await fetch("/api/refresh", { method: "POST" });
      const j = await r.json();
      setStatus(j.status ?? j.result);
      setMsg(
        j.result
          ? `OK — markets live ${j.result.marketLive}/${j.result.marketCount}, events live ${j.result.eventsLive}, demo ${j.result.eventsDemo}`
          : "Refresh completed"
      );
      await load();
    } catch (e) {
      setMsg(`Refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="h-11 shrink-0 border-b border-terminal-border bg-terminal-panel/90 backdrop-blur flex items-center px-3 gap-4 text-2xs">
      <div className="flex items-center gap-2 shrink-0">
        <BrandMark size={20} />
        <span className="font-display text-xs font-semibold tracking-wide text-terminal-text hidden sm:inline">
          {brand.shortName}
        </span>
      </div>
      <div className="h-4 w-px bg-terminal-border shrink-0" />
      <div className="flex items-center gap-2">
        <span className="text-terminal-muted uppercase tracking-wider">Quality</span>
        <QualityBadge quality={status?.dataQuality || "insufficient"} />
      </div>
      <div className="text-terminal-dim truncate min-w-0">
        Markets: <span className="num text-terminal-text">{fmtTime(status?.lastMarketUpdate)}</span>
        <span className="mx-2 text-terminal-border">|</span>
        Events: <span className="num text-terminal-text">{fmtTime(status?.lastEventUpdate)}</span>
        <span className="mx-2 text-terminal-border">|</span>
        Derive:{" "}
        <span className="num text-terminal-text">{fmtTime(sched?.lastRuns?.derive)}</span>
        <span className="mx-2 text-terminal-border">|</span>
        <span className="num">{status?.marketCount ?? 0}</span> snaps /{" "}
        <span className="num">{status?.eventCount ?? 0}</span> events
      </div>
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <Link
          href="/settings/scheduler"
          className="hidden lg:inline-flex items-center gap-1 px-2 py-0.5 border border-terminal-border rounded hover:border-terminal-teal/50 text-terminal-dim hover:text-terminal-text"
          title="Scheduler settings"
        >
          <span
            className={
              sched?.enabled
                ? "inline-block w-1.5 h-1.5 rounded-full bg-terminal-green"
                : "inline-block w-1.5 h-1.5 rounded-full bg-terminal-amber"
            }
          />
          Sched {sched?.inFastSession ? "session" : "off-hrs"}
        </Link>
        <AccountMenu variant="status" />
        <div className="h-4 w-px bg-terminal-border hidden sm:block" />
        {msg && <span className="text-terminal-muted max-w-md truncate hidden md:inline">{msg}</span>}
        <button
          onClick={refresh}
          disabled={busy}
          className="px-2.5 py-1 border border-terminal-border rounded-md bg-terminal-surface hover:border-terminal-teal/60 hover:shadow-glow text-terminal-text disabled:opacity-50 transition-all"
        >
          {busy ? "Refreshing…" : "Refresh data"}
        </button>
      </div>
    </header>
  );
}
