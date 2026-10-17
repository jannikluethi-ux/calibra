import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFailure,
  isValidPrice,
  backoffDelay,
  withRetry,
  mapWithConcurrency,
  breakerDelayMs,
  nextHealthState,
  emptyHealth,
  shouldSkip,
  withTimeout,
} from "../../src/lib/sources/health-core";

const NOW = "2026-10-17T10:00:00.000Z";
const H = 3600_000;

test("classifyFailure: network/DNS/timeout and 4xx/5xx are unavailable; 429 is rate_limited", () => {
  assert.equal(classifyFailure({ status: null, error: "getaddrinfo ENOTFOUND feeds.reuters.com" }), "unavailable");
  assert.equal(classifyFailure({ status: 0, error: "timeout after 15000ms" }), "unavailable");
  assert.equal(classifyFailure({ status: 403 }), "unavailable");
  assert.equal(classifyFailure({ status: 503 }), "unavailable");
  assert.equal(classifyFailure({ status: 429 }), "rate_limited");
  assert.equal(classifyFailure({ status: 200, body: "Too Many Requests" }), "rate_limited");
});

test("isValidPrice rejects 0, negatives, NaN, Infinity, null and strings", () => {
  for (const bad of [0, -1, NaN, Infinity, null, undefined, "5"]) assert.equal(isValidPrice(bad), false, String(bad));
  assert.equal(isValidPrice(0.0001), true);
  assert.equal(isValidPrice(3.45), true);
});

test("backoff is exponential and capped", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((n) => backoffDelay(n, 500, 8000)), [500, 1000, 2000, 4000, 8000, 8000]);
});

test("withRetry: bounded attempts, exponential sleeps, retries only retryable classes", async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const r = await withRetry(async () => {
    calls++;
    return { outcome: { ok: false, errorClass: "unavailable" as const, httpStatus: 503 } };
  }, { retries: 3, baseDelayMs: 10, sleep: async (ms) => void sleeps.push(ms) });
  assert.equal(calls, 4);
  assert.equal(r.attempts, 4);
  assert.deepEqual(sleeps, [10, 20, 40]);

  calls = 0;
  const inv = await withRetry(async () => {
    calls++;
    return { outcome: { ok: false, errorClass: "invalid_data" as const, httpStatus: 200 } };
  }, { retries: 3, sleep: async () => {} });
  assert.equal(calls, 1, "invalid data is not retried");
  assert.equal(inv.outcome.errorClass, "invalid_data");

  calls = 0;
  await withRetry(async () => {
    calls++;
    throw new Error("boom");
  }, { retries: 99, sleep: async () => {} });
  assert.equal(calls, 6, "retries are capped at 5 regardless of option");

  calls = 0;
  const ok = await withRetry(async () => {
    calls++;
    return calls < 2 ? { outcome: { ok: false, errorClass: "rate_limited" as const, httpStatus: 429 } } : { outcome: { ok: true, errorClass: "ok" as const }, value: 42 };
  }, { retries: 2, sleep: async () => {} });
  assert.equal(ok.value, 42);
  assert.equal(calls, 2);
});

test("withTimeout rejects slow operations", async () => {
  await assert.rejects(withTimeout(new Promise((r) => setTimeout(r, 200)), 20, "slow"), /timeout/i);
});

test("mapWithConcurrency isolates failures and respects the limit", async () => {
  let active = 0;
  let peak = 0;
  const res = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    if (n === 3) throw new Error("source 3 down");
    return n * 10;
  });
  assert.ok(peak <= 2);
  assert.equal(res[2].status, "rejected");
  assert.deepEqual(res.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<number>).value), [10, 20, 40, 50, 60]);
});

test("health state: unavailable → degraded → failing with circuit-breaker back-off", () => {
  let s = emptyHealth("rss_imf");
  for (let i = 1; i <= 3; i++) s = nextHealthState(s, { ok: false, errorClass: "unavailable", httpStatus: 403, error: "HTTP 403" }, NOW, 14 * 24 * H);
  assert.equal(s.consecutiveFailures, 3);
  assert.equal(s.status, "failing");
  assert.equal(s.errorClass, "unavailable");
  assert.equal(breakerDelayMs(3), 5 * 60_000);
  assert.equal(breakerDelayMs(40), 6 * H);
  assert.equal(shouldSkip(s, NOW).skip, true);
  assert.equal(shouldSkip(s, new Date(Date.parse(NOW) + 6 * 60_000).toISOString()).skip, false);
});

test("health state: rate_limited sets a cooldown and skip reason", () => {
  const s = nextHealthState(emptyHealth("yahoo_markets"), { ok: false, errorClass: "rate_limited", httpStatus: 429 }, NOW, 80 * H);
  assert.equal(s.status, "degraded");
  assert.equal(s.rateLimitedUntil, "2026-10-17T10:15:00.000Z");
  const sk = shouldSkip(s, NOW);
  assert.equal(sk.skip, true);
  assert.match(sk.reason ?? "", /rate-limited/);
});

test("health state: fetched but stale data is classified stale, zero items is no_relevant_update", () => {
  const stale = nextHealthState(emptyHealth("rss_ecb"), { ok: true, errorClass: "ok", items: 5, newestObservationAt: "2026-10-01T00:00:00.000Z" }, NOW, 7 * 24 * H);
  assert.equal(stale.errorClass, "stale");
  assert.equal(stale.status, "stale");
  const none = nextHealthState(emptyHealth("rss_fed"), { ok: true, errorClass: "ok", items: 0, newestObservationAt: "2026-10-17T08:00:00.000Z" }, NOW, 7 * 24 * H);
  assert.equal(none.errorClass, "no_relevant_update");
  const ok = nextHealthState(none, { ok: true, errorClass: "ok", items: 3, newestObservationAt: "2026-10-17T09:00:00.000Z" }, NOW, 7 * 24 * H);
  assert.equal(ok.errorClass, "ok");
  assert.equal(ok.status, "healthy");
  assert.equal(ok.consecutiveFailures, 0);
});

test("health state: success after failures resets counters; last valid observation never moves backwards", () => {
  let s = nextHealthState(emptyHealth("x"), { ok: true, errorClass: "ok", items: 1, newestObservationAt: "2026-10-17T09:00:00.000Z" }, NOW, H * 24);
  s = nextHealthState(s, { ok: false, errorClass: "invalid_data", error: "bad xml" }, NOW, H * 24);
  assert.equal(s.errorClass, "invalid_data");
  assert.equal(s.lastValidObservationAt, "2026-10-17T09:00:00.000Z");
  s = nextHealthState(s, { ok: true, errorClass: "ok", items: 1, newestObservationAt: "2026-10-16T09:00:00.000Z" }, NOW, H * 48);
  assert.equal(s.lastValidObservationAt, "2026-10-17T09:00:00.000Z");
  assert.equal(s.consecutiveFailures, 0);
});

test("disabled sources are reported disabled, not failing", () => {
  const s = nextHealthState(emptyHealth("rss_reuters"), { ok: false, errorClass: "disabled", error: "retired" }, NOW, H);
  assert.equal(s.status, "disabled");
  assert.equal(s.consecutiveFailures, 0);
});
