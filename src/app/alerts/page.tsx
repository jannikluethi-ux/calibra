"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { fmtTime } from "@/lib/format";
import { UpgradeBanner, DisclaimerStrip } from "@/components/billing/UpgradeBanner";
import Link from "next/link";

interface AlertRule {
  id: string;
  name: string;
  condition: string;
  assetSymbol?: string;
  threshold: number;
  metric: string;
  enabled: boolean;
  lastFiredAt?: string;
  channels?: string[];
  emailAddress?: string;
  webhookUrl?: string;
}

interface FiredAlert {
  id: string;
  ruleName: string;
  message: string;
  firedAt: string;
  channelsDelivered?: string[];
  deliveryNotes?: string[];
}

interface OutboxEntry {
  id: string;
  kind: string;
  to?: string;
  url?: string;
  subject?: string;
  body: string;
  createdAt: string;
  status: string;
  note: string;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [fired, setFired] = useState<FiredAlert[]>([]);
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [plan, setPlan] = useState<string>("free");
  const [name, setName] = useState("Custom alert");
  const [metric, setMetric] = useState("severe_down_prob");
  const [assetSymbol, setAssetSymbol] = useState("BTC");
  const [threshold, setThreshold] = useState(30);
  const [wantEmail, setWantEmail] = useState(false);
  const [wantWebhook, setWantWebhook] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canEmail = plan === "pro" || plan === "api";

