/**
 * B2 get-fix rec. 3 + 6: seeding is explicit (npm run seed / guarded POST) and idempotent; country profiles carry a
 * fixed dataset date and are only rewritten when their content changes; the legacy dedupe/backfill is a one-off,
 * opt-in migration script (dry-run by default, read-only).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { useTempDb } from "./_tmpdb";

const DIR = useTempDb("calibra-seed-");
const ROOT = join(__dirname, "..", "..");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

function grepSrc(re: string): string[] {
  let out = "";
  try {
    out = execFileSync("grep", ["-rlE", re, join(ROOT, "src", "app", "api")], { encoding: "utf8" });
  } catch {
    out = "";
  }
  return out.trim().split("\n").filter(Boolean).map((f) => f.replace(/^.*\/src\//, "src/")).sort();
}

test("only guarded POST/job handlers in src/app/api reference the seed helpers", () => {
  assert.deepEqual(grepSrc("ensureSeedData|ensureForecasts|ensureScenarios|ensureDemoEventsIfEmpty|ensureDefaultAlerts|seedCountries"), [
    "src/app/api/forecasts/resolve/route.ts",
    "src/app/api/refresh/route.ts",
    "src/app/api/scheduler/status/route.ts",
    "src/app/api/scheduler/tick/route.ts",
  ]);
});

test("country reads never seed; seedCountries is content-change-only with a fixed dataset date", async () => {
  const { getDb } = await import("../../src/lib/db");
  const prof = await import("../../src/lib/countries/profiles");
  const db = getDb();
  const tc = () => (db.prepare("SELECT total_changes() c").get() as { c: number }).c;
  let t = tc();
  assert.deepEqual(prof.getCountries(), []);
  assert.equal(prof.getCountry("us"), null);
  assert.equal(tc(), t, "reads on an empty DB write nothing");

  assert.equal(prof.seedCountries().written, 20);
  const rows1 = db.prepare("SELECT code, data, updated_at FROM countries ORDER BY code").all();
  t = tc();
  assert.equal(prof.seedCountries().written, 0, "second seed is a no-op");
  assert.equal(tc(), t);
  assert.deepEqual(db.prepare("SELECT code, data, updated_at FROM countries ORDER BY code").all(), rows1);
  for (const c of prof.getCountries()) assert.equal(c.lastUpdated, prof.COUNTRY_PROFILES_DATASET_DATE);
  assert.equal(prof.getCountry("us")?.code, "US");

  db.prepare("UPDATE countries SET data = json_set(data, '$.name', 'Tampered') WHERE code = 'US'").run();
  assert.equal(prof.seedCountries().written, 1, "a drifted row is restored");
  assert.equal(prof.getCountry("US")?.name, "United States");
});

test("ensureSeedData is idempotent and makes no network calls", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("network disabled in test");
  }) as typeof fetch;
  try {
    const { getDb } = await import("../../src/lib/db");
    const { ensureSeedData } = await import("../../src/lib/bootstrap/refresh");
    const db = getDb();
    ensureSeedData();
    const snap = () =>
      ["countries", "scenarios", "forecasts", "alerts", "events"]
        .map((tb) => db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(LENGTH(data)), 0) s FROM ${tb}`).get())
        .concat([db.prepare("SELECT group_concat(key || '=' || value) kv FROM meta").get()]);
    const before = snap();
    const t = (db.prepare("SELECT total_changes() c").get() as { c: number }).c;
    ensureSeedData();
    assert.deepEqual(snap(), before);
    assert.equal((db.prepare("SELECT total_changes() c").get() as { c: number }).c, t, "second seed writes nothing");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---- one-off migration script ----

function legacyDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "calibra-mig-"));
  mkdirSync(join(dir, "data"));
  const file = join(dir, "data", "gfi.db");
  // Build the current schema via the app (child process so this test's cached DB handle is unaffected).
  execFileSync(TSX, ["-e", 'require("' + join(ROOT, "src/lib/db") + '").getDb()'], { cwd: dir });
  const db = new Database(file);
  const ev = (id: string, title: string, at: string) =>
    db.prepare("INSERT INTO events(id, published_at, quality, data) VALUES(?,?,?,?)").run(
      id, at, "live", JSON.stringify({ id, title, publishedAt: at, quality: "live" })
    );
  ev("e1", "Central bank holds rates", "2026-10-01T00:00:00Z");
  ev("e2", "Central bank holds rates", "2026-10-02T00:00:00Z");
  ev("e3", "Unrelated headline", "2026-10-02T00:00:00Z");
  db.prepare("INSERT INTO forecasts(id, asset_symbol, created_at, is_seed, data) VALUES(?,?,?,?,?)").run(
    "f1", "SPY", "2026-10-01T00:00:00Z", 1,
    JSON.stringify({ id: "f1", assetSymbol: "SPY", createdAt: "2026-10-01T00:00:00Z", horizon: "1-4w", isSeed: true })
  );
  db.close();
  return file;
}

test("migration: dry run is read-only; apply needs explicit opt-in; apply is gated and idempotent", () => {
  const file = legacyDb();
  const s0 = sha(file);
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(TSX, [join(ROOT, "scripts/migrate-legacy-cleanup-v1.ts"), ...args], {
      cwd: DIR, // deliberately a different app dir: the script must only touch --db
      env: { ...process.env, CALIBRA_LEGACY_MIGRATION: "", ...env },
      encoding: "utf8",
    });

  assert.equal(run([]).status, 2, "no --db -> refuse");
  const dry = run(["--db", file]);
  assert.equal(dry.status, 0, dry.stderr);
  const plan = JSON.parse(dry.stdout).plan;
  assert.equal(plan.dedupe.eventsToRemove, 1);
  assert.equal(plan.forecasts.rowsMissingColumns, 1);
  assert.equal(sha(file), s0, "dry run leaves the DB byte-identical");

  const refused = run(["--db", file, "--apply"]);
  assert.equal(refused.status, 2);
  assert.equal(sha(file), s0, "refused apply leaves the DB byte-identical");

  const ok = run(["--db", file, "--apply"], { CALIBRA_LEGACY_MIGRATION: "1" });
  assert.equal(ok.status, 0, ok.stderr);
  const db = new Database(file, { readonly: true });
  assert.equal((db.prepare("SELECT COUNT(*) c FROM events").get() as { c: number }).c, 2);
  const f = db.prepare("SELECT status, horizon_end FROM forecasts WHERE id='f1'").get() as { status: string; horizon_end: string };
  assert.equal(f.status, "open");
  assert.ok(f.horizon_end);
  db.close();

  const again = run(["--db", file, "--apply"], { CALIBRA_LEGACY_MIGRATION: "1" });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /skipped \(already done\)/);
  assert.equal(JSON.parse(run(["--db", file]).stdout).plan.dedupe.gate, "done");
});
