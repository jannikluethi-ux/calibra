/**
 * One-off legacy cleanup migration (B2 get-fix). See src/lib/migrations/legacy-cleanup-v1.ts.
 *
 *   npx tsx scripts/migrate-legacy-cleanup-v1.ts --db <dir>/data/gfi.db            # dry run: read-only estimate
 *   CALIBRA_LEGACY_MIGRATION=1 npx tsx scripts/migrate-legacy-cleanup-v1.ts --db <dir>/data/gfi.db --apply
 *
 * --db is mandatory (no default DB). Dry run opens the file read-only. --apply additionally needs
 * CALIBRA_LEGACY_MIGRATION=1. NOT to be run against production without a separate explicit approval and a
 * verified backup (scripts/backup-db.py).
 */
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import Database from "better-sqlite3";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dbArg = arg("--db");
if (!dbArg || !existsSync(dbArg)) {
  console.error("usage: migrate-legacy-cleanup-v1.ts --db <path>/data/gfi.db [--apply]  (an existing DB file is required)");
  process.exit(2);
}
const db = realpathSync(dbArg);
if (basename(db) !== "gfi.db" || basename(dirname(db)) !== "data") {
  console.error("--db must point at <app-dir>/data/gfi.db");
  process.exit(2);
}
const apply = process.argv.includes("--apply");

(async () => {
  // App modules resolve <cwd>/data/gfi.db when first imported, so pin cwd to the chosen DB's app dir BEFORE any
  // app import (all app imports below are dynamic). This rules out touching the DB of the invoking directory.
  process.chdir(dirname(dirname(db)));
  const { planLegacyCleanup, applyLegacyCleanup } = await import("../src/lib/migrations/legacy-cleanup-v1");
  const ro = new Database(db, { readonly: true, fileMustExist: true });
  const plan = planLegacyCleanup(ro);
  ro.close();
  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", db, plan }));
    return;
  }
  if (process.env.CALIBRA_LEGACY_MIGRATION !== "1") {
    console.error("Refusing to apply: set CALIBRA_LEGACY_MIGRATION=1 (and have a verified backup).");
    process.exit(2);
  }
  const result = await applyLegacyCleanup();
  console.log(JSON.stringify({ mode: "apply", db, plan, result }));
})();
