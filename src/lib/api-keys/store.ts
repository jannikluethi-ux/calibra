import { createHash, randomBytes } from "crypto";
import { getDb } from "../db";
import { getUserById } from "../auth/users";
import { getPlan, type PlanId } from "../billing/plans";

export interface ApiKeyMeta {
  id: string;
  userId: string;
  keyPrefix: string;
  plan: PlanId;
  name: string | null;
  createdAt: string;
  lastUsed: string | null;
  revoked: boolean;
}

export interface CreatedApiKey extends ApiKeyMeta {
  /** Plaintext — shown once only */
  plaintext: string;
}

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function generatePlaintext(): { plaintext: string; prefix: string } {
  const raw = randomBytes(24).toString("base64url");
  const plaintext = `calibra_${raw}`;
  const prefix = plaintext.slice(0, 16);
  return { plaintext, prefix };
}

export function listApiKeys(userId: string): ApiKeyMeta[] {
  const rows = getDb()
    .prepare(
      `SELECT id, user_id, key_prefix, plan, name, created_at, last_used, revoked
       FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(userId) as {
    id: string;
    user_id: string;
    key_prefix: string;
    plan: string;
    name: string | null;
    created_at: string;
    last_used: string | null;
    revoked: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    keyPrefix: r.key_prefix,
    plan: (r.plan === "api" || r.plan === "pro" ? r.plan : "free") as PlanId,
    name: r.name,
    createdAt: r.created_at,
    lastUsed: r.last_used,
    revoked: !!r.revoked,
  }));
}

export function createApiKey(userId: string, name?: string): CreatedApiKey {
  const user = getUserById(userId);
  if (!user) throw new Error("User not found");
  const planDef = getPlan(user.plan);
  if (!planDef.limits.apiKeysAllowed) {
    throw new Error("API keys require Pro or API plan");
  }
  const active = listApiKeys(userId).filter((k) => !k.revoked);
  if (active.length >= planDef.limits.apiKeysMax) {
    throw new Error(`Plan allows at most ${planDef.limits.apiKeysMax} API key(s)`);
  }
  const { plaintext, prefix } = generatePlaintext();
  const id = randomBytes(16).toString("hex");
  const createdAt = new Date().toISOString();
  const keyPlan: PlanId = user.plan === "api" ? "api" : "pro";
  getDb()
    .prepare(
      `INSERT INTO api_keys(id, user_id, key_hash, key_prefix, plan, name, created_at, last_used, revoked)
       VALUES(?, ?, ?, ?, ?, ?, ?, NULL, 0)`
    )
    .run(id, userId, hashKey(plaintext), prefix, keyPlan, name || null, createdAt);
  return {
    id,
    userId,
    keyPrefix: prefix,
    plan: keyPlan,
    name: name || null,
    createdAt,
    lastUsed: null,
    revoked: false,
    plaintext,
  };
}

export function revokeApiKey(userId: string, keyId: string): boolean {
  const r = getDb()
    .prepare("UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?")
    .run(keyId, userId);
  return r.changes > 0;
}

export interface ApiKeyAuthResult {
  keyId: string;
  userId: string;
  plan: PlanId;
  rateLimitPerMinute: number;
}

/**
 * INTENTIONAL write on GET (B2 get-fix, approved): a valid key updates `api_keys.last_used`.
 * Together with checkRateLimit() this is the only write any GET request performs; see
 * tests/unit/v1-accounting.test.ts and docs/OPERATIONS.md "Intended writes on GET".
 */
export function authenticateApiKey(rawKey: string): ApiKeyAuthResult | null {
  if (!rawKey || !rawKey.startsWith("calibra_")) return null;
  const hash = hashKey(rawKey);
  const row = getDb()
    .prepare(
      `SELECT id, user_id, plan, revoked FROM api_keys WHERE key_hash = ?`
    )
    .get(hash) as { id: string; user_id: string; plan: string; revoked: number } | undefined;
  if (!row || row.revoked) return null;
  const plan = (row.plan === "api" || row.plan === "pro" ? row.plan : "pro") as PlanId;
  getDb()
    .prepare("UPDATE api_keys SET last_used = ? WHERE id = ?")
    .run(new Date().toISOString(), row.id);
  return {
    keyId: row.id,
    userId: row.user_id,
    plan,
    rateLimitPerMinute: getPlan(plan).limits.apiRatePerMinute,
  };
}

/** Simple per-minute rate limit stored in SQLite. INTENTIONAL write on GET (allowed calls increment `api_rate_limits`). */
export function checkRateLimit(keyId: string, limitPerMinute: number): {
  allowed: boolean;
  remaining: number;
  limit: number;
} {
  const windowStart = new Date();
  windowStart.setSeconds(0, 0);
  const ws = windowStart.toISOString();
  const db = getDb();
  const row = db
    .prepare("SELECT count FROM api_rate_limits WHERE key_id = ? AND window_start = ?")
    .get(keyId, ws) as { count: number } | undefined;
  const count = row?.count ?? 0;
  if (count >= limitPerMinute) {
    return { allowed: false, remaining: 0, limit: limitPerMinute };
  }
  if (row) {
    db.prepare("UPDATE api_rate_limits SET count = count + 1 WHERE key_id = ? AND window_start = ?").run(
      keyId,
      ws
    );
  } else {
    db.prepare("INSERT INTO api_rate_limits(key_id, window_start, count) VALUES(?, ?, 1)").run(keyId, ws);
  }
  return { allowed: true, remaining: Math.max(0, limitPerMinute - count - 1), limit: limitPerMinute };
}
