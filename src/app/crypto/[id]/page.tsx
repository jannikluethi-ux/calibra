import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { getResearch } from "@/lib/crypto/research";
import { fmtCompact, fmtPct, fmtPrice } from "@/lib/crypto/format";
import { fmtTime } from "@/lib/format";
import { INFO_RULE_TEXT, LIQUIDITY_RULE_TEXT, MOVE_RULE_TEXT, RISK_FACTORS } from "@/lib/crypto/risk";

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-terminal-border py-1.5 flex justify-between gap-4 text-xs">
      <span className="text-terminal-muted">{label}</span>
      <span className="text-right text-terminal-text">{value}</span>
    </div>
  );
}

export default function CryptoResearchPage({ params }: { params: { id: string } }) {
  const data = getResearch(params.id);
  if (!data.found || !data.instrument) notFound();
  const inst = data.instrument;
  const price = data.canonical?.price as
    | {
        value: number | null;
        method: string;
        confidence: number | null;
        n_sources: number;
        disagreement: number;
        spread: number | null;
        as_of: string | null;
        stale: boolean;
        freshness: string;
        newest_retrieved_at: string | null;
      }
    | undefined;
  const components = (data.risk?.components || null) as Record<string, { score: number; detail: string } | null> | null;

  return (
    <div className="space-y-3 max-w-4xl">
      <div>
        <h1 className="text-sm font-semibold text-terminal-text">
          {inst.name} <span className="text-terminal-muted">{inst.symbol}</span>
        </h1>
        <p className="text-2xs text-terminal-muted mt-1">
          {data.tier_text}. Rank {inst.rank ?? "Unknown"}. Quote {inst.quote_status}. Source row {inst.data_source}. Research only, not a buy or sell signal.
        </p>
        <p className="text-2xs text-terminal-muted break-all">Instrument id {inst.id}</p>
      </div>

      <Panel title="Price">
        {price && typeof price.value === "number" ? (
          <div className="text-xs space-y-1 text-terminal-dim">
            <p className="text-lg text-terminal-text">{fmtPrice(price.value)} USD</p>
            <p>Method {price.method}. Sources {price.n_sources}. Confidence {price.confidence == null ? "Unknown" : price.confidence.toFixed(4)}.</p>
            <p>Freshness {price.freshness}. Newest retrieved {fmtTime(price.newest_retrieved_at)}. As of {fmtTime(price.as_of)}. Stale {price.stale ? "yes" : "no"}.</p>
            <p>Disagreement {price.disagreement === 1 ? "yes" : "no"}. Spread {price.spread == null ? "Not available" : price.spread.toFixed(6)}.</p>
            <p>{data.disagreement_note}</p>
            <p className="text-2xs text-terminal-muted">{data.confidence_formula}</p>
          </div>
        ) : (
          <p className="text-xs text-terminal-dim">
            Canonical price: Not available.
            {data.price_observations.length === 0 ? " No price observations are stored." : " Observations exist but no enabled consensus was produced."}
            {data.price_observations.length === 1 ? " Only one price source is stored." : ""}
          </p>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-2xs">
            <thead className="uppercase text-terminal-muted">
              <tr>
                <th className="text-left p-1">Source</th>
                <th className="text-right p-1">Price</th>
                <th className="text-left p-1">Observed</th>
                <th className="text-left p-1">Retrieved</th>
                <th className="text-left p-1">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {data.price_observations.length === 0 ? (
                <tr><td className="p-1 text-terminal-muted" colSpan={5}>Not available</td></tr>
              ) : (
                data.price_observations.map((row) => (
                  <tr key={`${row.source_id}-${row.retrieved_at}`} className="border-t border-terminal-border">
                    <td className="p-1">
                      {row.source_name}
                      <div className="text-terminal-muted">{row.source_class}</div>
                      {row.source_url ? <div className="break-all">{row.source_url}</div> : null}
                    </td>
                    <td className="p-1 text-right">{fmtPrice(row.value)}</td>
                    <td className="p-1">{fmtTime(row.observed_at)}</td>
                    <td className="p-1">{fmtTime(row.retrieved_at)}</td>
                    <td className="p-1">{row.enabled ? "yes" : "no"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <Field label="Stored instrument price" value={inst.price == null ? "Not available" : fmtPrice(inst.price)} />
          <Field label="Instrument last updated" value={fmtTime(inst.last_updated)} />
          <Field label="Market cap" value={fmtCompact(inst.market_cap)} />
          <Field label="24h volume" value={fmtCompact(inst.volume_24h)} />
          <Field label="24h change" value={fmtPct(inst.change_24h_pct)} />
          <Field label="Circulating supply" value={inst.circulating_supply == null ? "Not available" : fmtCompact(inst.circulating_supply)} />
          <Field label="Total supply" value={inst.total_supply == null ? "Not available" : fmtCompact(inst.total_supply)} />
          <Field label="Max supply" value={inst.max_supply == null ? "Not available" : fmtCompact(inst.max_supply)} />
        </div>
      </Panel>

      <Panel title="About">
        {data.description ? (
          <div className="text-xs text-terminal-dim space-y-2">
            <p className="text-terminal-text">{data.description.label}. Claim type {data.description.claim_type}. Not a verified fact.</p>
            <p>{data.description.text}</p>
            <p>Retrieved {fmtTime(data.description.retrieved_at)}</p>
            <p className="break-all">Source URL: {data.description.source_url || "Unknown"}</p>
          </div>
        ) : data.about_status === "fetched_no_description" ? (
          <p className="text-xs text-terminal-dim">
            A CoinGecko coin payload was retrieved, but it did not include a description. No backstory is written from that gap. Other returned fields, if any, are listed under data sources as reported claims. {data.tier_text}.
          </p>
        ) : (
          <p className="text-xs text-terminal-dim">
            A research profile has not been fetched for this coin. {data.tier_text}.
          </p>
        )}
      </Panel>

      <Panel title="Not sourced">
        <ul className="text-xs text-terminal-dim space-y-1">
          {data.unsourced_sections.map((name) => (
            <li key={name}>{name.replace(/_/g, " ")}: Insufficient data</li>
          ))}
          <li>GitHub activity: Insufficient data</li>
          <li>Holder concentration: Insufficient data</li>
          <li>Unlock schedule: Insufficient data</li>
          <li>Audits: Insufficient data</li>
          <li>Founder identity: Insufficient data</li>
        </ul>
      </Panel>

      <Panel title="Research score">
        {data.risk ? (
          <div className="text-xs text-terminal-dim space-y-2">
            <p>
              Total {Number(data.risk.total).toFixed(2)}. Band {String(data.risk.band)}. Scored on {String(data.risk.factors_scored)} of {String(data.risk.factors_possible)} factors.
              {data.risk.band_capped ? ` Band capped. ${data.risk.cap_reason || ""}` : ""}
            </p>
            <p>Computed {fmtTime(String(data.risk.computed_at))}.</p>
            <p>{LIQUIDITY_RULE_TEXT}</p>
            <p>{MOVE_RULE_TEXT}</p>
            <p>{INFO_RULE_TEXT}</p>
            <table className="w-full text-2xs">
              <tbody>
                {RISK_FACTORS.map((key) => {
                  const comp = components?.[key];
                  return (
                    <tr key={key} className="border-t border-terminal-border">
                      <td className="py-1 pr-2">{key.replace(/_/g, " ")}</td>
                      <td className="py-1">{comp ? comp.score : "Not scored (insufficient data)"}</td>
                      <td className="py-1 text-terminal-muted">{comp ? comp.detail : "No observation or stored input for this factor."}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-terminal-dim">
            Not scored. The scorer runs on live-quoted crypto only. This row has quote status {inst.quote_status}.
          </p>
        )}
      </Panel>

      <Panel title="Data sources used for this coin">
        {data.observations.length === 0 ? (
          <p className="text-xs text-terminal-dim">No source observations are stored for this instrument.</p>
        ) : (
          <table className="w-full text-2xs">
            <thead className="uppercase text-terminal-muted">
              <tr>
                <th className="text-left p-1">Source</th>
                <th className="text-left p-1">Field</th>
                <th className="text-left p-1">Claim</th>
                <th className="text-left p-1">Retrieved</th>
              </tr>
            </thead>
            <tbody>
              {data.observations.slice(0, 40).map((row, i) => (
                <tr key={`${row.source_id}-${row.field}-${i}`} className="border-t border-terminal-border align-top">
                  <td className="p-1">
                    {row.source_name}
                    <div className="text-terminal-muted">{row.source_class} · {row.enabled ? "enabled" : "disabled"}</div>
                    {row.source_url ? <div className="break-all">{row.source_url}</div> : null}
                  </td>
                  <td className="p-1">{row.field}</td>
                  <td className="p-1">{row.claim_type || "Unknown"}</td>
                  <td className="p-1">{fmtTime(row.retrieved_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Related instruments">
        <p className="text-2xs text-terminal-muted mb-2">
          Other crypto rows with the same symbol or the same name. {data.related.total} found. Showing {data.related.items.length}. They are not merged into this record, and Yahoo is not chosen over CoinGecko.
        </p>
        {data.related.items.length === 0 ? (
          <p className="text-xs text-terminal-dim">None stored.</p>
        ) : (
          <ul className="text-xs space-y-1">
            {data.related.items.map((row) => (
              <li key={row.id}>
                <Link className="text-terminal-teal" href={`/instruments/${encodeURIComponent(row.id)}`}>{row.name}</Link>
                <span className="text-terminal-muted"> {row.symbol} · {row.data_source} · {row.quote_status} · {fmtPrice(row.price)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Linked news">
        <p className="text-2xs text-terminal-muted mb-2">
          {data.news_count} stored live events matched this instrument by a whole-token name or a unique live symbol. Demo events are not linked.
        </p>
        {data.news.length === 0 ? (
          <p className="text-xs text-terminal-dim">None.</p>
        ) : (
          <ul className="text-xs space-y-2">
            {data.news.map((item) => (
              <li key={item.event_id}>
                <div>{item.title}</div>
                <div className="text-2xs text-terminal-muted">
                  {item.source_name || "Unknown"} · {item.match_kind} · {fmtTime(item.published_at)}
                  {item.citation_url ? <> · <a className="text-terminal-teal" href={item.citation_url}>{item.citation_url}</a></> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
