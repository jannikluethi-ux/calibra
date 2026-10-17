import { getDb } from "../../db";
import { cryptoLinksForText } from "../../intel/store";
import { sourceIdOf } from "../../intel/assess";
import type { FinancialEvent } from "../../types";

/** Link kinds this adapter writes. Identifier-based only (Batch 3, item 21). */
export const IDENTIFIER_LINK_KINDS = ["contract_address", "coingecko_id"] as const;

/**
 * Link stored live events to crypto assets by identifier only:
 *  - an EVM contract address in the event text that matches crypto_contracts, or
 *  - an explicit CoinGecko id (coingecko.com/coins/<id> URL or "coingecko id: <id>").
 * Tickers and coin names are never used (a headline mentioning a ticker or a coin name is not a link).
 *
 * Rows of the older name/symbol kinds written before Batch 3 are left in the table as stored (not deleted),
 * but are no longer created or shown (readers filter on IDENTIFIER_LINK_KINDS).
 * Demo-quality rows are ignored.
 */
export function runRssLinks(): { httpStatus: number | null; ok: boolean; note: string; observations: number; partial: boolean } {
  const db = getDb();
  const events = db.prepare(`SELECT id, data FROM events WHERE quality = 'live'`).all() as { id: string; data: string }[];
  const insert = db.prepare(
    `INSERT OR IGNORE INTO instrument_event_links (instrument_id, event_id, match_kind, source_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const now = new Date().toISOString();
  let links = 0;
  let considered = 0;
  const bySource: Record<string, number> = {};
  const touchedSources = new Set<string>();

  const tx = db.transaction(() => {
    // Identifier links are derived from stored events and rebuilt each run; legacy name/symbol rows are kept.
    db.prepare(
      `DELETE FROM instrument_event_links WHERE match_kind IN (${IDENTIFIER_LINK_KINDS.map(() => "?").join(",")})`
    ).run(...IDENTIFIER_LINK_KINDS);
    for (const ev of events) {
      let parsed: FinancialEvent;
      try {
        parsed = JSON.parse(ev.data) as FinancialEvent;
      } catch {
        continue;
      }
      const sourceId = sourceIdOf(parsed);
      if (!sourceId) continue;
      touchedSources.add(sourceId);
      considered += 1;
      const blob = [parsed.title, parsed.summary, parsed.rawText]
        .filter((x): x is string => typeof x === "string")
        .join("\n");
      const seen = new Set<string>();
      for (const m of cryptoLinksForText(db, blob)) {
        if (!m.instrumentId || seen.has(m.instrumentId)) continue;
        seen.add(m.instrumentId);
        const res = insert.run(m.instrumentId, ev.id, m.linkBasis, sourceId, now);
        if (res.changes > 0) {
          links += 1;
          bySource[sourceId] = (bySource[sourceId] || 0) + 1;
        }
      }
    }
  });
  tx();

  const note = `No HTTP fetch. Live events considered: ${considered}. Identifier links: ${links}. By source: ${JSON.stringify(bySource)}. Links require a contract address (matched in crypto_contracts) or an explicit CoinGecko id in the text; tickers and names are not used. Demo rows excluded.`;
  for (const id of Array.from(touchedSources)) {
    db.prepare(`UPDATE sources SET last_checked_at = ?, status_note = ? WHERE id = ?`).run(now, note.slice(0, 700), id);
  }
  return { httpStatus: null, ok: true, note, observations: links, partial: false };
}
