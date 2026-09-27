"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ProGate } from "@/components/billing/ProGate";

interface Msg {
  role: "user" | "assistant";
  content: string;
  insufficient?: boolean;
}

export default function AnalystPage() {
  const [input, setInput] = useState("What is the current global risk environment?");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);

  async function send(q?: string) {
    const question = (q ?? input).trim();
    if (!question) return;
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: question }]);
    setInput("");
    try {
      const r = await fetch("/api/analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const j = await r.json();
      setMsgs((m) => [...m, { role: "assistant", content: j.answer || "No response", insufficient: j.insufficient }]);
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { role: "assistant", content: `Error: ${e instanceof Error ? e.message : String(e)}`, insufficient: true },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProGate feature="AI Analyst" required="pro">
    <div className="space-y-3 max-w-4xl">
      <div>
        <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">AI Analyst</h1>
        <p className="text-2xs text-terminal-muted mt-0.5">
          Answers ONLY from current stored events, scenarios, markets, warnings, forecasts. Structure: Evidence → Reasoning → Scenario → Uncertainty. No fabricated citations.
        </p>
      </div>
      <Panel title="Session">
        <div className="space-y-3 min-h-[320px] max-h-[520px] overflow-y-auto mb-3">
          {!msgs.length && (
            <div className="text-xs text-terminal-dim">
              Try: &quot;What is the current global risk environment?&quot; · &quot;BTC scenario&quot; · &quot;Fed / inflation transmission&quot; · &quot;BOJ carry&quot;
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "text-terminal-accent" : "text-terminal-text"}>
              <div className="text-2xs uppercase text-terminal-muted mb-0.5 flex gap-1 items-center">
                {m.role}
                {m.insufficient && <Badge tone="amber">insufficient</Badge>}
              </div>
              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed bg-terminal-surface border border-terminal-border rounded p-2">
                {m.content}
              </pre>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && send()}
            className="flex-1 bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs outline-none focus:border-terminal-accent"
            placeholder="Ask about stored evidence…"
          />
          <button
            disabled={busy}
            onClick={() => send()}
            className="px-3 py-1.5 border border-terminal-border rounded bg-terminal-surface text-xs hover:border-terminal-accent disabled:opacity-50"
          >
            {busy ? "…" : "Ask"}
          </button>
        </div>
      </Panel>
    </div>

    </ProGate>
  );
}