/**
 * Calibra 2.0 Phase 1, acceptance (a) for requests: every discovered GET route + server page/layout, with every
 * cookie variant, fired CONCURRENTLY (Promise.all, ROUNDS x) against one throwaway DB, the way a single Next.js
 * server interleaves requests. Nothing may write: no write statement attempted, DB state (schema, user_version,
 * per-table content hash, file stats) unchanged, so no init/seed record can be created — let alone duplicated.
 */
import "./_readonly-harness"; // spies first
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { useTempDb } from "./_tmpdb";
import { callTarget, dbState, diffState, discoverTargets, loadClientComponentSet, networkAttempts, rec, rawGet } from "./_readonly-harness";
import { buildEmptyFixture, buildPopulatedFixture } from "./_readonly-fixtures";
import { probesFor, variantsFor } from "./_readonly-run";

export function runConcurrentSuite(fixture: "empty" | "populated", rounds = Number(process.env.CALIBRA_CONC_ROUNDS ?? 5)) {
  const dir = useTempDb(`calibra-conc-${fixture}-`);
  for (const k of ["CALIBRA_JOB_TOKEN", "CALIBRA_SCHEDULER", "CALIBRA_DEMO_USERS", "MONITOR_LOOP_ENABLED"]) delete process.env[k];

  test(`concurrent GET/page burst x${rounds} — ${fixture} DB: no writes, no init/seed rows, nothing duplicated`, async () => {
    const ctx = fixture === "empty" ? await buildEmptyFixture() : await buildPopulatedFixture();
    const { getDb } = await import("../../src/lib/db");
    const db = getDb();
    db.pragma("wal_checkpoint(TRUNCATE)");
    await loadClientComponentSet();
    const targets = discoverTargets();
    const probes = probesFor(ctx);
    const variants = variantsFor(ctx);
    assert.deepEqual(targets.filter((x) => !probes[x.id]).map((x) => x.id), [], "every discovered target needs a probe config");
    const jobs = targets.flatMap((t) => (probes[t.id] ?? []).flatMap((p) => variants.map((v) => ({ t, p, v }))));
    assert.ok(jobs.length >= targets.length, "every target is fired");

    const before = dbState(db, join(dir, "data"));
    const tcBefore = rawGet<{ c: number }>(db, "SELECT total_changes() AS c").c;
    const netBefore = networkAttempts.length;
    rec.events = [];
    rec.active = true;
    const outcomes: { id: string; threw?: string }[] = [];
    try {
      for (let r = 1; r <= rounds; r++) {
        const res = await Promise.all(jobs.map((j, i) => callTarget(j.t, j.p.url, j.p.params ?? {}, j.v, r * 10000 + i)));
        res.forEach((o, i) => outcomes.push({ id: jobs[i].t.id, threw: o.threw }));
      }
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      rec.active = false;
    }
    const after = dbState(db, join(dir, "data"));
    // Same rule as the sequential harness: ANY recorded side effect (sql-write, ddl, pragma-write, network, timer,
    // child-process, fs-write) is a violation.
    assert.deepEqual(rec.events.slice(0, 5), [], `side effects during the burst (${rec.events.length})`);
    assert.deepEqual(diffState(before, after), [], "persistent DB state changed");
    assert.equal(rawGet<{ c: number }>(db, "SELECT total_changes() AS c").c, tcBefore, "total_changes moved");
    assert.equal(networkAttempts.length, netBefore, "network attempted");
    const threw = outcomes.filter((o) => o.threw);
    assert.deepEqual(threw.slice(0, 3), [], `handlers threw under concurrency (${threw.length})`);
    assert.equal(outcomes.length, jobs.length * rounds);
    const g = globalThis as Record<string, unknown>;
    assert.ok(!g.__calibraSchedulerStarted && !g.__calibraSchedulerTimer, "scheduler started by a request");
    console.log(`[concurrent ${fixture}] targets=${targets.length} requests=${outcomes.length} (${jobs.length} per round x ${rounds})`);
  });
}
