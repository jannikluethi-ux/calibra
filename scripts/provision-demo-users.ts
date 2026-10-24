/**
 * Explicit, opt-in creation of the local demo accounts (B2 get-fix rec. 2). Off by default:
 *   CALIBRA_DEMO_USERS=1 npm run provision:demo-users      (writes process.cwd()/data/gfi.db)
 * Insert-only — never re-hashes or changes an existing account. Prints emails/counts only, never passwords.
 * Do not run against a production DB unless demo accounts are explicitly wanted there.
 */
import { getDb } from "../src/lib/db";
import { demoUsersEnabled, provisionDemoUsers, DEMO_USERS_ENV } from "../src/lib/auth/demo-provision";

if (!demoUsersEnabled()) {
  console.error(`Demo users are disabled. Set ${DEMO_USERS_ENV}=1 to provision them explicitly (insert-only).`);
  process.exit(2);
}
const r = provisionDemoUsers(getDb());
console.log(JSON.stringify({ db: `${process.cwd()}/data/gfi.db`, created: r.created, skippedExisting: r.skippedExisting }));
