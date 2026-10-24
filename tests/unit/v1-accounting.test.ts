/**
 * B2 get-fix (C9): the ONLY intended writes on GET are the public v1 API's key accounting:
 * `api_keys.last_used` (on a valid key) and the per-minute `api_rate_limits` counter (on an allowed call).
 * Verified separately from the read-only harness (which probes v1 without a key -> 401, zero writes).
 * Offline: temp DB, fetch blocked. The plaintext test key is never printed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";
import { snapshotDb, blockFetch } from "./_dbsnap";

useTempDb("calibra-v1acct-");
const fetchCalls = blockFetch();
const ROUTES = ["calibration", "events", "forecasts", "movers", "scenarios"] as const;

async function setup() {
  const { getDb } = await import("../../src/lib/db");
  const { ensureSeedData } = await import("../../src/lib/bootstrap/refresh");
  const { createUser } = await import("../../src/lib/auth/users");
  const { createApiKey } = await import("../../src/lib/api-keys/store");
  ensureSeedData();
  const user = createUser("v1-acct@example.invalid", "v1-acct-password-not-secret", "pro");
  const key = createApiKey(user.id, "test");
  return { db: getDb(), key };
}

function changedTables(a: ReturnType<typeof snapshotDb>, b: ReturnType<typeof snapshotDb>) {
  return Object.keys({ ...a, ...b }).filter((t) => JSON.stringify(a[t]) !== JSON.stringify(b[t])).sort();
}

test("v1 GET with a valid key writes only api_keys.last_used and api_rate_limits; repeated calls count up", async () => {
  const { db, key } = await setup();
  const keyRow = () => db.prepare("SELECT id, user_id, key_hash, key_prefix, plan, name, created_at, revoked FROM api_keys WHERE id = ?").get(key.id);
  const fixed = keyRow();
  const count = () => (db.prepare("SELECT COALESCE(SUM(count),0) c FROM api_rate_limits WHERE key_id = ?").get(key.id) as { c: number }).c;
  let expected = count();
  for (const r of ROUTES) {
    const { GET } = await import(`../../src/app/api/v1/${r}/route`);
    for (let i = 0; i < 3; i++) {
      const before = snapshotDb(db);
      const res = await GET(new Request(`http://localhost:3456/api/v1/${r}`, { headers: { authorization: `Bearer ${key.plaintext}` } }));
      assert.equal(res.status, 200, `${r} call ${i + 1}`);
      const after = snapshotDb(db);
      const changed = changedTables(before, after);
      assert.ok(changed.every((t) => t === "api_keys" || t === "api_rate_limits"), `${r}: unexpected writes to ${changed.join(",")}`);
      assert.ok(changed.includes("api_rate_limits"), `${r}: rate-limit counter recorded`);
      expected++;
      // Minute rollover between calls would start a new window row; the SUM still grows by exactly one.
      assert.equal(count(), expected);
      assert.deepEqual(keyRow(), fixed, "only last_used may change on api_keys");
      assert.ok((db.prepare("SELECT last_used FROM api_keys WHERE id = ?").get(key.id) as { last_used: string | null }).last_used);
    }
  }
  assert.deepEqual(fetchCalls, []);
});

test("v1 GET with a missing, invalid or revoked key writes nothing", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { createUser } = await import("../../src/lib/auth/users");
  const { createApiKey, revokeApiKey } = await import("../../src/lib/api-keys/store");
  const db = getDb();
  const u = createUser("v1-revoked@example.invalid", "v1-revoked-password-not-secret", "pro");
  const k = createApiKey(u.id, "revoked");
  revokeApiKey(u.id, k.id);
  for (const r of ROUTES) {
    const { GET } = await import(`../../src/app/api/v1/${r}/route`);
    for (const headers of [{}, { authorization: "Bearer calibra_not_a_real_key" }, { "x-api-key": k.plaintext }] as Record<string, string>[]) {
      const before = snapshotDb(db);
      const res = await GET(new Request(`http://localhost:3456/api/v1/${r}`, { headers }));
      assert.equal(res.status, 401);
      assert.deepEqual(changedTables(before, snapshotDb(db)), []);
    }
  }
});

test("over the per-minute limit: 429, counter not incremented (only last_used is touched)", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { createUser } = await import("../../src/lib/auth/users");
  const { createApiKey } = await import("../../src/lib/api-keys/store");
  const db = getDb();
  const u = createUser("v1-limit@example.invalid", "v1-limit-password-not-secret", "pro");
  const k = createApiKey(u.id, "limit");
  const ws = new Date();
  ws.setSeconds(0, 0);
  // Fill this minute's and the next minute's window so a rollover mid-test cannot reset it.
  for (const t of [ws.getTime(), ws.getTime() + 60_000]) {
    db.prepare("INSERT INTO api_rate_limits(key_id, window_start, count) VALUES(?, ?, 100000)").run(k.id, new Date(t).toISOString());
  }
  const { GET } = await import("../../src/app/api/v1/events/route");
  const before = snapshotDb(db);
  const res = await GET(new Request("http://localhost:3456/api/v1/events", { headers: { authorization: `Bearer ${k.plaintext}` } }));
  assert.equal(res.status, 429);
  assert.deepEqual(changedTables(before, snapshotDb(db)), ["api_keys"]);
});
