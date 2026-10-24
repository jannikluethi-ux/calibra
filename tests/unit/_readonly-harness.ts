/**
 * Read-only regression harness for every GET route handler and every server page / layout (B2 get-fix).
 *
 * Import this module FIRST (before any app module): it installs spies that
 *  - record every mutating SQL statement run through better-sqlite3 (INSERT/UPDATE/DELETE/REPLACE) and every
 *    exec() / DDL (CREATE/ALTER/DROP) and pragma assignment,
 *  - BLOCK and record every outbound network attempt (fetch, http/https.request/get, net/tls.connect) so tests
 *    can never reach a provider or the running app,
 *  - record timers armed from app code (src/), child processes, fs writes, and the scheduler globals.
 * Each target is called repeatedly in a fake Next request scope (cookies) and must leave the DB byte-identical:
 * total_changes(), per-table row count + sha256, sqlite_master, schema_version, user_version and db/wal file stats.
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import cp from "node:child_process";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type Database from "better-sqlite3";

export const REPO = join(__dirname, "..", "..");
const APP = join(REPO, "src", "app");
const req = createRequire(join(REPO, "package.json"));
// tsx compiles JSX to React.createElement (classic runtime) — some modules build elements at import time.
(globalThis as Record<string, unknown>).React = req("react");
// Next's request storage expects the server runtime to expose AsyncLocalStorage globally.
(globalThis as Record<string, unknown>).AsyncLocalStorage ??= AsyncLocalStorage;
// layout.tsx imports globals.css; Next handles CSS at build time — ignore it here.
for (const ext of [".css", ".scss"]) (req.extensions as Record<string, unknown>)[ext] = () => undefined;

export type EventKind =
  | "sql-write"
  | "ddl"
  | "pragma-write"
  | "network"
  | "timer"
  | "child-process"
  | "fs-write";
export interface RecEvent {
  kind: EventKind;
  detail: string;
}
const rec = { active: false, events: [] as RecEvent[] };
function push(kind: EventKind, detail: string) {
  if (rec.active) rec.events.push({ kind, detail: detail.replace(/\s+/g, " ").trim().slice(0, 160) });
}
function appFrame(): string | null {
  const lines = (new Error().stack || "").split("\n").slice(3);
  const l = lines.find((x) => x.includes(`${sep}src${sep}`) && !x.includes("node_modules"));
  return l ? l.trim().replace(REPO + sep, "") : null;
}

// ---------------------------------------------------------------- network (blocked, always)
export const networkAttempts: string[] = [];
function blockNet(what: string): never {
  networkAttempts.push(what);
  push("network", what);
  throw new Error(`network disabled in tests: ${what}`);
}
globalThis.fetch = (async (input: unknown) =>
  blockNet("fetch " + String(input instanceof Request ? input.url : input))) as typeof fetch;
for (const [name, mod] of [["http", http], ["https", https]] as const) {
  for (const fn of ["request", "get"] as const) {
    (mod as unknown as Record<string, unknown>)[fn] = (a: unknown) =>
      blockNet(`${name}.${fn} ${typeof a === "string" ? a : JSON.stringify((a as { host?: string })?.host ?? a)}`);
  }
}
(net as unknown as Record<string, unknown>).connect = (a: unknown) => blockNet("net.connect " + JSON.stringify(a));
(net as unknown as Record<string, unknown>).createConnection = (a: unknown) => blockNet("net.createConnection " + JSON.stringify(a));
(tls as unknown as Record<string, unknown>).connect = (a: unknown) => blockNet("tls.connect " + JSON.stringify(a));

// ---------------------------------------------------------------- child processes (record + block)
for (const fn of ["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync"]) {
  const orig = (cp as unknown as Record<string, (...a: unknown[]) => unknown>)[fn];
  (cp as unknown as Record<string, unknown>)[fn] = function (this: unknown, ...a: unknown[]) {
    if (rec.active) {
      push("child-process", `${fn} ${String(a[0])}`);
      throw new Error("child processes disabled during read-only probes");
    }
    return orig.apply(this, a);
  };
}

// ---------------------------------------------------------------- timers from app code
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = ((fn: () => void, ms?: number, ...a: unknown[]) => {
  const f = appFrame();
  if (f) push("timer", `setInterval(${ms}) @ ${f}`);
  return realSetInterval(fn, ms, ...a);
}) as typeof setInterval;
globalThis.setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) => {
  const f = appFrame();
  if (f) push("timer", `setTimeout(${ms}) @ ${f}`);
  return realSetTimeout(fn, ms, ...a);
}) as typeof setTimeout;

// ---------------------------------------------------------------- fs writes
const tsxCache = /[/\\]tsx-\d+|[/\\]node_modules[/\\]/;
for (const op of ["writeFileSync", "appendFileSync", "mkdirSync", "renameSync", "unlinkSync", "copyFileSync", "rmSync", "createWriteStream", "writeFile", "appendFile", "mkdir", "rename", "unlink", "rm"]) {
  const orig = (fs as unknown as Record<string, (...a: unknown[]) => unknown>)[op];
  if (typeof orig !== "function") continue;
  (fs as unknown as Record<string, unknown>)[op] = function (this: unknown, p: unknown, ...a: unknown[]) {
    if (!tsxCache.test(String(p))) push("fs-write", `${op} ${String(p)}`);
    return orig.call(this, p, ...a);
  };
}
for (const op of ["writeFile", "appendFile", "mkdir", "rename", "unlink", "rm"]) {
  const orig = (fs.promises as unknown as Record<string, (...a: unknown[]) => unknown>)[op];
  (fs.promises as unknown as Record<string, unknown>)[op] = function (this: unknown, p: unknown, ...a: unknown[]) {
    if (!tsxCache.test(String(p))) push("fs-write", `promises.${op} ${String(p)}`);
    return orig.call(this, p, ...a);
  };
}

// ---------------------------------------------------------------- better-sqlite3 statement spy
const MUTATING = /^\s*(?:WITH\b[\s\S]*?\)\s*)?(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM|REINDEX|ANALYZE)\b/i;
const BetterSqlite = req("better-sqlite3") as typeof Database;
const P = (BetterSqlite as unknown as { prototype: Record<string, (...a: unknown[]) => unknown> }).prototype;
const oPrepare = P.prepare;
const oExec = P.exec;
const oPragma = P.pragma;
P.prepare = function (this: unknown, sql: unknown, ...rest: unknown[]) {
  const st = oPrepare.call(this, sql, ...rest) as { run: (...a: unknown[]) => unknown };
  if (MUTATING.test(String(sql))) {
    const oRun = st.run;
    st.run = function (...a: unknown[]) {
      push(/^\s*(CREATE|ALTER|DROP)/i.test(String(sql)) ? "ddl" : "sql-write", String(sql));
      return oRun.apply(st, a);
    };
  }
  return st;
};
P.exec = function (this: unknown, sql: unknown) {
  push(MUTATING.test(String(sql)) && !/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(String(sql)) ? "ddl" : "sql-write", "exec: " + String(sql));
  return oExec.call(this, sql);
};
P.pragma = function (this: unknown, src: unknown, ...rest: unknown[]) {
  if (/=|checkpoint|optimize|incremental_vacuum/i.test(String(src))) push("pragma-write", "pragma " + String(src));
  return oPragma.call(this, src, ...rest);
};

// ---------------------------------------------------------------- DB state
export function rawGet<T>(db: Database.Database, sql: string, ...a: unknown[]): T {
  return (oPrepare.call(db, sql) as { get: (...x: unknown[]) => T }).get(...a);
}
function rawAll<T>(db: Database.Database, sql: string): T[] {
  return (oPrepare.call(db, sql) as { all: () => T[] }).all();
}
export function dbState(db: Database.Database, dataDir: string, withContent = true) {
  const master = rawAll<{ type: string; name: string; sql: string | null }>(
    db,
    `SELECT type, name, sql FROM sqlite_master ORDER BY type, name`
  );
  const tables: Record<string, { rows: number; sha256: string }> = {};
  if (withContent) {
    for (const { name } of master.filter((m) => m.type === "table" && !m.name.startsWith("sqlite_"))) {
      const h = createHash("sha256");
      let n = 0;
      for (const row of rawAll(db, `SELECT * FROM "${name}" ORDER BY rowid`)) {
        h.update(JSON.stringify(row));
        n++;
      }
      tables[name] = { rows: n, sha256: h.digest("hex") };
    }
  }
  const stat = (f: string) => {
    try {
      const s = fs.statSync(join(dataDir, f));
      return `${s.size}:${s.mtimeMs}`;
    } catch {
      return "absent";
    }
  };
  return {
    totalChanges: rawGet<{ c: number }>(db, "SELECT total_changes() AS c").c,
    schemaVersion: rawGet<{ schema_version: number }>(db, "PRAGMA schema_version").schema_version,
    userVersion: rawGet<{ user_version: number }>(db, "PRAGMA user_version").user_version,
    master: createHash("sha256").update(JSON.stringify(master)).digest("hex"),
    masterNames: master.map((m) => `${m.type}:${m.name}`),
    tables,
    files: { db: stat("gfi.db"), wal: stat("gfi.db-wal") },
  };
}
export type DbState = ReturnType<typeof dbState>;

export function diffState(a: DbState, b: DbState): string[] {
  const out: string[] = [];
  if (a.totalChanges !== b.totalChanges) out.push(`total_changes +${b.totalChanges - a.totalChanges}`);
  if (a.schemaVersion !== b.schemaVersion) out.push(`schema_version ${a.schemaVersion}->${b.schemaVersion}`);
  if (a.userVersion !== b.userVersion) out.push(`user_version ${a.userVersion}->${b.userVersion}`);
  if (a.master !== b.master) {
    const added = b.masterNames.filter((n) => !a.masterNames.includes(n));
    out.push(`sqlite_master changed${added.length ? ` (+${added.slice(0, 8).join(",")}${added.length > 8 ? ",…" : ""})` : ""}`);
  }
  for (const t of Array.from(new Set([...Object.keys(a.tables), ...Object.keys(b.tables)]))) {
    const x = a.tables[t];
    const y = b.tables[t];
    if (!x || !y || x.sha256 !== y.sha256) out.push(`table ${t}: ${x ? x.rows : "absent"} -> ${y ? y.rows : "absent"} rows${x && y && x.rows === y.rows ? " (content changed)" : ""}`);
  }
  if (a.files.db !== b.files.db) out.push(`gfi.db file changed`);
  if (a.files.wal !== b.files.wal) out.push(`gfi.db-wal file changed`);
  return out;
}

// ---------------------------------------------------------------- targets
export interface Target {
  id: string; // e.g. "GET /api/alerts" or "PAGE /events/[id]"
  kind: "api" | "page";
  file: string; // relative to src/app
}
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
function isClientModule(src: string): boolean {
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src);
}
export function discoverTargets(): Target[] {
  const out: Target[] = [];
  for (const f of walk(APP).sort()) {
    const rel = relative(APP, f).split(sep).join("/");
    const src = fs.readFileSync(f, "utf8");
    if (/(^|\/)route\.ts$/.test(rel) && /export\s+(async\s+)?function\s+GET\b|export\s+const\s+GET\b|export\s*\{[^}]*\bGET\b/.test(src)) {
      out.push({ id: `GET /${rel.replace(/\/?route\.ts$/, "")}`, kind: "api", file: rel });
    } else if (/(^|\/)(page|layout|not-found|loading|template)\.tsx$/.test(rel) && !isClientModule(src)) {
      out.push({ id: `PAGE /${rel.replace(/\.tsx$/, "")}`, kind: "page", file: rel });
    }
  }
  return out;
}
export function clientModules(): string[] {
  return walk(join(REPO, "src"))
    .filter((f) => /\.tsx?$/.test(f) && isClientModule(fs.readFileSync(f, "utf8")))
    .map((f) => relative(REPO, f));
}

// ---------------------------------------------------------------- request scope (cookies) + calling
export interface Variant {
  name: string;
  cookie?: string;
  headers?: Record<string, string>;
}
async function inRequestScope<T>(v: Variant, fn: () => Promise<T>): Promise<T> {
  const { requestAsyncStorage } = req("next/dist/client/components/request-async-storage.external");
  const { RequestCookies } = req("next/dist/compiled/@edge-runtime/cookies");
  const headers = new Headers({ ...(v.headers ?? {}), ...(v.cookie ? { cookie: v.cookie } : {}) });
  const cookies = new RequestCookies(headers);
  const store = { headers, cookies, mutableCookies: cookies, draftMode: { isEnabled: false }, isHmrRefresh: false };
  return requestAsyncStorage.run(store, fn);
}

const clientFns = new Set<unknown>();
export async function loadClientComponentSet() {
  for (const m of clientModules()) {
    try {
      const mod = await import(join(REPO, m));
      for (const v of Object.values(mod)) if (typeof v === "function") clientFns.add(v);
    } catch {
      /* browser-only module: its functions are never called below anyway (render walker catches) */
    }
  }
  return clientFns.size;
}

