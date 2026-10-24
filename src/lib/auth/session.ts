import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { getDb } from "../db";
import { getUserById, type UserRecord } from "./users";
import type { PlanId } from "../billing/plans";
import { getPlan, planAtLeast } from "../billing/plans";

export const SESSION_COOKIE = "calibra_session";
const SESSION_DAYS = 14;

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("hex");
  const createdAt = new Date().toISOString();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  getDb()
    .prepare("INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)")
    .run(token, userId, createdAt, expires);
  return token;
}

export function destroySession(token: string) {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/**
 * Read-only session lookup (B2 get-fix rec. 2/7): no demo provisioning, no writes. An expired session simply
 * resolves to null; its row is left in place. Expired-session cleanup is deferred to a separately approved
 * maintenance job (docs/OPERATIONS.md, "Auth data hygiene") and is never done on a request.
 */
export function getUserFromToken(token: string | undefined | null): UserRecord | null {
  if (!token) return null;
  const row = getDb()
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?")
    .get(token) as { user_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (!(new Date(row.expires_at).getTime() >= Date.now())) return null; // expired or unparsable
  return getUserById(row.user_id);
}

/** Server Component / Route Handler: read session cookie */
export function getSessionUser(): UserRecord | null {
  try {
    const jar = cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    return getUserFromToken(token);
  } catch {
    return null;
  }
}

export function sessionCookieOptions(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure: process.env.NODE_ENV === "production",
  };
}

export function clearSessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}

export function requireUser(): UserRecord {
  const user = getSessionUser();
  if (!user) {
    const err = new Error("Unauthorized");
    (err as Error & { status: number }).status = 401;
    throw err;
  }
  return user;
}

export function userCanAccess(user: UserRecord | null, required: PlanId): boolean {
  if (!user) return required === "free";
  return planAtLeast(user.plan, required);
}

export function userPlanLimits(user: UserRecord | null) {
  return getPlan(user?.plan ?? "free").limits;
}
