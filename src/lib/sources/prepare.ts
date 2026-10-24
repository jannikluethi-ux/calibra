import { getDb } from "../db";
import { seedSources } from "./seeds";

let ready = false;

/** Seed source rows (tables come from the schema step on DB open). Does not call providers. */
export function prepareCryptoStore() {
  const db = getDb();
  if (!ready) {
    seedSources(db);
    ready = true;
  }
  return db;
}
