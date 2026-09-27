import Link from "next/link";
import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { MARKET_UNIVERSE } from "@/lib/market/universe";
import { getMarketSnapshots } from "@/lib/market/fetch";
import { Panel } from "@/components/ui/Panel";
import { QualityBadge } from "@/components/ui/Badge";
import { changeColor, fmtNum, fmtPct } from "@/lib/format";
import clsx from "clsx";

export const dynamic = "force-dynamic";

export default function AssetsPage() {
  ensureSeedData();
  const snaps = getMarketSnapshots();

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">Asset Intelligence</h1>
        <p className="text-2xs text-terminal-muted mt-0.5">Major instruments with live Yahoo snapshots where available. Proxies labeled.</p>
      </div>
      <Panel title="Universe">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-2xs text-terminal-muted uppercase">
              <tr className="border-b border-terminal-border text-left">
                <th className="py-1 pr-2">Symbol</th>
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Cat</th>
                <th className="py-1 pr-2 text-right">Price</th>
                <th className="py-1 pr-2 text-right">1D</th>
                <th className="py-1 pr-2 text-right">1W</th>
                <th className="py-1 pr-2 text-right">Vol</th>
                <th className="py-1">Quality</th>
              </tr>
            </thead>
            <tbody>
              {MARKET_UNIVERSE.map((u) => {
                const m = snaps.find((s) => s.symbol === u.symbol);
                return (
                  <tr key={u.symbol} className="border-b border-terminal-border/50 hover:bg-terminal-surface">
                    <td className="py-1.5 pr-2">
                      <Link href={`/assets/${u.symbol}`} className="text-terminal-accent">
                        {u.symbol}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-2 text-terminal-dim">{u.name}</td>
                    <td className="py-1.5 pr-2 text-terminal-muted">{u.category}</td>
                    <td className="py-1.5 pr-2 text-right num">{fmtNum(m?.price ?? null)}</td>
                    <td className={clsx("py-1.5 pr-2 text-right num", changeColor(m?.change1d))}>{fmtPct(m?.change1d)}</td>
                    <td className={clsx("py-1.5 pr-2 text-right num", changeColor(m?.change1w))}>{fmtPct(m?.change1w)}</td>
                    <td className="py-1.5 pr-2 text-right num">{fmtNum(m?.volatilityEst ?? null, 0)}</td>
                    <td className="py-1.5">
                      <QualityBadge quality={u.isProxy ? "proxy" : m?.provenance.quality || "insufficient"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
