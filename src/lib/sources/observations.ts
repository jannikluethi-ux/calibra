import { createHash, randomUUID } from "crypto";
import { getDb } from "../db";

export interface ObservationInput {
  instrumentId?: string | null;
  field: string;
  value: unknown;
  unit?: string | null;
  currency?: string | null;
  observedAt?: string | null;
  retrievedAt: string;
  sourceId: string;
  sourceUrl?: string | null;
  claimType?: string | null;
}

/** Append only. Same source+instrument+field+hash is skipped, never updated. */
export function appendObservation(input: ObservationInput): boolean {
  const valueJson = JSON.stringify(input.value);
  const instrumentId = input.instrumentId ?? null;
  const rawHash = createHash("sha256")
    .update(
      [
        input.sourceId,
        instrumentId ?? "",
        input.field,
        valueJson,
        input.observedAt ?? "",
        input.retrievedAt,
      ].join("|")
    )
    .digest("hex");
  const db = getDb();
  const dup = db
    .prepare(
      `SELECT 1 AS x FROM source_observations
       WHERE source_id = ? AND IFNULL(instrument_id, '') = ? AND field = ? AND raw_hash = ?`
    )
    .get(input.sourceId, instrumentId ?? "", input.field, rawHash) as { x: number } | undefined;
  if (dup) return false;
  db.prepare(
    `INSERT INTO source_observations (
      id, instrument_id, field, value_json, unit, currency, observed_at, retrieved_at,
      source_id, source_url, raw_hash, claim_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    instrumentId,
    input.field,
    valueJson,
    input.unit ?? null,
    input.currency ?? null,
    input.observedAt ?? null,
    input.retrievedAt,
    input.sourceId,
    input.sourceUrl ?? null,
    rawHash,
    input.claimType ?? null
  );
  return true;
}

export function setSourceStatus(id: string, status: number | null, note: string) {
  getDb()
    .prepare(
      `UPDATE sources SET last_http_status = ?, last_checked_at = ?, status_note = ? WHERE id = ?`
    )
    .run(status, new Date().toISOString(), note.slice(0, 800), id);
}
