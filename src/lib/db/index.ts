import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { runSchemaStep } from "./schema";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "gfi.db");

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  dbInstance = new Database(DB_PATH);
  // busy_timeout first: switching a fresh DB to WAL needs a lock, and a concurrent opener (app + `npm run migrate`
  // / `npm run seed`) must wait for it instead of failing with SQLITE_BUSY (Calibra 2.0 Phase 1).
  dbInstance.pragma("busy_timeout = 10000");
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");
  runSchemaStep(dbInstance); // centralized, versioned schema step — the only place DDL runs
  return dbInstance;
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string) {
  getDb()
    .prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function upsertJson(table: string, idCol: string, id: string, data: unknown, extra?: Record<string, unknown>) {
  const db = getDb();
  const cols = [idCol, "data", ...(extra ? Object.keys(extra) : [])];
  const placeholders = cols.map(() => "?").join(",");
  const updates = cols
    .filter((c) => c !== idCol)
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  const values = [id, JSON.stringify(data), ...(extra ? Object.values(extra) : [])];
  db.prepare(
    `INSERT INTO ${table}(${cols.join(",")}) VALUES(${placeholders}) ON CONFLICT(${idCol}) DO UPDATE SET ${updates}`
  ).run(...values);
}

export function getJsonAll<T>(table: string, orderBy?: string): T[] {
  const sql = orderBy ? `SELECT data FROM ${table} ORDER BY ${orderBy}` : `SELECT data FROM ${table}`;
  const rows = getDb().prepare(sql).all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as T);
}

export function getJsonById<T>(table: string, idCol: string, id: string): T | null {
  const row = getDb().prepare(`SELECT data FROM ${table} WHERE ${idCol} = ?`).get(id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as T) : null;
}

export function deleteById(table: string, idCol: string, id: string) {
  getDb().prepare(`DELETE FROM ${table} WHERE ${idCol} = ?`).run(id);
}
