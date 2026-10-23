import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

/** Row count + content hash of every table, for before/after "nothing was written" assertions. */
export function snapshotDb(db: Database.Database): Record<string, { rows: number; sha256: string }> {
  const out: Record<string, { rows: number; sha256: string }> = {};
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as { name: string }[];
  for (const { name } of tables) {
    const h = createHash("sha256");
    let n = 0;
    const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
    for (const row of rows) {
      h.update(JSON.stringify(row));
      n++;
    }
    out[name] = { rows: n, sha256: h.digest("hex") };
  }
  return out;
}

/** Replace global fetch with a recorder that refuses every call (tests must stay offline). */
export function blockFetch(): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input instanceof Request ? input.url : input));
    throw new Error("network disabled in tests");
  }) as typeof fetch;
  return calls;
}
