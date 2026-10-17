import { Panel } from "@/components/ui/Panel";
import { fmtTime } from "@/lib/format";
import { CATEGORY_SOURCES, RISK_EVENT_CATEGORIES, latestEventFactor } from "@/lib/intel/crypto-events";

const LEVEL_CLS: Record<string, string> = {
  high: "border-terminal-red/60 text-terminal-red",
  elevated: "border-terminal-amber/60 text-terminal-amber",
  noted: "border-line text-ink-2",
};

/** Separate qualitative factor from crypto risk events (crypto_event_factor_v1). Not blended into the v2 score. */
export function EventFactorPanel({ instrumentId }: { instrumentId: string }) {
  const f = latestEventFactor(instrumentId);
  return (
    <Panel title="Risk events (separate qualitative factor)">
      <div className="text-sm text-ink-2 space-y-2" data-testid="event-factor">
        {f.latest ? (
          <p>
            <span className={`badge ${LEVEL_CLS[f.latest.level] ?? ""}`}>{f.latest.level}</span>{" "}
            {f.latest.modelVersion}, computed {fmtTime(f.latest.computedAt)}; {f.historyCount} version(s) kept. Not part of the crypto_risk_v2 score.
          </p>
        ) : (
          <p>No risk events on record for this asset. Absence of records is not evidence of safety: delisting and unlock data have no free source.</p>
        )}
        {f.latest && <ul className="list-disc pl-5">{f.latest.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        {f.events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-caption">
              <thead className="uppercase text-ink-3"><tr><th className="p-1 text-left">Category</th><th className="p-1 text-left">Date</th><th className="p-1 text-left">Linked by</th><th className="p-1 text-left">Evidence</th></tr></thead>
              <tbody>
                {f.events.map((e) => (
                  <tr key={e.id} className="border-t border-line align-top">
                    <td className="p-1">{e.category}</td>
                    <td className="p-1 whitespace-nowrap">{fmtTime(e.occurredAt)}</td>
                    <td className="p-1">{e.linkBasis}</td>
                    <td className="p-1 text-ink-2 break-words">
                      {e.category === "exploit"
                        ? `${String(e.evidence.incident ?? "")}${e.evidence.amountUsd ? `, $${Math.round(Number(e.evidence.amountUsd)).toLocaleString("en-US")} reported` : ""}${e.evidence.technique ? `, ${String(e.evidence.technique)}` : ""}`
                        : e.category === "depeg"
                          ? `Price ${String(e.evidence.price)} (${String(e.evidence.deviationPct)}% below $1, ${String(e.evidence.basis)})`
                          : JSON.stringify(e.evidence).slice(0, 160)}
                      {" · "}
                      {e.sourceUrl ? <a className="text-accent" href={e.sourceUrl} target="_blank" rel="noreferrer">{e.source}</a> : e.source}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details className="text-caption text-ink-3">
          <summary className="cursor-pointer text-accent">Category coverage</summary>
          <ul className="list-disc pl-5 mt-1">
            {RISK_EVENT_CATEGORIES.map((c) => (
              <li key={c}>
                <b>{c}</b>: {CATEGORY_SOURCES[c].source ?? "no source configured"} — {CATEGORY_SOURCES[c].note}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Panel>
  );
}
