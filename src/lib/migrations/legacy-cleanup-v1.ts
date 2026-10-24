/**
 * One-off legacy data cleanup (B2 get-fix rec. 3). These steps used to run implicitly on GET requests via
 * ensureSeedData()/ensureForecasts(); they now run ONLY through the explicit, operator-invoked
 * scripts/migrate-legacy-cleanup-v1.ts (dry-run by default). Not to be run against production without a separate
 * explicit approval and a verified backup.
 *
 * Steps (each meta-gated, so a DB that already ran them is untouched):
 *  1. eventDedupeCleanupV1 — exact normalized-title duplicate events + duplicate scenarios per eventId
 *     (same meta key the old request-path code used, so DBs that already ran it skip it).
 *  2. forecastColumnsBackfillV1 — fill NULL forecasts.status / horizon_end columns from the normalized row.
 */
import type Database from "better-sqlite3";
import { normalizeEventTitle } from "../ingestion/dedupe";

export const DEDUPE_META = "eventDedupeCleanupV1";
export const FORECAST_META = "forecastColumnsBackfillV1";

export interface LegacyCleanupPlan {
  dedupe: { gate: string | null; duplicateEventGroups: number; eventsToRemove: number; scenarioDuplicates: number };
  forecasts: { gate: string | null; rowsMissingColumns: number };
}

function meta(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** Read-only estimate; safe on a DB opened with { readonly: true }. */
export function planLegacyCleanup(db: Database.Database): LegacyCleanupPlan {
  const titles = new Map<string, number>();
  for (const r of db.prepare(`SELECT json_extract(data, '$.title') AS title FROM events`).all() as { title: string | null }[]) {
    const k = normalizeEventTitle(r.title ?? "");
    if (k) titles.set(k, (titles.get(k) ?? 0) + 1);
  }
  const groups = Array.from(titles.values()).filter((n) => n > 1);
  const scen = db
    .prepare(
      `SELECT COALESCE(SUM(c - 1), 0) AS n FROM (SELECT COUNT(*) AS c FROM scenarios WHERE json_extract(data, '$.eventId') IS NOT NULL GROUP BY json_extract(data, '$.eventId') HAVING c > 1)`
    )
    .get() as { n: number };
  const fc = db.prepare(`SELECT COUNT(*) AS n FROM forecasts WHERE status IS NULL OR horizon_end IS NULL`).get() as { n: number };
  return {
    dedupe: {
      gate: meta(db, DEDUPE_META),
      duplicateEventGroups: groups.length,
      eventsToRemove: groups.reduce((a, n) => a + n - 1, 0),
      scenarioDuplicates: scen.n,
    },
    forecasts: { gate: meta(db, FORECAST_META), rowsMissingColumns: fc.n },
  };
}

/** Applies the steps against the app DB (getDb). Caller must have chosen the DB explicitly. */
export async function applyLegacyCleanup(now: Date = new Date()) {
  const { getMeta, setMeta } = await import("../db");
  const { cleanupExactTitleDuplicateEvents, cleanupDuplicateScenariosByEventId } = await import("../ingestion/dedupe");
  const { getForecasts, persistForecast } = await import("../forecast/distributions");
  const { getDb } = await import("../db");
  const out: Record<string, unknown> = {};
  if (getMeta(DEDUPE_META) !== "done") {
    const ev = cleanupExactTitleDuplicateEvents();
    const sc = cleanupDuplicateScenariosByEventId();
    setMeta(DEDUPE_META, "done");
    setMeta(`${DEDUPE_META}Detail`, JSON.stringify({ at: now.toISOString(), ...ev, scenariosCollapsed: sc.deleted, via: "migrate-legacy-cleanup-v1" }));
    out.dedupe = { ...ev, scenariosCollapsed: sc.deleted };
  } else out.dedupe = "skipped (already done)";
  if (getMeta(FORECAST_META) !== "done") {
    const ids = new Set(
      (getDb().prepare(`SELECT id FROM forecasts WHERE status IS NULL OR horizon_end IS NULL`).all() as { id: string }[]).map((r) => r.id)
    );
    let n = 0;
    for (const f of getForecasts()) {
      if (!ids.has(f.id)) continue;
      persistForecast(f); // getForecasts() already normalizes status / horizonEnd
      n++;
    }
    setMeta(FORECAST_META, "done");
    out.forecasts = { backfilled: n };
  } else out.forecasts = "skipped (already done)";
  return out;
}
