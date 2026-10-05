/**
 * Test J: disable the second price source, recompute BTC canonical price, re-enable.
 * Observations are not deleted.
 */
import { getDb } from "../src/lib/db";
import { recomputeCanonical } from "../src/lib/sources/consensus";
import { prepareCryptoStore } from "../src/lib/sources/prepare";

const BITCOIN = "crypto:coingecko:bitcoin";

function snapshot(label: string) {
  const db = getDb();
  const source = db.prepare(`SELECT id, enabled FROM sources WHERE id = 'coinbase'`).get();
  const canon = db
    .prepare(
      `SELECT consensus_value_json, method, confidence, n_sources, disagreement, spread, as_of, stale
       FROM canonical_fields WHERE instrument_id = ? AND field = 'price'`
    )
    .get(BITCOIN);
  const obs = db
    .prepare(
      `SELECT source_id, value_json, retrieved_at, observed_at
       FROM source_observations
       WHERE instrument_id = ? AND field = 'price'
       ORDER BY source_id, retrieved_at DESC`
    )
    .all(BITCOIN);
  const counts = db
    .prepare(
      `SELECT source_id, COUNT(*) AS c FROM source_observations
       WHERE instrument_id = ? AND field = 'price' GROUP BY source_id`
    )
    .all(BITCOIN);
  return { label, source, canon, observations: obs, counts };
}

function main() {
  prepareCryptoStore();
  const db = getDb();
  const before = snapshot("both_enabled_before");
  db.prepare(`UPDATE sources SET enabled = 0 WHERE id = 'coinbase'`).run();
  recomputeCanonical({ instrumentId: BITCOIN, field: "price" });
  const disabled = snapshot("coinbase_disabled");
  db.prepare(`UPDATE sources SET enabled = 1 WHERE id = 'coinbase'`).run();
  recomputeCanonical({ instrumentId: BITCOIN, field: "price" });
  const after = snapshot("both_enabled_after");
  const enabled = db.prepare(`SELECT enabled FROM sources WHERE id = 'coinbase'`).get() as { enabled: number };
  if (enabled.enabled !== 1) {
    throw new Error("coinbase was not re-enabled");
  }
  console.log(JSON.stringify({ before, disabled, after, coinbase_enabled_left: enabled.enabled }, null, 2));
}

main();
