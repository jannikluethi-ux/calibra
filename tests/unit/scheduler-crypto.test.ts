import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";

useTempDb("calibra-sched-crypto-");

test("crypto job is scheduled every ~6 h with bounded ~1 h retries, and never runs derive", async () => {
  const { setMeta, getDb } = await import("../../src/lib/db");
  const { JOB_NAMES, META_LAST, META_CRYPTO_RETRY, CRYPTO_MAX_RETRIES } = await import("../../src/lib/scheduler/jobs");
  const { decideDueJobs, nextDueEstimate, INTERVALS, getSchedulerStatus } = await import("../../src/lib/scheduler/runner");
  getDb();
  assert.ok(JOB_NAMES.includes("crypto"));
  assert.equal(INTERVALS.cryptoMs, 6 * 3600_000);
  assert.equal(CRYPTO_MAX_RETRIES, 2);
  const now = new Date("2026-10-17T12:00:00.000Z");
  assert.ok(decideDueJobs(now).due.includes("crypto"), "never run -> due");
  setMeta(META_LAST.crypto, new Date(now.getTime() - 61 * 60_000).toISOString());
  setMeta(META_CRYPTO_RETRY, "0");
  const d = decideDueJobs(now);
  assert.ok(!d.due.includes("crypto"));
  assert.ok(d.skipped.some((s) => s.job === "crypto"));
  setMeta(META_CRYPTO_RETRY, "1");
  assert.ok(decideDueJobs(now).due.includes("crypto"), "retry after ~1 h");
  setMeta(META_CRYPTO_RETRY, "0");
  setMeta(META_LAST.crypto, new Date(now.getTime() - 6 * 3600_000 - 1000).toISOString());
  assert.ok(decideDueJobs(now).due.includes("crypto"));
  assert.ok(nextDueEstimate(now).crypto);
  assert.match(getSchedulerStatus().intervals.crypto, /6 h/);
  assert.ok(!decideDueJobs(now).due.includes("derive"));
});
