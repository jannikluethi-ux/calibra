"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { UpgradeBanner, DisclaimerStrip } from "@/components/billing/UpgradeBanner";
import { fmtTime } from "@/lib/format";

interface KeyMeta {
  id: string;
  keyPrefix: string;
  plan: string;
  name: string | null;
  createdAt: string;
  lastUsed: string | null;
  revoked: boolean;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<KeyMeta[]>([]);
  const [limits, setLimits] = useState<{ allowed: boolean; max: number; ratePerMinute: number } | null>(
    null
  );
  const [plan, setPlan] = useState<string>("free");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [name, setName] = useState("default");
  const [error, setError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(true);

  async function load() {
    const r = await fetch("/api/account/api-keys");
    if (r.status === 401) {
      setAuthed(false);
      return;
    }
    const j = await r.json();
    setKeys(j.keys || []);
    setLimits(j.limits || null);
    setPlan(j.plan || "free");
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    setError(null);
    setPlaintext(null);
    const r = await fetch("/api/account/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await r.json();
    if (!r.ok) {
      setError(j.error || "Failed");
      return;
    }
    setPlaintext(j.key?.plaintext || null);
    setKeys(j.keys || []);
  }

  async function revoke(id: string) {
    await fetch("/api/account/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke", id }),
    });
    await load();
  }

  if (!authed) {
    return (
      <div className="max-w-lg">
        <Panel title="API keys">
          <p className="text-xs">
            <Link href="/login" className="text-terminal-teal">
              Log in
            </Link>{" "}
            to manage API keys.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-3">
      <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">API keys</h1>
      {!limits?.allowed && (
        <UpgradeBanner feature="API keys" requiredPlan={plan === "free" ? "Pro" : "API"} />
      )}
      <Panel title="Create key">
        <p className="text-2xs text-terminal-muted mb-2">
          Plan <Badge tone="blue">{plan}</Badge>
          {limits && (
            <span className="ml-2">
              max {limits.max} · {limits.ratePerMinute} req/min
            </span>
          )}
        </p>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs"
            placeholder="Key name"
            disabled={!limits?.allowed}
          />
          <button
            onClick={create}
            disabled={!limits?.allowed}
            className="px-3 py-1.5 border border-terminal-teal text-terminal-teal rounded text-xs disabled:opacity-40"
          >
            Create
          </button>
        </div>
        {error && <p className="text-2xs text-terminal-red mt-2">{error}</p>}
        {plaintext && (
          <div className="mt-3 border border-terminal-amber/50 bg-terminal-amber/10 rounded p-2 text-2xs">
            <div className="text-terminal-amber font-medium mb-1">Copy now — shown once</div>
            <code className="break-all text-terminal-text select-all">{plaintext}</code>
          </div>
        )}
        <DisclaimerStrip />
      </Panel>

      <Panel title="Keys">
        {!keys.length ? (
          <div className="text-xs text-terminal-muted">No keys yet.</div>
        ) : (
          <ul className="space-y-2 text-xs">
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex flex-wrap items-center gap-2 border border-terminal-border rounded p-2 bg-terminal-surface"
              >
                <code className="text-terminal-teal">{k.keyPrefix}…</code>
                <Badge>{k.plan}</Badge>
                {k.revoked && <Badge tone="red">revoked</Badge>}
                <span className="text-2xs text-terminal-muted">{k.name || "unnamed"}</span>
                <span className="text-2xs text-terminal-muted num">created {fmtTime(k.createdAt)}</span>
                {k.lastUsed && (
                  <span className="text-2xs text-terminal-muted num">used {fmtTime(k.lastUsed)}</span>
                )}
                {!k.revoked && (
                  <button
                    onClick={() => revoke(k.id)}
                    className="ml-auto text-2xs px-2 py-0.5 border border-terminal-red/40 text-terminal-red rounded"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <p className="text-2xs text-terminal-muted">
        See{" "}
        <Link href="/docs/api" className="text-terminal-accent">
          /docs/api
        </Link>{" "}
        for endpoints and curl examples.
      </p>
    </div>
  );
}
