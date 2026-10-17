import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";

useTempDb("calibra-rss-");

const FEEDS = [
  { id: "rss_federal_reserve", name: "Federal Reserve Press", url: "https://fed.test/rss", tier: 1 as const, active: true },
  { id: "rss_imf", name: "IMF News", url: "https://imf.test/rss", tier: 1 as const, active: true },
  { id: "rss_reuters", name: "Reuters Business", url: "https://reuters.test/rss", tier: 3 as const, active: false, inactiveReason: "retired" },
  { id: "rss_cnbc", name: "CNBC Top News", url: "https://cnbc.test/rss", tier: 3 as const, active: true },
];

test("RSS: one failing feed does not block others; no demo events are inserted; every new event carries provenance", async () => {
  const { ingestRssFeeds } = await import("../../src/lib/ingestion/rss");
  const { getDb } = await import("../../src/lib/db");
  const { getHealth } = await import("../../src/lib/sources/health");
  const calls: string[] = [];
  const fetchFeed = async (url: string) => {
    calls.push(url);
    if (url.includes("imf")) throw Object.assign(new Error("Status code 403"), { status: 403 });
    if (url.includes("fed")) return [{ title: "Federal Reserve issues FOMC statement", link: "https://fed.test/a", isoDate: "2026-10-16T18:00:00Z", contentSnippet: "The Committee decided..." }];
    return [
      { title: "Oil prices rise as supply worries mount", link: "https://cnbc.test/1", isoDate: "2026-10-17T07:00:00Z" },
      { title: "Untimed headline about bank earnings season", link: "https://cnbc.test/2" },
    ];
  };
  const r = await ingestRssFeeds({ fetchFeed, feeds: FEEDS, retryBaseMs: 1 });
  assert.equal(r.demo, 0);
  assert.equal(r.live, 3);
  assert.ok(!calls.some((u) => u.includes("reuters")), "disabled feed is not called");
  assert.equal(calls.filter((u) => u.includes("imf")).length, 1, "403 is not retried (not retryable)");
  const db = getDb();
  assert.equal((db.prepare(`SELECT COUNT(*) n FROM events WHERE quality = 'demo'`).get() as { n: number }).n, 0, "no synthetic substitution for failing/thin feeds");
  const rows = db.prepare(`SELECT data FROM events`).all() as { data: string }[];
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const ev = JSON.parse(row.data);
    assert.ok(ev.provenance, "provenance present");
    assert.ok(ev.provenance.retrievedAt.endsWith("Z"), "retrieval time in UTC");
    assert.ok(ev.provenance.sourceId && ev.provenance.feedUrl);
    assert.equal(ev.provenance.fields.classification, "derived");
    assert.equal(ev.provenance.fields.impactScore, "estimated");
  }
  const untimed = rows.map((x) => JSON.parse(x.data)).find((e) => e.title.startsWith("Untimed"));
  assert.equal(untimed.provenance.sourcePublishedAt, null, "missing publish time stays missing");
  assert.equal(untimed.provenance.fields.publishedAt, "missing");

  assert.equal(getHealth("rss_imf")!.errorClass, "unavailable");
  assert.equal(getHealth("rss_imf")!.consecutiveFailures, 1);
  assert.equal(getHealth("rss_reuters")!.status, "disabled");
  assert.equal(getHealth("rss_cnbc")!.status, "healthy");
});

test("RSS: total outage stores nothing, inserts no demo rows and does not advance lastEventUpdate", async () => {
  const { ingestRssFeeds } = await import("../../src/lib/ingestion/rss");
  const { getDb, getMeta } = await import("../../src/lib/db");
  const before = getMeta("lastEventUpdate");
  const n0 = (getDb().prepare(`SELECT COUNT(*) n FROM events`).get() as { n: number }).n;
  const r = await ingestRssFeeds({
    fetchFeed: async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    },
    feeds: FEEDS.filter((f) => f.id !== "rss_imf"),
    retryBaseMs: 1,
  });
  assert.equal(r.live, 0);
  assert.equal(r.demo, 0);
  assert.equal((getDb().prepare(`SELECT COUNT(*) n FROM events`).get() as { n: number }).n, n0);
  assert.equal(getMeta("lastEventUpdate"), before);
});

test("RSS: circuit breaker skips a feed after 3 consecutive failures", async () => {
  const { ingestRssFeeds } = await import("../../src/lib/ingestion/rss");
  const imfOnly = FEEDS.filter((f) => f.id === "rss_imf");
  let calls = 0;
  const fail = async () => {
    calls++;
    throw Object.assign(new Error("Status code 403"), { status: 403 });
  };
  await ingestRssFeeds({ fetchFeed: fail, feeds: imfOnly, retryBaseMs: 1 }); // 2nd failure
  await ingestRssFeeds({ fetchFeed: fail, feeds: imfOnly, retryBaseMs: 1 }); // 3rd → back-off
  const before = calls;
  const r = await ingestRssFeeds({ fetchFeed: fail, feeds: imfOnly, retryBaseMs: 1 });
  assert.equal(calls, before, "skipped during back-off");
  assert.equal(r.feeds[0].outcome.errorClass, "skipped");
});
