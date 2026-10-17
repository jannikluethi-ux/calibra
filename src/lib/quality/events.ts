/**
 * Event data-quality metrics (Batch 3): freshness per source, source concentration, duplicates, and
 * event-intelligence coverage. Read-only; computed from stored rows at request time.
 */
import { getDb } from "../db";
import { ensureIntelTables } from "../intel/schema";
import { RSS_FEEDS } from "../ingestion/rss";

export interface SourceFreshness {
  sourceName: string;
  tier: number | null;
  active: boolean | null;
  newestPublishedAt: string | null;
  newestAgeHours: number | null;
  last24h: number;
  last7d: number;
  last30d: number;
  total: number;
}

export interface EventMetrics {
  generatedAt: string;
  freshness: { newestPublishedAt: string | null; newestAgeHours: number | null; live24h: number; live7d: number; perSource: SourceFreshness[] };
  concentration: {
    window7d: { total: number; topSource: string | null; topShare: number | null; hhi: number | null; officialShare: number | null; sources: number };
    window30d: { total: number; topSource: string | null; topShare: number | null; hhi: number | null; officialShare: number | null; sources: number };
    note: string;
  };
  duplicates: { linkedEvents: number; nonCanonicalMembers: number; groups: number; multiSourceGroups: number; duplicateRate30d: number | null; method: string };
  intelligence: {
    assessments: number;
    eventsAssessed: number;
    materialEvents: number;
    mappings: number;
    mappingsBySymbol: { symbol: string; n: number }[];
    conflicts: { factual: number; interpretive: number };
    scenariosV2: number;
    scenariosPreV2: number;
    lastRunAt: string | null;
  };
}

const ageH = (iso: string | null, now: number) => (iso && Number.isFinite(Date.parse(iso)) ? +((now - Date.parse(iso)) / 3600_000).toFixed(1) : null);

function concentration(rows: { s: string; tier: number | null; n: number }[]) {
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!total) return { total: 0, topSource: null, topShare: null, hhi: null, officialShare: null, sources: 0 };
  const sorted = [...rows].sort((a, b) => b.n - a.n);
  const hhi = Math.round(rows.reduce((a, r) => a + Math.pow((r.n / total) * 100, 2), 0));
  const official = rows.filter((r) => r.tier === 1).reduce((a, r) => a + r.n, 0);
  return { total, topSource: sorted[0].s, topShare: +(sorted[0].n / total).toFixed(3), hhi, officialShare: +(official / total).toFixed(3), sources: rows.length };
}

