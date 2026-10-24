import type Database from "better-sqlite3";
import { RELIABILITY_WEIGHTS, type SourceClass } from "./weights";

export interface SourceSeed {
  id: string;
  name: string;
  category: string;
  source_class: SourceClass;
  legal_notes: string;
  enabled: number;
  status_note?: string;
}

/**
 * Data-driven registry rows. Adding a provider is a row here plus an adapter
 * registered in src/lib/sources/registry.ts. Pages do not import adapters.
 */
export const SOURCE_SEEDS: SourceSeed[] = [
  {
    id: "coingecko",
    name: "CoinGecko",
    category: "market_data",
    source_class: "secondary_aggregator",
    legal_notes:
      "Public API, no key. Free tier rate-limits. Quotes are an aggregator composite, not a single venue.",
    enabled: 1,
  },
  {
    id: "coingecko_project",
    name: "CoinGecko coin detail",
    category: "project",
    source_class: "secondary_aggregator",
    legal_notes:
      "Public /coins/{id} text. Descriptions and links are reported claims from CoinGecko, not verified facts.",
    enabled: 1,
  },
  {
    id: "coinbase",
    name: "Coinbase Exchange public ticker",
    category: "market_data",
    source_class: "established_market_data",
    legal_notes:
      "Public ticker, no key. Last trade on Coinbase Exchange for the mapped USD product. Not a consolidated tape. Base-asset volume is not stored as USD volume.",
    enabled: 1,
  },
  {
    id: "yahoo",
    name: "Yahoo Finance chart",
    category: "market_data",
    source_class: "established_market_data",
    legal_notes:
      "Existing equity, FX, and index path. A successful chart call does not mean the equity universe is covered.",
    enabled: 1,
  },
  {
    id: "defillama",
    name: "DefiLlama protocols",
    category: "on_chain",
    source_class: "secondary_aggregator",
    legal_notes:
      "Public protocols list, no key. TVL is DefiLlama's methodology. Matched only on payload gecko_id to an existing CoinGecko provider id.",
    enabled: 1,
  },
  {
    id: "rss_federal_reserve",
    name: "Federal Reserve Press",
    category: "news",
    source_class: "regulated_government",
    legal_notes: "Rows already stored from the Federal Reserve press RSS. This pass does not re-fetch the feed.",
    enabled: 1,
  },
  {
    id: "rss_ecb",
    name: "ECB Press",
    category: "news",
    source_class: "regulated_government",
    legal_notes: "Rows already stored from the ECB press RSS. This pass does not re-fetch the feed.",
    enabled: 1,
  },
  {
    id: "rss_imf",
    name: "IMF News",
    category: "news",
    source_class: "institutional",
    legal_notes: "Feed is in the existing RSS list. This pass does not re-fetch it. Links are created only from rows already stored.",
    enabled: 1,
  },
  {
    id: "rss_reuters",
    name: "Reuters Business",
    category: "news",
    source_class: "reputable_news",
    legal_notes: "Feed is in the existing RSS list. This pass does not re-fetch it.",
    enabled: 1,
  },
  {
    id: "rss_cnbc",
    name: "CNBC Top News",
    category: "news",
    source_class: "reputable_news",
    legal_notes: "Rows already stored from the CNBC top-news RSS. This pass does not re-fetch the feed.",
    enabled: 1,
  },
  {
    id: "defillama_hacks",
    name: "DefiLlama hacks database",
    category: "security",
    source_class: "secondary_aggregator",
    legal_notes:
      "api.llama.fi/hacks, no key. Reported incidents (date, loss, classification). Attached to an instrument only via DefiLlama protocol id -> gecko_id; never by ticker. Absence of a record is not evidence of safety.",
    enabled: 1,
  },
  {
    id: "ust_yield_curve",
    name: "U.S. Treasury daily par yield curve",
    category: "official_rates",
    source_class: "primary_official",
    legal_notes:
      "home.treasury.gov CSV, no key, U.S. government work (public domain). Daily, published after market close ET. Used for corroboration only.",
    enabled: 1,
  },
  {
    id: "bundesbank_yields",
    name: "Deutsche Bundesbank 10Y Bund yield",
    category: "official_rates",
    source_class: "primary_official",
    legal_notes:
      "api.statistiken.bundesbank.de SDMX CSV, no key; reuse permitted with source attribution 'Deutsche Bundesbank'. Daily. Used for corroboration only.",
    enabled: 1,
  },
  {
    id: "kraken",
    name: "Kraken public ticker",
    category: "market_data",
    source_class: "established_market_data",
    legal_notes: "Public ticker, no key. Not called this session.",
    enabled: 0,
    status_note:
      "Not called. Coinbase public ticker returned JSON for BTC-USD and ETH-USD first, so Kraken was not requested.",
  },
  {
    id: "binance",
    name: "Binance public ticker",
    category: "market_data",
    source_class: "established_market_data",
    legal_notes: "Public ticker, no key. Not called this session.",
    enabled: 0,
    status_note:
      "Not called. Stopped after Coinbase returned JSON. Host was not probed.",
  },
  {
    id: "edgar",
    name: "SEC EDGAR",
    category: "regulatory",
    source_class: "regulated_government",
    legal_notes: "No EDGAR or issuer filing fetch in this pass.",
    enabled: 0,
    status_note: "Not connected. No EDGAR client in this pass. Equity filing coverage is 0.",
  },
  {
    id: "github",
    name: "GitHub activity",
    category: "project",
    source_class: "community",
    legal_notes: "No GitHub API call and no scrape in this pass.",
    enabled: 0,
    status_note: "Not connected. Adapter stub disabled. GitHub activity stays insufficient data.",
  },
  {
    id: "audits",
    name: "Security audits",
    category: "security",
    source_class: "unverified",
    legal_notes: "No audit-PDF or auditor JSON fetch in this pass.",
    enabled: 0,
    status_note: "Not connected. Adapter stub disabled. Security observations stay empty.",
  },
];

export function seedSources(db: Database.Database) {
  const stmt = db.prepare(`
    INSERT INTO sources (id, name, category, source_class, reliability_weight, legal_notes, enabled, status_note)
    VALUES (@id, @name, @category, @source_class, @reliability_weight, @legal_notes, @enabled, @status_note)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      source_class = excluded.source_class,
      reliability_weight = excluded.reliability_weight,
      legal_notes = excluded.legal_notes
    WHERE sources.name IS NOT excluded.name
       OR sources.category IS NOT excluded.category
       OR sources.source_class IS NOT excluded.source_class
       OR sources.reliability_weight IS NOT excluded.reliability_weight
       OR sources.legal_notes IS NOT excluded.legal_notes
  `);
  const tx = db.transaction(() => {
    for (const s of SOURCE_SEEDS) {
      stmt.run({
        id: s.id,
        name: s.name,
        category: s.category,
        source_class: s.source_class,
        reliability_weight: RELIABILITY_WEIGHTS[s.source_class],
        legal_notes: s.legal_notes,
        enabled: s.enabled,
        status_note: s.status_note ?? null,
      });
    }
  });
  tx();
}
