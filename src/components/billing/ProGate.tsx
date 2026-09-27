"use client";

import { useEffect, useState } from "react";
import { UpgradeBanner } from "./UpgradeBanner";

type PlanId = "free" | "pro" | "api";

const RANK: Record<PlanId, number> = { free: 0, pro: 1, api: 2 };

export function ProGate({
  required = "pro",
  feature,
  children,
  teaser,
}: {
  required?: PlanId;
  feature: string;
  children: React.ReactNode;
  teaser?: React.ReactNode;
}) {
  const [plan, setPlan] = useState<PlanId | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => {
        setPlan((j.user?.plan as PlanId) || "free");
        setLoaded(true);
      })
      .catch(() => {
        setPlan("free");
        setLoaded(true);
      });
  }, []);

  if (!loaded) {
    return <div className="text-2xs text-terminal-muted p-3">Checking plan…</div>;
  }

  const ok = RANK[plan || "free"] >= RANK[required];
  if (ok) return <>{children}</>;

  return (
    <div className="space-y-3">
      <UpgradeBanner feature={feature} requiredPlan={required === "api" ? "API" : "Pro"} />
      {teaser}
    </div>
  );
}
