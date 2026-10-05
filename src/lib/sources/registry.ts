/**
 * Provider registry.
 *
 * Adding a provider:
 * 1. Add a row in src/lib/sources/seeds.ts (class, weight, legal note, enabled).
 * 2. Add a small adapter under src/lib/sources/adapters/.
 * 3. Register that function in ADAPTERS below.
 *
 * Explorer and crypto pages read canonical_fields, source_observations, and
 * instruments. They do not import this file and they do not call providers.
 */
import { runCoinbase } from "./adapters/coinbase";
import { runCoingeckoMarkets } from "./adapters/coingecko";
import { runCoingeckoProject } from "./adapters/coingecko-project";
import { runDefillama } from "./adapters/defillama";
import { runRssLinks } from "./adapters/rss-events";
import { runYahoo } from "./adapters/yahoo";

export interface AdapterResult {
  httpStatus: number | null;
  ok: boolean;
  note: string;
  observations: number;
  partial: boolean;
}

export const ADAPTERS: Record<string, () => Promise<AdapterResult> | AdapterResult> = {
  coinbase: runCoinbase,
  yahoo: runYahoo,
  defillama: runDefillama,
  coingecko_project: runCoingeckoProject,
  coingecko: runCoingeckoMarkets,
  rss_events: runRssLinks,
};

/** Present so a disabled provider is still an adapter registration, not a page branch. */
export const DISABLED_ADAPTER_IDS = ["kraken", "binance", "edgar", "github", "audits"] as const;
