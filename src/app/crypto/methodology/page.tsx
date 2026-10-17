import Link from "next/link";
import { CryptoHeader } from "@/components/crypto/CryptoHeader";
import { Panel } from "@/components/ui/Panel";
import { NON_ADVISORY } from "@/components/crypto/RiskBits";
import { BANDS, FACTORS, MIN_COVERAGE, MODEL_VERSION, STALE_MARKET_DATA_H, STRUCTURAL_THRESHOLD } from "@/lib/crypto/risk-v2";

export const dynamic = "force-dynamic";

const RULES: Record<string, string> = {
  market_volatility: "30-day realised volatility (annualised, ≥20 daily closes): <40%→15, <70→35, <100→55, <150→75, else 90. Fallback without history: |30d change| <10%→20, <25→40, <50→60, <100→80, else 90. Distance from ATH is context only.",
  liquidity: "Turnover (24h volume / market cap): ≥5%→10, ≥1%→30, ≥0.2%→55, ≥0.05%→75, else 90. Floors for small volume (<$100k ≥85, <$1M ≥65, <$10M ≥40); caps for deep volume (≥$1B ≤15, ≥$100M ≤30, ≥$25M ≤45).",
  market_size: "Market cap <$10M→85, <$50M→65, <$250M→45, <$1B→30, else 15.",
  dilution: "mcap/FDV (else circulating/max, else circulating/total): ≥0.9→10, ≥0.7→25, ≥0.5→45, ≥0.3→65, ≥0.15→80, else 92. Unlock schedules UNKNOWN.",
  security: "Only for assets mapped to a DefiLlama protocol via gecko_id. Incident ≤365 d→85 (65 if fully returned), 1–3 y→60. No record or unmapped→UNKNOWN (never safe).",
  stablecoin_peg: "USD stablecoins only: |price−1| <0.5%→10, <1%→30, <3%→60, <10%→85, else 95.",
  holder_concentration: "Always UNKNOWN (no free, keyless source).",
  governance: "Always UNKNOWN (not sourced).",
  regulatory: "Always UNKNOWN (no structured free source; absence is not clearance).",
  transparency: "Always UNKNOWN (not sourced).",
};

export default function CryptoMethodologyPage() {
  return (
    <div className="space-y-3 max-w-5xl">
      <CryptoHeader title="Crypto risk methodology">
        Model <code>{MODEL_VERSION}</code>. {NON_ADVISORY} Weights and thresholds are expert-designed and have not been validated against outcomes.
        Full text: <code>docs/crypto-risk-methodology.md</code>.
      </CryptoHeader>

      <Panel title="Factors, weights and rules (rendered from the model code)">
        <div className="overflow-x-auto">
          <table className="w-full text-caption" data-testid="method-factors">
            <thead className="uppercase text-ink-3"><tr><th className="p-1 text-left">Factor</th><th className="p-1 text-right">Weight</th><th className="p-1 text-left">Structural</th><th className="p-1 text-left">Rule</th></tr></thead>
            <tbody>
              {FACTORS.map((f) => (
                <tr key={f.key} className="border-t border-line align-top">
                  <td className="p-1 text-ink">{f.label}</td>
                  <td className="p-1 text-right">{f.weight.toFixed(2)}</td>
                  <td className="p-1">{f.structural ? "yes" : "no"}</td>
                  <td className="p-1 text-ink-2">{RULES[f.key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Aggregation, bands and the high-risk list">
        <ul className="list-disc pl-5 text-sm text-ink-2 space-y-1">
          <li>Score = rounded weighted mean over applicable factors that have a real input. UNKNOWN factors are excluded: they never lower (or raise) the score, and they always lower confidence.</li>
          <li>Bands: {BANDS.map((b, i) => `${b.band} ${b.min}${BANDS[i + 1] ? `–${BANDS[i + 1].min - 1}` : "–100"}`).join(", ")}. If less than {Math.round(MIN_COVERAGE * 100)}% of applicable weight is scored the band is “insufficient data”.</li>
          <li>A structural factor (liquidity, size, dilution, security, peg) scoring ≥{STRUCTURAL_THRESHOLD} makes the risk type “structural”. Volatility alone gives “volatility only” and is capped at “elevated”: price decline or volatility never puts an asset in the high-risk list.</li>
          <li>High-risk list: structural type and band high/extreme, or a structural red flag (stablecoin de-peg factor ≥60, or an un-returned security incident in the last year).</li>
        </ul>
      </Panel>

      <Panel title="Confidence (separate from the score)">
        <p className="text-sm text-ink-2">
          confidence = 100 × coverage × freshness × sources × history × identity. Freshness: ≤12 h 1, ≤{STALE_MARKET_DATA_H} h 0.8, ≤72 h 0.6, older 0.3, no timestamp 0.2.
          Sources: disagreement 0.7, ≥2 agreeing 1, single 0.85. History: realised volatility available 1, else 0.85. Identity: contract/platform list retrieved 1, else 0.9.
          Labels: high ≥70, medium ≥45, low below. Because about 43% of the weight has no free data source, confidence is usually low or medium.
        </p>
      </Panel>

      <Panel title="Evidence labels">
        <ul className="list-disc pl-5 text-sm text-ink-2 space-y-1">
          <li><b>measured</b>: observed directly by Calibra (e.g. stored daily closes, Coinbase spot price).</li>
          <li><b>reported</b>: a value reported by an aggregator (CoinGecko, DefiLlama), not independently verified.</li>
          <li><b>corroborated</b>: two or more independent sources agree.</li>
          <li><b>model-derived</b>: computed by Calibra from stored data (e.g. realised volatility, mcap/FDV).</li>
          <li><b>qualitative</b>: an analyst judgement (not used by v2 yet).</li>
          <li><b>unknown</b>: no input. Shown as UNKNOWN, never as safe.</li>
        </ul>
      </Panel>

      <Panel title="Data, update frequency and history">
        <ul className="list-disc pl-5 text-sm text-ink-2 space-y-1">
          <li>Sources (free, keyless): CoinGecko markets / coin list with platforms / category markets / daily charts; DefiLlama protocols and hacks; Coinbase spot prices (corroboration).</li>
          <li>Updated by the in-app scheduler job “crypto” about every 6 hours, paced for the CoinGecko free tier. A 429 stops CoinGecko calls for the run; at most two ~1 h retries follow. See <Link className="text-accent" href="/settings/scheduler">Scheduler</Link> and <Link className="text-accent" href="/data-quality">Data quality</Link>.</li>
          <li>Identity is by CoinGecko id and network + contract, never by ticker; shared tickers are flagged on every profile.</li>
          <li>History is append-only and versioned. Legacy research_v1 assessments are archived, not rewritten.</li>
        </ul>
      </Panel>

      <Panel title="Known weaknesses and validation">
        <ul className="list-disc pl-5 text-sm text-ink-2 space-y-1">
          <li>Expert weights, not validated. Volume is aggregated and may include wash trading; no order-book depth. Market cap relies on reported circulating supply.</li>
          <li>Security coverage only for DefiLlama-listed protocols; regulatory, holder, governance, unlock and audit data are not available from free sources.</li>
          <li>USD-stablecoin detection is a heuristic (CoinGecko stablecoins list + “USD/dollar” in the name); some asset-backed tokens may be misread as USD pegs — the evidence line shows the price used.</li>
          <li>Planned validation (needs accumulated history): event backtest against later de-pegs, exploits and top-1000 delistings; band stability; weight sensitivity; confidence calibration. No predictive performance is claimed.</li>
        </ul>
      </Panel>
    </div>
  );
}
