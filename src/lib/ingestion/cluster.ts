/**
 * DB layer for event_cluster_v1. Links same-story live events to a canonical event in
 * event_clusters and appends every decision to event_cluster_history. Never deletes or edits
 * rows in `events`; unlinking only removes the derived link row (and is itself audited).
 */
import { getDb } from "../db";
import { CLUSTER_METHOD, CLUSTER_WINDOW_MS, clusterHeadlines, type Headline } from "./cluster-core";

export interface ClusterRunResult {
  scanned: number;
  clusters: number;
  multiEventClusters: number;
  linkedMembers: number;
  newLinks: number;
  relinks: number;
  unlinks: number;
}

export function runEventClustering(opts: { sinceDays?: number; now?: Date } = {}): ClusterRunResult {
  const db = getDb();
  const now = opts.now ?? new Date();
  const sinceDays = opts.sinceDays ?? 3;
  const from = new Date(now.getTime() - sinceDays * 86400_000 - CLUSTER_WINDOW_MS).toISOString();
  const scanFrom = new Date(now.getTime() - sinceDays * 86400_000).toISOString();
  const rows = db
    .prepare(`SELECT id, published_at, data FROM events WHERE quality = 'live' AND published_at >= ? ORDER BY published_at`)
    .all(from) as { id: string; published_at: string; data: string }[];
  const items: Headline[] = rows.map((r) => {
    const d = JSON.parse(r.data) as { title?: string; sourceName?: string; sourceTier?: number };
    return { id: r.id, title: d.title ?? "", publishedAt: r.published_at, sourceName: d.sourceName, sourceTier: d.sourceTier };
  });
  const clusters = clusterHeadlines(items);

  const existing = new Map(
    (db.prepare(`SELECT event_id, canonical_event_id FROM event_clusters`).all() as { event_id: string; canonical_event_id: string }[]).map((r) => [
      r.event_id,
      r.canonical_event_id,
    ])
  );
  const at = now.toISOString();
  const upsert = db.prepare(
    `INSERT INTO event_clusters (event_id, canonical_event_id, method, score, reasons_json, linked_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET canonical_event_id = excluded.canonical_event_id, method = excluded.method,
       score = excluded.score, reasons_json = excluded.reasons_json, linked_at = excluded.linked_at`
  );
  const del = db.prepare(`DELETE FROM event_clusters WHERE event_id = ?`);
  const hist = db.prepare(
    `INSERT INTO event_cluster_history (event_id, canonical_event_id, action, method, score, reasons_json, at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const res: ClusterRunResult = { scanned: items.length, clusters: clusters.length, multiEventClusters: 0, linkedMembers: 0, newLinks: 0, relinks: 0, unlinks: 0 };
  const seen = new Set<string>();

  db.transaction(() => {
    for (const c of clusters) {
      if (c.members.length < 2) continue;
      res.multiEventClusters++;
      for (const m of c.members) {
        const id = m.item.id;
        seen.add(id);
        const canon = c.canonical.id;
        if (id !== canon) res.linkedMembers++;
        const prev = existing.get(id);
        if (prev === canon) continue; // unchanged: no write, no history
        const reasons = JSON.stringify(id === canon ? ["canonical of cluster"] : m.decision.reasons);
        upsert.run(id, canon, CLUSTER_METHOD, m.decision.score, reasons, at);
        hist.run(id, canon, prev ? "relink" : "link", CLUSTER_METHOD, m.decision.score, reasons, at);
        if (prev) res.relinks++;
        else res.newLinks++;
      }
    }
    // Events in the scanned range that were linked before but no longer match: unlink (audited).
    for (const it of items) {
      if (it.publishedAt < scanFrom || seen.has(it.id) || !existing.has(it.id)) continue;
      del.run(it.id);
      hist.run(it.id, existing.get(it.id) ?? null, "unlink", CLUSTER_METHOD, null, JSON.stringify(["no longer matches canonical"]), at);
      res.unlinks++;
    }
  })();
  return res;
}

export function getClusterMetrics() {
  const db = getDb();
  const live = (db.prepare(`SELECT COUNT(*) n FROM events WHERE quality = 'live'`).get() as { n: number }).n;
  const members = (db.prepare(`SELECT COUNT(*) n FROM event_clusters WHERE event_id != canonical_event_id`).get() as { n: number }).n;
  const clusters = (db.prepare(`SELECT COUNT(DISTINCT canonical_event_id) n FROM event_clusters`).get() as { n: number }).n;
  const historyRows = (db.prepare(`SELECT COUNT(*) n FROM event_cluster_history`).get() as { n: number }).n;
  return { method: CLUSTER_METHOD, liveEventsStored: live, multiEventClusters: clusters, duplicateMembersLinked: members, distinctLiveStories: live - members, historyRows };
}

export function getClusterFor(eventId: string): { canonicalEventId: string; members: string[] } | null {
  const db = getDb();
  const row = db.prepare(`SELECT canonical_event_id FROM event_clusters WHERE event_id = ?`).get(eventId) as { canonical_event_id: string } | undefined;
  if (!row) return null;
  const members = (db.prepare(`SELECT event_id FROM event_clusters WHERE canonical_event_id = ? ORDER BY event_id`).all(row.canonical_event_id) as { event_id: string }[]).map(
    (r) => r.event_id
  );
  return { canonicalEventId: row.canonical_event_id, members };
}
