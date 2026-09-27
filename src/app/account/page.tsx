"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { DisclaimerStrip } from "@/components/billing/UpgradeBanner";

interface MeResponse {
  user: { id: string; email: string; plan: string; createdAt: string } | null;
  plan?: { name: string; limits: Record<string, unknown> };
}

export default function AccountPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/auth/me");
    setMe(await r.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function demoCheckout(plan: "pro" | "api") {
    setMsg(null);
    const r = await fetch("/api/billing/checkout-demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg(j.error || "Checkout failed");
      return;
    }
    setMsg(j.message || "Upgraded");
    await load();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  if (!me) return <div className="text-xs text-terminal-muted">Loading…</div>;

  if (!me.user) {
    return (
      <div className="max-w-lg space-y-3">
        <Panel title="Account">
          <p className="text-xs text-terminal-dim">You are not logged in.</p>
          <Link href="/login" className="text-terminal-teal text-xs mt-2 inline-block">
            Log in
          </Link>
        </Panel>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-3">
      <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">Account</h1>
      <Panel title="Profile">
        <div className="text-xs space-y-1">
          <div>
            Email: <span className="text-terminal-text">{me.user.email}</span>
          </div>
          <div className="flex items-center gap-2">
            Plan: <Badge tone="blue">{me.user.plan.toUpperCase()}</Badge>
            <span className="text-2xs text-terminal-muted">{me.plan?.name}</span>
          </div>
          <div className="text-2xs text-terminal-muted num">Created {me.user.createdAt}</div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <Link href="/account/api-keys" className="px-2.5 py-1 border border-terminal-border rounded text-2xs hover:border-terminal-teal">
            API keys
          </Link>
          <Link href="/settings/scheduler" className="px-2.5 py-1 border border-terminal-border rounded text-2xs hover:border-terminal-teal">
            Scheduler
          </Link>
          <Link href="/pricing" className="px-2.5 py-1 border border-terminal-border rounded text-2xs hover:border-terminal-teal">
            Pricing
          </Link>
          <button onClick={logout} className="px-2.5 py-1 border border-terminal-red/40 text-terminal-red rounded text-2xs">
            Log out
          </button>
        </div>
        <DisclaimerStrip />
      </Panel>

      <Panel title="Demo checkout">
        <p className="text-2xs text-terminal-muted mb-2">
          DEMO CHECKOUT upgrades your plan in local SQLite. Replace with Stripe when keys exist.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => demoCheckout("pro")}
            className="px-3 py-1.5 border border-terminal-teal text-terminal-teal rounded text-xs hover:bg-terminal-teal/10"
          >
            Start Pro (demo)
          </button>
          <button
            onClick={() => demoCheckout("api")}
            className="px-3 py-1.5 border border-terminal-accent text-terminal-accent rounded text-xs hover:bg-terminal-accent/10"
          >
            Start API (demo)
          </button>
        </div>
        {msg && <p className="text-2xs text-terminal-amber mt-2">{msg}</p>}
      </Panel>
    </div>
  );
}
