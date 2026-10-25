/**
 * Calibra 2.0 Phase 1, acceptance (b) + (c): a fresh DB is initialized by the explicit commands alone — `npm run migrate`
 * then `npm run seed` — with no HTTP request / page visit and no network; schema v2 is idempotent and re-run safe;
 * older DBs are upgraded additively (existing rows untouched); a DB from a newer build is left alone.
 * The scripts run as separate processes with cwd = a throwaway dir, so they only ever touch <tmp>/data/gfi.db.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";

const ROOT = join(__dirname, "..", "..");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");
const NO_NET = join(__dirname, "_no-network.ts");
const MIGRATE = join(ROOT, "scripts", "migrate.ts");
const SEED = join(ROOT, "scripts", "seed.ts");
const SCHEMA_V = 2;
const EXPECTED_TABLES = [
  "meta", "market_snapshots", "market_history", "events", "scenarios", "forecasts", "warnings", "risk_gauges",
  "causal_graph", "countries", "alerts", "fired_alerts", "portfolio", "event_clusters", "event_cluster_history",
  "instruments", "users", "sessions", "api_keys", "api_rate_limits", "sources", "source_observations",
  "canonical_fields", "crypto_market_snapshots", "event_assessments", "source_health", "source_fetch_log",
  "data_quality_flags", "instrument_series_cache",
];
const EXPECTED_VIEWS = ["instrument_evidence"];

function dir(tag: string) {
  const d = mkdtempSync(join(tmpdir(), `calibra-fresh-${tag}-`));
  mkdirSync(join(d, "data"));
  return d;
}
function run(cwd: string, script: string, ...args: string[]) {
  const env = { ...process.env };
  for (const k of ["CALIBRA_JOB_TOKEN", "CALIBRA_SCHEDULER", "CALIBRA_DEMO_USERS"]) delete env[k];
  const r = spawnSync(TSX, ["--import", NO_NET, script, ...args], { cwd, env, encoding: "utf8", timeout: 120_000 });
  assert.ok(!/NETWORK_ATTEMPT/.test(r.stderr ?? ""), `network attempted: ${r.stderr}`);
  const line = (r.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "{}";
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(line);
  } catch {
    /* non-JSON output */
  }
  return { status: r.status, json, out: `${r.stdout}\n${r.stderr}` };
}
const dbFile = (d: string) => join(d, "data", "gfi.db");
function state(d: string) {
  const db = new Database(dbFile(d), { readonly: true });
  const master = db.prepare(`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all() as { type: string; name: string }[];
  const tables = master.filter((m) => m.type === "table").map((m) => m.name);
  const rows: Record<string, number> = {};
  const hashes: Record<string, string> = {};
  for (const t of tables) {
    const all = db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all();
    rows[t] = all.length;
    hashes[t] = createHash("sha256").update(JSON.stringify(all)).digest("hex");
  }
  const out = {
    user_version: db.pragma("user_version", { simple: true }) as number,
    fingerprint: createHash("sha256").update(JSON.stringify(master)).digest("hex"),
    tables,
    views: master.filter((m) => m.type === "view").map((m) => m.name),
    rows,
    hashes,
  };
  db.close();
  return out;
}

test("package.json exposes the explicit init commands (migrate, migrate:check, seed)", () => {
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
  assert.equal(scripts.migrate, "npx tsx scripts/migrate.ts");
  assert.equal(scripts["migrate:check"], "npx tsx scripts/migrate.ts --check");
  assert.equal(scripts.seed, "npx tsx scripts/seed.ts");
});

test("fresh DB without any page visit: migrate:check reports missing (creates nothing), migrate builds schema v2, seed fills it", () => {
  const d = dir("init");
  const c0 = run(d, MIGRATE, "--check");
  assert.equal(c0.status, 1, c0.out);
  assert.equal(c0.json.status, "missing");
  assert.ok(!existsSync(dbFile(d)), "--check must not create the DB");

  const m = run(d, MIGRATE);
  assert.equal(m.status, 0, m.out);
  assert.deepEqual([m.json.from, m.json.to, m.json.created], [0, SCHEMA_V, true]);
  const s1 = state(d);
  assert.equal(s1.user_version, SCHEMA_V);
  for (const t of EXPECTED_TABLES) assert.ok(s1.tables.includes(t), `migrate creates table ${t}`);
  for (const v of EXPECTED_VIEWS) assert.ok(s1.views.includes(v), `migrate creates view ${v}`);
  assert.ok(Object.values(s1.rows).every((n) => n === 0), `migrate writes no rows: ${JSON.stringify(s1.rows)}`);
  assert.equal(run(d, MIGRATE, "--check").status, 0);

  const sd = run(d, SEED);
  assert.equal(sd.status, 0, sd.out);
  const s2 = state(d);
  assert.equal(s2.user_version, SCHEMA_V);
  assert.equal(s2.fingerprint, s1.fingerprint, "seed performs no DDL");
  // scenarios stay empty: ensureScenarios() derives them from assessed events, which only the refresh pipeline
  // produces (unchanged pre-Phase-1 behavior, documented in docs/calibra2/phase1-read-path.md).
  for (const t of ["countries", "forecasts", "alerts", "events", "sources", "meta"]) {
    assert.ok(s2.rows[t] > 0, `seed fills ${t} (${s2.rows[t]})`);
  }
  for (const t of ["users", "sessions", "api_keys", "api_rate_limits"]) assert.equal(s2.rows[t], 0, `seed never creates ${t}`);
});

test("seed alone on an empty data dir also initializes the schema (seed implies migrate)", () => {
  const d = dir("seedonly");
  const sd = run(d, SEED);
  assert.equal(sd.status, 0, sd.out);
  const s = state(d);
  assert.equal(s.user_version, SCHEMA_V);
  for (const t of EXPECTED_TABLES) assert.ok(s.tables.includes(t), `schema has table ${t}`);
  for (const v of EXPECTED_VIEWS) assert.ok(s.views.includes(v), `schema has view ${v}`);
});

test("re-running migrate and seed is a no-op: schema fingerprint and every table hash unchanged", () => {
  const d = dir("rerun");
  assert.equal(run(d, MIGRATE).status, 0);
  assert.equal(run(d, SEED).status, 0);
  const before = state(d);
  for (let i = 0; i < 2; i++) {
    const m = run(d, MIGRATE);
    assert.equal(m.status, 0, m.out);
    assert.deepEqual([m.json.from, m.json.to, m.json.created], [SCHEMA_V, SCHEMA_V, false]);
    assert.equal(run(d, SEED).status, 0);
  }
  const after = state(d);
  assert.equal(after.fingerprint, before.fingerprint);
  assert.deepEqual(after.hashes, before.hashes, "re-run changed persisted rows");
});

test("v1 DB with data: migrate:check says behind, migrate adds only instrument_series_cache, existing rows byte-identical", () => {
  const d = dir("v1");
  assert.equal(run(d, MIGRATE).status, 0);
  assert.equal(run(d, SEED).status, 0);
  // Downgrade the copy to the v1 shape: drop the v2-only table and stamp user_version 1.
  const w = new Database(dbFile(d));
  w.exec(`DROP TABLE instrument_series_cache`);
  w.pragma("user_version = 1");
  w.close();
  const before = state(d);
  const c = run(d, MIGRATE, "--check");
  assert.equal(c.status, 1, c.out);
  assert.equal(c.json.status, "behind");
  const m = run(d, MIGRATE);
  assert.equal(m.status, 0, m.out);
  assert.deepEqual([m.json.from, m.json.to], [1, SCHEMA_V]);
  const after = state(d);
  assert.deepEqual(after.tables.filter((t) => !before.tables.includes(t)), ["instrument_series_cache"]);
  for (const t of before.tables) assert.equal(after.hashes[t], before.hashes[t], `${t} rows changed by the v1->v2 step`);
  assert.equal(after.rows.instrument_series_cache, 0);
});

test("DB from a newer build (user_version 3): migrate leaves it untouched, migrate:check exits 2", () => {
  const d = dir("newer");
  assert.equal(run(d, MIGRATE).status, 0);
  const w = new Database(dbFile(d));
  w.pragma("user_version = 3");
  w.close();
  const before = state(d);
  const c = run(d, MIGRATE, "--check");
  assert.equal(c.status, 2, c.out);
  assert.equal(c.json.status, "newer");
  assert.equal(run(d, MIGRATE).status, 0);
  const after = state(d);
  assert.equal(after.user_version, 3);
  assert.equal(after.fingerprint, before.fingerprint);
  assert.deepEqual(after.hashes, before.hashes);
});
