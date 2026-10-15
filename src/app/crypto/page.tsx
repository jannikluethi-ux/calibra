import { Panel } from "@/components/ui/Panel";
import { cryptoOverview } from "@/lib/crypto/overview";
import { fmtCompact, fmtPct } from "@/lib/crypto/format";
import { fmtTime } from "@/lib/format";
import { CryptoHeader } from "@/components/crypto/CryptoHeader";

export const dynamic = "force-dynamic";

export default function CryptoOverviewPage() {
  const data = cryptoOverview();
  const global = data.coingecko_global?.value as
    | {
        total_market_cap_usd?: number | null;
        total_volume_usd?: number | null;
        market_cap_percentage_btc?: number | null;
        market_cap_percentage_eth?: number | null;
      }
    | undefined;

  return (
    <div className="space-y-3 max-w-5xl">
      <CryptoHeader title="Crypto overview">
          Research view of stored crypto instruments. Figures below are not advice and are not a buy or sell signal.
          {data.coverage_note}
        </CryptoHeader>

      <div className="grid md:grid-cols-2 gap-3">
        <Panel title="Quoted-set market cap">
          <div className="text-lg text-terminal-text">{fmtCompact(data.total_market_cap_quoted)}</div>
          <p className="text-2xs text-terminal-muted mt-1">
            Sum of market_cap on {data.quoted_with_market_cap} live-quoted crypto assets. Indexed crypto: {data.indexed_crypto}. This is not the whole indexed set.
          </p>
        </Panel>
        <Panel title="Quoted-set volume">
          <div className="text-lg text-terminal-text">{fmtCompact(data.total_volume_quoted)}</div>
          <p className="text-2xs text-terminal-muted mt-1">
            Sum of volume_24h where it is non-null, across {data.quoted_with_volume} of those assets.
          </p>
        </Panel>
        <Panel title="BTC dominance, quoted set">
          <div className="text-lg text-terminal-text">
            {data.btc_dominance_quoted_pct == null ? "Not available" : `${data.btc_dominance_quoted_pct.toFixed(2)}%`}
          </div>
          <p className="text-2xs text-terminal-muted mt-1">Bitcoin market cap divided by the quoted-set sum above.</p>
        </Panel>
        <Panel title="ETH dominance, quoted set">
          <div className="text-lg text-terminal-text">
            {data.eth_dominance_quoted_pct == null ? "Not available" : `${data.eth_dominance_quoted_pct.toFixed(2)}%`}
          </div>
          <p className="text-2xs text-terminal-muted mt-1">Ethereum market cap divided by the same quoted-set sum.</p>
        </Panel>
      </div>

      <Panel title="Stablecoin cap">
        <p className="text-xs text-terminal-dim">{data.stablecoin_note}</p>
      </Panel>

      <Panel title="Regime label">
        <div className="text-lg text-terminal-text">{data.regime}</div>
        <p className="text-2xs text-terminal-dim mt-2">{data.regime_rule}</p>
        <p className="text-2xs text-terminal-muted mt-2">
          Input: {data.regime_input}. Change: {fmtPct(data.regime_change_24h_pct)}.
        </p>
      </Panel>

      <Panel title="CoinGecko global (single source)">
        {data.coingecko_global ? (
          <div className="text-xs space-y-1 text-terminal-dim">
            <p>{data.coingecko_global.label}</p>
            <p>Total market cap USD: {fmtCompact(typeof global?.total_market_cap_usd === "number" ? global.total_market_cap_usd : null)}</p>
            <p>Total volume USD: {fmtCompact(typeof global?.total_volume_usd === "number" ? global.total_volume_usd : null)}</p>
            <p>
              BTC share reported by that payload:{" "}
              {typeof global?.market_cap_percentage_btc === "number" ? `${global.market_cap_percentage_btc.toFixed(2)}%` : "Not available"}
              . ETH share:{" "}
              {typeof global?.market_cap_percentage_eth === "number" ? `${global.market_cap_percentage_eth.toFixed(2)}%` : "Not available"}.
            </p>
            <p>Retrieved: {fmtTime(data.coingecko_global.retrieved_at)}</p>
            <p>Observed: {fmtTime(data.coingecko_global.observed_at)}</p>
            <p className="break-all">Source URL: {data.coingecko_global.source_url || "Unknown"}</p>
          </div>
        ) : (
          <p className="text-xs text-terminal-dim">Insufficient data. The CoinGecko global endpoint was not stored.</p>
        )}
      </Panel>
    </div>
  );
}
