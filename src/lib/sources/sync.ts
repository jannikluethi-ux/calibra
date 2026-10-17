import { getDb } from "../db";
import { recomputeCanonical } from "./consensus";
import { setSourceStatus } from "./observations";
import { prepareCryptoStore } from "./prepare";
import { ADAPTERS, DISABLED_ADAPTER_IDS, type AdapterResult } from "./registry";
import { ensureSourceTables } from "./schema";
import { seedSources } from "./seeds";
import { scoreQuotedCrypto } from "../crypto/risk";
import { writeCoverageSnapshot } from "../crypto/coverage";
import { recordAttempt, trackedSource } from "./health";

export interface SyncReport {
  adapters: { id: string; enabled: boolean; result?: AdapterResult; skipped?: string }[];
  canonicalFields: number;
  riskScores: number;
  disabledNotCalled: string[];
}

export async function runCryptoSourceSync(): Promise<SyncReport> {
  const db = getDb();
  ensureSourceTables(db);
  seedSources(db);
  prepareCryptoStore();
  const report: SyncReport = {
    adapters: [],
    canonicalFields: 0,
    riskScores: 0,
    disabledNotCalled: [...DISABLED_ADAPTER_IDS],
  };
  for (const [id, run] of Object.entries(ADAPTERS)) {
    if (id !== "rss_events") {
      const src = db.prepare(`SELECT enabled FROM sources WHERE id = ?`).get(id) as { enabled: number } | undefined;
      if (!src || src.enabled !== 1) {
        report.adapters.push({ id, enabled: false, skipped: "sources.enabled=0" });
        continue;
      }
    }
    // Isolation: an adapter that throws is recorded as unavailable and the next adapter still runs.
    const t0 = Date.now();
    let result: AdapterResult;
    try {
      result = await run();
    } catch (e) {
      result = { httpStatus: null, ok: false, note: `adapter threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300), observations: 0, partial: false };
    }
    if (id !== "rss_events") setSourceStatus(id, result.httpStatus, result.note);
    if (trackedSource(id)) {
      const rl = result.httpStatus === 429 || /429|rate.?limit|too many/i.test(result.note);
      recordAttempt(id, {
        ok: result.ok,
        errorClass: result.ok ? "ok" : rl ? "rate_limited" : "unavailable",
        httpStatus: result.httpStatus,
        latencyMs: Date.now() - t0,
        items: result.observations,
        newestObservationAt: result.ok && result.observations > 0 ? new Date().toISOString() : null,
        error: result.ok ? null : result.note,
      });
    }
    report.adapters.push({ id, enabled: true, result });
  }
  report.canonicalFields = recomputeCanonical().fields;
  report.riskScores = scoreQuotedCrypto();
  writeCoverageSnapshot();
  return report;
}
