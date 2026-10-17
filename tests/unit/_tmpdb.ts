import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Point the app's DB (process.cwd()/data/gfi.db) at a fresh temp dir. Call BEFORE importing app modules. */
export function useTempDb(prefix = "calibra-unit-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, "data"), { recursive: true });
  process.chdir(dir);
  return dir;
}
