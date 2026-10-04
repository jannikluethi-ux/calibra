"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { QualityBadge } from "../ui/Badge";
import { fmtTime } from "@/lib/format";
import { brand } from "@/lib/brand";
import { BrandMark } from "@/components/brand/BrandMark";
import { AccountMenu } from "@/components/auth/AccountMenu";

function shortStamp(iso: string | null | undefined): string {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Europe/Zurich",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return fmtTime(iso);
  }
}

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
    <header className="min-h-12 shrink-0 border-b border-terminal-border bg-terminal-panel/90 backdrop-blur flex items-center px-3 sm:px-4 gap-3 py-2 text-xs">
      <div className="flex items-center gap-2 shrink-0 md:hidden">
        <BrandMark size={20} />
        <span className="font-display text-sm font-semibold text-terminal-text">
          {brand.shortName}
        </span>
      </div>
      <div className="hidden sm:flex items-center gap-2 shrink-0">
        <span className="text-terminal-muted">Quality</span>
        <QualityBadge quality={status?.dataQuality || "insufficient"} />
      </div>
      <div className="text-terminal-dim min-w-0 hidden md:flex items-center gap-x-3 flex-wrap leading-5">
        <span className="whitespace-nowrap">
          <span className="text-terminal-muted">Markets</span>{" "}
          <span className="num text-terminal-text">{shortStamp(status?.lastMarketUpdate)}</span>
        </span>
        <span className="whitespace-nowrap">
          <span className="text-terminal-muted">Events</span>{" "}
          <span className="num text-terminal-text">{shortStamp(status?.lastEventUpdate)}</span>
        </span>
        <span className="whitespace-nowrap">
          <span className="text-terminal-muted">Derive</span>{" "}
          <span className="num text-terminal-text">{shortStamp(sched?.lastRuns?.derive)}</span>
        </span>
        <span className="whitespace-nowrap num text-terminal-text">
          {status?.marketCount ?? 0}
          <span className="text-terminal-muted font-sans"> snaps</span>
          <span className="mx-1.5 text-terminal-border">·</span>
          {status?.eventCount ?? 0}
          <span className="text-terminal-muted font-sans"> events</span>
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <Link
          href="/settings/scheduler"
          className="hidden xl:inline-flex items-center gap-1.5 px-2 py-1 border border-terminal-border rounded-md hover:border-terminal-teal/40 text-terminal-dim hover:text-terminal-text"
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
        {msg && (
          <span className="text-terminal-muted max-w-[16rem] truncate hidden xl:inline">{msg}</span>
        )}
        <button
          onClick={refresh}
          disabled={busy}
          className="px-3 py-1.5 rounded-md border border-terminal-teal/35 bg-terminal-teal/10 text-terminal-text hover:bg-terminal-teal/15 disabled:opacity-50 transition-colors text-xs font-medium"
        >
          {busy ? "Refreshing…" : "Refresh data"}
        </button>
      </div>
    </header>
  );
}
