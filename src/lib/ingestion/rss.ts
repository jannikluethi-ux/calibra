import Parser from "rss-parser";
import { randomUUID } from "crypto";
import type { FinancialEvent, DataQuality, SourceTier, EventProvenance } from "../types";
import { classifyEventV2, reclassifyEventV2 } from "../classification/classify_v2";
import { getDb, upsertJson, setMeta } from "../db";
import { upsertEventDeduped } from "./dedupe";
import { recordAttempt, skipCheck } from "../sources/health";
import { classifyFailure, mapWithConcurrency, statusFromError, withRetry, withTimeout, type AttemptOutcome } from "../sources/health-core";

const parser = new Parser({
  timeout: 12000,
  headers: { "User-Agent": "GlobalFinancialIntelligenceAgent/0.1 (research; +local)" },
});

export interface FeedDef {
  id: string;
  name: string;
  url: string;
  tier: SourceTier;
  /** false = not called; health shows "disabled" with the reason. */
  active: boolean;
  inactiveReason?: string;
}

/**
 * Public RSS endpoints. A failing feed is recorded in source_health and skipped; it is never
 * replaced by demo/synthetic events (demo rows exist only for an empty-DB bootstrap).
 */
export const RSS_FEEDS: FeedDef[] = [
  { id: "rss_federal_reserve", name: "Federal Reserve Press", url: "https://www.federalreserve.gov/feeds/press_all.xml", tier: 1, active: true },
  { id: "rss_ecb", name: "ECB Press", url: "https://www.ecb.europa.eu/rss/press.html", tier: 1, active: true },
  { id: "rss_imf", name: "IMF News", url: "https://www.imf.org/en/News/RSS", tier: 1, active: true },
  {
    id: "rss_reuters",
    name: "Reuters Business",
    url: "https://feeds.reuters.com/reuters/businessNews",
    tier: 3,
    active: false,
    inactiveReason: "feeds.reuters.com retired (DNS lookup fails; 0 events ever stored); disabled 2026-10-17",
  },
  { id: "rss_cnbc", name: "CNBC Top News", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", tier: 3, active: true },
];

export interface FeedItem {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  summary?: string;
}
export type FeedFetcher = (url: string) => Promise<FeedItem[]>;

const defaultFetcher: FeedFetcher = async (url) => {
  const parsed = await withTimeout(parser.parseURL(url), 15000, url);
  return (parsed.items || []) as FeedItem[];
};

function parseDate(s: string | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const DEMO_EVENTS: Omit<FinancialEvent, "id" | "ingestedAt">[] = [
  {
    title: "FOMC holds rates; statement notes still-elevated inflation risks",
    summary:
      "Illustrative sample: Fed maintains target range; market interprets mildly hawkish tone on inflation persistence.",
    rawText:
      "SAMPLE EVENT (not live). The Federal Open Market Committee decided to maintain the target range. Inflation remains somewhat elevated. Labor market conditions have generally eased.",
    country: "US",
    region: "North America",
    sector: "Rates",
    assetClass: "Rates / FX / Equities",
    transmissionMechanism:
      "US → Fed → policy path → real rates → USD → global liquidity → equities → credit → crypto",
    causalChain: ["US", "Fed", "policy rates", "real rates", "USD", "liquidity", "equities", "crypto", "bonds"],
    expectedImpact: "Near-term USD support; duration volatility; risk assets sensitive to path-of-rates narrative.",
    timeHorizon: "1-4w",
    impactScore: {
      magnitude: 72,
      probability: 65,
      marketSensitivity: 80,
      transmissionSpeed: 70,
      persistence: 55,
      confidence: 55,
      composite: 68,
      methodology: "Demo seed — illustrative only",
    },
    sourceTier: 1,
    sourceName: "Demo / illustrative Fed-style sample",
    citationUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
    publishedAt: new Date(Date.now() - 3600_000 * 8).toISOString(),
    quality: "demo",
    tags: ["central_bank", "inflation", "demo"],
    classification: {
      categories: ["central_bank", "inflation"],
      entities: ["Fed", "US"],
      sentiment: "hawkish",
      confidence: 0.7,
      method: "heuristic_v1",
    },
  },
  {
    title: "BOJ signals reduced accommodation; JPY volatility rises",
    summary:
      "Illustrative sample: Policy normalization narrative in Japan; carry-trade sensitivity highlighted.",
    rawText:
      "SAMPLE EVENT (not live). Bank of Japan discusses further steps toward policy normalization. Yen strengthens intraday; global carry positions watched closely.",
    country: "JP",
    region: "Asia",
    sector: "FX / Rates",
    assetClass: "FX / Equities / Crypto",
    transmissionMechanism: "Japan → BOJ → rates → JPY → liquidity → carry → equities → crypto → bonds",
    causalChain: ["Japan", "BOJ", "rates", "JPY", "liquidity", "carry", "equities", "crypto", "bonds"],
    expectedImpact: "Carry unwind risk; EM and high-beta equity sensitivity; crypto correlated risk appetite channel.",
    timeHorizon: "1-7d",
    impactScore: {
      magnitude: 78,
      probability: 55,
      marketSensitivity: 85,
      transmissionSpeed: 85,
      persistence: 50,
      confidence: 50,
      composite: 70,
      methodology: "Demo seed — illustrative only",
    },
    sourceTier: 1,
    sourceName: "Demo / illustrative BOJ-style sample",
    citationUrl: "https://www.boj.or.jp/en/",
    publishedAt: new Date(Date.now() - 3600_000 * 20).toISOString(),
    quality: "demo",
    tags: ["central_bank", "fx", "demo"],
    classification: {
      categories: ["central_bank", "fx"],
      entities: ["BOJ", "Japan"],
      sentiment: "hawkish",
      confidence: 0.65,
      method: "heuristic_v1",
    },
  },
  {
    title: "Eurozone flash CPI softens; ECB cut pricing adjusts",
    summary:
      "Illustrative sample: Softer inflation print shifts near-term ECB path expectations.",
    rawText:
      "SAMPLE EVENT (not live). Eurozone flash CPI comes in below consensus. Money markets add ECB ease pricing for the next two meetings.",
    country: "EU",
    region: "Europe",
    sector: "Rates",
    assetClass: "Rates / FX / Equities",
    transmissionMechanism: "Eurozone → inflation → ECB reaction → EUR → bunds → European equities",
    causalChain: ["Eurozone", "inflation print", "ECB", "EUR", "bunds", "EU equities"],
    expectedImpact: "Bullish duration skew if confirmed; EUR soft vs USD depending on relative US data.",
    timeHorizon: "1-4w",
    impactScore: {
      magnitude: 60,
      probability: 60,
      marketSensitivity: 70,
      transmissionSpeed: 65,
      persistence: 45,
      confidence: 52,
      composite: 60,
      methodology: "Demo seed — illustrative only",
    },
    sourceTier: 1,
    sourceName: "Demo / illustrative Eurostat/ECB-style sample",
    citationUrl: "https://www.ecb.europa.eu/",
    publishedAt: new Date(Date.now() - 3600_000 * 30).toISOString(),
    quality: "demo",
    tags: ["inflation", "central_bank", "demo"],
    classification: {
      categories: ["inflation", "central_bank"],
      entities: ["ECB", "Eurozone"],
      sentiment: "dovish",
      confidence: 0.62,
      method: "heuristic_v1",
    },
  },
  {
    title: "Crude oil jumps on Middle East supply-risk headlines",
    summary:
      "Illustrative sample: Energy risk premium rises; inflation and terms-of-trade channels noted.",
    rawText:
      "SAMPLE EVENT (not live). Oil prices rise on reports of heightened supply risk. Markets watch inflation pass-through and equity sector rotation into energy.",
    country: undefined,
    region: "Middle East",
    sector: "Energy",
    assetClass: "Commodities / Equities / FX",
    transmissionMechanism: "Energy shock → inflation impulse → real incomes → CB reaction → FX → equities",
    causalChain: ["geopolitics", "oil", "inflation", "rates path", "FX", "equities"],
    expectedImpact: "Short-horizon vol in energy and inflation-linked assets; equity dispersion by sector.",
    timeHorizon: "1-7d",
    impactScore: {
      magnitude: 68,
      probability: 50,
      marketSensitivity: 75,
      transmissionSpeed: 80,
      persistence: 40,
      confidence: 45,
      composite: 62,
      methodology: "Demo seed — illustrative only",
    },
    sourceTier: 3,
    sourceName: "Demo / illustrative energy-geopolitics sample",
    citationUrl: "https://www.eia.gov/",
    publishedAt: new Date(Date.now() - 3600_000 * 5).toISOString(),
    quality: "demo",
    tags: ["energy", "geopolitics", "demo"],
    classification: {
      categories: ["energy", "geopolitics"],
      entities: [],
      sentiment: "risk_off",
      confidence: 0.55,
      method: "heuristic_v1",
    },
  },
  {
    title: "US labor market cools; unemployment edges higher",
    summary:
      "Illustrative sample: Softer labor print raises odds of easier policy path — contested interpretation.",
    rawText:
      "SAMPLE EVENT (not live). Nonfarm payrolls and unemployment rate point to cooling. Bond yields fall; equities mixed on growth-vs-easing debate.",
    country: "US",
    region: "North America",
    sector: "Macro",
    assetClass: "Rates / Equities",
    transmissionMechanism: "US → labor → growth expectations → Fed path → yields → equities",
    causalChain: ["US", "labor data", "growth", "Fed path", "yields", "equities"],
    expectedImpact: "Bull steepener/easing narrative vs growth-scare risk-off — scenarios diverge.",
    timeHorizon: "1-4w",
    impactScore: {
      magnitude: 70,
      probability: 58,
      marketSensitivity: 82,
      transmissionSpeed: 75,
      persistence: 50,
      confidence: 58,
      composite: 67,
      methodology: "Demo seed — illustrative only",
    },
    sourceTier: 1,
    sourceName: "Demo / illustrative BLS-style sample",
    citationUrl: "https://www.bls.gov/",
    publishedAt: new Date(Date.now() - 3600_000 * 48).toISOString(),
    quality: "demo",
    tags: ["growth", "central_bank", "demo"],
    classification: {
      categories: ["growth", "central_bank"],
      entities: ["Fed", "US"],
      sentiment: "mixed",
      confidence: 0.6,
      method: "heuristic_v1",
    },
  },
];

function itemToEvent(
  title: string,
  body: string,
  link: string | undefined,
  publishedAt: string,
  feed: FeedDef,
  quality: DataQuality
): FinancialEvent {
  const v2 = classifyEventV2({
    title,
    body,
    sourceTier: feed.tier,
    sourceName: feed.name,
    quality,
  });

  return {
    id: randomUUID(),
    title: title.slice(0, 240),
    summary: body.slice(0, 400) || title,
    rawText: body.slice(0, 4000),
    country: v2.country,
    region: v2.region,
    sector: v2.sector,
    assetClass: v2.assetClass,
    transmissionMechanism: v2.transmissionMechanism,
    causalChain: v2.causalChain,
    expectedImpact: v2.expectedImpact,
    timeHorizon: v2.timeHorizon,
    impactScore: v2.impactScore,
    sourceTier: feed.tier,
    sourceName: feed.name,
    citationUrl: link,
    publishedAt,
    ingestedAt: new Date().toISOString(),
    quality,
    tags: v2.tags,
    classification: v2.classification,
    evidenceLayers: v2.evidenceLayers,
  };
}

export interface FeedRunReport {
  id: string;
  name: string;
  outcome: AttemptOutcome | { ok: false; errorClass: "disabled" | "skipped"; error: string };
  attempts: number;
  items: number;
}

export async function ingestRssFeeds(deps: { fetchFeed?: FeedFetcher; feeds?: FeedDef[]; retryBaseMs?: number } = {}): Promise<{
  live: number;
  demo: number;
  events: FinancialEvent[];
  feeds: FeedRunReport[];
}> {
  getDb();
  const fetchFeed = deps.fetchFeed ?? defaultFetcher;
  const feeds = deps.feeds ?? RSS_FEEDS;
  const collected: FinancialEvent[] = [];
  const reports: FeedRunReport[] = [];
  let live = 0;

  const results = await mapWithConcurrency(feeds, 3, async (feed) => {
    if (!feed.active) {
      recordAttempt(feed.id, { ok: false, errorClass: "disabled", error: feed.inactiveReason ?? "inactive" });
      return { feed, report: { id: feed.id, name: feed.name, outcome: { ok: false as const, errorClass: "disabled" as const, error: feed.inactiveReason ?? "inactive" }, attempts: 0, items: 0 }, events: [] as FinancialEvent[] };
    }
    const sk = skipCheck(feed.id);
    if (sk.skip) {
      return { feed, report: { id: feed.id, name: feed.name, outcome: { ok: false as const, errorClass: "skipped" as const, error: sk.reason ?? "back-off" }, attempts: 0, items: 0 }, events: [] as FinancialEvent[] };
    }
    const t0 = Date.now();
    const r = await withRetry<FeedItem[]>(
      async () => {
        try {
          const items = await fetchFeed(feed.url);
          return { outcome: { ok: true, errorClass: "ok", items: items.length }, value: items };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const status = statusFromError(e);
          return { outcome: { ok: false, errorClass: classifyFailure({ status, error: msg }), httpStatus: status, error: msg.slice(0, 300) } };
        }
      },
      { retries: 1, baseDelayMs: deps.retryBaseMs ?? 1000 }
    );
    const retrievedAt = new Date().toISOString();
    const events: FinancialEvent[] = [];
    let newest: string | null = null;
    if (r.outcome.ok && r.value) {
      for (const item of r.value.slice(0, 8)) {
        const title = item.title?.trim();
        if (!title) continue;
        const body = (item.contentSnippet || item.content || item.summary || "").toString();
        const srcPublished = parseDate(item.isoDate) ?? parseDate(item.pubDate);
        if (srcPublished && (!newest || srcPublished > newest)) newest = srcPublished;
        // published_at is a NOT NULL sort key; when the item carries no date we sort by retrieval time
        // but record sourcePublishedAt = null and mark the field as missing in provenance.
        const ev = itemToEvent(title, body, item.link, srcPublished ?? retrievedAt, feed, "live");
        ev.provenance = {
          sourceId: feed.id,
          sourceName: feed.name,
          feedUrl: feed.url,
          itemUrl: item.link ?? null,
          sourcePublishedAt: srcPublished,
          retrievedAt,
          fields: {
            title: "observed",
            summary: body ? "observed" : "missing",
            publishedAt: srcPublished ? "observed" : "missing",
            classification: "derived",
            impactScore: "estimated",
            transmissionMechanism: "estimated",
          },
          transformations: ["rss-parse", "title-trim-240", "body-trim-4000", "classify_v2 (heuristic)", "event_dedupe_v1 (exact normalized title, 72h)"],
          corroboration: null,
          pipeline: "ingestRssFeeds v2 (2026-10-17)",
        } satisfies EventProvenance;
        events.push(ev);
      }
    }
    const outcome: AttemptOutcome = { ...r.outcome, latencyMs: Date.now() - t0, items: events.length, newestObservationAt: newest };
    recordAttempt(feed.id, outcome);
    return { feed, report: { id: feed.id, name: feed.name, outcome, attempts: r.attempts, items: events.length }, events };
  });

  for (const res of results) {
    if (res.status === "fulfilled") {
      reports.push(res.value.report);
      collected.push(...res.value.events);
      live += res.value.events.length;
    }
  }

  // No synthetic substitution: when feeds fail we store nothing new. Demo rows are only seeded by
  // ensureDemoEventsIfEmpty() for a completely empty database and stay labeled quality='demo'.
  const demo = 0;

  // Batch-local exact-title dedupe, then DB near-dupe upsert (normalize + 72h window).
  const seen = new Set<string>();
  const unique: FinancialEvent[] = [];
  for (const ev of collected) {
    const key = ev.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ev);
  }

  const stored: FinancialEvent[] = [];
  for (const ev of unique) {
    const { event } = upsertEventDeduped(ev);
    if (!stored.some((s) => s.id === event.id)) stored.push(event);
  }

  if (live > 0) setMeta("lastEventUpdate", new Date().toISOString());
  return { live, demo, events: stored, feeds: reports };
}

/** Excludes events linked as non-canonical members of a same-story cluster (they stay stored). */
const CANONICAL_ONLY = `AND id NOT IN (SELECT event_id FROM event_clusters WHERE event_id != canonical_event_id)`;

export function getEvents(limit = 100, opts: { includeDemo?: boolean; canonicalOnly?: boolean } = {}): FinancialEvent[] {
  // Same order as the previous full-table load + slice. LIMIT avoids parsing
  // every stored event (thousands of rows) on each dashboard read.
  // Demo/illustrative rows (quality='demo') are excluded from live views and counts;
  // they are only returned when no non-demo events exist (empty-DB bootstrap).
  const n = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 100;
  const db = getDb();
  if (!opts.includeDemo) {
    const rows = db
      .prepare(`SELECT data FROM events WHERE quality != 'demo' ${opts.canonicalOnly ? CANONICAL_ONLY : ""} ORDER BY published_at DESC LIMIT ?`)
      .all(n) as { data: string }[];
    if (rows.length) return rows.map((r) => JSON.parse(r.data) as FinancialEvent);
  }
  const rows = db
    .prepare(`SELECT data FROM events ORDER BY published_at DESC LIMIT ?`)
    .all(n) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as FinancialEvent);
}

