/**
 * B2.1 — job-trigger endpoints require CALIBRA_JOB_TOKEN (fail closed), constant-time compare,
 * honour the automation switch, single-flight + min-interval guard. Offline: temp DB, fetch blocked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";
import { snapshotDb, blockFetch } from "./_dbsnap";

useTempDb("calibra-jobguard-");
delete process.env.CALIBRA_JOB_TOKEN;
delete process.env.CALIBRA_SCHEDULER;
delete process.env.CALIBRA_JOB_MIN_INTERVAL_S;
const fetchCalls = blockFetch();

const TOKEN = "t".repeat(20) + "-unit-test-token-0123456789"; // test-only value, 47 chars
const BASE = "http://localhost:3456";

type Handler = (req: Request) => Promise<Response>;
type Trigger = { name: string; method: "POST" | "PATCH"; path: string; load: () => Promise<Handler> };

const TRIGGERS: Trigger[] = [
  { name: "scheduler/tick", method: "POST", path: "/api/scheduler/tick", load: async () => (await import("../../src/app/api/scheduler/tick/route")).POST },
  { name: "scheduler/status PATCH", method: "PATCH", path: "/api/scheduler/status", load: async () => (await import("../../src/app/api/scheduler/status/route")).PATCH },
  { name: "refresh", method: "POST", path: "/api/refresh", load: async () => (await import("../../src/app/api/refresh/route")).POST },
  { name: "events", method: "POST", path: "/api/events", load: async () => (await import("../../src/app/api/events/route")).POST },
  { name: "market", method: "POST", path: "/api/market", load: async () => (await import("../../src/app/api/market/route")).POST },
  { name: "instruments/sync", method: "POST", path: "/api/instruments/sync", load: async () => (await import("../../src/app/api/instruments/sync/route")).POST },
  { name: "forecasts/resolve", method: "POST", path: "/api/forecasts/resolve", load: async () => (await import("../../src/app/api/forecasts/resolve/route")).POST },
  { name: "forecasts", method: "POST", path: "/api/forecasts", load: async () => (await import("../../src/app/api/forecasts/route")).POST },
  { name: "scenarios", method: "POST", path: "/api/scenarios", load: async () => (await import("../../src/app/api/scenarios/route")).POST },
  { name: "risk", method: "POST", path: "/api/risk", load: async () => (await import("../../src/app/api/risk/route")).POST },
  { name: "warnings", method: "POST", path: "/api/warnings", load: async () => (await import("../../src/app/api/warnings/route")).POST },
  { name: "causal", method: "POST", path: "/api/causal", load: async () => (await import("../../src/app/api/causal/route")).POST },
];

function req(t: Trigger, headers: Record<string, string> = {}, query = "", body?: unknown): Request {
  return new Request(BASE + t.path + query, {
    method: t.method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? (t.method === "PATCH" ? JSON.stringify({ enabled: true }) : undefined) : JSON.stringify(body),
  });
}

async function ctx() {
  const db = await import("../../src/lib/db");
  const guard = await import("../../src/lib/security/job-guard");
  db.getDb(); // migrations happen on first open; baseline is taken after
  return { db, guard };
}

/** Assert that calling every trigger with `headers` returns `status` and changes nothing. */
async function expectAllRefused(headers: Record<string, string>, status: number, query = "") {
  const { db, guard } = await ctx();
  guard.resetJobGuardState();
  const before = snapshotDb(db.getDb());
  const f0 = fetchCalls.length;
  for (const t of TRIGGERS) {
    const res = await (await t.load())(req(t, headers, query));
    assert.equal(res.status, status, `${t.name} → ${res.status}`);
    const j = (await res.json()) as { error?: string };
    assert.equal(typeof j.error, "string", `${t.name} has error message`);
  }
  assert.deepEqual(snapshotDb(db.getDb()), before, "no DB writes");
  assert.equal(fetchCalls.length, f0, "no fetch calls");
  assert.equal(globalThis.__calibraSchedulerStarted, undefined, "scheduler loop not armed");
}

test("12 trigger handlers exist and are covered", async () => {
  assert.equal(TRIGGERS.length, 12);
  for (const t of TRIGGERS) assert.equal(typeof (await t.load()), "function", t.name);
});

test("fail closed: token env unset → 503 for every trigger, even with a header", async () => {
  delete process.env.CALIBRA_JOB_TOKEN;
  await expectAllRefused({}, 503);
  await expectAllRefused({ authorization: `Bearer ${TOKEN}` }, 503, "?force=1");
});

