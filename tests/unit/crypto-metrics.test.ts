import { test } from "node:test";
import assert from "node:assert/strict";
import { returnOver, realizedVol, maxDrawdown, returnCorrelation, type DailyPoint } from "../../src/lib/crypto/metrics";

const days = (prices: number[], start = Date.UTC(2026, 6, 1)): DailyPoint[] =>
  prices.map((p, i) => ({ day: new Date(start + i * 86400_000).toISOString().slice(0, 10), price: p }));

test("returnOver uses stored points only and returns null without enough history", () => {
  const s = days([100, 101, 102, 103, 104, 105, 106, 110]);
  assert.equal(Math.round(returnOver(s, 7)! * 100) / 100, 10);
  assert.equal(returnOver(s, 30), null);
  assert.equal(returnOver([], 7), null);
});

test("realizedVol needs >=20 points; constant series has zero vol", () => {
  assert.equal(realizedVol(days(Array(10).fill(1)), 30), null);
  assert.equal(realizedVol(days(Array(40).fill(5)), 30), 0);
  const zig = days(Array.from({ length: 40 }, (_, i) => (i % 2 ? 110 : 100)));
  assert.ok(realizedVol(zig, 30)! > 100);
});

test("maxDrawdown finds the peak-to-trough fall", () => {
  const s = days([100, ...Array(10).fill(120), 60, ...Array(10).fill(90)]);
  assert.equal(Math.round(maxDrawdown(s)!), -50);
  assert.equal(maxDrawdown(days([1, 2, 3])), null);
});

test("returnCorrelation needs >=30 matching days and detects perfect correlation", () => {
  const a = days(Array.from({ length: 40 }, (_, i) => 100 * Math.exp(0.01 * Math.sin(i))));
  const b = days(a.map((p) => p.price * 2));
  const c = returnCorrelation(a, b);
  assert.equal(c.pairs, 39);
  assert.ok(Math.abs(c.value! - 1) < 1e-9);
  const short = returnCorrelation(a.slice(0, 20), b.slice(0, 20));
  assert.equal(short.value, null);
  const shifted = returnCorrelation(a, days(b.map((p) => p.price), Date.UTC(2027, 0, 1)));
  assert.equal(shifted.pairs, 0, "only matching days are paired");
});
