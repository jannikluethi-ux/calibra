/** Market universe — Yahoo tickers with proxy labels where needed */

export interface UniverseItem {
  symbol: string;
  name: string;
  category: "equity_index" | "crypto" | "commodity" | "rates" | "fx" | "vol";
  yahooSymbol: string;
  isProxy?: boolean;
  proxyNote?: string;
}

export const MARKET_UNIVERSE: UniverseItem[] = [
  { symbol: "SPX", name: "S&P 500", category: "equity_index", yahooSymbol: "^GSPC" },
  { symbol: "NDX", name: "Nasdaq Composite", category: "equity_index", yahooSymbol: "^IXIC" },
  { symbol: "SX5E", name: "Euro Stoxx 50", category: "equity_index", yahooSymbol: "^STOXX50E" },
  { symbol: "UKX", name: "FTSE 100", category: "equity_index", yahooSymbol: "^FTSE" },
  { symbol: "DAX", name: "DAX", category: "equity_index", yahooSymbol: "^GDAXI" },
  { symbol: "NKY", name: "Nikkei 225", category: "equity_index", yahooSymbol: "^N225" },
  { symbol: "HSI", name: "Hang Seng", category: "equity_index", yahooSymbol: "^HSI" },
  {
    symbol: "MSCI_WORLD",
    name: "MSCI World (proxy: ACWI)",
    category: "equity_index",
    yahooSymbol: "ACWI",
    isProxy: true,
    proxyNote: "iShares MSCI ACWI ETF used as liquid proxy for MSCI World / ACWI exposure",
  },
  { symbol: "BTC", name: "Bitcoin", category: "crypto", yahooSymbol: "BTC-USD" },
  { symbol: "ETH", name: "Ethereum", category: "crypto", yahooSymbol: "ETH-USD" },
  { symbol: "GOLD", name: "Gold", category: "commodity", yahooSymbol: "GC=F" },
  { symbol: "SILVER", name: "Silver", category: "commodity", yahooSymbol: "SI=F" },
  { symbol: "OIL", name: "WTI Crude Oil", category: "commodity", yahooSymbol: "CL=F" },
  { symbol: "NATGAS", name: "Natural Gas", category: "commodity", yahooSymbol: "NG=F" },
  { symbol: "US2Y", name: "US 2Y Yield", category: "rates", yahooSymbol: "^IRX", isProxy: true, proxyNote: "13-week T-bill (^IRX) as short-rate proxy for US 2Y" },
  { symbol: "US10Y", name: "US 10Y Yield", category: "rates", yahooSymbol: "^TNX" },
  {
    symbol: "DE10Y",
    name: "German 10Y (proxy: BUND ETF)",
    category: "rates",
    yahooSymbol: "BUND.DE",
    isProxy: true,
    proxyNote: "iShares Euro Government Bond / BUND.DE used as imperfect proxy — not a direct yield quote",
  },
  { symbol: "EURUSD", name: "EUR/USD", category: "fx", yahooSymbol: "EURUSD=X" },
  { symbol: "USDJPY", name: "USD/JPY", category: "fx", yahooSymbol: "USDJPY=X" },
  { symbol: "DXY", name: "US Dollar Index", category: "fx", yahooSymbol: "DX-Y.NYB" },
  { symbol: "VIX", name: "VIX", category: "vol", yahooSymbol: "^VIX" },
];

export function getUniverseItem(symbol: string): UniverseItem | undefined {
  return MARKET_UNIVERSE.find((u) => u.symbol === symbol || u.yahooSymbol === symbol);
}
