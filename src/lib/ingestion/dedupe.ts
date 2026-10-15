/**
 * Event title normalization and near-duplicate detection for ingestion.
 *
 * Rule (event_dedupe_v1):
 *  - Normalize: NFKD, strip diacritics, lowercase, collapse non-alnum to spaces, trim.
 *  - Within a time window (default 72h around publishedAt), an incoming headline whose
 *    normalized title equals an existing event's is treated as the same event:
 *    skip insert / upsert into the existing row id (keep stable id).
 *  - Optional light cleanup: for exact normalized titles with multiple rows, keep one
 *    (prefer live quality, then earliest published_at, then earliest id) and delete the rest.
 *    Orphan instrument_event_links and scenarios pointing at deleted event ids are removed.
 *  - Does not merge meaningfully different headlines; keeps data honest.
 */
import { getDb, upsertJson } from "../db";
import type { FinancialEvent } from "../types";

/** Default near-dupe window: 72 hours either side of publishedAt. */
export const EVENT_DEDUPE_WINDOW_MS = 72 * 3600_000;

export function normalizeEventTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function windowBounds(publishedAt: string, windowMs = EVENT_DEDUPE_WINDOW_MS): { from: string; to: string } {
  const t = Date.parse(publishedAt);
  const center = Number.isFinite(t) ? t : Date.now();
  return {
    from: new Date(center - windowMs).toISOString(),
    to: new Date(center + windowMs).toISOString(),
  };
}

/**
 * Find an existing event with the same normalized title inside the time window.
 * Scans candidates by published_at range (indexed) then compares normalized titles in JS.
 */
export function findDuplicateEvent(
  title: string,
  publishedAt: string,
  windowMs = EVENT_DEDUPE_WINDOW_MS
): FinancialEvent | null {
  const norm = normalizeEventTitle(title);
  if (!norm) return null;
  const { from, to } = windowBounds(publishedAt, windowMs);
  const rows = getDb()
    .prepare(
      `SELECT data FROM events
       WHERE published_at >= ? AND published_at <= ?
       ORDER BY published_at DESC
       LIMIT 400`
    )
    .all(from, to) as { data: string }[];
  for (const row of rows) {
    let ev: FinancialEvent;
    try {
      ev = JSON.parse(row.data) as FinancialEvent;
    } catch {
      continue;
    }
    if (normalizeEventTitle(ev.title || "") === norm) return ev;
  }
  return null;
}

/**
 * Upsert an ingested event with dedupe: reuses existing id when a near-dupe is found.
 * Returns { event, action: 'inserted' | 'updated' | 'skipped' }.
 */
export function upsertEventDeduped(
  ev: FinancialEvent,
  opts?: { windowMs?: number; refreshExisting?: boolean }
): { event: FinancialEvent; action: "inserted" | "updated" | "skipped" } {
  const existing = findDuplicateEvent(ev.title, ev.publishedAt, opts?.windowMs);
  if (!existing) {
    upsertJson("events", "id", ev.id, ev, {
      published_at: ev.publishedAt,
      quality: ev.quality,
    });
    return { event: ev, action: "inserted" };
  }

  // Same story already stored — keep stable id. Optionally refresh body/classification
  // when the new copy is live and the stored one is demo, or when refreshExisting.
  const shouldRefresh =
    opts?.refreshExisting === true ||
    (ev.quality === "live" && existing.quality !== "live") ||
    (Number(ev.sourceTier) < Number(existing.sourceTier));

  if (!shouldRefresh) {
    return { event: existing, action: "skipped" };
  }

  const merged: FinancialEvent = {
    ...ev,
    id: existing.id,
    ingestedAt: existing.ingestedAt || ev.ingestedAt,
    publishedAt: existing.publishedAt || ev.publishedAt,
  };
  upsertJson("events", "id", merged.id, merged, {
    published_at: merged.publishedAt,
    quality: merged.quality,
  });
  return { event: merged, action: "updated" };
}

export interface CleanupResult {
  eventGroups: number;
  eventsDeleted: number;
  scenariosDeleted: number;
  linksDeleted: number;
}

/**
 * Light cleanup: exact normalized-title duplicates only (no fuzzy merge of different stories).
 * Keeps one row per normalized title globally (not windowed) — safe because identical
 * normalized titles are the same headline re-ingested.
 */