test("fail closed: blank or too-short token env → 503", async () => {
  process.env.CALIBRA_JOB_TOKEN = "   ";
  await expectAllRefused({ authorization: "Bearer    " }, 503);
  process.env.CALIBRA_JOB_TOKEN = "short-token";
  await expectAllRefused({ authorization: "Bearer short-token" }, 503, "?force=1");
});

test("unauthorized: no Authorization header → 401 with WWW-Authenticate", async () => {
  process.env.CALIBRA_JOB_TOKEN = TOKEN;
  await expectAllRefused({}, 401, "?force=1");
  const t = TRIGGERS[0];
  const res = await (await t.load())(req(t));
  assert.equal(res.headers.get("www-authenticate"), "Bearer");
});

test("malformed Authorization headers → 401", async () => {
  process.env.CALIBRA_JOB_TOKEN = TOKEN;
  for (const h of ["Basic " + TOKEN, "Bearer", "Bearer ", `Bearer ${TOKEN} extra`, `Bearer ${TOKEN},${TOKEN}`, TOKEN, `Token ${TOKEN}`, `Bearer ${"x".repeat(2000)}`]) {
    await expectAllRefused({ authorization: h }, 401, "?force=1");
  }
});

test("wrong token (same length, shorter, longer, prefix) → 403", async () => {
  process.env.CALIBRA_JOB_TOKEN = TOKEN;
  const wrong = [TOKEN.slice(0, -1) + "X", TOKEN.slice(0, 10), TOKEN + "0", TOKEN.toUpperCase()];
  for (const w of wrong) await expectAllRefused({ authorization: `Bearer ${w}` }, 403, "?force=1");
});

test("tokensMatch is a digest compare (equal → true, any difference → false)", async () => {
  const { guard } = await ctx();
  assert.equal(guard.tokensMatch(TOKEN, TOKEN), true);
  assert.equal(guard.tokensMatch(TOKEN + " ", TOKEN), false);
  assert.equal(guard.tokensMatch("", TOKEN), false);
});

test("authorised but automation disabled (scheduler.enabled=0) → 409 for job triggers, nothing runs", async () => {
  process.env.CALIBRA_JOB_TOKEN = TOKEN;
  const { db, guard } = await ctx();
  db.setMeta("scheduler.enabled", "0");
  guard.resetJobGuardState();
  const before = snapshotDb(db.getDb());
  const f0 = fetchCalls.length;
  for (const t of TRIGGERS.filter((x) => x.method === "POST")) {
    const res = await (await t.load())(req(t, { authorization: `Bearer ${TOKEN}` }));
    assert.equal(res.status, 409, t.name);
    assert.match(((await res.json()) as { error: string }).error, /force=1/);
  }
  assert.deepEqual(snapshotDb(db.getDb()), before);
  assert.equal(fetchCalls.length, f0);
  assert.equal(db.getMeta("scheduler.lastTick"), null, "tick did not run");
});

test("authorised + CALIBRA_SCHEDULER=0 (dev hard-disable): triggers 409, PATCH enable → 409 env message", async () => {
  process.env.CALIBRA_JOB_TOKEN = TOKEN;
  process.env.CALIBRA_SCHEDULER = "0";
  try {
    const { db, guard } = await ctx();
    db.setMeta("scheduler.enabled", "1");
    guard.resetJobGuardState();
    const before = snapshotDb(db.getDb());
    const tick = TRIGGERS[0];
    const r1 = await (await tick.load())(req(tick, { authorization: `Bearer ${TOKEN}` }));
    assert.equal(r1.status, 409);
    const patch = TRIGGERS[1];
    const r2 = await (await patch.load())(req(patch, { authorization: `Bearer ${TOKEN}` }, "", { enabled: true }));
    assert.equal(r2.status, 409);
    assert.match(((await r2.json()) as { error: string }).error, /CALIBRA_SCHEDULER=0/);
    assert.deepEqual(snapshotDb(db.getDb()), before);
    assert.equal(globalThis.__calibraSchedulerStarted, undefined);
  } finally {
    delete process.env.CALIBRA_SCHEDULER;
  }
});

