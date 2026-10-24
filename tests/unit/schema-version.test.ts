/**
 * B2 get-fix P5 — centralized, versioned schema step. All DDL runs once on DB open (getDb -> runSchemaStep),
 * tracked by PRAGMA user_version. Re-running is a no-op; request paths never create tables.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { useTempDb } from "./_tmpdb";

useTempDb("calibra-schema-");

function masterOf(db: Database.Database) {
  return db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all() as {
    type: string;
    name: string;
    sql: string | null;
  }[];
}
function fingerprint(db: Database.Database) {
  return createHash("sha256").update(JSON.stringify(masterOf(db))).digest("hex");
}
function scratch(name: string) {
  return new Database(join(mkdtempSync(join(tmpdir(), "calibra-schema-x-")), name));
}

/** Update together with SCHEMA_VERSION whenever any DDL changes (and document the migration). */
const EXPECTED: Record<number, string> = {
  1: "d055db50a4dbe395181ea224cefa62b127492cb26cc775c5194c36488a026169",
  2: "5796f5d330bb4c4bfdbde7428f7f92a2772ad76a2860d54b5ee03d1179bc2486", // + instrument_series_cache
};

test("fresh DB: getDb() applies the full schema once and stamps user_version", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { SCHEMA_VERSION, getSchemaVersion } = await import("../../src/lib/db/schema");
  const db = getDb();
  assert.equal(getSchemaVersion(db), SCHEMA_VERSION);
  const names = new Set(masterOf(db).map((m) => m.name));
  for (const t of [
    "meta", "events", "forecasts", "scenarios", "countries", "instruments", "users", "sessions", "api_keys", "api_rate_limits",
    "sources", "source_observations", "canonical_fields", "crypto_market_snapshots", "event_assessments", "source_health",
    "source_fetch_log", "data_quality_flags", "instrument_evidence", "ux_scenarios_event_id", "instrument_series_cache",
  ]) {
    assert.ok(names.has(t), `schema step creates ${t}`);
  }
  assert.equal(fingerprint(db), EXPECTED[SCHEMA_VERSION], "DDL changed without bumping SCHEMA_VERSION / updating the fingerprint");
});

test("re-running the schema step on an up-to-date DB is a no-op (no DDL, no row changes)", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { runSchemaStep, applySchema } = await import("../../src/lib/db/schema");
  const db = getDb();
  const before = { fp: fingerprint(db), sv: db.pragma("schema_version", { simple: true }), tc: db.prepare("SELECT total_changes() c").get() };
  const r = runSchemaStep(db);
  assert.equal(r.applied, false);
  // Even forcing the idempotent DDL leaves the schema byte-identical (view only recreated when it differs).
  applySchema(db);
  assert.equal(fingerprint(db), before.fp);
  assert.equal(db.pragma("schema_version", { simple: true }), before.sv, "no DDL executed");
  assert.deepEqual(db.prepare("SELECT total_changes() c").get(), before.tc);
});

test("legacy DB (user_version 0, partial schema, data present): upgraded in place, data preserved", async () => {
  const { runSchemaStep, SCHEMA_VERSION } = await import("../../src/lib/db/schema");
  const db = scratch("legacy.db");
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE forecasts (id TEXT PRIMARY KEY, data TEXT NOT NULL, asset_symbol TEXT NOT NULL, created_at TEXT NOT NULL, is_seed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE scenarios (id TEXT PRIMARY KEY, event_id TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO meta VALUES ('k', 'v');
    INSERT INTO forecasts VALUES ('f1', '{}', 'SPX', '2026-01-01', 0);
    INSERT INTO scenarios VALUES ('s1', 'e1', '{"eventId":"e1"}', '2026-01-01');
  `);
  const r = runSchemaStep(db);
  assert.deepEqual(r, { from: 0, to: SCHEMA_VERSION, applied: true });
  assert.deepEqual(db.prepare("SELECT * FROM meta").all(), [{ key: "k", value: "v" }]);
  const f = db.prepare("SELECT id, status FROM forecasts").get() as { id: string; status: string };
  assert.deepEqual(f, { id: "f1", status: "open" }, "additive ALTER keeps rows");
  assert.equal((db.prepare("SELECT COUNT(*) c FROM scenarios").get() as { c: number }).c, 1);
  assert.ok(db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'ux_scenarios_event_id'`).get());
});

