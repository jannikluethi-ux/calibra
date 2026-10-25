/**
 * Explicit, operator-run schema migration (Calibra 2.0 Phase 1). Brings process.cwd()/data/gfi.db to SCHEMA_VERSION
 * using the same idempotent, additive-only schema step the app runs on DB open (src/lib/db/schema.ts): CREATE ... IF
 * NOT EXISTS / additive ALTER in one BEGIN IMMEDIATE transaction, tracked by PRAGMA user_version. Never drops or
 * rewrites data, writes no rows, makes no network calls. Safe to re-run and safe to run concurrently with the app.
 *
 * Usage (from the app directory):
 *   npm run migrate          apply (creates data/gfi.db if missing), print {from, to, applied, tables}
 *   npm run migrate:check    read-only: report the version; exit 0 if current, 1 if missing/behind, 2 if newer
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SCHEMA_VERSION, getSchemaVersion } from "../src/lib/db/schema";

const file = path.join(process.cwd(), "data", "gfi.db");

function readVersion(): number | null {
  if (!fs.existsSync(file)) return null;
  const ro = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return getSchemaVersion(ro);
  } finally {
    ro.close();
  }
}

function tableNames(db: Database.Database): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]).map((r) => r.name);
}

async function main() {
  const before = readVersion();
  if (process.argv.includes("--check")) {
    const status = before === null ? "missing" : before === SCHEMA_VERSION ? "current" : before < SCHEMA_VERSION ? "behind" : "newer";
    console.log(JSON.stringify({ db: file, user_version: before, expected: SCHEMA_VERSION, status }));
    process.exit(status === "current" ? 0 : status === "newer" ? 2 : 1);
  }
  const { getDb } = await import("../src/lib/db"); // getDb() runs the schema step (src/lib/db/schema.ts)
  const db = getDb();
  const to = getSchemaVersion(db);
  console.log(JSON.stringify({ db: file, from: before ?? 0, to, expected: SCHEMA_VERSION, created: before === null, tables: tableNames(db).length }));
  if (to < SCHEMA_VERSION) process.exit(1);
}

main().catch((e) => {
  console.error(`[migrate] failed: ${(e as Error)?.message ?? e}`);
  process.exit(1);
});
