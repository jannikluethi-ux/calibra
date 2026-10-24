/** B2 get-fix (C6): risk gauges, warnings and the causal graph are read-only getters; persisting is explicit. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "./_tmpdb";

useTempDb("calibra-getters-");

test("getters on an empty DB return empty values and write nothing; persisted data is returned unchanged", async () => {
  const { getDb } = await import("../../src/lib/db");
  const { getRiskGauges, persistRiskGauges } = await import("../../src/lib/risk/gauges");
  const { getWarnings, persistWarnings } = await import("../../src/lib/warnings/detect");
  const { getCausalGraph, persistCausalGraph } = await import("../../src/lib/causal/graph");
  const db = getDb();
  const tc = () => (db.prepare("SELECT total_changes() c").get() as { c: number }).c;
  const t0 = tc();
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(getRiskGauges(), []);
    assert.deepEqual(getWarnings(), []);
    assert.deepEqual(getCausalGraph(), { nodes: [], edges: [], updatedAt: "" });
  }
  assert.equal(tc(), t0, "no writes from getters on an empty DB");
  for (const t of ["risk_gauges", "warnings", "causal_graph"]) {
    assert.equal((db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c, 0, t);
  }

  const g = persistRiskGauges();
  persistWarnings();
  const cg = persistCausalGraph();
  const t1 = tc();
  assert.equal(getRiskGauges().length, g.length);
  assert.ok(g.length > 0);
  assert.equal(getCausalGraph().updatedAt, cg.updatedAt);
  getWarnings();
  assert.equal(tc(), t1, "reads after persisting write nothing");
});
