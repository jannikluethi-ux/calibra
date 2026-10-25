/**
 * Calibra 2.0 Phase 1, acceptance (a): concurrent initialization never duplicates schema work or seed records.
 * Many OS processes start migrate / seed / migrate+seed at the same instant against ONE throwaway DB (SQLite WAL,
 * like production with the app + an operator command). Every worker must succeed, and the resulting DB must equal a
 * single sequential run: same schema fingerprint, same row count per table, no duplicate natural keys.
 * Never touches data/gfi.db of the repo (cwd is a temp dir) and never reaches the network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";

const ROOT = join(__dirname, "..", "..");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");
const WORKER = join(__dirname, "_race-worker.ts");

function freshDir(tag: string) {
  const d = mkdtempSync(join(tmpdir(), `calibra-race-${tag}-`));
  mkdirSync(join(d, "data"));
  return d;
}

function runWorkers(dir: string, modes: string[], startInMs: number) {
  const startAt = Date.now() + startInMs;
  return Promise.all(
    modes.map(
      (m) =>
        new Promise<{ code: number | null; out: string }>((resolve) => {
          const env: NodeJS.ProcessEnv = { ...process.env, RACE_START_AT: String(startAt) };
          for (const k of ["CALIBRA_JOB_TOKEN", "CALIBRA_SCHEDULER", "CALIBRA_DEMO_USERS"]) delete env[k];
          const p = spawn(TSX, [WORKER, m], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
          let out = "";
          p.stdout.on("data", (b) => (out += b));
          p.stderr.on("data", (b) => (out += b));
          p.on("close", (code) => resolve({ code, out: out.trim() }));
        })
    )
  );
}

/** Content summary with volatile columns removed, so a sequential and a concurrent run are comparable. */
function summary(dir: string) {
  const db = new Database(join(dir, "data", "gfi.db"), { readonly: true });
  const master = db
    .prepare(`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`)
    .all();
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]).map((r) => r.name);
  const rows: Record<string, number> = {};
  for (const t of tables) rows[t] = (db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get() as { c: number }).c;
  // natural-key duplicate probes for every table the seed writes (ids are random UUIDs for events/alerts)
  const dup = (sql: string) => (db.prepare(sql).all() as unknown[]).length;
  const dups = {
    events_title: dup(`SELECT json_extract(data,'$.title') t FROM events GROUP BY t HAVING COUNT(*)>1`),
    alerts_name: dup(`SELECT json_extract(data,'$.name') n FROM alerts GROUP BY n HAVING COUNT(*)>1`),
    scenarios_key: dup(`SELECT json_extract(data,'$.name') n, json_extract(data,'$.eventId') e FROM scenarios GROUP BY n, e HAVING COUNT(*)>1`),
    forecasts_key: dup(`SELECT json_extract(data,'$.assetSymbol') a, json_extract(data,'$.horizon') h, json_extract(data,'$.scenarioId') s FROM forecasts GROUP BY a, h, s HAVING COUNT(*)>1`),
    countries_code: dup(`SELECT code FROM countries GROUP BY code HAVING COUNT(*)>1`),
    sources_id: dup(`SELECT id FROM sources GROUP BY id HAVING COUNT(*)>1`),
    meta_key: dup(`SELECT key FROM meta GROUP BY key HAVING COUNT(*)>1`),
  };
  const uv = db.pragma("user_version", { simple: true });
  db.close();
  return { fingerprint: createHash("sha256").update(JSON.stringify(master)).digest("hex"), user_version: uv, rows, dups };
}
const noDups = (d: Record<string, number>) => Object.fromEntries(Object.keys(d).map((k) => [k, 0]));

const N = Number(process.env.CALIBRA_RACE_N ?? 8);
let baseline: ReturnType<typeof summary>;

test("baseline: one sequential migrate + seed on a fresh DB", async () => {
  const d = freshDir("seq");
  const r = await runWorkers(d, ["migrate"], 0);
  assert.equal(r[0].code, 0, r[0].out);
  const r2 = await runWorkers(d, ["seed"], 0);
  assert.equal(r2[0].code, 0, r2[0].out);
  baseline = summary(d);
  assert.equal(baseline.user_version, 2);
  assert.ok(baseline.rows.events > 0 && baseline.rows.alerts > 0 && baseline.rows.countries > 0, JSON.stringify(baseline.rows));
  assert.deepEqual(baseline.dups, noDups(baseline.dups));
});

const ROUNDS = Number(process.env.CALIBRA_RACE_ROUNDS ?? 3);

test(`${N} parallel migrate processes on a fresh DB (x${ROUNDS} rounds): all succeed, schema identical to sequential`, async () => {
  for (let round = 1; round <= ROUNDS; round++) {
    const d = freshDir("migrate");
    const res = await runWorkers(d, Array(N).fill("migrate"), 2500);
    for (const r of res) assert.equal(r.code, 0, `round ${round}: ${r.out}`);
    const s = summary(d);
    assert.equal(s.user_version, 2);
    assert.equal(s.fingerprint, baseline.fingerprint, "schema differs from a sequential run");
    assert.ok(Object.values(s.rows).every((n) => n === 0), `migrate alone writes no rows: ${JSON.stringify(s.rows)}`);
  }
});

test(`${N} parallel seed processes on a fresh DB (x${ROUNDS} rounds): no duplicate seed rows, same counts as one run`, async () => {
  for (let round = 1; round <= ROUNDS; round++) {
    const d = freshDir("seed");
    const res = await runWorkers(d, Array(N).fill("seed"), 2500);
    for (const r of res) assert.equal(r.code, 0, `round ${round}: ${r.out}`);
    const s = summary(d);
    assert.deepEqual(s.dups, noDups(s.dups), `round ${round}: duplicate natural keys`);
    assert.deepEqual(s.rows, baseline.rows, `round ${round}: row counts differ from one sequential migrate+seed`);
    assert.equal(s.fingerprint, baseline.fingerprint);
  }
});

test(`mixed: ${N} parallel migrate / seed / migrate+seed processes, then a second wave on the seeded DB`, async () => {
  const d = freshDir("mixed");
  const modes = Array.from({ length: N }, (_, i) => ["migrate", "seed", "migrate+seed"][i % 3]);
  for (const wave of [1, 2]) {
    const res = await runWorkers(d, modes, 2500);
    for (const r of res) assert.equal(r.code, 0, `wave ${wave}: ${r.out}`);
    const s = summary(d);
    assert.deepEqual(s.dups, noDups(s.dups), `wave ${wave}: duplicate natural keys`);
    assert.deepEqual(s.rows, baseline.rows, `wave ${wave}: row counts differ from one sequential run`);
  }
});
