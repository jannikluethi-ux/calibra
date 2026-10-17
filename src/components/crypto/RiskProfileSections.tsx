import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { BandBadge, BasisBadge, ConfidenceBadge, NON_ADVISORY, RiskTypeBadge, StaleBadge } from "./RiskBits";
import type { RiskProfile } from "@/lib/crypto/risk-store";
import { FACTORS, STALE_MARKET_DATA_H } from "@/lib/crypto/risk-v2";
import { fmtCompact, fmtPct, fmtPrice } from "@/lib/crypto/format";
import { fmtTime } from "@/lib/format";

function Row({ label, value, basis, asOf }: { label: string; value: React.ReactNode; basis?: string; asOf?: string | null }) {
  return (
    <tr className="border-t border-line align-top">
      <td className="py-1 pr-2 text-ink-3">{label}</td>
      <td className="py-1 pr-2 text-ink">{value}</td>
      <td className="py-1 pr-2">{basis ? <BasisBadge basis={basis} /> : null}</td>
      <td className="py-1 text-caption text-ink-3">{asOf === undefined ? "" : asOf ? fmtTime(asOf) : "—"}</td>
    </tr>
  );
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const UNKNOWN = <span className="text-ink-3">UNKNOWN</span>;
const or = (v: number | null, f: (n: number) => string) => (v == null ? UNKNOWN : f(v));

export function RiskProfileSections({ p, hasCoinbase }: { p: RiskProfile; hasCoinbase: boolean }) {
  const l = p.latest;
  const s = p.snapshot as Record<string, unknown> | null;
  const asOf = (s?.observed_at as string | null) ?? p.inputs?.marketDataAt ?? null;
  const stale = !asOf || Date.now() - Date.parse(asOf) > STALE_MARKET_DATA_H * 3600_000;
  const v2 = p.history.filter((h) => h.model_version === "crypto_risk_v2");
  const prev = v2[1];
  const missing = l ? l.factors.filter((f) => f.applicable && f.score == null) : [];

  return (
    <>
      <Panel title="Risk profile · crypto_risk_v2" right={<Link href="/crypto/methodology" className="text-accent normal-case">Methodology</Link>}>
        {!l ? (
          <p className="text-sm text-ink-2" data-testid="rp-none">Not scored by crypto_risk_v2. Only live-quoted crypto assets with a price are scored.</p>
        ) : (
          <div className="space-y-3 text-sm" data-testid="rp-summary">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-metric text-ink">{l.score ?? "—"}</span>
              <span className="text-ink-3">/ 100</span>
              <BandBadge band={l.band} />
              <RiskTypeBadge type={l.riskType} />
              <ConfidenceBadge value={l.confidence} label={l.confidenceLabel} />
              {l.highRisk && <span className="badge border-terminal-red text-terminal-red">in high-risk list</span>}
              <StaleBadge stale={stale} />
            </div>
            <p className="text-caption text-ink-3">
              Score and confidence are separate: the score summarises scored risk factors; confidence (0–100) reflects factor coverage
              {l.coverage ? ` (${Math.round(l.coverage * 100)}% of applicable weight scored)` : ""}, data freshness, number of sources, price-history depth and identity verification
              {Object.keys(l.confidenceParts).length ? ` [${Object.entries(l.confidenceParts).map(([k, v]) => `${k} ${v}`).join(", ")}]` : ""}.
              Computed {fmtTime(l.computedAt)} · market data as of {fmtTime(l.marketDataAt)}. Weights are expert-designed and not validated. {NON_ADVISORY}
            </p>
            <div>
              <div className="text-caption uppercase text-ink-3">Why</div>
              <ul className="list-disc pl-5 text-ink-2">{l.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
            {l.flags.length > 0 && (
              <div data-testid="rp-flags">
                <div className="text-caption uppercase text-ink-3">Warnings and data limitations</div>
                <ul className="list-disc pl-5 text-dq-stale">{l.flags.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </Panel>

      {l && (
        <Panel title="Risk factors and evidence">
          <div className="overflow-x-auto">
            <table className="w-full text-caption" data-testid="rp-factors">
              <thead className="uppercase text-ink-3">
                <tr><th className="p-1 text-left">Factor</th><th className="p-1 text-right">Weight</th><th className="p-1 text-right">Score</th><th className="p-1 text-left">Basis</th><th className="p-1 text-left">Evidence</th><th className="p-1 text-left">As of · source</th></tr>
              </thead>
              <tbody>
                {l.factors.map((f) => (
                  <tr key={f.key} className="border-t border-line align-top">
                    <td className="p-1 text-ink">{f.label}{f.structural ? <div className="text-ink-3">structural</div> : <div className="text-ink-3">non-structural</div>}</td>
                    <td className="p-1 text-right">{f.applicable ? f.weight.toFixed(2) : "n/a"}</td>
                    <td className="p-1 text-right text-ink">{!f.applicable ? "n/a" : f.score == null ? "UNKNOWN" : f.score}</td>
                    <td className="p-1">{f.applicable ? <BasisBadge basis={f.basis} /> : <span className="text-ink-3">not applicable</span>}</td>
                    <td className="p-1 text-ink-2"><ul className="space-y-0.5">{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></td>
                    <td className="p-1 text-ink-3">{f.asOf ? fmtTime(f.asOf) : "—"}{f.source ? <div className="break-all">{f.source}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Recent changes and risk history">
        {prev && l ? (
          <p className="text-sm text-ink-2 mb-2" data-testid="rp-change">
            Since {fmtTime(prev.computed_at)}: score {prev.score ?? "—"} → {l.score ?? "—"}, band {prev.band} → {l.band}, confidence {prev.confidence ?? "—"} → {Math.round(l.confidence)}.
          </p>
        ) : (
          <p className="text-sm text-ink-2 mb-2">No earlier crypto_risk_v2 record to compare yet. History is append-only; older model versions are kept.</p>
        )}
        <table className="w-full text-caption" data-testid="rp-history">
          <thead className="uppercase text-ink-3"><tr><th className="p-1 text-left">Computed</th><th className="p-1 text-left">Model</th><th className="p-1 text-right">Score</th><th className="p-1 text-left">Band</th><th className="p-1 text-left">Type</th><th className="p-1 text-right">Confidence</th></tr></thead>
          <tbody>
            {p.history.length === 0 ? <tr><td colSpan={6} className="p-1 text-ink-3">None stored.</td></tr> : p.history.map((h, i) => (
              <tr key={i} className="border-t border-line">
                <td className="p-1">{fmtTime(h.computed_at)}</td><td className="p-1">{h.model_version}</td>
                <td className="p-1 text-right">{h.score == null ? "—" : Math.round(h.score * 100) / 100}</td><td className="p-1">{h.band}</td>
                <td className="p-1">{h.risk_type ?? "n/a"}</td><td className="p-1 text-right">{h.confidence ?? "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-caption text-ink-3">research_v1 scores used a different, 3-factor equal-weight method and are not directly comparable.</p>
      </Panel>

      <Panel title="Identity">
        <table className="w-full text-sm" data-testid="rp-identity">
          <tbody>
            <Row label="Instrument id" value={<span className="break-all">{p.instrumentId}</span>} />
            <Row label="Networks / contracts" value={p.contracts.length ? `${p.contracts.length} recorded` : p.inputs?.platformDataKnown ? "None listed by CoinGecko (native coin or not reported)" : UNKNOWN} basis={p.contracts.length ? "reported" : "unknown"} asOf={p.contracts[0]?.retrieved_at ?? null} />
            <Row label="Categories" value={p.categories.length ? p.categories.map((c) => c.category_slug).join(", ") : <span className="text-ink-3">UNKNOWN (not in the retrieved top-250 category lists)</span>} basis={p.categories.length ? "reported" : "unknown"} asOf={p.categories[0]?.retrieved_at ?? null} />
          </tbody>
        </table>
        {p.contracts.length > 0 && (
          <table className="mt-2 w-full text-caption">
            <thead className="uppercase text-ink-3"><tr><th className="p-1 text-left">Network</th><th className="p-1 text-left">Contract address</th></tr></thead>
            <tbody>{p.contracts.map((c) => <tr key={c.network} className="border-t border-line"><td className="p-1">{c.network}</td><td className="p-1 break-all font-mono">{c.contract_address}</td></tr>)}</tbody>
          </table>
        )}
        <div className="mt-2 text-caption" data-testid="rp-collisions">
          {p.collisions.length === 0 ? (
            <span className="text-ink-3">No other stored crypto asset uses this ticker.</span>
          ) : (
            <>
              <span className="text-dq-stale">Ticker collision: {p.collisions.length} other stored asset(s) share this ticker. They are different assets; this profile is keyed by CoinGecko id, not ticker.</span>
              <ul className="mt-1 space-y-0.5">{p.collisions.map((c) => <li key={c.id}><Link className="text-accent" href={`/crypto/${encodeURIComponent(c.id)}`}>{c.name}</Link> <span className="text-ink-3">{c.symbol} · {c.quote_status} · mcap {fmtCompact(c.market_cap)} · {c.id}</span></li>)}</ul>
            </>
          )}
        </div>
      </Panel>

      <Panel title="Market and liquidity context">
        <table className="w-full text-sm" data-testid="rp-market">
          <tbody>
            <Row label="Price (USD)" value={or(num(s?.price) ?? p.inputs?.price ?? null, fmtPrice)} basis="reported" asOf={asOf} />
            <Row label="Market cap" value={or(p.inputs?.marketCap ?? null, fmtCompact)} basis={p.inputs?.marketCap ? "reported" : "unknown"} asOf={asOf} />
            <Row label="Fully diluted valuation" value={or(p.inputs?.fdv ?? null, fmtCompact)} basis={p.inputs?.fdv ? "reported" : "unknown"} asOf={asOf} />
            <Row label="24h volume" value={or(p.inputs?.volume24h ?? null, fmtCompact)} basis={p.inputs?.volume24h != null ? "reported" : "unknown"} asOf={asOf} />
            <Row label="24h high / low" value={num(s?.high_24h) != null ? `${fmtPrice(num(s?.high_24h))} / ${fmtPrice(num(s?.low_24h))}` : UNKNOWN} basis={num(s?.high_24h) != null ? "reported" : "unknown"} asOf={asOf} />
            <Row label="Change 24h / 7d / 30d" value={`${fmtPct(num(s?.change_24h_pct))} / ${fmtPct(p.inputs?.change7d ?? null)} / ${fmtPct(p.inputs?.change30d ?? null)}`} basis="reported" asOf={asOf} />
            <Row label="Market-cap change 24h" value={or(num(s?.mcap_change_24h_pct), (n) => fmtPct(n))} basis={num(s?.mcap_change_24h_pct) != null ? "reported" : "unknown"} asOf={asOf} />
            <Row label="All-time high / distance" value={num(s?.ath) != null ? `${fmtPrice(num(s?.ath))} (${fmtPct(num(s?.ath_change_pct))}${s?.ath_date ? `, ${String(s.ath_date).slice(0, 10)}` : ""})` : UNKNOWN} basis={num(s?.ath) != null ? "reported" : "unknown"} asOf={asOf} />
            <Row label="Market-cap rank" value={num(s?.rank) ?? UNKNOWN} basis={num(s?.rank) != null ? "reported" : "unknown"} asOf={asOf} />
            <Row label="Exchange availability" value={hasCoinbase ? "Coinbase spot price observed (other venues not sourced)" : <span className="text-ink-3">UNKNOWN (no exchange-listing source configured)</span>} basis={hasCoinbase ? "measured" : "unknown"} />
            <Row label="Order-book depth / slippage" value={<span className="text-ink-3">UNKNOWN (not sourced; volume is aggregated and may include wash trading)</span>} basis="unknown" />
          </tbody>
        </table>
        <p className="mt-1 text-caption text-ink-3">Source: CoinGecko /coins/markets (free, keyless). Retrieved {fmtTime((s?.retrieved_at as string | null) ?? null)}.</p>
      </Panel>

      <Panel title="Price behaviour (from stored daily closes)">
        {p.behavior.historyDays === 0 ? (
          <p className="text-sm text-ink-2" data-testid="rp-behavior-none">No daily price history stored yet. History is fetched for a few assets per run (largest first), so multi-horizon metrics appear over time. Nothing is estimated in the meantime.</p>
        ) : (
          <table className="w-full text-sm" data-testid="rp-behavior">
            <tbody>
              <Row label="Return 7d / 30d / ~90d" value={`${fmtPct(p.behavior.return7d)} / ${fmtPct(p.behavior.return30d)} / ${fmtPct(p.behavior.return90d)}`} basis="measured" />
              <Row label="Realised volatility (30d, annualised)" value={or(p.behavior.vol30d, (n) => `${n.toFixed(1)}%`)} basis={p.behavior.vol30d != null ? "measured" : "unknown"} />
              <Row label="Max drawdown (stored window)" value={or(p.behavior.maxDrawdown90d, (n) => `${n.toFixed(1)}%`)} basis={p.behavior.maxDrawdown90d != null ? "measured" : "unknown"} />
              <Row label="Correlation with BTC" value={p.behavior.corrBtc.value == null ? <span className="text-ink-3">UNKNOWN ({p.behavior.corrBtc.pairs} overlapping days; needs ≥30)</span> : `${p.behavior.corrBtc.value.toFixed(2)} (${p.behavior.corrBtc.pairs} days)`} basis={p.behavior.corrBtc.value != null ? "measured" : "unknown"} />
              <Row label="Correlation with ETH" value={p.behavior.corrEth.value == null ? <span className="text-ink-3">UNKNOWN ({p.behavior.corrEth.pairs} overlapping days; needs ≥30)</span> : `${p.behavior.corrEth.value.toFixed(2)} (${p.behavior.corrEth.pairs} days)`} basis={p.behavior.corrEth.value != null ? "measured" : "unknown"} />
              <Row label="History window" value={`${p.behavior.historyDays} daily closes, ${p.behavior.firstDay} → ${p.behavior.lastDay}`} />
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Tokenomics">
        <table className="w-full text-sm" data-testid="rp-tokenomics">
          <tbody>
            <Row label="Circulating supply" value={or(p.inputs?.circulating ?? null, fmtCompact)} basis={p.inputs?.circulating ? "reported" : "unknown"} asOf={asOf} />
            <Row label="Total supply" value={or(p.inputs?.total ?? null, fmtCompact)} basis={p.inputs?.total ? "reported" : "unknown"} asOf={asOf} />
            <Row label="Max supply" value={p.inputs?.max ? fmtCompact(p.inputs.max) : <span className="text-ink-3">UNKNOWN or uncapped (not reported)</span>} basis={p.inputs?.max ? "reported" : "unknown"} asOf={asOf} />
            <Row label="Market cap / FDV" value={p.inputs?.marketCap && p.inputs?.fdv ? `${Math.round((p.inputs.marketCap / p.inputs.fdv) * 100)}%` : UNKNOWN} basis={p.inputs?.marketCap && p.inputs?.fdv ? "model-derived" : "unknown"} />
            <Row label="Unlock / emission schedule" value={<span className="text-ink-3">UNKNOWN (no free source configured)</span>} basis="unknown" />
            <Row label="Holder concentration" value={<span className="text-ink-3">UNKNOWN (no free, keyless source configured)</span>} basis="unknown" />
          </tbody>
        </table>
      </Panel>

      <Panel title="Security and regulatory">
        <div className="text-sm text-ink-2 space-y-2" data-testid="rp-security">
          {!p.protocolMapped ? (
            <p>Security incidents: <span className="text-ink-3">UNKNOWN</span>. This asset is not mapped to a DefiLlama protocol, so the hacks database cannot be checked for it. Absence of a record is not evidence of safety. No audit source is configured.</p>
          ) : p.incidents.length === 0 ? (
            <p>Mapped to a DefiLlama protocol; no incident is recorded for it in the DefiLlama hacks database. This is not an audit and not evidence of safety.</p>
          ) : (
            <ul className="space-y-1">
              {p.incidents.map((x, i) => (
                <li key={i}>
                  <span className="text-ink">{x.name}</span> · {x.incident_date?.slice(0, 10)} · {x.classification ?? "unclassified"}{x.technique ? ` (${x.technique})` : ""} · lost {or(x.amount_usd, fmtCompact)}{x.returned_usd ? `, returned ${fmtCompact(x.returned_usd)}` : ""} <BasisBadge basis="reported" />
                  {x.source_url ? <> · <a className="text-accent break-all" href={x.source_url}>source</a></> : null}
                </li>
              ))}
            </ul>
          )}
          <p>Regulatory status: <span className="text-ink-3">UNKNOWN</span>. No structured, free regulatory-action source is configured; absence of data is not clearance.</p>
          <p>Governance (admin keys, upgradeability): <span className="text-ink-3">UNKNOWN</span>.</p>
        </div>
      </Panel>

      <Panel title="Freshness, missing information and limitations">
        <ul className="list-disc pl-5 text-sm text-ink-2 space-y-1" data-testid="rp-missing">
          <li>Market data as of {fmtTime(asOf)} {stale ? `(stale: older than ${STALE_MARKET_DATA_H} h or unknown)` : "(fresh)"}.</li>
          {missing.length > 0 && <li>Unknown factors ({missing.length}): {missing.map((f) => f.label).join(", ")}. They reduce confidence and are not counted as low risk.</li>}
          <li>Volumes, market caps and supplies are reported by an aggregator (CoinGecko) and are not independently verified.</li>
          <li>Weights and thresholds are expert-designed and have not been validated against outcomes. See the <Link className="text-accent" href="/crypto/methodology">methodology</Link>.</li>
          <li>{NON_ADVISORY}</li>
        </ul>
      </Panel>
    </>
  );
}

export const FACTOR_KEYS = FACTORS.map((f) => f.key);
