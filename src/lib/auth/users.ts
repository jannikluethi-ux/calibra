import { randomUUID } from "crypto";
import { getDb } from "../db";
import { hashPassword, verifyPassword } from "./password";
import { DEMO_CREDENTIALS, type PlanId } from "../billing/plans";

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


export function ensureDemoUsers() {
  const db = getDb();
  const find = db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE");
  const insert = db.prepare(
    `INSERT INTO users(id, email, password_hash, plan, display_name, created_at)
     VALUES(?, ?, ?, ?, ?, ?)`
  );
  for (const demo of DEMO_CREDENTIALS) {
    const existing = find.get(demo.email) as { id: string } | undefined;
    if (existing) {
      // Keep existing plan (demo checkout may have upgraded); refresh password only
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
        hashPassword(demo.password),
        existing.id
      );
      continue;
    }
    insert.run(
      randomUUID(),
      demo.email.toLowerCase(),
      hashPassword(demo.password),
      demo.plan,
      demo.plan === "pro" ? "Demo Pro" : "Demo Free",
      new Date().toISOString()
    );
  }
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

export function authenticateUser(email: string, password: string): UserRecord | null {
  ensureDemoUsers();
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