export function getEvent(id: string): FinancialEvent | null {
  const row = getDb().prepare(`SELECT data FROM events WHERE id = ?`).get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as FinancialEvent) : null;
}

export function ensureDemoEventsIfEmpty() {
  const existing = getEvents(5);
  if (existing.length > 0) return;
  for (const d of DEMO_EVENTS) {
    const base: FinancialEvent = { ...d, id: randomUUID(), ingestedAt: new Date().toISOString() };
    const ev = reclassifyEventV2(base);
    upsertJson("events", "id", ev.id, ev, { published_at: ev.publishedAt, quality: ev.quality });
  }
}

/** Reclassify open/recent events with heuristic_v2; store prior method in metadata for audit */
export function reclassifyEventsV2(opts?: { limit?: number; onlyOutdated?: boolean }): {
  total: number;
  updated: number;
  events: FinancialEvent[];
} {
  getDb();
  const limit = opts?.limit ?? 100;
  const onlyOutdated = opts?.onlyOutdated ?? true;
  const all = getEvents(limit);
  let updated = 0;
  const out: FinancialEvent[] = [];
  for (const ev of all) {
    const needs =
      !onlyOutdated ||
      ev.classification.method !== "heuristic_v2" ||
      ev.classification.classifier_version !== "heuristic_v2";
    if (!needs) {
      out.push(ev);
      continue;
    }
    const next = reclassifyEventV2(ev);
    upsertJson("events", "id", next.id, next, {
      published_at: next.publishedAt,
      quality: next.quality,
    });
    updated++;
    out.push(next);
  }
  if (updated > 0) setMeta("lastEventUpdate", new Date().toISOString());
  return { total: all.length, updated, events: out };
}
