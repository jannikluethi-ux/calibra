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
        <div className="empty-state">
          No market snapshots yet. Use <strong className="font-medium text-terminal-text">Refresh data</strong> in
          the header to pull quotes. Until then, figures stay insufficient — nothing is invented.
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Market Overview"
      right={
        <span className="normal-case tracking-normal text-terminal-muted font-normal">
          {markets.length} instruments
        </span>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {markets.map((m) => (
          <Link
            key={m.symbol}
            href={`/assets/${m.symbol}`}
            className="bg-terminal-surface/80 border border-terminal-border rounded-lg p-3.5 hover:border-terminal-teal/45 hover:shadow-glow transition-all min-w-0"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold tracking-wide text-terminal-teal">{m.symbol}</div>
                <div className="text-2xs text-terminal-dim truncate">{m.name}</div>
              </div>
              <QualityBadge quality={m.isProxy ? "proxy" : m.provenance.quality} />
            </div>
            <div className="num text-xl mt-2.5 leading-none text-terminal-text">
              {fmtNum(m.price, m.category === "fx" || m.category === "rates" ? 3 : 2)}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 text-2xs">
              <div>
                <div className="text-terminal-muted">1D</div>
                <div className={clsx("num text-xs mt-0.5", changeColor(m.change1d))}>{fmtPct(m.change1d)}</div>
              </div>
              <div>
                <div className="text-terminal-muted">1W</div>
                <div className={clsx("num text-xs mt-0.5", changeColor(m.change1w))}>{fmtPct(m.change1w)}</div>
              </div>
              <div>
                <div className="text-terminal-muted">1M</div>
                <div className={clsx("num text-xs mt-0.5", changeColor(m.change1m))}>{fmtPct(m.change1m)}</div>
              </div>
            </div>
            <div className="text-2xs text-terminal-muted mt-2.5 leading-relaxed">
              vol≈{fmtNum(m.volatilityEst, 0)}%
              {m.scenarioSnippet ? ` · ${m.scenarioSnippet}` : ""}
            </div>
            {m.isProxy && m.proxyNote && (
              <div className="text-2xs text-terminal-dim mt-1.5 line-clamp-2 leading-relaxed">{m.proxyNote}</div>
            )}
          </Link>
        ))}
      </div>
    </Panel>
  );
}