test("authorised + ?force=1 runs a local derive job (POST /api/risk) and a repeat within the interval → 429", async () => {
  process.env.CALIBRA_JOB_TOKEN = TOKEN;
  const { db, guard } = await ctx();
  db.setMeta("scheduler.enabled", "0");
  guard.resetJobGuardState();
  const risk = TRIGGERS.find((t) => t.name === "risk")!;
  const f0 = fetchCalls.length;
  const r1 = await (await risk.load())(req(risk, { authorization: `bearer ${TOKEN}` }, "?force=1"));
  assert.equal(r1.status, 200);
  assert.ok(Array.isArray(((await r1.json()) as { gauges: unknown[] }).gauges));
  const r2 = await (await risk.load())(req(risk, { authorization: `Bearer ${TOKEN}` }, "?force=1"));
  assert.equal(r2.status, 429);
  assert.ok(Number(r2.headers.get("retry-after")) > 0);
  assert.equal(fetchCalls.length, f0, "derive job made no network calls");
});

test("PATCH scheduler/status authorised: validates body (400), toggles, not interval-limited", async () => {
  process.env.CALIBRA_JOB_TOKEN = TOKEN;
  const { db, guard } = await ctx();
  guard.resetJobGuardState();
  const patch = TRIGGERS[1];
  const h = { authorization: `Bearer ${TOKEN}` };
  const bad = await (await patch.load())(req(patch, h, "", { enabled: "yes" }));
  assert.equal(bad.status, 400);
  for (let i = 0; i < 3; i++) {
    const r = await (await patch.load())(req(patch, h, "", { enabled: false }));
    assert.equal(r.status, 200);
  }
  assert.equal(db.getMeta("scheduler.enabled"), "0");
  assert.equal(globalThis.__calibraSchedulerStarted, undefined, "disable does not arm the loop");
});

test("single-flight: concurrent run of the same job key → 409; different key allowed; released after", async () => {
  process.env.CALIBRA_JOB_TOKEN = TOKEN;
  const { guard } = await ctx();
  guard.resetJobGuardState();
  const mk = () => new Request(BASE + "/api/x?force=1", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let runs = 0;
  const slow = async () => {
    runs++;
    await gate;
    return new Response("{}", { status: 200 });
  };
  const p1 = guard.runGuardedJob(mk(), "k1", slow, { minIntervalMs: 0 });
  const r2 = await guard.runGuardedJob(mk(), "k1", slow, { minIntervalMs: 0 });
  assert.equal(r2.status, 409);
  const r3 = await guard.runGuardedJob(mk(), "k2", () => new Response("{}"), { minIntervalMs: 0 });
  assert.equal(r3.status, 200);
  release();
  assert.equal((await p1).status, 200);
  const r4 = await guard.runGuardedJob(mk(), "k1", () => new Response("{}"), { minIntervalMs: 0 });
  assert.equal(r4.status, 200);
  assert.equal(runs, 1);
});

test("single-flight slot is released when the job throws", async () => {
  process.env.CALIBRA_JOB_TOKEN = TOKEN;
  const { guard } = await ctx();
  guard.resetJobGuardState();
  const mk = () => new Request(BASE + "/api/x?force=1", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } });
  await assert.rejects(guard.runGuardedJob(mk(), "boom", () => { throw new Error("job failed"); }, { minIntervalMs: 0 }));
  const r = await guard.runGuardedJob(mk(), "boom", () => new Response("{}"), { minIntervalMs: 0 });
  assert.equal(r.status, 200);
});

test("CALIBRA_JOB_MIN_INTERVAL_S env controls the interval (0 disables it)", async () => {
  process.env.CALIBRA_JOB_TOKEN = TOKEN;
  const { guard } = await ctx();
  const mk = () => new Request(BASE + "/api/x?force=1", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } });
  try {
    process.env.CALIBRA_JOB_MIN_INTERVAL_S = "0";
    guard.resetJobGuardState();
    for (let i = 0; i < 3; i++) assert.equal((await guard.runGuardedJob(mk(), "iv", () => new Response("{}"))).status, 200);
    process.env.CALIBRA_JOB_MIN_INTERVAL_S = "600";
    guard.resetJobGuardState();
    assert.equal((await guard.runGuardedJob(mk(), "iv", () => new Response("{}"))).status, 200);
    const r = await guard.runGuardedJob(mk(), "iv", () => new Response("{}"));
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get("retry-after")) > 590);
  } finally {
    delete process.env.CALIBRA_JOB_MIN_INTERVAL_S;
  }
});

test("read-only GETs stay public (no token needed): scheduler/status, refresh", async () => {
  delete process.env.CALIBRA_JOB_TOKEN;
  const s = await (await import("../../src/app/api/scheduler/status/route")).GET();
  assert.equal(s.status, 200);
  const r = await (await import("../../src/app/api/refresh/route")).GET();
  assert.equal(r.status, 200);
});

test("no external requests were attempted during this file", () => {
  assert.deepEqual(fetchCalls, []);
});
