import { getDb } from "../../db";

const FEED_SOURCE: Record<string, string> = {
  "Federal Reserve Press": "rss_federal_reserve",
  "ECB Press": "rss_ecb",
  "IMF News": "rss_imf",
  "Reuters Business": "rss_reuters",
  "CNBC Top News": "rss_cnbc",
};

interface LiveInstrument {
  id: string;
  symbol: string;
  name: string;
}

function normText(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

/** Ordinary English phrases that collide with coin names. Not linked by name. */
const AMBIGUOUS_NAME = new Set([
  "optimism",
  "momentum",
  "humanity",
  "lighter",
  "request",
  "the index",
  "genius",
  "people",
  "america",
]);


/**
 * Link stored live events only.
 * Name: normalized phrase with boundaries, name length >= 5.
 * Symbol: uppercase token bounded by non-alphanumerics, length >= 3,
 * and the symbol is unique among live-quoted crypto (so "BTC" does not attach to every list-only ticker).
 * Demo-quality rows are ignored.
 */
export function runRssLinks(): { httpStatus: number | null; ok: boolean; note: string; observations: number; partial: boolean } {
  const db = getDb();
  const instruments = db
    .prepare(
      `SELECT id, symbol, name FROM instruments
       WHERE asset_type = 'crypto' AND quote_status = 'live' AND price IS NOT NULL`
    )
    .all() as LiveInstrument[];

  const symbolCounts = new Map<string, number>();
  for (const row of instruments) {
    const sym = row.symbol.toUpperCase();
    if (!/^[A-Z0-9]{3,12}$/.test(sym)) continue;
    symbolCounts.set(sym, (symbolCounts.get(sym) || 0) + 1);
  }
  const otherAssetSymbols = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT upper(symbol) AS symbol FROM instruments WHERE asset_type != 'crypto' AND symbol IS NOT NULL`
        )
        .all() as { symbol: string }[]
    ).map((r) => r.symbol)
  );
  const symbolToId = new Map<string, string>();
  const byId = new Map<string, LiveInstrument>();
  for (const row of instruments) {
    byId.set(row.id, row);
    const sym = row.symbol.toUpperCase();
    if (symbolCounts.get(sym) === 1 && !otherAssetSymbols.has(sym)) symbolToId.set(sym, row.id);
  }
  const namesByToken = new Map<string, { id: string; phrase: string }[]>();
  for (const row of instruments) {
    const cleaned = row.name.trim();
    const phrase = normText(cleaned).trim();
    const words = phrase.split(" ").filter(Boolean);
    // Single dictionary-like names (bank, would, data) are not linked.
    // Multi-word names need a real phrase. Bitcoin (7) still matches.
    if (AMBIGUOUS_NAME.has(phrase)) continue;
    if (words.length >= 2) {
      if (phrase.length < 8) continue;
    } else if (phrase.length < 7) {
      continue;
    }
    const key = phrase.split(" ").find((w) => w.length >= 4) || phrase.split(" ")[0];
    if (!key) continue;
    const list = namesByToken.get(key);
    if (list) list.push({ id: row.id, phrase });
    else namesByToken.set(key, [{ id: row.id, phrase }]);
  }

  const events = db.prepare(`SELECT id, data, quality FROM events WHERE quality = 'live'`).all() as {
    id: string;
    data: string;
    quality: string;
  }[];

  const insert = db.prepare(
    `INSERT OR IGNORE INTO instrument_event_links (instrument_id, event_id, match_kind, source_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const now = new Date().toISOString();
  let links = 0;
  let considered = 0;
  const bySource: Record<string, number> = {};

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM instrument_event_links`).run();
    for (const ev of events) {
      let parsed: {
        title?: string;
        summary?: string;
        rawText?: string;
        sourceName?: string;
        classification?: { entities?: string[] };
      };
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        continue;
      }
      const sourceId = FEED_SOURCE[parsed.sourceName || ""];
      if (!sourceId) continue;
      considered += 1;
      const blob = [parsed.title, parsed.summary, parsed.rawText, ...(parsed.classification?.entities || [])]
        .filter((x): x is string => typeof x === "string")
        .join("\n");
      const normalized = normText(blob);
      // Case-sensitive uppercase tokens of length >= 4. Three-letter acronyms such as NIL are not linked.
      const tokens = new Set(
        blob.split(/[^A-Za-z0-9]+/).filter((tok) => /^[A-Z][A-Z0-9]{3,11}$/.test(tok))
      );
      const matched = new Map<string, string>();
      for (const token of Array.from(tokens)) {
        const id = symbolToId.get(token);
        if (!id || matched.has(id)) continue;
        const inst = byId.get(id);
        // Ticker equals a short coin name (GENIUS / Genius). All-caps macro text
        // would otherwise attach every occurrence. Name matching still covers
        // longer names such as Bitcoin.
        if (inst && inst.name.trim().length < 7 && inst.name.toUpperCase() === token) continue;
        matched.set(id, "symbol");
      }
      const lowerTokens = new Set(
        blob.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4)
      );
      for (const token of Array.from(lowerTokens)) {
        const candidates = namesByToken.get(token);
        if (!candidates) continue;
        for (const name of candidates) {
          if (matched.get(name.id) === "name") continue;
          if (normalized.includes(` ${name.phrase} `)) matched.set(name.id, "name");
        }
      }
      for (const [instrumentId, kind] of Array.from(matched.entries())) {
        const res = insert.run(instrumentId, ev.id, kind, sourceId, now);
        if (res.changes > 0) {
          links += 1;
          bySource[sourceId] = (bySource[sourceId] || 0) + 1;
        }
      }
    }
  });
  tx();

  const note = `No HTTP fetch. Live events considered: ${considered}. New instrument links: ${links}. By source: ${JSON.stringify(bySource)}. Demo rows excluded. Symbol match is an uppercase token, unique among live quotes. Name match requires a phrase of 8+ characters or a single name of 7+ characters.`;
  for (const id of Object.values(FEED_SOURCE)) {
    db.prepare(
      `UPDATE sources SET last_checked_at = ?, status_note = ?, last_http_status = NULL WHERE id = ?`
    ).run(now, note.slice(0, 700), id);
  }
  return { httpStatus: null, ok: true, note, observations: links, partial: false };
}
