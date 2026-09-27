"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { fmtTime } from "@/lib/format";

interface SchedulerStatus {
  enabled: boolean;
  envAllowed: boolean;
  softEnabled: boolean;
  zurichNow: { label: string; isoDate: string; hour: number; minute: number };
  inFastSession: boolean;
  sessionWindow: string;
  intervals: Record<string, string>;
  lastRuns: Record<string, string | null>;
  nextDue: Record<string, string | null>;
  currentlyDue: string[];
  lastTick: string | null;
  lastSummary: {
    at?: string;
    ran?: string[];
    skipped?: string[];
    quality?: string;
    firedAlerts?: number;
    noteworthy?: boolean;
    summary?: string;
  } | null;
  lock: string | null;
  dataQuality: string | null;
  lastMarketUpdate: string | null;
  lastEventUpdate: string | null;
  noteworthyDefinition: Record<string, unknown>;
}

export default function SchedulerSettingsPage() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/scheduler/status");
      setStatus(await r.json());
    } catch (e) {
      setMsg(`Status failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function toggle(enabled: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/scheduler/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg(j.error || "Toggle failed");
        return;
      }
      setStatus(j);
      setMsg(enabled ? "Scheduler enabled" : "Scheduler soft-disabled");
    } finally {
      setBusy(false);
    }
  }

  async function tickNow() {
    setBusy(true);
    setMsg("Running scheduler tick…");
    try {
      const r = await fetch("/api/scheduler/tick", { method: "POST" });
      const j = await r.json();
      setMsg(
        `${j.noteworthy ? "⚠ NOTEWORTHY — " : ""}${j.summary || "Tick done"} (ran: ${(j.ran || []).join(", ") || "none"})`
      );
      await load();
    } catch (e) {
      setMsg(`Tick failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const jobs = ["markets-fast", "markets-slow", "events", "derive", "daily-maintenance"];

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">
          Scheduler
        </h1>
        <Link href="/account" className="text-2xs text-terminal-teal hover:underline">
          ← Account
        </Link>
      </div>

      <Panel
        title="Auto-refresh"
        right={
          <Badge tone={status?.enabled ? "green" : "amber"}>
            {status?.enabled ? "ENABLED" : "DISABLED"}
          </Badge>
        }
      >
        <p className="text-2xs text-terminal-muted mb-3 leading-relaxed">
          In-app layered schedule while the Next server is up (~60s decision loop). Jobs only run when
          due — not a full Yahoo pull every minute. Session hours use Europe/Zurich.
          Hard-disable: <code className="text-terminal-text">CALIBRA_SCHEDULER=0</code> then restart.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            disabled={busy || !status}
            onClick={() => toggle(true)}
            className="px-2.5 py-1 border border-terminal-teal/50 text-terminal-teal rounded text-2xs hover:bg-terminal-teal/10 disabled:opacity-50"
          >
            Enable
          </button>
          <button
            disabled={busy || !status}
            onClick={() => toggle(false)}
            className="px-2.5 py-1 border border-terminal-border rounded text-2xs hover:border-terminal-amber disabled:opacity-50"
          >
            Disable
          </button>
          <button
            disabled={busy}
            onClick={tickNow}
            className="px-2.5 py-1 border border-terminal-border rounded text-2xs hover:border-terminal-teal disabled:opacity-50"
          >
            {busy ? "Working…" : "Run tick now"}
          </button>
          {!status?.envAllowed && (
            <span className="text-2xs text-terminal-amber">Env hard-disabled (CALIBRA_SCHEDULER=0)</span>
          )}
        </div>
        {msg && <p className="text-2xs text-terminal-amber mt-2">{msg}</p>}
      </Panel>

      <Panel title="Clock & window">
        <div className="text-xs space-y-1">
          <div>
            Zurich now:{" "}
            <span className="num text-terminal-text">{status?.zurichNow?.label ?? "—"}</span>
          </div>
          <div>
            Fast session:{" "}
            <Badge tone={status?.inFastSession ? "green" : "neutral"}>
              {status?.inFastSession ? "IN SESSION" : "OFF-HOURS"}
            </Badge>{" "}
            <span className="text-2xs text-terminal-muted">({status?.sessionWindow})</span>
          </div>
          <div className="text-2xs text-terminal-muted">
            Last market: <span className="num text-terminal-text">{fmtTime(status?.lastMarketUpdate)}</span>
            {" · "}
            Last event: <span className="num text-terminal-text">{fmtTime(status?.lastEventUpdate)}</span>
            {" · "}
            Quality: <span className="text-terminal-text">{status?.dataQuality ?? "—"}</span>
          </div>
          <div className="text-2xs text-terminal-muted">
            Last tick: <span className="num">{fmtTime(status?.lastTick)}</span>
            {status?.lock ? ` · lock held since ${status.lock}` : ""}
          </div>
        </div>
      </Panel>

      <Panel title="Jobs">
        <div className="overflow-x-auto">
          <table className="w-full text-2xs">
            <thead>
              <tr className="text-terminal-muted text-left border-b border-terminal-border">
                <th className="py-1 pr-2">Job</th>
                <th className="py-1 pr-2">Cadence</th>
                <th className="py-1 pr-2">Last run</th>
                <th className="py-1">Next due</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j} className="border-b border-terminal-border/50">
                  <td className="py-1.5 pr-2 text-terminal-text font-medium">
                    {j}
                    {status?.currentlyDue?.includes(j) && (
                      <span className="ml-1 text-terminal-teal">● due</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-terminal-dim">{status?.intervals?.[j] ?? "—"}</td>
                  <td className="py-1.5 pr-2 num">{fmtTime(status?.lastRuns?.[j])}</td>
                  <td className="py-1.5 num">
                    {status?.nextDue?.[j] ? fmtTime(status.nextDue[j]) : "— (conditional)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {status?.lastSummary && (
        <Panel title="Last tick summary">
          <pre className="text-2xs text-terminal-dim whitespace-pre-wrap num">
            {JSON.stringify(status.lastSummary, null, 2)}
          </pre>
        </Panel>
      )}

      <Panel title="Noteworthy threshold">
        <p className="text-2xs text-terminal-muted leading-relaxed">
          A tick sets <code className="text-terminal-text">noteworthy: true</code> only when:
          (1) <code className="text-terminal-text">dataQuality</code> degrades from{" "}
          <code className="text-terminal-text">live</code>, (2) any job returns refresh errors, or
          (3) a new high-impact alert fires — metrics{" "}
          <code className="text-terminal-text">high_impact_event</code> (composite ≥ 70),{" "}
          <code className="text-terminal-text">risk_gauge</code> (≥ 70), or{" "}
          <code className="text-terminal-text">vix_level</code> (≥ 25).
        </p>
      </Panel>
    </div>
  );
}