test("v1 DB is upgraded to v2 in place: only instrument_series_cache is added, data untouched", async () => {
  const { runSchemaStep, applySchema } = await import("../../src/lib/db/schema");
  const db = scratch("v1.db");
  applySchema(db);
  db.exec("DROP TABLE instrument_series_cache");
  db.pragma("user_version = 1");
  db.prepare("INSERT INTO meta (key, value) VALUES ('k', 'v')").run();
  assert.equal(fingerprint(db), EXPECTED[1], "a v1 schema is exactly the v1 fingerprint");
  const r = runSchemaStep(db);
  assert.deepEqual(r, { from: 1, to: 2, applied: true });
  assert.equal(fingerprint(db), EXPECTED[2]);
  assert.deepEqual(db.prepare("SELECT * FROM meta").all(), [{ key: "k", value: "v" }]);
  assert.equal(runSchemaStep(db).applied, false);
});

test("DB that already has the scenarios unique index: the legacy duplicate cleanup never runs", async () => {
  const { runSchemaStep } = await import("../../src/lib/db/schema");
  const db = scratch("hasux.db");
  db.exec(`
    CREATE TABLE scenarios (id TEXT PRIMARY KEY, event_id TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX ux_scenarios_event_id ON scenarios(json_extract(data, '$.eventId'));
    INSERT INTO scenarios VALUES ('s1', 'e1', '{"eventId":"e1"}', '2026-01-01');
  `);
  const sql: string[] = [];
  const origExec = db.exec.bind(db);
  db.exec = ((s: string) => {
    sql.push(s);
    return origExec(s);
  }) as typeof db.exec;
  runSchemaStep(db);
  assert.ok(!sql.some((s) => /DELETE FROM scenarios/.test(s)), "no row cleanup on a DB that already has the index");
  assert.equal((db.prepare("SELECT COUNT(*) c FROM scenarios").get() as { c: number }).c, 1);
});

test("DB from a newer build (user_version > SCHEMA_VERSION) is left untouched", async () => {
  const { runSchemaStep, SCHEMA_VERSION } = await import("../../src/lib/db/schema");
  const db = scratch("newer.db");
  db.pragma(`user_version = ${SCHEMA_VERSION + 5}`);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const r = runSchemaStep(db);
    assert.equal(r.applied, false);
  } finally {
    console.warn = warn;
  }
  assert.equal(masterOf(db).length, 0);
});

test("no request-path module creates tables: DDL only lives in pure schema modules applied by db/schema.ts", async () => {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("grep", ["-rlE", "CREATE (TABLE|INDEX|UNIQUE INDEX|VIEW)|ALTER TABLE|DROP (TABLE|VIEW)", join(__dirname, "..", "..", "src")], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((f) => f.replace(/^.*\/src\//, "src/"))
    .sort();
  assert.deepEqual(out, [
    "src/lib/auth/schema.ts",
    "src/lib/crypto/intel-schema.ts",
    "src/lib/db/schema.ts",
    "src/lib/ingestion/dedupe.ts", // TEMP tables inside the explicit duplicate-cleanup migration only
    "src/lib/instruments/schema.ts",
    "src/lib/intel/schema.ts",
    "src/lib/quality/schema.ts",
    "src/lib/sources/health-schema.ts",
    "src/lib/sources/schema.ts",
  ]);
  for (const f of out.filter((x) => x !== "src/lib/db/schema.ts" && x !== "src/lib/ingestion/dedupe.ts")) {
    const src = (await import("node:fs")).readFileSync(join(__dirname, "..", "..", f), "utf8");
    assert.ok(!/from "\.\.?\/(\.\.\/)?db"|getDb\(/.test(src), `${f} must be pure (no getDb)`);
  }
});
