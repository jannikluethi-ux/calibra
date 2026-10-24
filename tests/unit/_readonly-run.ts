/**
 * Shared runner for readonly-routes-{empty,populated}.test.ts (one process per fixture: the DB path is fixed
 * per process). Discovers every GET route + server page/layout, fails on any target without a probe config,
 * probes each with every cookie variant x3 and compares against the exact known-writer list.
 */
import "./_readonly-harness"; // spies first
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDb } from "./_tmpdb";
import { discoverTargets, loadClientComponentSet, probe, summarize, networkAttempts, type Target, type Variant, type TargetResult } from "./_readonly-harness";
import { buildEmptyFixture, buildPopulatedFixture, FAKE_TOKEN, type FixtureCtx } from "./_readonly-fixtures";
import { KNOWN_WRITERS } from "./readonly-known-writers";

type Probe = { url: string; params?: Record<string, string> };
const AAPL = encodeURIComponent("yahoo:AAPL");
const BTC = encodeURIComponent("crypto:coingecko:bitcoin");

/** One or more probe URLs per target id. A discovered target missing here fails the suite. */
export function probesFor(c: FixtureCtx): Record<string, Probe[]> {
  return {
    "GET /api/account/api-keys": [{ url: "/api/account/api-keys" }],
    "GET /api/alerts": [{ url: "/api/alerts" }],
    "GET /api/auth/me": [{ url: "/api/auth/me" }],
    "GET /api/causal": [{ url: "/api/causal" }],
    "GET /api/countries": [{ url: "/api/countries" }, { url: "/api/countries?code=US" }],
    "GET /api/crypto/assets": [{ url: "/api/crypto/assets" }],
    "GET /api/crypto/high-risk": [{ url: "/api/crypto/high-risk" }],
    "GET /api/crypto/overview": [{ url: "/api/crypto/overview" }],
    "GET /api/crypto/research": [{ url: "/api/crypto/research?id=crypto:coingecko:bitcoin" }],
    "GET /api/crypto/resolve": [{ url: "/api/crypto/resolve?q=btc" }],
    "GET /api/crypto/risk": [{ url: "/api/crypto/risk" }],
    "GET /api/data-quality": [{ url: "/api/data-quality" }],
    "GET /api/digest": [{ url: "/api/digest" }],
    "GET /api/events/[id]/intel": [{ url: `/api/events/${c.eventId}/intel`, params: { id: c.eventId } }],
    "GET /api/events": [{ url: "/api/events" }],
    "GET /api/forecasts/calibration": [{ url: "/api/forecasts/calibration" }],
    "GET /api/forecasts/resolve": [{ url: "/api/forecasts/resolve" }],
    "GET /api/forecasts": [{ url: "/api/forecasts" }],
    "GET /api/instruments/[id]": [
      { url: `/api/instruments/${AAPL}`, params: { id: AAPL } },
      { url: `/api/instruments/${BTC}`, params: { id: BTC } },
    ],
    "GET /api/instruments/[id]/series": [
      { url: `/api/instruments/${AAPL}/series?range=1M`, params: { id: AAPL } },
      { url: `/api/instruments/${BTC}/series?range=1Y`, params: { id: BTC } },
    ],
    "GET /api/instruments/resolve": [{ url: "/api/instruments/resolve?symbol=AAPL" }],
    "GET /api/instruments": [{ url: "/api/instruments?q=a" }],
    "GET /api/instruments/suggest": [{ url: "/api/instruments/suggest?q=AA" }],
    "GET /api/instruments/sync": [{ url: "/api/instruments/sync" }],
    "GET /api/market": [{ url: "/api/market" }],
    "GET /api/movers": [{ url: "/api/movers" }],
    "GET /api/portfolio": [{ url: "/api/portfolio" }],
    "GET /api/refresh": [{ url: "/api/refresh" }],
    "GET /api/risk": [{ url: "/api/risk" }],
    "GET /api/scenarios": [{ url: "/api/scenarios" }],
    "GET /api/scheduler/status": [{ url: "/api/scheduler/status" }],
    "GET /api/sources/health": [{ url: "/api/sources/health" }],
    "GET /api/v1/calibration": [{ url: "/api/v1/calibration" }],
    "GET /api/v1/events": [{ url: "/api/v1/events" }],
    "GET /api/v1/forecasts": [{ url: "/api/v1/forecasts" }],
    "GET /api/v1/movers": [{ url: "/api/v1/movers" }],
    "GET /api/v1/scenarios": [{ url: "/api/v1/scenarios" }],
    "GET /api/warnings": [{ url: "/api/warnings" }],
    "GET /api/watchlists/[id]/items": [{ url: `/api/watchlists/${c.watchlistId}/items`, params: { id: c.watchlistId } }],
    "GET /api/watchlists": [{ url: "/api/watchlists" }],
    "PAGE /assets/[symbol]/page": [{ url: "/assets/SPX", params: { symbol: "SPX" } }, { url: "/assets/AAPL", params: { symbol: "AAPL" } }],
    "PAGE /assets/page": [{ url: "/assets" }],
    "PAGE /countries/[code]/page": [{ url: "/countries/US", params: { code: "US" } }],
    "PAGE /countries/page": [{ url: "/countries" }],
    "PAGE /crypto/[id]/page": [{ url: "/crypto/bitcoin", params: { id: "bitcoin" } }],
    "PAGE /crypto/assets/page": [{ url: "/crypto/assets" }],
    "PAGE /crypto/categories/page": [{ url: "/crypto/categories" }],
    "PAGE /crypto/high-risk/page": [{ url: "/crypto/high-risk" }],
    "PAGE /crypto/methodology/page": [{ url: "/crypto/methodology" }],
    "PAGE /crypto/page": [{ url: "/crypto" }],
    "PAGE /crypto/risk/page": [{ url: "/crypto/risk" }],
    "PAGE /data-quality/page": [{ url: "/data-quality" }],
    "PAGE /digest/page": [{ url: "/digest" }],
    "PAGE /docs/api/page": [{ url: "/docs/api" }],
    "PAGE /events/[id]/page": [{ url: `/events/${c.eventId}`, params: { id: c.eventId } }],
    "PAGE /events/conflicts/page": [{ url: "/events/conflicts" }],
    "PAGE /events/page": [{ url: "/events" }],
    "PAGE /explorer/page": [{ url: "/explorer" }],
    "PAGE /forecasts/page": [{ url: "/forecasts" }],
    "PAGE /instruments/[id]/page": [{ url: `/instruments/${AAPL}`, params: { id: AAPL } }],
    "PAGE /layout": [{ url: "/" }],
    "PAGE /map/page": [{ url: "/map" }],
    "PAGE /methodology/page": [{ url: "/methodology" }],
    "PAGE /movers/page": [{ url: "/movers" }],
    "PAGE /page": [{ url: "/" }],
    "PAGE /scenarios/page": [{ url: "/scenarios" }],
    "PAGE /warnings/page": [{ url: "/warnings" }],
  };
}

