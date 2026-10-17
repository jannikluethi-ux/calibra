import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";

useTempDb("calibra-crev-");

const NOW = "2026-10-17T12:00:00.000Z";
const d = (days: number) => new Date(Date.parse(NOW) - days * 86400_000).toISOString();

test("event factor levels follow documented windows", async () => {
  const { eventFactorLevel } = await import("../../src/lib/intel/crypto-events");
  assert.equal(eventFactorLevel([{ id: "a", category: "exploit", occurredAt: d(30), evidence: { amountUsd: 2e7, returnedUsd: 0, incident: "X" } }], NOW).level, "high");
  assert.equal(eventFactorLevel([{ id: "a", category: "exploit", occurredAt: d(30), evidence: { amountUsd: 2e7, returnedUsd: 1.5e7, incident: "X" } }], NOW).level, "elevated", "net of returned funds");
  assert.equal(eventFactorLevel([{ id: "a", category: "exploit", occurredAt: d(400), evidence: { amountUsd: 2e7 } }], NOW).level, "noted");
  assert.equal(eventFactorLevel([{ id: "a", category: "depeg", occurredAt: d(10), evidence: { severe: true, deviationPct: 8 } }], NOW).level, "high");
  assert.equal(eventFactorLevel([{ id: "a", category: "depeg", occurredAt: d(10), evidence: { severe: false, deviationPct: 3 } }], NOW).level, "elevated");
});

test("risk events, factor history and outcome log from stored data; ids only; below-peg only; exits need two complete syncs", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { ensureCryptoIntelTables } = await import("../../src/lib/crypto/intel-schema");
  const { runCryptoRiskEvents, latestEventFactor, outcomeLogSummary } = await import("../../src/lib/intel/crypto-events");
  const db = getDb();
  ensureCryptoIntelTables(db);
  const inst = db.prepare(`INSERT INTO instruments (id, symbol, name, asset_type, provider_id, data_source, quote_status, first_seen_at) VALUES (?,?,?,?,?,?,?,?)`);
  for (const [id, sym, name] of [["crypto:coingecko:proto", "PRT", "Proto"], ["crypto:coingecko:usdx", "USDX", "X Dollar"], ["crypto:coingecko:susdx", "SUSDX", "Staked USD X"], ["crypto:coingecko:stale-usd", "SUSD", "Stale USD"], ["crypto:coingecko:a", "A", "A"], ["crypto:coingecko:b", "B", "B"]]) {
    inst.run(id, sym, name, "crypto", id.split(":")[2], "test", "live", NOW);
  }
  db.prepare(`INSERT INTO crypto_security_incidents (id, instrument_id, defillama_id, name, incident_date, amount_usd, returned_usd, classification, technique, chains_json, target_type, source, source_url, retrieved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("h1", "crypto:coingecko:proto", "1", "Proto hack", d(20), 3e7, 0, "Protocol Logic", "Reentrancy", "[]", "DeFi", "defillama", "https://example.org/h1", NOW);
  db.prepare(`INSERT INTO crypto_security_incidents (id, instrument_id, defillama_id, name, incident_date, amount_usd, returned_usd, classification, technique, chains_json, target_type, source, source_url, retrieved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("h2", null, "2", "Unmapped", d(20), 1e6, 0, null, null, "[]", null, "defillama", null, NOW);
  const cat = db.prepare(`INSERT INTO crypto_categories (instrument_id, category_slug, category_name, source, retrieved_at) VALUES (?,?,?,?,?)`);
  for (const id of ["crypto:coingecko:usdx", "crypto:coingecko:susdx", "crypto:coingecko:stale-usd"]) cat.run(id, "stablecoins", "Stablecoins", "coingecko", NOW);
  const snap = db.prepare(`INSERT INTO crypto_market_snapshots (instrument_id, retrieved_at, observed_at, price, rank, market_cap, source) VALUES (?,?,?,?,?,?,?)`);
  const sync1 = d(0.5);
  snap.run("crypto:coingecko:usdx", sync1, sync1, 0.95, 10, 1e9, "coingecko");
  snap.run("crypto:coingecko:susdx", sync1, sync1, 1.12, 11, 1e9, "coingecko"); // above peg: yield-bearing, not a de-peg
  snap.run("crypto:coingecko:stale-usd", sync1, d(60), 0.5, 12, 1e7, "coingecko"); // stale source timestamp: ignored
  db.prepare(`INSERT INTO crypto_price_history (instrument_id, day, price, source, retrieved_at) VALUES (?,?,?,?,?)`).run("crypto:coingecko:usdx", d(40).slice(0, 10), 0.97, "coingecko", NOW);

  const r1 = runCryptoRiskEvents(NOW, db);
  assert.equal(r1.byCategory.exploit, 1, "unmapped incident not attached");
  assert.equal(r1.byCategory.depeg, 2, "history day + latest snapshot for usdx only");
  assert.equal(r1.byCategory.delisting, 0);
  assert.equal(r1.byCategory.unlock, 0);
  assert.equal(r1.outcomes.newExploits, 1);
  assert.equal(r1.outcomes.newDepegs, 2);
  assert.match(r1.outcomes.exitCheck, /needs two market syncs/);
  const f = latestEventFactor("crypto:coingecko:proto", db);
  assert.equal(f.latest!.level, "high");
  assert.equal(f.events[0].linkBasis, "coingecko_id");
  assert.equal(latestEventFactor("crypto:coingecko:usdx", db).latest!.level, "high");
  assert.equal(latestEventFactor("crypto:coingecko:susdx", db).latest, null);

  const r2 = runCryptoRiskEvents(NOW, db);
  assert.equal(r2.newRecords, 0);
  assert.equal(r2.newFactorRows, 0, "history appended only on change");

  // two complete syncs (>= 900 rows each): an asset present in the older and missing in the newer is logged as an exit
  const s1 = d(0.4);
  const s2 = d(0.1);
  const tx = db.transaction(() => {
    for (let i = 0; i < 950; i++) snap.run(`crypto:coingecko:x${i}`, s1, s1, 1, i + 1, 1e6, "coingecko");
    snap.run("crypto:coingecko:a", s1, s1, 1, 999, 1e6, "coingecko");
    for (let i = 0; i < 950; i++) snap.run(`crypto:coingecko:x${i}`, s2, s2, 1, i + 1, 1e6, "coingecko");
    snap.run("crypto:coingecko:b", s2, s2, 1, 999, 1e6, "coingecko");
  });
  tx();
  const r3 = runCryptoRiskEvents(NOW, db);
  assert.equal(r3.outcomes.newExits, 1);
  const sum = outcomeLogSummary(db);
  assert.deepEqual(sum.byKind.map((k) => k.kind).sort(), ["depeg", "exploit", "top1000_exit"]);
  // later factor change appends, never overwrites
  const later = new Date(Date.parse(NOW) + 400 * 86400_000).toISOString();
  runCryptoRiskEvents(later, db);
  const hist = latestEventFactor("crypto:coingecko:proto", db);
  assert.equal(hist.historyCount, 2);
  assert.equal(hist.latest!.level, "noted");
});
