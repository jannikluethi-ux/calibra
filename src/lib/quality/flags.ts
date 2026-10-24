/**
 * Non-destructive data-quality flags. Records are never edited or deleted; a flag row marks a
 * record as invalid so reads can exclude it and an owner can decide later (approval required to delete).
 */
import { getDb } from "../db";

/** Flag market_history rows with a non-positive price (e.g. DE10Y/BUND.DE price 0 since 2026-09-26). Idempotent. */
export function flagInvalidHistoryPrices(nowIso = new Date().toISOString()): { flagged: number } {
  const r = getDb()
    .prepare(
      `INSERT OR IGNORE INTO data_quality_flags(record_table, record_id, flag, symbol, reason, flagged_at)
       SELECT 'market_history', id, 'invalid_price', symbol, 'non-positive price from source; excluded from history reads and resolution; row preserved', ?
       FROM market_history WHERE price <= 0`
    )
    .run(nowIso);
  return { flagged: r.changes };
}