export function variantsFor(c: FixtureCtx): Variant[] {
  const v: Variant[] = [{ name: "no-cookie" }, { name: "invalid-session", cookie: `calibra_session=${FAKE_TOKEN}` }];
  if (c.validToken) v.push({ name: "valid-session", cookie: `calibra_session=${c.validToken}` });
  if (c.expiredToken) v.push({ name: "expired-session", cookie: `calibra_session=${c.expiredToken}` });
  return v;
}

export function runReadonlySuite(fixture: "empty" | "populated") {
  const dir = useTempDb(`calibra-ro-${fixture}-`);
  for (const k of ["CALIBRA_JOB_TOKEN", "CALIBRA_SCHEDULER", "CALIBRA_DEMO_USERS", "MONITOR_LOOP_ENABLED"]) delete process.env[k];
  const results: TargetResult[] = [];

  test(`read-only GET/page regression — ${fixture} DB`, async (t) => {
    const ctx = fixture === "empty" ? await buildEmptyFixture() : await buildPopulatedFixture();
    const { getDb } = await import("../../src/lib/db");
    const db = getDb();
    db.pragma("wal_checkpoint(TRUNCATE)"); // fixture writes flushed before the first baseline
    await loadClientComponentSet();
    const targets = discoverTargets();
    const probes = probesFor(ctx);
    const missing = targets.filter((x: Target) => !probes[x.id]).map((x) => x.id);
    assert.deepEqual(missing, [], "every discovered GET route / server page needs a probe config");
    const stale = Object.keys(probes).filter((id) => !targets.some((x) => x.id === id));
    assert.deepEqual(stale, [], "probe configs for targets that no longer exist");

    const variants = variantsFor(ctx);
    const known = KNOWN_WRITERS[fixture];
    for (const target of targets) {
      for (const p of probes[target.id]) {
        const r = await probe(db, join(dir, "data"), target, p.url, p.params ?? {}, variants, 3);
        results.push(r);
      }
    }
    const offenders = new Map<string, TargetResult[]>();
    for (const r of results) if (r.violations.length) offenders.set(r.id, [...(offenders.get(r.id) ?? []), r]);
    if (process.env.CALIBRA_RO_REPORT) {
      writeFileSync(
        process.env.CALIBRA_RO_REPORT,
        JSON.stringify({ fixture, targets: targets.length, probes: results.length, networkAttempts, results }, null, 2)
      );
    }
    for (const r of results) {
      await t.test(`${r.id} ${r.url}`, () => {
        const threw = r.outcomes.filter((o) => o.threw);
        if (!known[r.id]) assert.deepEqual(threw, [], `handler threw: ${JSON.stringify(threw[0])}`);
        if (known[r.id]) {
          assert.ok(offenders.has(r.id), `${r.id} is listed as a known writer (${known[r.id]}) but is now clean — remove it`);
        } else {
          assert.deepEqual(r.violations, [], summarize(r));
        }
      });
    }
  });
}