/** Minimal server-component walker: awaits async components and calls server function components (not client). */
async function renderTree(node: unknown, depth = 0, seen = new Set<unknown>()): Promise<void> {
  if (depth > 60 || node == null || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);
  if (node instanceof Promise) return renderTree(await node, depth + 1, seen);
  if (Array.isArray(node)) {
    for (const n of node) await renderTree(n, depth + 1, seen);
    return;
  }
  const el = node as { $$typeof?: symbol; type?: unknown; props?: Record<string, unknown> };
  if (!el.$$typeof) return;
  const props = el.props ?? {};
  for (const v of Object.values(props)) if (v && typeof v === "object") await renderTree(v, depth + 1, seen);
  if (typeof el.type === "function" && !clientFns.has(el.type)) {
    let out: unknown;
    try {
      out = (el.type as (p: unknown) => unknown)(props);
      if (out instanceof Promise) out = await out;
    } catch {
      return; // client component (hooks) or third-party component; not server data code
    }
    await renderTree(out, depth + 1, seen);
  }
}

export interface CallOutcome {
  variant: string;
  call: number;
  status?: number;
  threw?: string;
}
export async function callTarget(t: Target, url: string, params: Record<string, string>, v: Variant, call: number): Promise<CallOutcome> {
  const mod = await import(join(APP, t.file));
  try {
    return await inRequestScope(v, async () => {
      if (t.kind === "api") {
        const { NextRequest } = req("next/server");
        const hdr: Record<string, string> = { ...(v.headers ?? {}) };
        if (v.cookie) hdr.cookie = v.cookie;
        const res: Response = await mod.GET(new NextRequest(new URL(url, "http://probe.invalid"), { headers: hdr }), { params });
        await res.text();
        return { variant: v.name, call, status: res.status };
      }
      const sp = Object.fromEntries(new URL(url, "http://probe.invalid").searchParams);
      if (typeof mod.generateMetadata === "function") await mod.generateMetadata({ params, searchParams: sp });
      const props = t.file.endsWith("layout.tsx") ? { children: null, params } : { params, searchParams: sp };
      await renderTree(await mod.default(props));
      return { variant: v.name, call, status: 200 };
    });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    const digest = String((e as { digest?: string })?.digest ?? "");
    if (digest.startsWith("NEXT_NOT_FOUND")) return { variant: v.name, call, status: 404 };
    if (digest.startsWith("NEXT_REDIRECT")) return { variant: v.name, call, status: 307 };
    return { variant: v.name, call, threw: msg.slice(0, 200) };
  }
}

