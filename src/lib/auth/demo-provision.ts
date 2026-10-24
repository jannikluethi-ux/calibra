/**
 * Opt-in demo-account provisioning (B2 get-fix rec. 2). NEVER imported by a request path: only
 * scripts/provision-demo-users.ts calls it, and only when CALIBRA_DEMO_USERS=1.
 * Insert-only: an existing account with a demo email is left completely untouched (no password re-hash,
 * no plan change), so running it twice — or against a DB where the user changed the password — is safe.
 */
import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { hashPassword } from "./password";
import { DEMO_CREDENTIALS } from "../billing/plans";

export const DEMO_USERS_ENV = "CALIBRA_DEMO_USERS";

export function demoUsersEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[DEMO_USERS_ENV] === "1";
}

export interface DemoProvisionResult {
  created: string[];
  skippedExisting: string[];
}

export function provisionDemoUsers(db: Database.Database, now: Date = new Date()): DemoProvisionResult {
  const find = db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE");
  const insert = db.prepare(
    `INSERT INTO users(id, email, password_hash, plan, display_name, created_at) VALUES(?, ?, ?, ?, ?, ?)`
  );
  const result: DemoProvisionResult = { created: [], skippedExisting: [] };
  db.transaction(() => {
    for (const demo of DEMO_CREDENTIALS) {
      const email = demo.email.toLowerCase();
      if (find.get(email)) {
        result.skippedExisting.push(email);
        continue;
      }
      insert.run(randomUUID(), email, hashPassword(demo.password), demo.plan, demo.plan === "pro" ? "Demo Pro" : "Demo Free", now.toISOString());
      result.created.push(email);
    }
  })();
  return result;
}
