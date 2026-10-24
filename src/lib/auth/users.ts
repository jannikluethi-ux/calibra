import { randomUUID } from "crypto";
import { getDb } from "../db";
import { hashPassword, verifyPassword } from "./password";
import type { PlanId } from "../billing/plans";

export interface UserRecord {
  id: string;
  email: string;
  plan: PlanId;
  createdAt: string;
  displayName: string | null;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  plan: string;
  created_at: string;
  display_name: string | null;
}

function rowToUser(row: UserRow): UserRecord {
  const plan = (row.plan === "pro" || row.plan === "api" ? row.plan : "free") as PlanId;
  return {
    id: row.id,
    email: row.email,
    plan,
    createdAt: row.created_at,
    displayName: row.display_name,
  };
}


export function createUser(email: string, password: string, plan: PlanId = "free"): UserRecord {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    throw new Error("Invalid email");
  }
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(normalized);
  if (existing) throw new Error("Email already registered");
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO users(id, email, password_hash, plan, display_name, created_at)
     VALUES(?, ?, ?, ?, ?, ?)`
  ).run(id, normalized, hashPassword(password), plan, null, createdAt);
  return { id, email: normalized, plan, createdAt, displayName: null };
}

/** Read-only credential check. Demo users are never provisioned here (see scripts/provision-demo-users.ts). */
export function authenticateUser(email: string, password: string): UserRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE")
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return rowToUser(row);
}

export function getUserById(id: string): UserRecord | null {
  const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function getUserByEmail(email: string): UserRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE")
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function setUserPlan(userId: string, plan: PlanId): UserRecord | null {
  getDb().prepare("UPDATE users SET plan = ? WHERE id = ?").run(plan, userId);
  return getUserById(userId);
}
