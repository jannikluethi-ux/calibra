import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";

useTempDb("calibra-rates-");

const UST = `Date,"1 Mo","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"
10/16/2026,4.20,4.21,4.22,4.23,4.30,4.50,4.74,4.80,4.90,5.00,5.09,5.40,5.30
10/15/2026,4.19,4.20,4.21,4.22,4.29,4.49,4.70,4.79,4.88,4.98,5.05,5.38,5.28`;
const BUBA = `"";BBSIS.D.I.ZAR.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A;BBSIS.D.I.ZAR.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A_FLAGS
unit;%;
2026-10-15;3,41;
2026-10-16;3,45;`;

test("parsers read the newest row; out-of-range or malformed input is rejected", async () => {
  const { parseTreasuryCsv, parseBundesbankCsv } = await import("../../src/lib/sources/adapters/official-rates");
  assert.deepEqual(parseTreasuryCsv(UST), { date: "2026-10-16", y2: 4.74, y10: 5.09 });
  assert.deepEqual(parseBundesbankCsv(BUBA), { date: "2026-10-16", y10: 3.45 });
  assert.equal(parseTreasuryCsv("<html>blocked</html>"), null);
  assert.equal(parseBundesbankCsv("2026-10-16;999,0;"), null);
  assert.equal(parseBundesbankCsv(""), null);
});

test("one failing official source does not block the other; observations carry observed/retrieved times", async () => {
  const { runOfficialRates } = await import("../../src/lib/sources/adapters/official-rates");
  const { getDb } = await import("../../src/lib/db");
  const { getHealth } = await import("../../src/lib/sources/health");
  const r = await runOfficialRates({
    now: new Date("2026-10-17T10:00:00Z"),
    retryBaseMs: 1,
    fetchText: async (url) => (url.includes("treasury.gov") ? { status: 503, text: "down" } : { status: 200, text: BUBA }),
  });
  assert.equal(r.ust.ok, false);
  assert.equal(r.ust.errorClass, "unavailable");
  assert.equal(r.bundesbank.ok, true);
  const rows = getDb().prepare(`SELECT instrument_id, value_json, observed_at, retrieved_at, source_id, claim_type FROM source_observations WHERE instrument_id LIKE 'rates:%'`).all() as Record<string, string>[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].instrument_id, "rates:DE10Y");
  assert.equal(JSON.parse(rows[0].value_json), 3.45);
  assert.equal(rows[0].observed_at, "2026-10-16");
  assert.ok(rows[0].retrieved_at.endsWith("Z"));
  assert.equal(rows[0].claim_type, "observed_official");
  assert.equal(getHealth("ust_yield_curve")!.errorClass, "unavailable");
  assert.equal(getHealth("bundesbank_yields")!.status, "healthy");
});

test("200 with an unparseable body is invalid_data and stores nothing", async () => {
  const { runOfficialRates } = await import("../../src/lib/sources/adapters/official-rates");
  const { getDb } = await import("../../src/lib/db");
  const n0 = (getDb().prepare(`SELECT COUNT(*) n FROM source_observations`).get() as { n: number }).n;
  const r = await runOfficialRates({ now: new Date("2026-10-17T10:00:00Z"), retryBaseMs: 1, fetchText: async () => ({ status: 200, text: "<html>maintenance</html>" }) });
  assert.equal(r.ust.errorClass, "invalid_data");
  assert.equal(r.bundesbank.errorClass, "invalid_data");
  assert.equal((getDb().prepare(`SELECT COUNT(*) n FROM source_observations`).get() as { n: number }).n, n0);
});
