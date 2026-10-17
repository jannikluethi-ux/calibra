import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";

useTempDb("calibra-cluster-");

test("clustering links duplicates without deleting events, is idempotent, audits every change, and narrows scenario inputs", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { runEventClustering, getClusterMetrics, getClusterFor } = await import("../../src/lib/ingestion/cluster");
  const { getEvents } = await import("../../src/lib/ingestion/rss");
  const db = getDb();
  const ins = db.prepare(`INSERT INTO events (id, published_at, data, quality) VALUES (?, ?, ?, ?)`);
  const ev = (id: string, title: string, at: string, quality = "live") =>
    ins.run(id, at, JSON.stringify({ id, title, publishedAt: at, sourceName: "CNBC Top News", sourceTier: 3, quality }), quality);
  ev("e1", "Trump to announce planned $15 billion steel plant, would be largest in U.S. history", "2026-10-16T16:29:00Z");
  ev("e2", "Trump to announce plan for $15 billion steel plant, would be largest in U.S. history", "2026-10-16T16:48:00Z");
  ev("e3", "Federal Reserve issues FOMC statement", "2026-10-16T18:00:00Z");
  ev("e4", "Oil prices rise on Middle East tensions", "2026-10-16T19:00:00Z");
  ev("e5", "Gold prices rise on Middle East tensions", "2026-10-16T19:10:00Z");
  ev("d1", "Demo headline duplicate", "2026-10-16T19:20:00Z", "demo");
  ev("d2", "Demo headline duplicate", "2026-10-16T19:30:00Z", "demo");
  const now = new Date("2026-10-17T10:00:00Z");

  const before = (db.prepare(`SELECT COUNT(*) n FROM events`).get() as { n: number }).n;
  const r1 = runEventClustering({ now });
  assert.equal(r1.multiEventClusters, 1);
  assert.equal(r1.linkedMembers, 1);
  assert.equal(r1.newLinks, 2);
  assert.equal((db.prepare(`SELECT COUNT(*) n FROM events`).get() as { n: number }).n, before, "no event deleted");
  assert.deepEqual(getClusterFor("e2"), { canonicalEventId: "e1", members: ["e1", "e2"] });
  assert.equal(getClusterFor("e5"), null, "different commodity, not linked");

  const r2 = runEventClustering({ now });
  assert.equal(r2.newLinks + r2.relinks + r2.unlinks, 0, "idempotent");
  const histRows = (db.prepare(`SELECT COUNT(*) n FROM event_cluster_history`).get() as { n: number }).n;
  assert.equal(histRows, 2, "history only records changes");

  const all = getEvents(10).map((e) => e.id);
  const canon = getEvents(10, { canonicalOnly: true }).map((e) => e.id);
  assert.ok(all.includes("e2"));
  assert.ok(!canon.includes("e2"), "non-canonical member excluded from scenario inputs");
  assert.ok(canon.includes("e1"));
  const m = getClusterMetrics();
  assert.equal(m.liveEventsStored, 5);
  assert.equal(m.distinctLiveStories, 4);
});