export function computeEventMetrics(nowIso = new Date().toISOString()): EventMetrics {
  const db = getDb();
  ensureIntelTables(db);
  const now = Date.parse(nowIso);
  const iso = (h: number) => new Date(now - h * 3600_000).toISOString();
  const per = db
    .prepare(
      `SELECT json_extract(data,'$.sourceName') AS s, MAX(json_extract(data,'$.sourceTier')) AS tier, MAX(published_at) AS newest,
              SUM(published_at >= ?) AS d1, SUM(published_at >= ?) AS d7, SUM(published_at >= ?) AS d30, COUNT(*) AS total
       FROM events WHERE quality = 'live' GROUP BY s ORDER BY total DESC`
    )
    .all(iso(24), iso(168), iso(720)) as { s: string; tier: number | null; newest: string | null; d1: number; d7: number; d30: number; total: number }[];
  const feedByName = new Map(RSS_FEEDS.map((f) => [f.name, f]));
  const perSource: SourceFreshness[] = per.map((r) => ({
    sourceName: r.s,
    tier: r.tier ?? null,
    active: feedByName.get(r.s)?.active ?? null,
    newestPublishedAt: r.newest,
    newestAgeHours: ageH(r.newest, now),
    last24h: r.d1 ?? 0,
    last7d: r.d7 ?? 0,
    last30d: r.d30 ?? 0,
    total: r.total,
  }));
  // configured feeds with no stored events yet are listed explicitly (missing stays missing)
  for (const f of RSS_FEEDS) {
    if (f.active && !perSource.some((p) => p.sourceName === f.name)) {
      perSource.push({ sourceName: f.name, tier: f.tier, active: true, newestPublishedAt: null, newestAgeHours: null, last24h: 0, last7d: 0, last30d: 0, total: 0 });
    }
  }
  const newest = per.reduce<string | null>((a, r) => (r.newest && (!a || r.newest > a) ? r.newest : a), null);
  const w7 = per.filter((r) => r.d7 > 0).map((r) => ({ s: r.s, tier: r.tier, n: r.d7 }));
  const w30 = per.filter((r) => r.d30 > 0).map((r) => ({ s: r.s, tier: r.tier, n: r.d30 }));

  const cl = db
    .prepare(
      `SELECT COUNT(*) AS linked, SUM(event_id != canonical_event_id) AS members, COUNT(DISTINCT canonical_event_id) AS groups FROM event_clusters`
    )
    .get() as { linked: number; members: number | null; groups: number };
  const groupSources = db
    .prepare(
      `SELECT c.canonical_event_id AS g, COUNT(DISTINCT json_extract(e.data,'$.sourceName')) AS ns
       FROM event_clusters c JOIN events e ON e.id = c.event_id GROUP BY c.canonical_event_id`
    )
    .all() as { g: string; ns: number }[];
  const live30 = w30.reduce((a, r) => a + r.n, 0);
  const members30 = (db
    .prepare(`SELECT COUNT(*) AS n FROM event_clusters c JOIN events e ON e.id = c.event_id WHERE c.event_id != c.canonical_event_id AND e.published_at >= ?`)
    .get(iso(720)) as { n: number }).n;

  const count = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;
  const conf = db.prepare(`SELECT kind, COUNT(*) AS n FROM event_conflicts GROUP BY kind`).all() as { kind: string; n: number }[];
  const lastRun = db.prepare(`SELECT value FROM meta WHERE key = 'eventIntelLastRun'`).get() as { value: string } | undefined;
  let lastRunAt: string | null = null;
  try {
    lastRunAt = lastRun ? JSON.parse(lastRun.value).at ?? null : null;
  } catch {
    lastRunAt = null;
  }

  return {
    generatedAt: nowIso,
    freshness: { newestPublishedAt: newest, newestAgeHours: ageH(newest, now), live24h: per.reduce((a, r) => a + (r.d1 ?? 0), 0), live7d: per.reduce((a, r) => a + (r.d7 ?? 0), 0), perSource },
    concentration: {
      window7d: concentration(w7),
      window30d: concentration(w30),
      note: "HHI on a 0-10,000 scale (10,000 = one source). Official share = share of tier-1 (official/primary) items. Counts use publish time.",
    },
    duplicates: {
      linkedEvents: cl.linked,
      nonCanonicalMembers: cl.members ?? 0,
      groups: cl.groups,
      multiSourceGroups: groupSources.filter((g) => g.ns >= 2).length,
      duplicateRate30d: live30 ? +(members30 / live30).toFixed(3) : null,
      method: "event_cluster_v1 links same-story items to a canonical event; originals are kept. Exact-title duplicates are merged at ingest (event_dedupe_v1).",
    },
    intelligence: {
      assessments: count(`SELECT COUNT(*) AS n FROM event_assessments`),
      eventsAssessed: count(`SELECT COUNT(DISTINCT event_id) AS n FROM event_assessments`),
      materialEvents: count(`SELECT COUNT(*) AS n FROM (SELECT event_id, material FROM event_assessments a WHERE a.id = (SELECT MAX(id) FROM event_assessments b WHERE b.event_id = a.event_id)) WHERE material = 1`),
      mappings: count(`SELECT COUNT(*) AS n FROM event_instrument_mappings`),
      mappingsBySymbol: db.prepare(`SELECT symbol, COUNT(DISTINCT event_id) AS n FROM event_instrument_mappings GROUP BY symbol ORDER BY n DESC LIMIT 12`).all() as { symbol: string; n: number }[],
      conflicts: { factual: conf.find((c) => c.kind === "factual")?.n ?? 0, interpretive: conf.find((c) => c.kind === "interpretive")?.n ?? 0 },
      scenariosV2: count(`SELECT COUNT(*) AS n FROM scenarios WHERE schema_version = 2`),
      scenariosPreV2: count(`SELECT COUNT(*) AS n FROM scenarios WHERE schema_version IS NULL`),
      lastRunAt,
    },
  };
}
