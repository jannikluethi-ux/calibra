import { getDb } from "../db";
import { ensureSourceTables } from "./schema";
import { seedSources } from "./seeds";

let ready = false;

/** Create tables and seed source rows. Does not call providers. */
export function prepareCryptoStore() {
  const db = getDb();
  if (!ready) {
    ensureSourceTables(db);
    seedSources(db);
    ready = true;
  }
  return db;
}
