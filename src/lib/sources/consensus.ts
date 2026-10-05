import { getDb } from "../db";
import {
  CHANGE_24H_DISAGREEMENT_PP,
  DESCRIPTIVE_STALE_MS,
  DISAGREEMENT_THRESHOLDS,
  MARKET_FIELDS,
  MARKET_STALE_MS,
  confidenceFromSignals,
} from "./weights";

interface ObsRow {
  instrument_id: string | null;
  field: string;
  value_json: string;
  observed_at: string | null;
  retrieved_at: string;
  source_id: string;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/**
 * Recompute canonical_fields from enabled sources only.
 * Disabled sources keep their observations; they drop out of the consensus.
 * On disagreement the median (numbers) is stored with disagreement=1.
 * Original observations are not edited.
 */
export function recomputeCanonical(filter?: { instrumentId?: string; field?: string }): { fields: number } {
  const db = getDb();
  const where: string[] = ["s.enabled = 1"];
  const params: string[] = [];
  if (filter?.instrumentId) {
    where.push("o.instrument_id = ?");
    params.push(filter.instrumentId);
  }
  if (filter?.field) {
    where.push("o.field = ?");
    params.push(filter.field);
  }
  const rows = db
    .prepare(
      `SELECT o.instrument_id, o.field, o.value_json, o.observed_at, o.retrieved_at, o.source_id
       FROM source_observations o
       JOIN sources s ON s.id = o.source_id
       WHERE ${where.join(" AND ")} AND o.instrument_id IS NOT NULL
       ORDER BY o.instrument_id, o.field, o.source_id, o.retrieved_at DESC, o.id DESC`
    )
    .all(...params) as ObsRow[];

  const latest = new Map<string, ObsRow>();
  for (const row of rows) {
    const key = `${row.instrument_id}|${row.field}|${row.source_id}`;
    if (!latest.has(key)) latest.set(key, row);
  }

  const groups = new Map<string, ObsRow[]>();
  for (const row of Array.from(latest.values())) {
    const key = `${row.instrument_id}|${row.field}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const now = Date.now();
  const upsert = db.prepare(
    `INSERT INTO canonical_fields (
      instrument_id, field, consensus_value_json, method, confidence, n_sources,
      disagreement, spread, as_of, stale
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instrument_id, field) DO UPDATE SET
      consensus_value_json = excluded.consensus_value_json,
      method = excluded.method,
      confidence = excluded.confidence,
      n_sources = excluded.n_sources,
      disagreement = excluded.disagreement,
      spread = excluded.spread,
      as_of = excluded.as_of,
      stale = excluded.stale`
  );

  const touched = new Set<string>();
  const tx = db.transaction(() => {
    if (!filter?.instrumentId && !filter?.field) {
      db.prepare(`DELETE FROM canonical_fields`).run();
    } else if (filter?.instrumentId && filter?.field) {
      db.prepare(`DELETE FROM canonical_fields WHERE instrument_id = ? AND field = ?`).run(
        filter.instrumentId,
        filter.field
      );
    } else if (filter?.instrumentId) {
      db.prepare(`DELETE FROM canonical_fields WHERE instrument_id = ?`).run(filter.instrumentId);
    }
    for (const list of Array.from(groups.values())) {
      const instrumentId = list[0].instrument_id as string;
      const field = list[0].field;
      const parsed = list.map((row: ObsRow) => ({ row, value: JSON.parse(row.value_json) as unknown }));
      const nums = parsed.map((p: { row: ObsRow; value: unknown }) => asNumber(p.value));
      const allNumeric = nums.every((n: number | null) => n != null);
      let consensus: unknown = null;
      let method: "median" | "single_source" | "withheld" = "withheld";
      let disagreement = 0;
      let spread: number | null = null;
      if (allNumeric) {
        const values = nums as number[];
        if (values.length === 1) {
          consensus = values[0];
          method = "single_source";
        } else {
          consensus = median(values);
          method = "median";
          const med = consensus as number;
          if (field === "change_24h_pct") {
            const gap = Math.max(...values) - Math.min(...values);
            spread = gap;
            if (gap > CHANGE_24H_DISAGREEMENT_PP) disagreement = 1;
          } else if (med !== 0) {
            const rel = (Math.max(...values) - Math.min(...values)) / Math.abs(med);
            spread = rel;
            const threshold = DISAGREEMENT_THRESHOLDS[field] ?? 0.02;
            if (rel > threshold) disagreement = 1;
          } else if (values.some((v) => v !== 0)) {
            disagreement = 1;
            spread = null;
          }
        }
      } else {
        const texts = parsed.map((p: { row: ObsRow; value: unknown }) => JSON.stringify(p.value));
        const unique = new Set(texts);
        if (unique.size === 1) {
          consensus = parsed[0].value;
          method = "single_source";
        } else {
          consensus = null;
          method = "withheld";
          disagreement = 1;
        }
      }
      const newest = list.reduce((a: ObsRow, b: ObsRow) => (a.retrieved_at > b.retrieved_at ? a : b));
      const newestMs = new Date(newest.retrieved_at).getTime();
      const age = now - newestMs;
      const staleLimit = MARKET_FIELDS.has(field) ? MARKET_STALE_MS : DESCRIPTIVE_STALE_MS;
      const stale = Number.isFinite(age) && age > staleLimit ? 1 : 0;
      const asOf =
        list
          .map((r: ObsRow) => r.observed_at || r.retrieved_at)
          .sort()
          .at(-1) ?? newest.retrieved_at;
      const confidence = confidenceFromSignals(list.length, age, disagreement === 1);
      upsert.run(
        instrumentId,
        field,
        consensus == null ? null : JSON.stringify(consensus),
        method,
        confidence,
        list.length,
        disagreement,
        spread,
        asOf,
        stale
      );
      touched.add(`${instrumentId}|${field}`);
    }
  });
  tx();
  return { fields: touched.size };
}
