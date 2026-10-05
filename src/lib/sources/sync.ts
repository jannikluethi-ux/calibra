import { getDb } from "../db";
import { recomputeCanonical } from "./consensus";
import { setSourceStatus } from "./observations";
import { prepareCryptoStore } from "./prepare";
import { ADAPTERS, DISABLED_ADAPTER_IDS, type AdapterResult } from "./registry";
import { ensureSourceTables } from "./schema";
import { seedSources } from "./seeds";
import { scoreQuotedCrypto } from "../crypto/risk";
import { writeCoverageSnapshot } from "../crypto/coverage";

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
    const result = await run();
    if (id !== "rss_events") setSourceStatus(id, result.httpStatus, result.note);
    report.adapters.push({ id, enabled: true, result });
  }
  report.canonicalFields = recomputeCanonical().fields;
  report.riskScores = scoreQuotedCrypto();
  writeCoverageSnapshot();
  return report;
}