export interface TargetResult {
  id: string;
  url: string;
  outcomes: CallOutcome[];
  events: RecEvent[];
  stateDiff: string[];
  scheduler: string[];
  violations: string[];
}

/** Run one target: each variant x `calls` times, inside one measurement window. */
export async function probe(
  db: Database.Database,
  dataDir: string,
  t: Target,
  url: string,
  params: Record<string, string>,
  variants: Variant[],
  calls = 3,
  withContent = true
): Promise<TargetResult> {
  const before = dbState(db, dataDir, withContent);
  const schedBefore = [(globalThis as Record<string, unknown>).__calibraSchedulerStarted, (globalThis as Record<string, unknown>).__calibraSchedulerTimer];
  rec.events = [];
  rec.active = true;
  const outcomes: CallOutcome[] = [];
  try {
    for (const v of variants) for (let i = 1; i <= calls; i++) outcomes.push(await callTarget(t, url, params, v, i));
    await new Promise((r) => realSetTimeout(r, 30)); // let fire-and-forget promises surface
  } finally {
    rec.active = false;
  }
  const after = dbState(db, dataDir, withContent);
  const stateDiff = diffState(before, after);
  const scheduler: string[] = [];
  if (!schedBefore[0] && (globalThis as Record<string, unknown>).__calibraSchedulerStarted) scheduler.push("scheduler loop started");
  if (!schedBefore[1] && (globalThis as Record<string, unknown>).__calibraSchedulerTimer) scheduler.push("scheduler timer armed");
  const kinds = Array.from(new Set(rec.events.map((e) => e.kind)));
  const violations = [...kinds, ...(stateDiff.length ? ["db-state"] : []), ...(scheduler.length ? ["scheduler"] : [])];
  return { id: t.id, url, outcomes, events: rec.events.slice(0, 40), stateDiff, scheduler, violations };
}

export function summarize(r: TargetResult): string {
  const counts: Record<string, number> = {};
  for (const e of r.events) {
    const key = `${e.kind}: ${e.detail.replace(/^exec: /, "").split(/[ (]/).slice(0, 3).join(" ")}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return `${r.id} [${r.violations.join(",") || "clean"}] ${r.stateDiff.join("; ")} ${Object.entries(counts)
    .slice(0, 6)
    .map(([k, n]) => `${k} x${n}`)
    .join(" | ")}`;
}
