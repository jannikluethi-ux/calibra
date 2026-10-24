/**
 * B2 get-fix rec. 2/7: demo accounts never provisioned on a request; opt-in, insert-only script;
 * read-only session lookup (expired -> null, row kept, no writes).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { useTempDb } from "./_tmpdb";

useTempDb("calibra-authro-");
const ROOT = join(__dirname, "..", "..");

test("no app code path provisions demo users", () => {
  let hits = "";
  try {
    hits = execFileSync("grep", ["-rlE", "ensureDemoUsers|provisionDemoUsers|demo-provision", join(ROOT, "src")], { encoding: "utf8" });
  } catch {
    hits = ""; // grep exit 1 = no match
  }
  const files = hits.trim().split("\n").filter(Boolean).map((f) => f.replace(/^.*\/src\//, "src/"));
  assert.deepEqual(files, ["src/lib/auth/demo-provision.ts"]);
});

test("auth lookups on an empty DB create no users", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { authenticateUser } = await import("../../src/lib/auth/users");
  const { getUserFromToken } = await import("../../src/lib/auth/session");
  const { DEMO_CREDENTIALS } = await import("../../src/lib/billing/plans");
  const db = getDb();
  const tc = db.prepare("SELECT total_changes() c").get();
  for (const d of DEMO_CREDENTIALS) assert.equal(authenticateUser(d.email, d.password), null, "demo login fails until provisioned");
  assert.equal(getUserFromToken("nope"), null);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c, 0);
  assert.deepEqual(db.prepare("SELECT total_changes() c").get(), tc);
});

test("session lookup is read-only: valid resolves, expired resolves to null and its row is kept", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { createUser } = await import("../../src/lib/auth/users");
  const { getUserFromToken } = await import("../../src/lib/auth/session");
  const db = getDb();
  const u = createUser("ro-session@test.local", "a-long-test-password");
  const ins = db.prepare("INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)");
  ins.run("valid-tok", u.id, "2026-01-01T00:00:00.000Z", new Date(Date.now() + 3600e3).toISOString());
  ins.run("expired-tok", u.id, "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
  ins.run("garbage-tok", u.id, "2026-01-01T00:00:00.000Z", "not-a-date");
  const tc = db.prepare("SELECT total_changes() c").get();
  for (let i = 0; i < 3; i++) {
    assert.equal(getUserFromToken("valid-tok")?.id, u.id);
    assert.equal(getUserFromToken("expired-tok"), null);
    assert.equal(getUserFromToken("garbage-tok"), null);
  }
  assert.deepEqual(db.prepare("SELECT total_changes() c").get(), tc, "no writes");
  assert.equal((db.prepare("SELECT COUNT(*) c FROM sessions").get() as { c: number }).c, 3, "expired rows kept (cleanup is a later approved job)");
});

test("provisioning is off by default and insert-only (never re-hashes an existing account)", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { demoUsersEnabled, provisionDemoUsers } = await import("../../src/lib/auth/demo-provision");
  const { authenticateUser } = await import("../../src/lib/auth/users");
  const { DEMO_CREDENTIALS } = await import("../../src/lib/billing/plans");
  assert.equal(demoUsersEnabled({}), false);
  assert.equal(demoUsersEnabled({ CALIBRA_DEMO_USERS: "true" }), false);
  assert.equal(demoUsersEnabled({ CALIBRA_DEMO_USERS: "1" }), true);
  const db = getDb();
  const [pro, free] = DEMO_CREDENTIALS;
  // an account already holding a demo email with its own password and plan
  db.prepare("INSERT INTO users(id, email, password_hash, plan, display_name, created_at) VALUES('pre', ?, 'custom-hash', 'api', 'Mine', 'x')").run(pro.email);
  const r1 = provisionDemoUsers(db, new Date("2026-10-24T00:00:00Z"));
  assert.deepEqual(r1, { created: [free.email], skippedExisting: [pro.email] });
  assert.deepEqual(db.prepare("SELECT password_hash, plan, display_name FROM users WHERE id = 'pre'").get(), {
    password_hash: "custom-hash",
    plan: "api",
    display_name: "Mine",
  });
  assert.ok(authenticateUser(free.email, free.password));
  const snap = db.prepare("SELECT * FROM users ORDER BY id").all();
  const r2 = provisionDemoUsers(db);
  assert.deepEqual(r2.created, []);
  assert.deepEqual(db.prepare("SELECT * FROM users ORDER BY id").all(), snap, "second run changes nothing");
});

test("provision script refuses without CALIBRA_DEMO_USERS=1 and writes nothing", async () => {
  const { getDb } = await import("../../src/lib/db");
  getDb().pragma("wal_checkpoint(TRUNCATE)");
  const dbFile = join(process.cwd(), "data", "gfi.db");
  const h = () => createHash("sha256").update(readFileSync(dbFile)).digest("hex");
  const before = h();
  const env = { ...process.env };
  delete env.CALIBRA_DEMO_USERS;
  let code = 0;
  let stderr = "";
  try {
    execFileSync(join(ROOT, "node_modules", ".bin", "tsx"), [join(ROOT, "scripts", "provision-demo-users.ts")], { env, cwd: process.cwd(), encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    code = (e as { status: number }).status;
    stderr = String((e as { stderr: string }).stderr);
  }
  assert.equal(code, 2, stderr);
  assert.match(stderr, /disabled/);
  assert.doesNotMatch(stderr, /calibra-(pro|free)-demo/, "never prints passwords");
  assert.equal(h(), before, "DB file unchanged");
});
