/**
 * B2 get-fix rec. 3 (page side): server pages never seed or persist; empty data renders an "Awaiting first run"
 * state instead. Byte-level read-only behaviour is covered by readonly-routes-{empty,populated}.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const APP = join(__dirname, "..", "..", "src", "app");

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== "api") out.push(...pages(p));
    } else if (/^(page|layout)\.tsx$/.test(n)) out.push(p);
  }
  return out;
}

const PENDING: Record<string, string> = {};

test("no server page or layout seeds, persists or prepares stores", () => {
  const offenders: string[] = [];
  for (const f of pages(APP)) {
    const rel = relative(APP, f);
    const src = readFileSync(f, "utf8");
    if (/\b(ensure[A-Z]\w*|seed\w*|persist[A-Z]\w*|prepareCryptoStore|rebuild[A-Z]\w*)\s*\(/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders.sort(), Object.keys(PENDING).sort());
});

test("pages that depend on seeded data render an Awaiting first run state", () => {
  for (const rel of [
    "page.tsx",
    "assets/page.tsx",
    "countries/page.tsx",
    "countries/[code]/page.tsx",
    "events/page.tsx",
    "forecasts/page.tsx",
    "map/page.tsx",
    "scenarios/page.tsx",
    "warnings/page.tsx",
  ]) {
    assert.match(readFileSync(join(APP, rel), "utf8"), /<AwaitingFirstRun what=/, rel);
  }
});

test("on an empty DB the pages render the Awaiting first run element (and with data they do not)", async () => {
  const { useTempDb } = await import("./_tmpdb");
  useTempDb("calibra-pages-empty-");
  const { createRequire } = await import("node:module");
  const req = createRequire(join(APP, "..", "..", "package.json"));
  (globalThis as Record<string, unknown>).React = req("react");
  for (const ext of [".css", ".scss"]) (req.extensions as Record<string, unknown>)[ext] = () => undefined;
  const { getDb } = await import("../../src/lib/db");
  const { AwaitingFirstRun } = await import("../../src/components/ui/AwaitingFirstRun");
  const db = getDb();

  const has = (node: unknown, depth = 0): boolean => {
    if (!node || depth > 12) return false;
    if (Array.isArray(node)) return node.some((n) => has(n, depth + 1));
    if (typeof node !== "object") return false;
    const el = node as { type?: unknown; props?: { children?: unknown } };
    if (el.type === AwaitingFirstRun) return true;
    return has(el.props?.children, depth + 1);
  };
  const render = async (rel: string, params: Record<string, string> = {}) =>
    (await import(join(APP, rel))).default({ params, searchParams: {} });

  const tc = () => (db.prepare("SELECT total_changes() c").get() as { c: number }).c;
  const t0 = tc();
  for (const rel of ["countries/page.tsx", "map/page.tsx", "warnings/page.tsx", "assets/page.tsx", "forecasts/page.tsx"]) {
    assert.ok(has(await render(rel)), `${rel} shows Awaiting first run on an empty DB`);
  }
  assert.ok(has(await render("countries/[code]/page.tsx", { code: "US" })), "country detail on an empty DB");
  assert.equal(tc(), t0, "rendering on an empty DB wrote nothing");

  const { seedCountries } = await import("../../src/lib/countries/profiles");
  seedCountries();
  assert.ok(!has(await render("countries/page.tsx")), "seeded countries page has no empty state");
});
