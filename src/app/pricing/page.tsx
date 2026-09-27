"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { BrandMark } from "@/components/brand/BrandMark";
import { PLANS, DEMO_CREDENTIALS, type PlanId } from "@/lib/billing/plans";
import { DisclaimerStrip } from "@/components/billing/UpgradeBanner";

export default function PricingPage() {
  const [plan, setPlan] = useState<PlanId | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => {
        setLoggedIn(!!j.user);
        setPlan((j.user?.plan as PlanId) || null);
      })
      .catch(() => undefined);
  }, []);

  async function demoCheckout(target: "pro" | "api") {
    setMsg(null);
    if (!loggedIn) {
      window.location.href = "/login";
      return;
    }
    const r = await fetch("/api/billing/checkout-demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: target }),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg(j.error || "Failed");
      return;
    }
    setMsg(j.message);
    setPlan(target);
  }

  const cards: PlanId[] = ["free", "pro", "api"];

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="hero-strip px-4 py-4">
        <div className="flex items-start gap-3">
          <BrandMark size={36} />
          <div>
            <h1 className="font-display text-base font-semibold">Calibra plans</h1>
            <p className="text-2xs text-terminal-dim mt-1 max-w-2xl leading-relaxed">
              Probabilistic market intelligence for institutional desks. Not investment advice — never
              buy/sell recommendations. Pricing bands below are{" "}
              <span className="text-terminal-amber">draft suggestions</span>, not market research claims.
            </p>
            {plan && (
              <div className="mt-2">
                <Badge tone="green">Your plan: {plan.toUpperCase()}</Badge>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {cards.map((id) => {
          const p = PLANS[id];
          const highlight = id === "pro";
          return (
            <section
              key={id}
              className={
                highlight
                  ? "panel overflow-hidden border-terminal-teal/50 shadow-glow"
                  : "panel overflow-hidden"
              }
            >
              <div className="panel-header">
                <span>{p.name}</span>
                {highlight && <Badge tone="green">Popular</Badge>}
              </div>
              <div className="p-3 space-y-3">
                <div>
                  <div className="font-display text-lg text-terminal-text num">
                    {p.draftPriceChfMonthly === 0
                      ? "CHF 0"
                      : `CHF ${p.draftPriceChfMonthly}`}
                    {p.draftPriceChfMonthly ? (
                      <span className="text-2xs text-terminal-muted font-sans"> / mo</span>
                    ) : null}
                  </div>
                  <div className="text-2xs text-terminal-amber mt-0.5">{p.draftPriceNote}</div>
                  <p className="text-2xs text-terminal-dim mt-2">{p.tagline}</p>
                </div>
                <ul className="space-y-1 text-2xs text-terminal-text">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-1.5">
                      <span className="text-terminal-teal">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {id === "free" ? (
                  <Link
                    href={loggedIn ? "/account" : "/signup"}
                    className="block text-center px-3 py-2 rounded border border-terminal-border text-xs hover:border-terminal-teal"
                  >
                    {loggedIn ? "Go to account" : "Start Free"}
                  </Link>
                ) : (
                  <button
                    onClick={() => demoCheckout(id)}
                    className="w-full px-3 py-2 rounded border border-terminal-teal text-terminal-teal text-xs hover:bg-terminal-teal/10"
                  >
                    Start {p.name} (demo)
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {msg && (
        <Panel title="Checkout">
          <p className="text-xs text-terminal-amber">{msg}</p>
        </Panel>
      )}

      <Panel title="Local demo credentials">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-2xs font-mono">
          {DEMO_CREDENTIALS.map((d) => (
            <div key={d.email} className="border border-terminal-border rounded p-2 bg-terminal-surface">
              <div>{d.email}</div>
              <div className="text-terminal-muted">{d.password}</div>
              <Badge tone="blue">{d.plan}</Badge>
            </div>
          ))}
        </div>
        <p className="text-2xs text-terminal-muted mt-2">
          <Link href="/login" className="text-terminal-accent">
            Log in
          </Link>{" "}
          ·{" "}
          <Link href="/methodology" className="text-terminal-accent">
            Methodology & track record
          </Link>{" "}
          ·{" "}
          <Link href="/docs/api" className="text-terminal-accent">
            API docs
          </Link>
        </p>
        <DisclaimerStrip />
      </Panel>
    </div>
  );
}
