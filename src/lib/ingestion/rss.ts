import Parser from "rss-parser";
import { randomUUID } from "crypto";
import type { FinancialEvent, DataQuality, SourceTier } from "../types";
import { classifyEventV2, reclassifyEventV2 } from "../classification/classify_v2";
import { getDb, upsertJson, setMeta } from "../db";
import { upsertEventDeduped } from "./dedupe";

const parser = new Parser({
  timeout: 12000,
  headers: { "User-Agent": "GlobalFinancialIntelligenceAgent/0.1 (research; +local)" },
});

interface FeedDef {
  name: string;
  url: string;
  tier: SourceTier;
}

/** Public RSS endpoints — may fail; we degrade to demo cache */
export const RSS_FEEDS: FeedDef[] = [
  { name: "Federal Reserve Press", url: "https://www.federalreserve.gov/feeds/press_all.xml", tier: 1 },
  { name: "ECB Press", url: "https://www.ecb.europa.eu/rss/press.html", tier: 1 },
  { name: "IMF News", url: "https://www.imf.org/en/News/RSS", tier: 1 },
  { name: "Reuters Business", url: "https://feeds.reuters.com/reuters/businessNews", tier: 3 },
  { name: "CNBC Top News", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", tier: 3 },
];

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

export async function ingestRssFeeds(): Promise<{ live: number; demo: number; events: FinancialEvent[] }> {
  getDb();
  const collected: FinancialEvent[] = [];
  let live = 0;

  for (const feed of RSS_FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = (parsed.items || []).slice(0, 8);
      for (const item of items) {
        const title = item.title?.trim();
        if (!title) continue;
        const body = (item.contentSnippet || item.content || item.summary || "").toString();
        const publishedAt = item.isoDate || item.pubDate || new Date().toISOString();
        const ev = itemToEvent(title, body, item.link, new Date(publishedAt).toISOString(), feed, "live");
        collected.push(ev);
        live++;
      }
    } catch {
      // feed failed — continue
    }
  }

  let demo = 0;
  if (collected.length < 3) {
    for (const d of DEMO_EVENTS) {
      const ev: FinancialEvent = {
        ...d,
        id: randomUUID(),
        ingestedAt: new Date().toISOString(),
      };
      collected.push(ev);
      demo++;
    }
  }

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
    // Avoid returning the same existing row twice in one ingest pass
    if (!stored.some((s) => s.id === event.id)) stored.push(event);
  }

  setMeta("lastEventUpdate", new Date().toISOString());
  return { live, demo, events: stored };
}

export function getEvents(limit = 100): FinancialEvent[] {
  // Same order as the previous full-table load + slice. LIMIT avoids parsing
  // every stored event (thousands of rows) on each dashboard read.
  const n = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 100;
  const rows = getDb()
    .prepare(`SELECT data FROM events ORDER BY published_at DESC LIMIT ?`)
    .all(n) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as FinancialEvent);
}

export function getEvent(id: string): FinancialEvent | null {
  const all = getEvents(500);
  return all.find((e) => e.id === id) ?? null;
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
