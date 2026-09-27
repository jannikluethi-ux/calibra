import Link from "next/link";
import type { MarketSnapshot } from "@/lib/types";
import { Panel } from "../ui/Panel";
import { QualityBadge } from "../ui/Badge";
import { changeColor, fmtNum, fmtPct } from "@/lib/format";
import clsx from "clsx";

export function MarketCards({ markets }: { markets: MarketSnapshot[] }) {
  if (!markets.length) {
    return (
      <Panel title="Market Overview">
        <div className="text-terminal-amber text-xs">
          No market snapshots yet. Click <strong>Refresh data</strong> in the status bar to pull Yahoo Finance quotes.
          Until then, figures remain insufficient — nothing is invented.
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Market Overview"
      right={
        <span className="normal-case tracking-normal text-terminal-muted">
          {markets.length} instruments
        </span>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
        {markets.map((m) => (
          <Link
            key={m.symbol}
            href={`/assets/${m.symbol}`}
            className="bg-terminal-surface border border-terminal-border rounded-md p-2.5 hover:border-terminal-teal/50 hover:shadow-glow transition-all"
          >
            <div className="flex items-center justify-between gap-1">
              <div>
                <div className="text-2xs text-terminal-teal font-medium">{m.symbol}</div>
                <div className="text-2xs text-terminal-dim truncate max-w-[140px]">{m.name}</div>
              </div>
              <QualityBadge quality={m.isProxy ? "proxy" : m.provenance.quality} />
            </div>
            <div className="num text-base mt-1">
              {fmtNum(m.price, m.category === "fx" || m.category === "rates" ? 3 : 2)}
            </div>
            <div className="grid grid-cols-3 gap-1 mt-1 text-2xs">
              <div>
                <div className="text-terminal-muted">1D</div>
                <div className={clsx("num", changeColor(m.change1d))}>{fmtPct(m.change1d)}</div>
              </div>
              <div>
                <div className="text-terminal-muted">1W</div>
                <div className={clsx("num", changeColor(m.change1w))}>{fmtPct(m.change1w)}</div>
              </div>
              <div>
                <div className="text-terminal-muted">1M</div>
                <div className={clsx("num", changeColor(m.change1m))}>{fmtPct(m.change1m)}</div>
              </div>
            </div>
            <div className="text-2xs text-terminal-muted mt-1">
              vol≈{fmtNum(m.volatilityEst, 0)}%
              {m.scenarioSnippet ? ` · ${m.scenarioSnippet}` : ""}
            </div>
            {m.isProxy && m.proxyNote && (
              <div className="text-2xs text-terminal-purple mt-1 line-clamp-2">{m.proxyNote}</div>
            )}
          </Link>
        ))}
      </div>
    </Panel>
  );
}
