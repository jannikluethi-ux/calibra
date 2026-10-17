import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHighRiskQuery, toQueryString, backHref, buildWhere, orderBy } from "../../src/lib/crypto/highrisk-query";

test("defaults and whitelisting: unknown values are dropped, never interpolated", () => {
  const d = parseHighRiskQuery({});
  assert.equal(d.view, "high"); assert.equal(d.sort, "score"); assert.equal(d.dir, "desc"); assert.equal(d.page, 1);
  const q = parseHighRiskQuery({ view: "nope", sort: "price; DROP TABLE x", band: "high,bogus,extreme", factor: "market_volatility", category: "Bad Slug!", network: "ethereum", conf: "ultra", fresh: "stale", page: "-3" });
  assert.equal(q.view, "high");
  assert.equal(q.sort, "score");
  assert.deepEqual(q.band, ["high", "extreme"]);
  assert.equal(q.factor, null, "non-structural factor is not a filter");
  assert.equal(q.category, null);
  assert.equal(q.network, "ethereum");
  assert.equal(q.conf, null);
  assert.equal(q.fresh, "stale");
  assert.equal(q.page, 1);
});

test("serialize/parse round-trip preserves filter state", () => {
  const q = parseHighRiskQuery({ q: "usd", view: "structural", band: "high", factor: "liquidity", category: "stablecoins", network: "solana", conf: "medium", fresh: "fresh", sort: "market_cap", dir: "asc", page: "3" });
  const qs = toQueryString(q);
  assert.deepEqual(parseHighRiskQuery(new URLSearchParams(qs)), q);
  assert.equal(toQueryString(parseHighRiskQuery({})), "", "defaults serialize to empty");
  assert.equal(new URLSearchParams(toQueryString(q, { page: 1 })).get("page"), null);
});

test("backHref only returns a sanitized high-risk list URL", () => {
  assert.equal(backHref(undefined), "/crypto/high-risk");
  assert.equal(backHref(""), "/crypto/high-risk");
  assert.equal(backHref("view=all&sort=name"), "/crypto/high-risk?view=all&sort=name");
  assert.equal(backHref("https://evil.example/&view=volatility&x=<script>"), "/crypto/high-risk?view=volatility");
});

test("SQL builder uses placeholders and escapes LIKE wildcards", () => {
  const q = parseHighRiskQuery({ q: "50%_off", view: "all", band: "high,extreme", category: "meme-token", network: "base", conf: "high", fresh: "fresh" });
  const { where, params } = buildWhere(q, "2026-10-17T12:00:00.000Z");
  assert.ok(!where.includes("meme-token") && !where.includes("base'") && !where.includes("50%"));
  assert.equal((where.match(/\?/g) || []).length, params.length);
  assert.ok(params.includes("%50\\%\\_off%"));
  assert.ok(params.includes("2026-10-16T00:00:00.000Z"), "36 h freshness cut-off");
  assert.match(orderBy(parseHighRiskQuery({ sort: "name" })), /ORDER BY \(i\.name COLLATE NOCASE IS NULL\), i\.name COLLATE NOCASE ASC/);
  assert.equal(buildWhere(parseHighRiskQuery({ view: "all" }), "2026-10-17T12:00:00.000Z").where, "");
});

test("selection -> detail -> back restores the exact list state (navigation round-trip)", async () => {
  const { detailHref } = await import("../../src/lib/crypto/highrisk-query");
  const q = parseHighRiskQuery({ view: "structural", factor: "dilution", network: "base", sort: "confidence", dir: "asc", page: "2", q: "a&b=c" });
  const href = detailHref("crypto:coingecko:some-coin", q);
  assert.ok(href.startsWith("/crypto/crypto%3Acoingecko%3Asome-coin?from="));
  const from = new URL(href, "http://x").searchParams.get("from")!;
  const back = backHref(from);
  assert.deepEqual(parseHighRiskQuery(new URL(back, "http://x").searchParams), q);
  assert.equal(backHref(new URL(detailHref("id", parseHighRiskQuery({})), "http://x").searchParams.get("from")!), "/crypto/high-risk");
});
