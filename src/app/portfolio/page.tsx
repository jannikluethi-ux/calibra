"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Badge, QualityBadge } from "@/components/ui/Badge";
import { ProGate } from "@/components/billing/ProGate";

interface Holding {
  symbol: string;
  weight?: number;
  quantity?: number;
  name?: string;
}

export default function PortfolioPage() {
  const [text, setText] = useState("SPX,40\nBTC,10\nGOLD,15\nUS10Y,20\nEURUSD,15");
  const [impact, setImpact] = useState<{
    rows: {
      holding: Holding;
      matchedScenarios: { title: string; branchFocus: string; sensitivity: string; evidence: string[] }[];
      marketSnapshot?: { price: number | null; change1d: number | null; quality: string };
    }[];
    disclaimer: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  function parse(t: string): Holding[] {
    return t
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [symbol, w] = line.split(/[,\s]+/);
        return { symbol: symbol.toUpperCase(), weight: w ? Number(w) : undefined };
      })
      .filter((h) => h.symbol);
  }

  async function save() {
    setBusy(true);
    try {
      const holdings = parse(text);
      const r = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings }),
      });
      const j = await r.json();
      setImpact(j.impact);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    fetch("/api/portfolio")
      .then((r) => r.json())
      .then((j) => {
        if (j.holdings?.length) {
          setText(j.holdings.map((h: Holding) => `${h.symbol},${h.weight ?? ""}`).join("\n"));
          setImpact(j.impact);
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <ProGate feature="Portfolio impact" required="pro" teaser={<p className="text-xs text-terminal-muted">Free users see this upgrade path — page is not broken.</p>}>
    <div className="space-y-3 max-w-4xl">
      <div>
        <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">Portfolio Impact</h1>
        <p className="text-2xs text-terminal-muted mt-0.5">
          Enter holdings (symbol, weight%). Maps active scenarios → exposure → sensitivity → evidence. <strong>NO buy/sell advice.</strong>
        </p>
      </div>
      <Panel title="Holdings">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          className="w-full bg-terminal-bg border border-terminal-border rounded p-2 text-xs font-mono outline-none focus:border-terminal-accent"
          placeholder={"SPX,40\nBTC,10"}
        />
        <button
          onClick={save}
          disabled={busy}
          className="mt-2 px-3 py-1.5 border border-terminal-border rounded text-xs hover:border-terminal-accent disabled:opacity-50"
        >
          {busy ? "Analyzing…" : "Save & analyze"}
        </button>
      </Panel>
      {impact && (
        <Panel title="Scenario exposure map">
          <div className="text-2xs text-terminal-amber mb-2">{impact.disclaimer}</div>
          <div className="space-y-3">
            {impact.rows.map((row) => (
              <div key={row.holding.symbol} className="border border-terminal-border rounded p-2 bg-terminal-surface">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold">{row.holding.symbol}</span>
                  {row.holding.weight != null && <Badge>w {row.holding.weight}%</Badge>}
                  {row.marketSnapshot && (
                    <>
                      <span className="num text-terminal-dim">px {row.marketSnapshot.price}</span>
                      <QualityBadge quality={row.marketSnapshot.quality} />
                    </>
                  )}
                </div>
                {row.matchedScenarios.length ? (
                  <ul className="mt-2 space-y-1 text-2xs text-terminal-dim">
                    {row.matchedScenarios.map((s, i) => (
                      <li key={i}>
                        <span className="text-terminal-text">{s.title}</span> — {s.branchFocus}. {s.sensitivity}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-2xs text-terminal-muted mt-1">No active scenario links for this symbol in store.</div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>

    </ProGate>
  );
}