import { randomUUID } from "crypto";
import { getDb } from "../db";

/**
 * Signal types a future job may insert. This pass does not scan for them
 * and does not email or show a user-facing alert.
 */
export const CRYPTO_RISK_EVENT_TYPES = [
  "price_disagreement",
  "liquidity_thin",
  "large_24h_move",
  "quote_missing",
  "information_gap",
  "canonical_stale",
] as const;

export type CryptoRiskEventType = (typeof CRYPTO_RISK_EVENT_TYPES)[number];

export function recordCryptoRiskEvent(input: {
  instrumentId?: string | null;
  eventType: CryptoRiskEventType;
  payload?: unknown;
}): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO crypto_risk_events (id, instrument_id, event_type, detected_at, payload_json, fired)
       VALUES (?, ?, ?, ?, ?, 0)`
    )
    .run(
      id,
      input.instrumentId ?? null,
      input.eventType,
      new Date().toISOString(),
      input.payload == null ? null : JSON.stringify(input.payload)
    );
  return id;
}
