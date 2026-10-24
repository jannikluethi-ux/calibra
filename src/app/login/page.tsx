"use client";

import { useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { BrandMark } from "@/components/brand/BrandMark";
import { DEMO_CREDENTIALS } from "@/lib/billing/plans";
import { DisclaimerStrip } from "@/components/billing/UpgradeBanner";

export default function LoginPage() {
  const [email, setEmail] = useState("pro@calibra.local");
  const [password, setPassword] = useState("calibra-pro-demo");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || "Login failed");
        return;
      }
      window.location.href = "/account";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-3">
      <div className="flex items-center gap-2">
        <BrandMark size={28} />
        <h1 className="font-display text-sm font-semibold">Log in to Calibra</h1>
      </div>
      <Panel title="Session">
        <form onSubmit={submit} className="space-y-2 text-xs">
          <label className="block">
            <span className="text-terminal-dim text-2xs uppercase tracking-wider">Email</span>
            <input
              className="mt-0.5 w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </label>
          <label className="block">
            <span className="text-terminal-dim text-2xs uppercase tracking-wider">Password</span>
            <input
              className="mt-0.5 w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </label>
          {error && <div className="text-terminal-red text-2xs">{error}</div>}
          <button
            type="submit"
            disabled={busy}
            className="w-full px-3 py-2 rounded border border-terminal-teal text-terminal-teal hover:bg-terminal-teal/10 disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="text-2xs text-terminal-muted mt-3">
          No account?{" "}
          <Link href="/signup" className="text-terminal-accent">
            Sign up free
          </Link>{" "}
          ·{" "}
          <Link href="/pricing" className="text-terminal-accent">
            Pricing
          </Link>
        </p>
        <DisclaimerStrip />
      </Panel>
      <Panel title="Local demo credentials (only if provisioned: CALIBRA_DEMO_USERS=1 npm run provision:demo-users)">
        <ul className="space-y-1 text-2xs font-mono">
          {DEMO_CREDENTIALS.map((d) => (
            <li key={d.email} className="border border-terminal-border/50 rounded p-2 bg-terminal-surface">
              <button
                type="button"
                className="text-left w-full hover:text-terminal-teal"
                onClick={() => {
                  setEmail(d.email);
                  setPassword(d.password);
                }}
              >
                <div className="text-terminal-text">{d.email}</div>
                <div className="text-terminal-muted">{d.password}</div>
                <div className="text-terminal-teal uppercase mt-0.5">{d.plan}</div>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
