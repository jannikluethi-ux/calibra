/** B2 get-fix (C7): crypto read paths never seed the source registry; seeding is explicit and zero-write when unchanged. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";

useTempDb("calibra-crypto-ro-");

test("crypto read paths on an empty DB write nothing and seed no sources", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { cryptoOverview } = await import("../../src/lib/crypto/overview");
  const { computeCoverage } = await import("../../src/lib/crypto/coverage");
  const { getResearch } = await import("../../src/lib/crypto/research");
  const { resolveCryptoQuery } = await import("../../src/lib/crypto/resolve");
  const { listHighRisk, highRiskFacets, getRiskProfile } = await import("../../src/lib/crypto/risk-store");
  const { parseHighRiskQuery } = await import("../../src/lib/crypto/highrisk-query");
  const { getInstrumentEvidence } = await import("../../src/lib/forecast/instrument_evidence");
  const db = getDb();
  const tc = () => (db.prepare("SELECT total_changes() c").get() as { c: number }).c;
  const t0 = tc();
  for (let i = 0; i < 3; i++) {
    cryptoOverview();
    computeCoverage();
    getResearch("crypto:coingecko:bitcoin");
    resolveCryptoQuery("bitcoin");
    listHighRisk(parseHighRiskQuery({}));
    highRiskFacets();
    getRiskProfile("crypto:coingecko:bitcoin");
    getInstrumentEvidence("crypto:coingecko:bitcoin");
  }
  assert.equal(tc(), t0, "no writes from crypto read paths");
  assert.equal((db.prepare("SELECT COUNT(*) c FROM sources").get() as { c: number }).c, 0, "no source seeding on reads");
});

test("explicit seeding writes the source registry once, then is zero-write and keeps operator disables", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { seedSources } = await import("../../src/lib/sources/seeds");
  const db = getDb();
  const tc = () => (db.prepare("SELECT total_changes() c").get() as { c: number }).c;
  seedSources(db);
  const n = (db.prepare("SELECT COUNT(*) c FROM sources").get() as { c: number }).c;
  assert.ok(n > 0);
  const id = (db.prepare("SELECT id FROM sources WHERE enabled = 1 LIMIT 1").get() as { id: string }).id;
  db.prepare("UPDATE sources SET enabled = 0 WHERE id = ?").run(id);
  const t1 = tc();
  seedSources(db);
  seedSources(db);
  assert.equal(tc(), t1, "re-seeding unchanged rows writes nothing");
  assert.equal((db.prepare("SELECT enabled FROM sources WHERE id = ?").get(id) as { enabled: number }).enabled, 0);
});
