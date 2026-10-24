import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";

useTempDb("calibra-celink-");

const NOW = "2026-10-17T12:00:00.000Z";

test("crypto news links use contract address or CoinGecko id only; tickers and names never link; legacy rows kept", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { runRssLinks } = await import("../../src/lib/sources/adapters/rss-events");
  const db = getDb();
  const inst = db.prepare(`INSERT INTO instruments (id, symbol, name, asset_type, provider_id, data_source, quote_status, price, first_seen_at) VALUES (?,?,?,?,?,?,?,?,?)`);
  inst.run("crypto:coingecko:bitcoin", "BTC", "Bitcoin", "crypto", "bitcoin", "test", "live", 60000, NOW);
  inst.run("crypto:coingecko:tok", "TOKN", "Token Protocol", "crypto", "tok", "test", "live", 1, NOW);
  const addr = "0x" + "ab".repeat(20);
  db.prepare(`INSERT INTO crypto_contracts (instrument_id, network, contract_address, source, retrieved_at) VALUES (?,?,?,?,?)`).run("crypto:coingecko:tok", "ethereum", addr, "coingecko", NOW);
  const ev = (id: string, title: string, summary = "") =>
    db.prepare(`INSERT INTO events (id, published_at, data, quality) VALUES (?,?,?,?)`).run(id, NOW, JSON.stringify({ id, title, summary, sourceName: "CNBC Top News", publishedAt: NOW }), "live");
  ev("e-ticker", "Bitcoin BTC jumps as Token Protocol TOKN rallies");
  ev("e-addr", "Exploit drains pool", `Attacker used contract ${addr.toUpperCase().replace("0X", "0x")} on Ethereum`);
  ev("e-cg", "Listing notice", "See https://www.coingecko.com/en/coins/bitcoin for details");
  db.prepare(`INSERT INTO instrument_event_links (instrument_id, event_id, match_kind, source_id, created_at) VALUES (?,?,?,?,?)`).run("crypto:coingecko:bitcoin", "e-ticker", "name", "rss_cnbc", NOW);

  const r1 = runRssLinks();
  assert.equal(r1.ok, true);
  const rows = db.prepare(`SELECT instrument_id, event_id, match_kind FROM instrument_event_links ORDER BY event_id, match_kind`).all() as { instrument_id: string; event_id: string; match_kind: string }[];
  const idRows = rows.filter((r) => r.match_kind !== "name");
  assert.deepEqual(idRows.map((r) => `${r.event_id}:${r.instrument_id}:${r.match_kind}`).sort(), [
    "e-addr:crypto:coingecko:tok:contract_address",
    "e-cg:crypto:coingecko:bitcoin:coingecko_id",
  ]);
  assert.ok(!rows.some((r) => r.event_id === "e-ticker" && r.match_kind !== "name"), "ticker/name mention creates no link");
  assert.equal(rows.filter((r) => r.match_kind === "name").length, 1, "legacy name row preserved, not deleted");
  // Idempotent rebuild
  runRssLinks();
  assert.equal((db.prepare(`SELECT COUNT(*) c FROM instrument_event_links`).get() as { c: number }).c, 3);
});
