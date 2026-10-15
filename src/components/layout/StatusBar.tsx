"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ageLabel } from "@/components/uncertainty/ProvenanceChip";
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

  const latest = [status?.lastMarketUpdate, status?.lastEventUpdate]
    .filter(Boolean)
    .sort()
    .pop() as string | undefined;
  const q = status?.dataQuality;
  const dot =
    q === "live" ? "bg-dq-fresh" : q === "cached" || q === "demo" || q === "proxy" ? "bg-dq-stale" : "bg-dq-insufficient";
  const qLabel = !status ? "Checking data…" : q === "live" ? "Live data" : q ? `${q[0].toUpperCase()}${q.slice(1)} data` : "Data status unknown";

  return (
    <header className="h-14 shrink-0 border-b border-line bg-surface-0/85 backdrop-blur flex items-center px-4 sm:px-6 gap-3 text-caption">
      <Link href="/" className="flex items-center gap-2 shrink-0 md:hidden">
        <BrandMark size={22} />
        <span className="font-display text-sm font-semibold text-ink">{brand.shortName}</span>
      </Link>
      <div
        className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-1 px-3 py-1 text-ink-2"
        title={
          status
            ? `Markets updated ${shortStamp(status.lastMarketUpdate)} · Events updated ${shortStamp(status.lastEventUpdate)} · ${status.marketCount} market snapshots · ${status.eventCount} events stored${sched?.lastRuns?.derive ? ` · derive ${shortStamp(sched.lastRuns.derive)}` : ""}`
            : undefined
        }
      >
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-ink">{qLabel}</span>
        {latest && (
          <span className="hidden sm:inline text-ink-3">
            · updated <span className="num">{ageLabel(latest) ?? shortStamp(latest)}</span>
          </span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {msg && <span className="text-ink-3 max-w-[16rem] truncate hidden xl:inline">{msg}</span>}
        <button
          onClick={refresh}
          disabled={busy}
          title="Fetch latest markets and events"
          className="hidden sm:inline-flex px-3 py-1.5 rounded-md border border-line text-ink-2 hover:text-ink hover:border-line-strong disabled:opacity-50 transition-colors duration-[120ms]"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
        <AccountMenu variant="status" />
      </div>
    </header>
  );
}
