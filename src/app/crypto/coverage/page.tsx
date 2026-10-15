import { computeCoverage } from "@/lib/crypto/coverage";
import { CryptoHeader } from "@/components/crypto/CryptoHeader";
import { fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function CryptoCoveragePage() {
  let c: ReturnType<typeof computeCoverage> | null = null;
  try {
    c = computeCoverage();
  } catch {
    c = null;
  }
  const rows: [string, number, string?][] = c
    ? [
        ["Indexed crypto instruments", c.indexed_crypto],
        ["With live quote", c.live_quotes],
        ["With live market cap", c.live_market_cap],
        ["BTC/ETH history points", c.historical_points_btc_eth, c.historical_note],
        ["Multi-source price", c.multi_source_price],
        ["On-chain TVL", c.on_chain_tvl_instruments],
        ["Tokenomics (non-null)", c.tokenomics_instruments_nonnull, c.tokenomics_note],
        ["Security observations", c.security_observations],
        ["Categories sourced", c.category_instruments],
        ["News links", c.news_links],
        ["Research scores", c.risk_scores],
        ["Full research profiles", c.full_research_profiles, c.full_research_note],
      ]
    : [];
  return (
    <div className="space-y-8 max-w-5xl">
      <CryptoHeader title="Coverage">
        What we actually hold for crypto, counted from stored rows. Gaps stay visible. We don&apos;t backfill or
        estimate missing coverage.
      </CryptoHeader>
      {!c ? (
        <div className="rounded-card border border-dashed border-line-strong p-5 text-sm text-ink-3">
          Coverage could not be computed from the store right now.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {rows.map(([label, n, note]) => (
              <div key={label} className="card p-4">
                <div className="micro-label text-ink-3">{label}</div>
                <div className={`mt-2 font-display text-display-l num ${n ? "text-ink" : "text-ink-3"}`}>
                  {n.toLocaleString("en-US")}
                </div>
                {note && <div className="mt-1 text-caption text-ink-3">{note}</div>}
              </div>
            ))}
          </div>
          <section>
            <h2 className="text-sm font-semibold text-ink mb-3">Sources</h2>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-caption text-ink-3 uppercase tracking-wider">
                  <tr className="border-b border-line text-left">
                    <th className="py-2.5 px-4">Source</th>
                    <th className="py-2.5 pr-3">Class</th>
                    <th className="py-2.5 pr-3 text-right">Weight</th>
                    <th className="py-2.5 pr-3">Status</th>
                    <th className="py-2.5 pr-4">Last checked</th>
                  </tr>
                </thead>
                <tbody>
                  {c.sources.map((s) => (
                    <tr key={s.id} className="border-b border-line/50">
                      <td className="py-2 px-4 text-ink">{s.name}</td>
                      <td className="py-2 pr-3 text-ink-2">{s.source_class}</td>
                      <td className="py-2 pr-3 text-right num text-ink-2">{s.reliability_weight.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-caption text-ink-2">
                        {s.enabled ? (s.last_http_status ? `HTTP ${s.last_http_status}` : "Enabled") : "Disabled"}
                        {s.status_note ? <span className="text-ink-3"> · {s.status_note}</span> : null}
                      </td>
                      <td className="py-2 pr-4 text-caption text-ink-3 num">{s.last_checked_at ? fmtTime(s.last_checked_at) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="text-caption text-ink-3 space-y-1">
            <p>{c.confidence_formula}</p>
            <p>{c.risk_bands}</p>
            <p>Computed {fmtTime(c.computed_at)}. Research coverage only. Not advice.</p>
          </section>
        </>
      )}
    </div>
  );
}
