/**
 * Child process used by init-concurrency.test.ts. Runs in a throwaway cwd (its data/gfi.db), preloads the app modules,
 * waits for a shared start instant (RACE_START_AT, epoch ms) so all workers hit the DB at the same moment, then runs
 * exactly what the explicit commands run:  migrate -> getDb() (schema step)  |  seed -> ensureSeedData() (npm run seed).
 * Network is blocked; prints one JSON line.
 */
globalThis.fetch = (async () => {
  throw new Error("network disabled in race worker");
}) as typeof fetch;

async function main() {
  const mode = process.argv[2] ?? "migrate";
  const db = await import("../../src/lib/db");
  const seed = mode.includes("seed") ? await import("../../src/lib/bootstrap/refresh") : null;
  const startAt = Number(process.env.RACE_START_AT ?? 0);
  const wait = startAt - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const t0 = Date.now();
  const handle = db.getDb();
  if (seed) seed.ensureSeedData();
  const uv = handle.pragma("user_version", { simple: true });
  console.log(JSON.stringify({ mode, pid: process.pid, late_ms: t0 - startAt, user_version: uv }));
}
main().catch((e) => {
  console.log(JSON.stringify({ error: String((e as Error)?.message ?? e), code: (e as { code?: string })?.code, at: String((e as Error)?.stack ?? "").split("\n").slice(1, 6).map((l) => l.trim()) }));
  process.exit(1);
});
