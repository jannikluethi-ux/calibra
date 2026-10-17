import Link from "next/link";
import { CryptoHeader } from "@/components/crypto/CryptoHeader";
import { Panel } from "@/components/ui/Panel";
import { BandBadge, ConfidenceBadge, NON_ADVISORY, RiskTypeBadge, StaleBadge } from "@/components/crypto/RiskBits";
import { parseHighRiskQuery, toQueryString, detailHref, VIEWS, SORTS, type HighRiskQuery } from "@/lib/crypto/highrisk-query";
import { listHighRisk, highRiskFacets } from "@/lib/crypto/risk-store";
import { MODEL_VERSION } from "@/lib/crypto/risk-v2";
import { fmtCompact } from "@/lib/crypto/format";
import { fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const VIEW_TEXT: Record<HighRiskQuery["view"], string> = {
  high: "High risk (structural)",
  structural: "Any structural flag",
  volatility: "Volatility only (not structural)",
  all: "All scored assets",
  insufficient: "Insufficient data",
};
const SORT_TEXT: Record<HighRiskQuery["sort"], string> = {
  score: "Risk score",
  confidence: "Confidence",
  market_cap: "Market cap",
  volume: "24h volume",
  name: "Name",
  updated: "Data as of",
};

export default function HighRiskPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const q = parseHighRiskQuery(searchParams);
  const facets = highRiskFacets();
  const list = listHighRisk(q);
  const viewCount = (v: HighRiskQuery["view"]) => {
    const by = Object.fromEntries(facets.views.map((x) => [x.risk_type, x.c]));
    if (v === "high") return facets.highRisk;
    if (v === "structural") return by.structural ?? 0;
    if (v === "volatility") return by.volatility_only ?? 0;
    if (v === "insufficient") return by.insufficient_data ?? 0;
    return facets.total;
  };
  const link = (o: Partial<HighRiskQuery>) => {
    const s = toQueryString(q, { page: 1, ...o });
    return s ? `/crypto/high-risk?${s}` : "/crypto/high-risk";
  };
  const active = [q.q && "search", q.band.length && "band", q.factor && "factor", q.category && "category", q.network && "network", q.conf && "confidence", q.fresh && "freshness"].filter(Boolean);

  return (
    <div className="space-y-3">
      <CryptoHeader title="High-risk crypto assets">
        Assets whose transparent multi-factor score ({MODEL_VERSION}) is high or extreme because of a <em>structural</em> factor (thin liquidity, small size,
        dilution, a mapped security incident or a stablecoin de-peg), or that carry a structural red flag. High volatility or a price decline alone never puts an asset here.
        Unknown factors lower confidence, never the score, and are never treated as safe. {NON_ADVISORY}{" "}
        <Link href="/crypto/methodology" className="text-accent">Methodology</Link>.
      </CryptoHeader>

      {facets.total === 0 ? (
        <div className="empty-state" data-testid="hr-empty">No v2 risk scores are stored yet. They are computed by the scheduled crypto job (about every 6 hours).</div>
      ) : (
        <>
          <nav aria-label="Risk views" className="flex flex-wrap gap-2" data-testid="hr-views">
            {VIEWS.map((v) => (
              <Link key={v} href={link({ view: v })} aria-current={q.view === v ? "page" : undefined}
                className={q.view === v ? "btn-accent" : "btn-secondary"}>
                {VIEW_TEXT[v]} <span className="ml-1 text-ink-3">{viewCount(v)}</span>
              </Link>
            ))}
          </nav>

          <Panel title="Filter, sort and search">
            <form method="get" action="/crypto/high-risk" className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="hr-filters">
              <input type="hidden" name="view" value={q.view} />
              <label className="col-span-2 text-caption text-ink-3">Search (name, exact ticker, CoinGecko id or contract)
                <input name="q" defaultValue={q.q} className="form-control mt-1" placeholder="e.g. tether, 0x…, solana" />
              </label>
              <label className="text-caption text-ink-3">Band
                <select name="band" defaultValue={q.band.join(",")} className="form-control mt-1">
                  <option value="">Any</option>
                  {facets.bands.map((b) => <option key={b.band} value={b.band}>{b.band} ({b.c})</option>)}
                </select>
              </label>
              {facets.factors.length > 0 && (
                <label className="text-caption text-ink-3">Structural factor
                  <select name="factor" defaultValue={q.factor ?? ""} className="form-control mt-1">
                    <option value="">Any</option>
                    {facets.factors.map((f) => <option key={f.v} value={f.v}>{f.label} ({f.c})</option>)}
                  </select>
                </label>
              )}
              {facets.categories.length > 0 && (
                <label className="text-caption text-ink-3">Category (top-250 lists)
                  <select name="category" defaultValue={q.category ?? ""} className="form-control mt-1">
                    <option value="">Any</option>
                    {facets.categories.map((c) => <option key={c.v} value={c.v}>{c.v} ({c.c})</option>)}
                  </select>
                </label>
              )}
              {facets.networks.length > 0 && (
                <label className="text-caption text-ink-3">Network (contract on)
                  <select name="network" defaultValue={q.network ?? ""} className="form-control mt-1">
                    <option value="">Any</option>
                    {facets.networks.map((n) => <option key={n.v} value={n.v}>{n.v} ({n.c})</option>)}
                  </select>
                </label>
              )}
              <label className="text-caption text-ink-3">Minimum confidence
                <select name="conf" defaultValue={q.conf ?? ""} className="form-control mt-1">
                  <option value="">Any</option>
                  <option value="medium">medium or high</option>
                  <option value="high">high</option>
                </select>
              </label>
              <label className="text-caption text-ink-3">Data freshness
                <select name="fresh" defaultValue={q.fresh ?? ""} className="form-control mt-1">
                  <option value="">Any</option>
                  <option value="fresh">fresh (≤36 h)</option>
                  <option value="stale">stale (&gt;36 h or unknown)</option>
                </select>
              </label>
              <label className="text-caption text-ink-3">Sort
                <select name="sort" defaultValue={q.sort} className="form-control mt-1">
                  {SORTS.map((s) => <option key={s} value={s}>{SORT_TEXT[s]}</option>)}
                </select>
              </label>
              <label className="text-caption text-ink-3">Direction
                <select name="dir" defaultValue={q.dir} className="form-control mt-1">
                  <option value="desc">descending</option>
                  <option value="asc">ascending</option>
                </select>
              </label>
              <div className="col-span-2 flex items-end gap-2 md:col-span-4">
                <button type="submit" className="btn-accent">Apply</button>
                <Link href={link({ q: "", band: [], factor: null, category: null, network: null, conf: null, fresh: null, sort: "score", dir: "desc" })} className="btn-secondary">Clear filters</Link>
                <span className="text-caption text-ink-3">
                  {list.total} match{list.total === 1 ? "" : "es"}{active.length ? ` · filters: ${active.join(", ")}` : ""} · scored {fmtTime(facets.lastScored)}
                </span>
              </div>
            </form>
            {facets.categories.length === 0 && <p className="mt-2 text-caption text-ink-3">Category and network filters appear once category and contract data has been retrieved; they are not offered without data.</p>}
          </Panel>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm" data-testid="hr-table">
              <thead className="text-caption uppercase text-ink-3">
                <tr>
                  <th className="p-2 text-left">Asset</th>
                  <th className="p-2 text-left">Score</th>
                  <th className="p-2 text-left">Type · confidence</th>
                  <th className="p-2 text-left">Why</th>
                  <th className="p-2 text-right">Market cap</th>
                  <th className="p-2 text-left">Data as of</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.length === 0 ? (
                  <tr><td colSpan={6} className="p-3 text-ink-3">No assets match these filters.</td></tr>
                ) : (
                  list.rows.map((r) => (
                    <tr key={r.instrument_id} className="border-t border-line align-top" data-testid="hr-row">
                      <td className="p-2">
                        <Link className="text-accent" href={detailHref(r.instrument_id, q)}>
                          {r.name}
                        </Link>
                        <div className="text-caption text-ink-3">
                          {r.symbol.toUpperCase()} · id {r.provider_id}
                          {r.symbol_collisions > 0 && <span className="ml-1 badge border-dq-stale/60 text-dq-stale" title="Ticker is not unique; identity is by CoinGecko id">ticker shared ×{r.symbol_collisions + 1}</span>}
                        </div>
                      </td>
                      <td className="p-2 whitespace-nowrap"><span className="text-ink">{r.score ?? "—"}</span> <BandBadge band={r.band} /></td>
                      <td className="p-2 space-y-1"><div><RiskTypeBadge type={r.risk_type} /></div><div><ConfidenceBadge value={r.confidence} label={r.confidence_label} /></div></td>
                      <td className="p-2 text-caption text-ink-2 max-w-md">
                        <ul className="list-disc pl-4 space-y-0.5">
                          {r.reasons.slice(0, 3).map((x, i) => <li key={i}>{x}</li>)}
                        </ul>
                      </td>
                      <td className="p-2 text-right whitespace-nowrap">{fmtCompact(r.market_cap)}</td>
                      <td className="p-2 text-caption whitespace-nowrap">{fmtTime(r.market_data_at)} <StaleBadge stale={r.stale} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm" data-testid="hr-pager">
            <span className="text-ink-3">Page {list.page} of {list.pages}</span>
            <div className="flex gap-2">
              {list.page > 1 && <Link className="btn-secondary" href={link({ page: list.page - 1 })}>Previous</Link>}
              {list.page < list.pages && <Link className="btn-secondary" href={link({ page: list.page + 1 })}>Next</Link>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
