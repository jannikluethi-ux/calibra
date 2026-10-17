import { test } from "node:test";
import assert from "node:assert/strict";
import { RSS_FEEDS } from "../../src/lib/ingestion/rss";
import { TRACKED_SOURCES } from "../../src/lib/sources/health";
import { SOURCE_REGION } from "../../src/lib/intel/assess";

test("every configured feed is health-tracked; official feeds are tier 1 with an issuing region", () => {
  const tracked = new Set(TRACKED_SOURCES.map((t) => t.id));
  for (const f of RSS_FEEDS) assert.ok(tracked.has(f.id), `${f.id} tracked`);
  const official = ["rss_snb", "rss_bis", "rss_sec", "rss_boe", "rss_boj", "rss_boc", "rss_cftc", "rss_fsb"];
  for (const id of official) {
    const f = RSS_FEEDS.find((x) => x.id === id);
    assert.ok(f && f.active && f.tier === 1 && f.url.startsWith("https://"), id);
    assert.ok(SOURCE_REGION[id], `${id} region`);
  }
  assert.equal(new Set(RSS_FEEDS.map((f) => f.id)).size, RSS_FEEDS.length);
});
