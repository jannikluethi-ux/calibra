/**
 * Explicit Coinbase product → existing CoinGecko instrument.
 * Ids were checked against instruments.provider_id in this database.
 * Products that 404 are skipped. Nothing is matched by fuzzy name.
 */
export const COINBASE_PRODUCT_MAP: { product: string; instrumentId: string }[] = [
  { product: "BTC-USD", instrumentId: "crypto:coingecko:bitcoin" },
  { product: "ETH-USD", instrumentId: "crypto:coingecko:ethereum" },
  { product: "LINK-USD", instrumentId: "crypto:coingecko:chainlink" },
  { product: "SOL-USD", instrumentId: "crypto:coingecko:solana" },
  { product: "ADA-USD", instrumentId: "crypto:coingecko:cardano" },
  { product: "XRP-USD", instrumentId: "crypto:coingecko:ripple" },
  { product: "DOGE-USD", instrumentId: "crypto:coingecko:dogecoin" },
  { product: "AVAX-USD", instrumentId: "crypto:coingecko:avalanche-2" },
  { product: "DOT-USD", instrumentId: "crypto:coingecko:polkadot" },
  { product: "LTC-USD", instrumentId: "crypto:coingecko:litecoin" },
  { product: "UNI-USD", instrumentId: "crypto:coingecko:uniswap" },
  { product: "AAVE-USD", instrumentId: "crypto:coingecko:aave" },
  { product: "SUI-USD", instrumentId: "crypto:coingecko:sui" },
  { product: "NEAR-USD", instrumentId: "crypto:coingecko:near" },
  { product: "APT-USD", instrumentId: "crypto:coingecko:aptos" },
  { product: "ARB-USD", instrumentId: "crypto:coingecko:arbitrum" },
  { product: "OP-USD", instrumentId: "crypto:coingecko:optimism" },
  { product: "RENDER-USD", instrumentId: "crypto:coingecko:render-token" },
];