export function cleanupExactTitleDuplicateEvents(opts?: { dryRun?: boolean; limitGroups?: number }): CleanupResult {
  const db = getDb();
  const dryRun = opts?.dryRun === true;
  const limitGroups = opts?.limitGroups ?? 5000;

  const rows = db.prepare(`SELECT id, published_at, quality, data FROM events`).all() as {
    id: string;
    published_at: string;
    quality: string;
    data: string;
  }[];

  const groups = new Map<string, { id: string; published_at: string; quality: string }[]>();
  for (const row of rows) {
    let title = "";
    try {
      title = (JSON.parse(row.data) as FinancialEvent).title || "";
    } catch {
      continue;
    }
    const norm = normalizeEventTitle(title);
    if (!norm) continue;
    const list = groups.get(norm);
    const entry = { id: row.id, published_at: row.published_at, quality: row.quality };
    if (list) list.push(entry);
    else groups.set(norm, [entry]);
  }

  const toDelete: string[] = [];
  let eventGroups = 0;
  for (const [, list] of Array.from(groups.entries())) {
    if (list.length < 2) continue;
    eventGroups++;
    if (eventGroups > limitGroups) break;
    // Prefer live > other, then earliest published_at, then id
    list.sort((a, b) => {
      const q = (x: string) => (x === "live" ? 0 : x === "demo" ? 2 : 1);
      const dq = q(a.quality) - q(b.quality);
      if (dq !== 0) return dq;
      const pt = a.published_at.localeCompare(b.published_at);
      if (pt !== 0) return pt;
      return a.id.localeCompare(b.id);
    });
    for (const extra of list.slice(1)) toDelete.push(extra.id);
  }

  if (dryRun || toDelete.length === 0) {
    return { eventGroups, eventsDeleted: toDelete.length, scenariosDeleted: 0, linksDeleted: 0 };
  }

  // Bulk path: temp keep-set, then set-based deletes (per-row json_extract is too slow at ~20k).
  const keepIds = new Set(rows.map((r) => r.id));
  for (const id of toDelete) keepIds.delete(id);

  db.exec(`CREATE TEMP TABLE IF NOT EXISTS _dedupe_keep (id TEXT PRIMARY KEY)`);
  db.exec(`DELETE FROM _dedupe_keep`);
  const ins = db.prepare(`INSERT OR IGNORE INTO _dedupe_keep(id) VALUES (?)`);
  const fill = db.transaction((ids: string[]) => {
    for (const id of ids) ins.run(id);
  });
  fill(Array.from(keepIds));

  const linksDeleted = db
    .prepare(
      `DELETE FROM instrument_event_links WHERE event_id NOT IN (SELECT id FROM _dedupe_keep)`
    )
    .run().changes;

  // Resolve eventId in JS — json_extract NOT IN over thousands of rows is too slow under lock.
  const scRows = db.prepare(`SELECT id, data FROM scenarios`).all() as { id: string; data: string }[];
  const orphanScenarioIds: string[] = [];
  for (const row of scRows) {
    let eventId: string | null = null;
    try {
      eventId = (JSON.parse(row.data) as { eventId?: string }).eventId ?? null;
    } catch {
      continue;
    }
    if (eventId && !keepIds.has(eventId)) orphanScenarioIds.push(row.id);
  }
  let scenariosDeleted = 0;
  if (orphanScenarioIds.length) {
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS _sc_orphan (id TEXT PRIMARY KEY)`);
    db.exec(`DELETE FROM _sc_orphan`);
    const insSc = db.prepare(`INSERT OR IGNORE INTO _sc_orphan(id) VALUES (?)`);
    const fillSc = db.transaction((ids: string[]) => {
      for (const id of ids) insSc.run(id);
    });
    fillSc(orphanScenarioIds);
    scenariosDeleted = db.prepare(`DELETE FROM scenarios WHERE id IN (SELECT id FROM _sc_orphan)`).run().changes;
    db.exec(`DROP TABLE IF EXISTS _sc_orphan`);
  }

  const eventsDeleted = db
    .prepare(`DELETE FROM events WHERE id NOT IN (SELECT id FROM _dedupe_keep)`)
    .run().changes;
  db.exec(`DROP TABLE IF EXISTS _dedupe_keep`);

  return {
    eventGroups,
    eventsDeleted,
    scenariosDeleted,
    linksDeleted,
  };
}

/** Collapse scenario rows that share the same eventId (keep newest created_at). */
export function cleanupDuplicateScenariosByEventId(): { deleted: number } {
  const db = getDb();
  const rows = db
    .prepare(`SELECT id, created_at, json_extract(data, '$.eventId') AS event_id FROM scenarios`)
    .all() as { id: string; created_at: string; event_id: string | null }[];
  const best = new Map<string, { id: string; created_at: string }>();
  const toDelete: string[] = [];
  for (const row of rows) {
    if (!row.event_id) continue;
    const prev = best.get(row.event_id);
    if (!prev) {
      best.set(row.event_id, { id: row.id, created_at: row.created_at });
      continue;
    }
    if (row.created_at >= prev.created_at) {
      toDelete.push(prev.id);
      best.set(row.event_id, { id: row.id, created_at: row.created_at });
    } else {
      toDelete.push(row.id);
    }
  }
  if (!toDelete.length) return { deleted: 0 };
  const del = db.prepare(`DELETE FROM scenarios WHERE id = ?`);
  const tx = db.transaction((ids: string[]) => {
    for (const id of ids) del.run(id);
  });
  tx(toDelete);
  return { deleted: toDelete.length };
}
