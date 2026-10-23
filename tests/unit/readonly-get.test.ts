/**
 * B2.2 — GET /api/scheduler/status and GET /api/refresh are read-only: no seed writes,
 * no meta writes, no scheduler (re-)arm, no jobs, no network. Temp DB only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import { useTempDb } from "./_tmpdb";
import { snapshotDb, blockFetch } from "./_dbsnap";

const dir = useTempDb("calibra-roget-");
delete process.env.CALIBRA_JOB_TOKEN;
delete process.env.CALIBRA_SCHEDULER;
const fetchCalls = blockFetch();

// Spy on timers: a GET must not arm the scheduler interval/timeout.
const timers: string[] = [];
const realSetInterval = globalThis.setInterval;
const realSetTimeout = globalThis.setTimeout;
function spyTimers() {
  globalThis.setInterval = ((fn: () => void, ms?: number, ...a: unknown[]) => {
    timers.push(`setInterval(${ms})`);
    return realSetInterval(fn, ms, ...a);
  }) as typeof setInterval;
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) => {
    timers.push(`setTimeout(${ms})`);
    return realSetTimeout(fn, ms, ...a);
  }) as typeof setTimeout;
}
function unspyTimers() {
  globalThis.setInterval = realSetInterval;
  globalThis.setTimeout = realSetTimeout;
}

async function load() {
  const db = await import("../../src/lib/db");
  const status = await import("../../src/app/api/scheduler/status/route");
  const refresh = await import("../../src/app/api/refresh/route");
  db.getDb(); // one-time schema migration on open happens here, before any baseline
  return { db, status, refresh };
}

function totalChanges(db: import("better-sqlite3").Database): number {
  return (db.prepare("SELECT total_changes() AS c").get() as { c: number }).c;
}

function fileState() {
  const f = (p: string) => {
    try {
      const s = statSync(join(dir, "data", p));
      return `${s.size}:${s.mtimeMs}`;
    } catch {
      return "absent";
    }
  };
  return { db: f("gfi.db"), wal: f("gfi.db-wal") };
}

async function hitBoth(n: number, routes: Awaited<ReturnType<typeof load>>) {
  const bodies: { refresh: unknown; status: unknown }[] = [];
  for (let i = 0; i < n; i++) {
    const r = await routes.refresh.GET();
    const s = await routes.status.GET();
    assert.equal(r.status, 200);
    assert.equal(s.status, 200);
    bodies.push({ refresh: await r.json(), status: await s.json() });
  }
  return bodies;
}

test("unseeded DB: GETs return 200 with graceful empty status and write nothing", async () => {
  const routes = await load();
  const d = routes.db.getDb();
  const before = snapshotDb(d);
  const tc0 = totalChanges(d);
  const fs0 = fileState();
  spyTimers();
  let bodies;
  try {
    bodies = await hitBoth(5, routes);
  } finally {
    unspyTimers();
  }
  const st = (bodies[0].refresh as { status: Record<string, unknown> }).status;
  assert.equal(st.dataQuality, "insufficient");
  assert.equal(st.marketCount, 0);
  assert.equal(st.eventCount, 0);
  assert.equal(st.historyPoints, 0);
  assert.equal(st.lastMarketUpdate, null);
  const sch = bodies[0].status as Record<string, unknown>;
  assert.equal(typeof sch.enabled, "boolean");
  assert.equal(typeof sch.inFastSession, "boolean");
  assert.equal(typeof sch.lastRuns, "object");

  assert.equal(totalChanges(d), tc0, "no rows changed on the app connection");
  assert.deepEqual(snapshotDb(d), before, "all tables identical");
  for (const t of ["countries", "scenarios", "forecasts", "alerts", "events"]) assert.equal(before[t].rows, 0, `${t} stays unseeded`);
  assert.equal(routes.db.getMeta("dataQuality"), null, "no dataQuality default written");
  assert.equal(routes.db.getMeta("eventDedupeCleanupV1"), null, "no one-shot cleanup ran");
  assert.deepEqual(fileState(), fs0, "db/wal files untouched");
  assert.deepEqual(timers, [], "no timers armed");
  assert.equal(globalThis.__calibraSchedulerStarted, undefined, "scheduler loop not armed");
  assert.deepEqual(fetchCalls, []);
});

test("seeded DB (scheduler disabled): 25 repeated GETs leave every table hash and row count unchanged", async () => {
  const routes = await load();
  const { ensureSeedData } = await import("../../src/lib/bootstrap/refresh");
  ensureSeedData(); // explicit init, as POST /api/refresh or `npm run seed` would do
  routes.db.setMeta("scheduler.enabled", "0");
  routes.db.setMeta("scheduler.lastTick", "2026-10-22T16:41:59.762Z");
  routes.db.setMeta("lastMarketUpdate", "2026-10-22T16:41:39.059Z");
  const d = routes.db.getDb();
  d.pragma("wal_checkpoint(TRUNCATE)");
  const before = snapshotDb(d);
  assert.ok(before.countries.rows > 0, "seed rows present");
  const tc0 = totalChanges(d);
  const fs0 = fileState();
  spyTimers();
  let bodies;
  try {
    bodies = await hitBoth(25, routes);
  } finally {
    unspyTimers();
  }
  assert.equal(totalChanges(d), tc0, "no rows changed (would catch idempotent re-upserts too)");
  assert.deepEqual(snapshotDb(d), before);
  assert.deepEqual(fileState(), fs0, "db/wal files untouched");
  assert.deepEqual(timers, []);
  assert.equal(globalThis.__calibraSchedulerStarted, undefined);
  assert.equal(routes.db.getMeta("scheduler.lastTick"), "2026-10-22T16:41:59.762Z", "no tick ran");
  assert.equal((bodies[24].status as { enabled: boolean }).enabled, false);
  assert.equal(((bodies[24].refresh as { status: { lastMarketUpdate: string } }).status).lastMarketUpdate, "2026-10-22T16:41:39.059Z");
  assert.deepEqual(fetchCalls, []);
});

test("GET does not re-arm a stopped scheduler loop", async () => {
  const routes = await load();
  const { stopScheduler } = await import("../../src/lib/scheduler/boot");
  stopScheduler();
  routes.db.setMeta("scheduler.enabled", "1"); // even when enabled, a GET must not start the loop
  const tc0 = totalChanges(routes.db.getDb());
  await hitBoth(3, routes);
  assert.ok(!globalThis.__calibraSchedulerStarted, "loop not started by GET");
  assert.equal(totalChanges(routes.db.getDb()), tc0);
  routes.db.setMeta("scheduler.enabled", "0");
});

test("explicit init path still works: ensureSeedData seeds an empty DB (used by POST refresh/tick, npm run seed)", async () => {
  const routes = await load();
  const d = routes.db.getDb();
  d.prepare("DELETE FROM countries").run();
  const { ensureSeedData } = await import("../../src/lib/bootstrap/refresh");
  ensureSeedData();
  assert.ok((d.prepare("SELECT COUNT(*) c FROM countries").get() as { c: number }).c > 0);
  assert.deepEqual(fetchCalls, []);
});
