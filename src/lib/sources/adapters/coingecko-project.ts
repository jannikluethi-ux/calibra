import { getDb } from "../../db";
import { blockCoingecko, coingeckoBlocked } from "../cg-guard";
import { fetchJson, sleep } from "../http";
import { appendObservation } from "../observations";

/**
 * Three coins only.
 * bitcoin: tier-1 id already in the DB.
 * chainlink: mid-cap, rank outside the top 10 in the stored table.
 * hegic: provider_id hegic, stored rank outside the top 100.
 * If hegic is not fetchable, the failure is recorded. No substitute is invented.
 */
export const PROJECT_COINS = [
  { id: "bitcoin", instrumentId: "crypto:coingecko:bitcoin" },
  { id: "chainlink", instrumentId: "crypto:coingecko:chainlink" },
  { id: "hegic", instrumentId: "crypto:coingecko:hegic" },
] as const;

const GAP_MS = 8000;

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nonEmptyStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

export async function runCoingeckoProject(): Promise<{ httpStatus: number | null; ok: boolean; note: string; observations: number; partial: boolean }> {
  if (coingeckoBlocked()) {
    return { httpStatus: 429, ok: false, note: "Skipped. CoinGecko already returned 429 in this process.", observations: 0, partial: true };
  }
  const db = getDb();
  let observations = 0;
  let okCount = 0;
  let lastStatus: number | null = null;
  const lines: string[] = [];
  for (let i = 0; i < PROJECT_COINS.length; i++) {
    const coin = PROJECT_COINS[i];
    const exists = db.prepare(`SELECT id FROM instruments WHERE id = ?`).get(coin.instrumentId) as { id: string } | undefined;
    if (!exists) {
      lines.push(`${coin.id}: instrument missing`);
      continue;
    }
    if (i > 0) await sleep(GAP_MS);
    const url =
      `https://api.coingecko.com/api/v3/coins/${coin.id}` +
      "?localization=false&tickers=false&market_data=false&community_data=true&developer_data=false&sparkline=false";
    const res = await fetchJson(url);
    lastStatus = res.status;
    if (res.rateLimited) {
      blockCoingecko();
      lines.push(`${coin.id}: HTTP 429, stopped`);
      return { httpStatus: 429, ok: okCount > 0, note: lines.join("; "), observations, partial: true };
    }
    if (!res.ok || !res.json || typeof res.json !== "object") {
      lines.push(`${coin.id}: HTTP ${res.status} ${res.error || "failed"}`);
      continue;
    }
    const body = res.json as Record<string, unknown>;
    const retrievedAt = new Date().toISOString();
    const pageUrl = `https://www.coingecko.com/en/coins/${coin.id}`;
    const description = body.description;
    const en =
      description && typeof description === "object"
        ? (description as { en?: unknown }).en
        : null;
    if (typeof en === "string" && plainText(en)) {
      if (
        appendObservation({
          instrumentId: coin.instrumentId,
          field: "description",
          value: { text: plainText(en), locale: "en" },
          observedAt: null,
          retrievedAt,
          sourceId: "coingecko_project",
          sourceUrl: pageUrl,
          claimType: "reported_claim",
        })
      ) {
        observations += 1;
      }
    }
    const links = body.links;
    if (links && typeof links === "object") {
      const l = links as Record<string, unknown>;
      const stored = {
        homepage: nonEmptyStrings(l.homepage),
        blockchain_site: nonEmptyStrings(l.blockchain_site),
        official_forum_url: nonEmptyStrings(l.official_forum_url),
        whitepaper: typeof l.whitepaper === "string" && l.whitepaper.trim() ? l.whitepaper.trim() : null,
        repos_url: l.repos_url && typeof l.repos_url === "object" ? l.repos_url : null,
      };
      const any =
        stored.homepage.length ||
        stored.blockchain_site.length ||
        stored.official_forum_url.length ||
        stored.whitepaper ||
        stored.repos_url;
      if (any) {
        if (
          appendObservation({
            instrumentId: coin.instrumentId,
            field: "links",
            value: stored,
            observedAt: null,
            retrievedAt,
            sourceId: "coingecko_project",
            sourceUrl: pageUrl,
            claimType: "reported_claim",
          })
        ) {
          observations += 1;
        }
      }
    }
    if (typeof body.genesis_date === "string" && body.genesis_date.trim()) {
      if (
        appendObservation({
          instrumentId: coin.instrumentId,
          field: "genesis_date",
          value: body.genesis_date.trim(),
          observedAt: null,
          retrievedAt,
          sourceId: "coingecko_project",
          sourceUrl: pageUrl,
          claimType: "reported_claim",
        })
      ) {
        observations += 1;
      }
    }
    const categories = nonEmptyStrings(body.categories);
    if (categories.length) {
      if (
        appendObservation({
          instrumentId: coin.instrumentId,
          field: "categories",
          value: categories,
          observedAt: null,
          retrievedAt,
          sourceId: "coingecko_project",
          sourceUrl: pageUrl,
          claimType: "reported_claim",
        })
      ) {
        observations += 1;
      }
    }
    if (typeof body.hashing_algorithm === "string" && body.hashing_algorithm.trim()) {
      if (
        appendObservation({
          instrumentId: coin.instrumentId,
          field: "hashing_algorithm",
          value: body.hashing_algorithm.trim(),
          observedAt: null,
          retrievedAt,
          sourceId: "coingecko_project",
          sourceUrl: pageUrl,
          claimType: "reported_claim",
        })
      ) {
        observations += 1;
      }
    }
    const sentiment = body.sentiment_votes_up_percentage;
    if (typeof sentiment === "number" && Number.isFinite(sentiment)) {
      if (
        appendObservation({
          instrumentId: coin.instrumentId,
          field: "sentiment_up_pct",
          value: sentiment,
          unit: "percent",
          observedAt: null,
          retrievedAt,
          sourceId: "coingecko_project",
          sourceUrl: pageUrl,
          claimType: "reported_claim",
        })
      ) {
        observations += 1;
      }
    }
    okCount += 1;
    lines.push(`${coin.id}: HTTP ${res.status}`);
  }
  return {
    httpStatus: lastStatus,
    ok: okCount > 0,
    note: lines.join("; "),
    observations,
    partial: okCount > 0 && okCount < PROJECT_COINS.length,
  };
}
