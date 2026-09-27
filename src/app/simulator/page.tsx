"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ProGate } from "@/components/billing/ProGate";

interface Result {
  label: string;
  hypothesis: string;
  effects: { sleeve: string; direction: string; mechanism: string; confidence: number }[];
  caveats: string[];
}

export default function SimulatorPage() {
  const [hypothesis, setHypothesis] = useState("Fed hikes / higher for longer surprise");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await fetch("/api/simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hypothesis }),
      });
      setResult(await r.json());
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProGate feature="What-If Simulator" required="pro">
    <div className="space-y-3 max-w-4xl">
      <div>
        <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">What-If Simulator</h1>
        <p className="text-2xs text-terminal-muted mt-0.5">
          Outputs are labeled <strong className="text-terminal-amber">HYPOTHETICAL</strong> — not forecasts. Mechanisms are stylized.
        </p>
      </div>
      <Panel title="Hypothesis">
        <textarea
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
          rows={3}
          className="w-full bg-terminal-bg border border-terminal-border rounded p-2 text-xs outline-none focus:border-terminal-accent"
        />
        <div className="flex gap-2 mt-2 flex-wrap">
          {["Fed dovish cut", "BOJ yen carry unwind", "Oil supply shock Middle East", "Hard landing recession"].map((h) => (
            <button
              key={h}
              onClick={() => setHypothesis(h)}
              className="text-2xs px-2 py-1 border border-terminal-border rounded hover:border-terminal-accent"
            >
              {h}
            </button>
          ))}
          <button
            onClick={run}
            disabled={busy}
            className="ml-auto px-3 py-1 border border-terminal-accent text-terminal-accent rounded text-xs disabled:opacity-50"
          >
            {busy ? "Running…" : "Simulate"}
          </button>
        </div>
      </Panel>
      {result && (
        <Panel
          title="Effects"
          right={
            <Badge tone="amber">{result.label}</Badge>
          }
        >
          <div className="text-2xs text-terminal-muted mb-2">Hypothesis: {result.hypothesis}</div>
          <div className="space-y-2">
            {result.effects.map((e) => (
              <div key={e.sleeve} className="border border-terminal-border rounded p-2 bg-terminal-surface text-xs">
                <div className="flex justify-between">
                  <span className="font-medium">{e.sleeve}</span>
                  <span className="text-2xs text-terminal-muted">conf {e.confidence}%</span>
                </div>
                <div className="text-terminal-text mt-0.5">{e.direction}</div>
                <div className="text-2xs text-terminal-dim mt-0.5">{e.mechanism}</div>
              </div>
            ))}
          </div>
          <ul className="mt-3 text-2xs text-terminal-amber list-disc ml-4">
            {result.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Panel>
      )}
    </div>

    </ProGate>
  );
}