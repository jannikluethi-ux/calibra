import Link from "next/link";
import { getDb } from "@/lib/db";
import { prepareCryptoStore } from "@/lib/sources/prepare";
import { Panel } from "@/components/ui/Panel";
import { INFO_RULE_TEXT, LIQUIDITY_RULE_TEXT, MOVE_RULE_TEXT, RISK_BAND_TEXT } from "@/lib/crypto/risk";
import { CryptoHeader } from "@/components/crypto/CryptoHeader";

export const dynamic = "force-dynamic";

export default function CryptoRiskPage({ searchParams }: { searchParams: { page?: string } }) {
  prepareCryptoStore();
  const page = Math.max(1, Number(searchParams.page || 1) || 1);
  const pageSize = 40;
  const offset = (page - 1) * pageSize;
  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM crypto_risk_assessments`).get() as { c: number }).c;
  const bands = db
    .prepare(`SELECT band, COUNT(*) AS c FROM crypto_risk_assessments GROUP BY band ORDER BY c DESC`)
    .all() as { band: string; c: number }[];
  const rows = db
    .prepare(
      `SELECT r.instrument_id, r.total, r.band, r.factors_scored, r.factors_possible, r.market_factors_scored,
              r.band_capped, r.cap_reason, r.components_json, i.symbol, i.name, i.rank
       FROM crypto_risk_assessments r
       JOIN instruments i ON i.id = r.instrument_id
       ORDER BY r.total DESC, i.name COLLATE NOCASE
       LIMIT ? OFFSET ?`
    )
    .all(pageSize, offset) as {
    instrument_id: string;
    total: number;
    band: string;
    factors_scored: number;
    factors_possible: number;
    market_factors_scored: number;
    band_capped: number;
    cap_reason: string | null;
    components_json: string;
    symbol: string;
    name: string;
    rank: number | null;
  }[];
  const highest = db
    .prepare(
      `SELECT r.total, r.band, r.factors_scored, r.components_json, i.name, i.symbol, r.instrument_id
       FROM crypto_risk_assessments r JOIN instruments i ON i.id = r.instrument_id
       ORDER BY r.total DESC LIMIT 1`
    )
    .get() as
    | { total: number; band: string; factors_scored: number; components_json: string; name: string; symbol: string; instrument_id: string }
    | undefined;
  const highCount = bands.filter((b) => b.band === "high" || b.band === "extreme").reduce((s, b) => s + b.c, 0);

  return (
    <div className="space-y-3">
      <CryptoHeader title="Higher-uncertainty assets">
          Sorted by research score among coins that have a score. The score is not a buy or sell signal and not a warning to exit a position.
          Scored coins: {total}. High or extreme under the stated bands: {highCount}.
        </CryptoHeader>
      <Panel title="How the score is built">
        <div className="text-2xs text-terminal-dim space-y-2">
          <p>{LIQUIDITY_RULE_TEXT}</p>
          <p>{MOVE_RULE_TEXT}</p>
          <p>{INFO_RULE_TEXT}</p>
          <p>{RISK_BAND_TEXT}</p>
          <p>
            Total is the average of scored components only. Tokenomics, holder concentration, security, GitHub, regulatory status, team identity, and unlocks stay Not scored (insufficient data) unless a real observation exists. They do not add points.
          </p>
          <p>Band counts: {bands.length ? bands.map((b) => `${b.band} ${b.c}`).join(", ") : "none yet"}.</p>
          {highest ? (
            <p>
              Highest stored score: {highest.total.toFixed(2)} ({highest.band}) on {highest.name} ({highest.symbol}), scored on {highest.factors_scored} of 10 factors.
            </p>
          ) : (
            <p>No scores stored yet.</p>
          )}
        </div>
      </Panel>
      <div className="overflow-x-auto border border-terminal-border rounded">
        <table className="w-full text-xs">
          <thead className="text-2xs uppercase text-terminal-muted bg-terminal-surface">
            <tr>
              <th className="text-left p-2">Asset</th>
              <th className="text-right p-2">Score</th>
              <th className="text-left p-2">Band</th>
              <th className="text-right p-2">Factors</th>
              <th className="text-right p-2">Liquidity</th>
              <th className="text-right p-2">24h move</th>
              <th className="text-right p-2">Information</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const components = JSON.parse(row.components_json) as Record<string, { score: number } | null>;
              const cell = (key: string) => (components[key] ? components[key]!.score : "Not scored");
              return (
                <tr key={row.instrument_id} className="border-t border-terminal-border">
                  <td className="p-2">
                    <Link className="text-terminal-teal" href={`/crypto/${encodeURIComponent(row.instrument_id)}`}>
                      {row.name}
                    </Link>
                    <div className="text-2xs text-terminal-muted">
                      {row.symbol} · rank {row.rank ?? "Unknown"}
                      {row.band_capped ? ` · capped: ${row.cap_reason || "thin inputs"}` : ""}
                    </div>
                  </td>
                  <td className="p-2 text-right">{row.total.toFixed(2)}</td>
                  <td className="p-2">{row.band}</td>
                  <td className="p-2 text-right">{row.factors_scored} of {row.factors_possible}</td>
                  <td className="p-2 text-right">{cell("liquidity")}</td>
                  <td className="p-2 text-right">{cell("market_behavior_24h")}</td>
                  <td className="p-2 text-right">{cell("information_risk")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3 text-xs">
        {page > 1 ? (
          <Link className="text-terminal-teal" href={`/crypto/risk?page=${page - 1}`}>Previous</Link>
        ) : (
          <span className="text-terminal-muted">Previous</span>
        )}
        <span className="text-terminal-muted">Page {page}</span>
        {offset + rows.length < total ? (
          <Link className="text-terminal-teal" href={`/crypto/risk?page=${page + 1}`}>Next</Link>
        ) : (
          <span className="text-terminal-muted">Next</span>
        )}
      </div>
    </div>
  );
}
