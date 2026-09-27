import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getUniverseItem } from "@/lib/market/universe";
import { getMarketSnapshot } from "@/lib/market/fetch";
import { getEvents } from "@/lib/ingestion/rss";
import { getScenarios } from "@/lib/scenarios/engine";
import { getForecasts } from "@/lib/forecast/distributions";
import { Panel } from "@/components/ui/Panel";
import { Badge, QualityBadge } from "@/components/ui/Badge";
import { changeColor, fmtNum, fmtPct, fmtTime } from "@/lib/format";
import clsx from "clsx";

export const dynamic = "force-dynamic";

export default function AssetDetailPage({ params }: { params: { symbol: string } }) {
  ensureSeedData();
  const sym = params.symbol.toUpperCase();
  const uni = getUniverseItem(sym);
  if (!uni) notFound();
  const m = getMarketSnapshot(sym);
  const scenarios = getScenarios().filter((s) => s.affectedAssets.includes(sym));
  const forecasts = getForecasts().filter((f) => f.assetSymbol === sym).slice(0, 3);
  const events = getEvents(40).filter(
    (e) =>
      e.tags.includes(sym.toLowerCase()) ||
      e.causalChain.some((c) => c.toLowerCase().includes(sym.toLowerCase())) ||
      (sym === "BTC" && e.classification.categories.includes("crypto")) ||
      (sym === "US10Y" && e.classification.categories.includes("central_bank"))
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/assets" className="text-2xs text-terminal-accent">
          ← Assets
        </Link>
        <h1 className="text-sm font-semibold">
          {uni.symbol} — {uni.name}
        </h1>
        <Badge>{uni.category}</Badge>
        {uni.isProxy && <Badge tone="purple">PROXY</Badge>}
        <QualityBadge quality={m?.provenance.quality || "insufficient"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {[
          ["Price", fmtNum(m?.price ?? null, uni.category === "fx" || uni.category === "rates" ? 3 : 2)],
          ["1D", fmtPct(m?.change1d)],
          ["1W", fmtPct(m?.change1w)],
          ["1M", fmtPct(m?.change1m)],
          ["Vol est.", `${fmtNum(m?.volatilityEst ?? null, 0)}%`],
        ].map(([k, v], i) => (
          <div key={k} className="panel p-2">
            <div className="text-2xs text-terminal-muted">{k}</div>
            <div className={clsx("num text-base", i > 0 && i < 4 ? changeColor(m?.[["", "change1d", "change1w", "change1m"][i] as "change1d"]) : "")}>
              {v}
            </div>
          </div>
        ))}
      </div>

      <Panel title="Conditions & sensitivity">
        <ul className="text-xs text-terminal-dim space-y-1 list-disc ml-4">
          <li>
            Macro / liquidity sensitivity: {uni.category === "crypto" || uni.category === "equity_index" ? "High beta to global liquidity (interpretation)" : uni.category === "rates" ? "Direct policy / inflation channel" : uni.category === "fx" ? "Rate differentials + risk appetite" : "Mixed — see catalysts"}
          </li>
          <li>Yahoo symbol: <span className="num">{uni.yahooSymbol}</span></li>
          {uni.proxyNote && <li className="text-terminal-purple">Proxy note: {uni.proxyNote}</li>}
          <li>
            Provenance: {m?.provenance.source || "n/a"} @ {fmtTime(m?.provenance.fetchedAt)} {m?.provenance.note ? `— ${m.provenance.note}` : ""}
          </li>
        </ul>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Panel title="Active catalysts (from event store)">
          {events.length ? (
            <ul className="space-y-1 text-xs">
              {events.slice(0, 8).map((e) => (
                <li key={e.id}>
                  <QualityBadge quality={e.quality} /> {e.title}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-terminal-amber text-xs">No linked catalysts in store.</div>
          )}
        </Panel>
        <Panel title="Bull / Bear / Tail (linked scenarios)">
          {scenarios.length ? (
            scenarios.slice(0, 3).map((s) => (
              <div key={s.id} className="text-2xs mb-2 border-b border-terminal-border/50 pb-2">
                <div className="text-terminal-text">{s.title}</div>
                <div className="num text-terminal-dim">
                  Bull {s.bull.probability}% · Bear {s.bear.probability}% · Tail {s.tail.probability}%
                </div>
              </div>
            ))
          ) : (
            <div className="text-terminal-amber text-xs">Insufficient scenario links.</div>
          )}
        </Panel>
      </div>

      <Panel title="Forecast distributions">
        {forecasts.length ? (
          forecasts.map((f) => (
            <div key={f.id} className="mb-2 text-2xs">
              <div className="flex gap-1 mb-1">
                <Badge>{f.horizon}</Badge>
                {f.isSeed ? <Badge tone="purple">SEED</Badge> : <Badge tone="amber">ESTIMATE</Badge>}
              </div>
              <div className="flex flex-wrap gap-1">
                {f.distribution.map((b) => (
                  <span key={b.label} className="border border-terminal-border rounded px-1.5 py-0.5 num">
                    {b.label} {b.probability}%
                  </span>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="text-xs text-terminal-amber">No forecasts yet — refresh data.</div>
        )}
      </Panel>
    </div>
  );
}
