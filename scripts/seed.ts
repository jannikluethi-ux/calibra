/**
 * Explicit, operator-run DB init (B2.2): idempotent seed rows (countries, scenarios, forecasts,
 * default alerts, demo events if the events table is empty, dataQuality default).
 * No network access. Read-only GET routes no longer do this.
 *
 * Usage (from the app directory, writes process.cwd()/data/gfi.db):  npm run seed
 */
import { getDb } from "../src/lib/db";
import { ensureSeedData } from "../src/lib/bootstrap/refresh";

function counts() {
  const db = getDb();
  const out: Record<string, number> = {};
  for (const t of ["countries", "scenarios", "forecasts", "alerts", "events"]) {
    out[t] = (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
  }
  return out;
}

const before = counts();
ensureSeedData();
const after = counts();
console.log(JSON.stringify({ db: `${process.cwd()}/data/gfi.db`, before, after }));