  async function load() {
    const [a, me] = await Promise.all([fetch("/api/alerts"), fetch("/api/auth/me")]);
    const j = await a.json();
    setAlerts(j.alerts || []);
    setFired(j.fired || []);
    setOutbox(j.outbox || []);
    setSmtpConfigured(!!j.smtpConfigured);
    const m = await me.json();
    setPlan(m.user?.plan || "free");
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    setError(null);
    const channels = ["in_app"];
    if (wantEmail) channels.push("email");
    if (wantWebhook) channels.push("webhook");
    const r = await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        metric,
        assetSymbol,
        threshold,
        enabled: true,
        condition: metric,
        channels,
        emailAddress: wantEmail ? emailAddress : undefined,
        webhookUrl: wantWebhook ? webhookUrl : undefined,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      setError(j.error || "Failed");
      return;
    }
    await load();
  }

  async function toggle(id: string, enabled: boolean) {
    await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id, patch: { enabled } }),
    });
    await load();
  }

  async function remove(id: string) {
    await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    await load();
  }

  async function evaluate() {
    const r = await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "evaluate" }),
    });
    const j = await r.json();
    setAlerts(j.alerts || []);
    setFired(j.firedAll || []);
    setOutbox(j.outbox || []);
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <div className="micro-label text-accent">Notifications</div>
        <h1 className="mt-2 font-display text-display-l text-ink">Threshold alerts</h1>
        <p className="mt-2 text-sm text-ink-2 max-w-2xl">
          Get a notification when a scenario weight, risk gauge or observed market move crosses a level you set.
          Alerts describe what changed. They are not trading signals and don&apos;t recommend any action. In-app is
          included; email and webhook delivery are Pro.
        </p>
      </div>

      {!canEmail && (
        <UpgradeBanner feature="Email & webhook alert channels" compact />
      )}

      <Panel title="New threshold">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-terminal-bg border border-terminal-border rounded px-2 py-1.5"
            placeholder="Name"
          />
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="bg-terminal-bg border border-terminal-border rounded px-2 py-1.5"
          >
            <option value="severe_down_prob">Severe-down outcome weight % (forecast)</option>
            <option value="price_change_1d">Observed 1-day move ± %</option>
            <option value="large_move">Observed large move %</option>
            <option value="vix_level">VIX level (observed)</option>
            <option value="risk_gauge">Risk gauge score</option>
            <option value="scenario_prob">Scenario weight % (Downside scenario by default)</option>
            <option value="forecast_invalidation">Forecast assumption tested</option>
            <option value="high_impact_event">High-impact event (impact score)</option>
          </select>
          <input
            value={assetSymbol}
            onChange={(e) => setAssetSymbol(e.target.value.toUpperCase())}
            className="bg-terminal-bg border border-terminal-border rounded px-2 py-1.5"
            placeholder="Symbol / gauge id"
          />
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="bg-terminal-bg border border-terminal-border rounded px-2 py-1.5"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-2xs">
          <label className="flex items-center gap-1.5 text-terminal-dim">
            <input type="checkbox" checked disabled /> in-app (required)
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={wantEmail}
              disabled={!canEmail}
              onChange={(e) => setWantEmail(e.target.checked)}
            />
            email {!canEmail && <Badge tone="amber">Pro</Badge>}
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={wantWebhook}
              disabled={!canEmail}
              onChange={(e) => setWantWebhook(e.target.checked)}
            />
            webhook {!canEmail && <Badge tone="amber">Pro</Badge>}
          </label>
        </div>
        {wantEmail && (
          <input
            value={emailAddress}
            onChange={(e) => setEmailAddress(e.target.value)}
            className="mt-2 w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs"
            placeholder="alert recipient email"
          />
        )}
        {wantWebhook && (
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            className="mt-2 w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs"
            placeholder="https://hooks.example/…"
          />
        )}
        {error && <p className="text-2xs text-terminal-red mt-2">{error}</p>}
        <div className="flex gap-2 mt-2">
          <button
            onClick={create}
            className="px-3 py-1.5 border border-terminal-border rounded text-xs hover:border-terminal-accent"
          >
            Save threshold
          </button>
          <button
            onClick={evaluate}
            className="px-3 py-1.5 border border-terminal-accent text-terminal-accent rounded text-xs"
          >
            Check thresholds now
          </button>
        </div>
        <DisclaimerStrip />
      </Panel>

      <Panel title="Your thresholds">
        <div className="space-y-2">
          {alerts.length === 0 && <div className="text-ink-3 text-sm">No thresholds yet. Add one above.</div>}
          {alerts.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center gap-2 text-xs border border-terminal-border rounded p-2 bg-terminal-surface"
            >
              <span className="font-medium">{a.name}</span>
              <Badge>{a.metric}</Badge>
              {a.assetSymbol && <Badge tone="blue">{a.assetSymbol}</Badge>}
              <span className="num text-terminal-dim">≥ {a.threshold}</span>
              <Badge tone={a.enabled ? "green" : "neutral"}>{a.enabled ? "on" : "off"}</Badge>
              {(a.channels || ["in_app"]).map((c) => (
                <Badge key={c} tone="purple">
                  {c}
                </Badge>
              ))}
              {a.lastFiredAt && (
                <span className="text-2xs text-terminal-muted">last {fmtTime(a.lastFiredAt)}</span>
              )}
              <div className="ml-auto flex gap-1">
                <button
                  onClick={() => toggle(a.id, !a.enabled)}
                  className="text-2xs px-2 py-0.5 border border-terminal-border rounded"
                >
                  Toggle
                </button>
                <button
                  onClick={() => remove(a.id)}
                  className="text-2xs px-2 py-0.5 border border-terminal-red/40 text-terminal-red rounded"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Recent notifications">
        {fired.length ? (
          <ul className="space-y-1 text-xs">
            {fired.map((f) => (
              <li key={f.id} className="border-b border-terminal-border/50 py-1">
                <span className="text-ink font-medium">{f.ruleName}</span> — {publicMessage(f.message)}
                <span className="text-2xs text-terminal-muted num ml-2">{fmtTime(f.firedAt)}</span>
                {f.deliveryNotes?.length ? (
                  <div className="text-2xs text-terminal-muted mt-0.5">
                    {f.deliveryNotes.join(" · ")}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-ink-3 text-sm">Nothing has crossed a threshold yet.</div>
        )}
      </Panel>

      <details className="group">
        <summary className="cursor-pointer text-2xs text-terminal-muted hover:text-terminal-text">Delivery log</summary>
        <div className="mt-2">
      <Panel
        title="Delivery log"
        right={
          <Badge tone={smtpConfigured ? "green" : "amber"}>
            {smtpConfigured ? "SMTP env set" : "email delivery not configured"}
          </Badge>
        }
      >
        <p className="text-2xs text-terminal-muted mb-2">
          Recent email / webhook delivery attempts. Entries marked queued have not been sent.
        </p>
        {outbox.length ? (
          <ul className="space-y-2 text-2xs max-h-64 overflow-y-auto">
            {outbox.map((o) => (
              <li key={o.id} className="border border-terminal-border/50 rounded p-2 bg-terminal-surface">
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge tone="blue">{o.kind}</Badge>
                  <Badge>{o.status}</Badge>
                  <span className="num text-terminal-muted">{fmtTime(o.createdAt)}</span>
                </div>
                <div className="text-terminal-dim mt-1">
                  {o.to && <span>to {o.to} · </span>}
                  {o.url && <span className="break-all">url {o.url} · </span>}
                  {o.subject}
                </div>
                
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-terminal-muted text-xs">
            Outbox empty. Create a Pro email/webhook alert and evaluate to queue entries.
          </div>
        )}
        <p className="text-2xs mt-2">
          <Link href="/pricing" className="text-terminal-accent">
            Upgrade for email channel
          </Link>
        </p>
      </Panel>
        </div>
      </details>
    </div>
  );
}

/** Strip internal delivery-pipeline notes (outbox/SMTP) from user-facing alert text. */
function publicMessage(m: string): string {
  return m
    .replace(/\s*[;,|·—-]?\s*email queued to outbox[^;|]*?\(no SMTP[^)]*\)/gi, "")
    .replace(/\s*\(no SMTP[^)]*\)/gi, "")
    // Legacy stored messages: reframe as scenario-weight / threshold wording
    .replace(/severe_down prob/gi, "severe-down outcome weight")
    .replace(/\bbear prob\b/gi, "Downside scenario weight")
    .replace(/\bbull prob\b/gi, "Upside weight")
    .replace(/\b(base|tail) prob\b/gi, (_m, b: string) => `${b[0].toUpperCase()}${b.slice(1)} weight`)
    .replace(/^Scenario "Scenario set:\s*/i, 'Scenario "')
    .trim();
}
