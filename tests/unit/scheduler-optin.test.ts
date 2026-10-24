/**
 * B2 get-fix (C10): the scheduler loop is opt-in at boot (CALIBRA_SCHEDULER=1) and status reports the
 * configuration (`enabled`) separately from the runtime (`started`). Timers are intercepted, never armed for real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";
import { blockFetch } from "./_dbsnap";

useTempDb("calibra-sched-optin-");
const fetchCalls = blockFetch();
delete process.env.CALIBRA_SCHEDULER;

function interceptTimers() {
  const armed: string[] = [];
  const st = globalThis.setTimeout;
  const si = globalThis.setInterval;
  globalThis.setTimeout = ((_: unknown, ms?: number) => {
    armed.push(`timeout:${ms}`);
    return { unref() {} } as never;
  }) as never;
  globalThis.setInterval = ((_: unknown, ms?: number) => {
    armed.push(`interval:${ms}`);
    return { unref() {} } as never;
  }) as never;
  return { armed, restore: () => ((globalThis.setTimeout = st), (globalThis.setInterval = si)) };
}

test("isEnvSchedulerAllowed is opt-in: only 1/true/on", async () => {
  const { isEnvSchedulerAllowed } = await import("../../src/lib/scheduler/runner");
  const cases: [string | undefined, boolean][] = [[undefined, false], ["", false], ["0", false], ["false", false], ["off", false], ["yes", false], ["1", true], ["true", true], ["ON", true]];
  for (const [v, want] of cases) {
    if (v === undefined) delete process.env.CALIBRA_SCHEDULER;
    else process.env.CALIBRA_SCHEDULER = v;
    assert.equal(isEnvSchedulerAllowed(), want, String(v));
  }
  delete process.env.CALIBRA_SCHEDULER;
});

test("boot (instrumentation.register) without opt-in arms no timers; status: enabled=false, started=false", async () => {
  const t = interceptTimers();
  const prev = process.env.NEXT_RUNTIME;
  process.env.NEXT_RUNTIME = "nodejs";
  try {
    const { register } = await import("../../src/instrumentation");
    await register();
    assert.deepEqual(t.armed, []);
  } finally {
    t.restore();
    if (prev === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = prev;
  }
  const { getSchedulerStatus } = await import("../../src/lib/scheduler/runner");
  const s = getSchedulerStatus();
  assert.equal(s.enabled, false);
  assert.equal(s.started, false);
  assert.equal(s.envAllowed, false);
});

test("with CALIBRA_SCHEDULER=1 boot arms the loop (intercepted); started is reported separately from enabled", async () => {
  const { setMeta } = await import("../../src/lib/db");
  const { getSchedulerStatus } = await import("../../src/lib/scheduler/runner");
  const { startScheduler, stopScheduler } = await import("../../src/lib/scheduler/boot");
  process.env.CALIBRA_SCHEDULER = "1";
  setMeta("scheduler.enabled", "0"); // configured off, but env opted in -> loop may be armed; ticks will skip
  const t = interceptTimers();
  try {
    startScheduler();
    assert.deepEqual(t.armed, ["timeout:8000", "interval:60000"]);
    const s = getSchedulerStatus();
    assert.equal(s.started, true);
    assert.equal(s.enabled, false, "soft toggle off: configured disabled even though the loop is armed");
    setMeta("scheduler.enabled", "1");
    assert.equal(getSchedulerStatus().enabled, true);
  } finally {
    t.restore();
    globalThis.__calibraSchedulerTimer = undefined; // fake handle; nothing real to clear
    stopScheduler();
    delete process.env.CALIBRA_SCHEDULER;
  }
  assert.equal(getSchedulerStatus().started, false);
  assert.deepEqual(fetchCalls, []);
});
