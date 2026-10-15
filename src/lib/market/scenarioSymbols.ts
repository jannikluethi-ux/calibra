/**
 * Central map: scenario-engine asset codes → real instrument symbols / preferred rows.
 *
 * Scenarios use short codes (SPX, US10Y, IXIC, …). Instruments may use a different
 * display symbol (NDX for Nasdaq) or share a ticker with unrelated crypto (SPX6900).
 * Only map where a real tracked instrument exists; never invent quotes.
 */

export interface ScenarioInstrumentBinding {
  /** Canonical scenario / universe code. */
  scenario: string;
  /** Instrument.symbol values that should receive this scenario's weights. */
  symbols: string[];
  /** Preferred instrument ids when symbol collisions exist (crypto meme tickers, etc.). */
  preferredIds: string[];
  /** Asset types allowed for symbol-fallback matching (excludes colliding crypto). */
  assetTypes: string[];
}

/**
 * Bindings derived from MARKET_UNIVERSE + known Yahoo instrument ids in the store.
 * IXIC (scenario) → NDX (instrument symbol for yahoo:^IXIC).
 */
export const SCENARIO_INSTRUMENT_BINDINGS: ScenarioInstrumentBinding[] = [
  { scenario: "SPX", symbols: ["SPX"], preferredIds: ["yahoo:^GSPC"], assetTypes: ["index"] },
  { scenario: "NDX", symbols: ["NDX"], preferredIds: ["yahoo:^IXIC"], assetTypes: ["index"] },
  { scenario: "IXIC", symbols: ["NDX", "IXIC"], preferredIds: ["yahoo:^IXIC"], assetTypes: ["index"] },
  { scenario: "SX5E", symbols: ["SX5E"], preferredIds: ["yahoo:^STOXX50E"], assetTypes: ["index"] },
  { scenario: "UKX", symbols: ["UKX"], preferredIds: ["yahoo:^FTSE"], assetTypes: ["index"] },
  { scenario: "DAX", symbols: ["DAX"], preferredIds: ["yahoo:^GDAXI"], assetTypes: ["index"] },
  { scenario: "NKY", symbols: ["NKY"], preferredIds: ["yahoo:^N225"], assetTypes: ["index"] },
  { scenario: "HSI", symbols: ["HSI"], preferredIds: ["yahoo:^HSI"], assetTypes: ["index"] },
  { scenario: "MSCI_WORLD", symbols: ["MSCI_WORLD"], preferredIds: ["yahoo:ACWI"], assetTypes: ["etf", "index"] },
  { scenario: "BTC", symbols: ["BTC"], preferredIds: ["crypto:coingecko:bitcoin", "yahoo:BTC-USD"], assetTypes: ["crypto"] },
  { scenario: "ETH", symbols: ["ETH"], preferredIds: ["crypto:coingecko:ethereum", "yahoo:ETH-USD"], assetTypes: ["crypto"] },
  { scenario: "GOLD", symbols: ["GOLD"], preferredIds: ["yahoo:GC=F"], assetTypes: ["future", "commodity"] },
  { scenario: "SILVER", symbols: ["SILVER"], preferredIds: ["yahoo:SI=F"], assetTypes: ["future", "commodity"] },
  { scenario: "OIL", symbols: ["OIL"], preferredIds: ["yahoo:CL=F"], assetTypes: ["future", "commodity"] },
  { scenario: "NATGAS", symbols: ["NATGAS"], preferredIds: ["yahoo:NG=F"], assetTypes: ["future", "commodity"] },
  { scenario: "US2Y", symbols: ["US2Y"], preferredIds: ["yahoo:^IRX"], assetTypes: ["index"] },
  { scenario: "US10Y", symbols: ["US10Y"], preferredIds: ["yahoo:^TNX"], assetTypes: ["index"] },
  { scenario: "DE10Y", symbols: ["DE10Y"], preferredIds: ["yahoo:BUND.DE"], assetTypes: ["bond", "etf"] },
  { scenario: "EURUSD", symbols: ["EURUSD"], preferredIds: ["yahoo:EURUSD=X"], assetTypes: ["forex"] },
  { scenario: "USDJPY", symbols: ["USDJPY"], preferredIds: ["yahoo:USDJPY=X"], assetTypes: ["forex"] },
  { scenario: "DXY", symbols: ["DXY"], preferredIds: ["yahoo:DX-Y.NYB"], assetTypes: ["index"] },
  { scenario: "VIX", symbols: ["VIX"], preferredIds: ["yahoo:^VIX"], assetTypes: ["index"] },
];

const BY_SCENARIO = new Map(SCENARIO_INSTRUMENT_BINDINGS.map((b) => [b.scenario.toUpperCase(), b]));

/** All instrument symbols that should show weights for a scenario asset code. */
export function instrumentSymbolsForScenarioAsset(asset: string): string[] {
  const b = BY_SCENARIO.get(asset.toUpperCase());
  if (b) return b.symbols.map((s) => s.toUpperCase());
  return [asset.toUpperCase()];
}

/** Preferred instrument ids for a scenario asset (may be empty if unknown). */
export function preferredInstrumentIdsForScenarioAsset(asset: string): string[] {
  return BY_SCENARIO.get(asset.toUpperCase())?.preferredIds ?? [];
}

export function bindingForScenarioAsset(asset: string): ScenarioInstrumentBinding | undefined {
  return BY_SCENARIO.get(asset.toUpperCase());
}

/**
 * Whether this instrument row is allowed to display weights for a scenario asset.
 * Blocks crypto tickers that collide with macro codes (e.g. SPX6900, DXY meme).
 */
export function instrumentAcceptsScenarioAsset(
  instrument: { id: string; symbol: string; asset_type: string },
  scenarioAsset: string
): boolean {
  const b = BY_SCENARIO.get(scenarioAsset.toUpperCase());
  if (!b) {
    return instrument.symbol.toUpperCase() === scenarioAsset.toUpperCase();
  }
  if (b.preferredIds.includes(instrument.id)) return true;
  const symOk = b.symbols.some((s) => s.toUpperCase() === instrument.symbol.toUpperCase());
  if (!symOk) return false;
  return b.assetTypes.includes(instrument.asset_type);
}

/** Does a market-snapshot / universe symbol match a scenario affectedAsset (incl. aliases)? */
export function universeSymbolMatchesScenarioAsset(universeSymbol: string, scenarioAsset: string): boolean {
  const u = universeSymbol.toUpperCase();
  const a = scenarioAsset.toUpperCase();
  if (u === a) return true;
  const b = BY_SCENARIO.get(a);
  if (!b) return false;
  return b.symbols.some((s) => s.toUpperCase() === u) || b.scenario.toUpperCase() === u;
}

/**
 * Build lookup maps for explorer: by instrument id and by (symbol|asset_type) key.
 * Caller supplies weights keyed by scenario asset code.
 */
export function expandScenarioWeightsToInstruments<T>(
  weightsByScenarioAsset: Record<string, T>
): { byId: Record<string, T>; bySymbolType: Record<string, T> } {
  const byId: Record<string, T> = {};
  const bySymbolType: Record<string, T> = {};
  for (const [asset, weights] of Object.entries(weightsByScenarioAsset)) {
    const b = BY_SCENARIO.get(asset.toUpperCase());
    if (b) {
      for (const id of b.preferredIds) {
        if (!byId[id]) byId[id] = weights;
      }
      for (const sym of b.symbols) {
        for (const at of b.assetTypes) {
          const k = `${sym.toUpperCase()}|${at}`;
          if (!bySymbolType[k]) bySymbolType[k] = weights;
        }
      }
    } else {
      const k = `${asset.toUpperCase()}|*`;
      if (!bySymbolType[k]) bySymbolType[k] = weights;
    }
  }
  return { byId, bySymbolType };
}

export function lookupExpandedWeights<T>(
  instrument: { id: string; symbol: string; asset_type: string },
  maps: { byId: Record<string, T>; bySymbolType: Record<string, T> }
): T | undefined {
  if (maps.byId[instrument.id]) return maps.byId[instrument.id];
  const exact = maps.bySymbolType[`${instrument.symbol.toUpperCase()}|${instrument.asset_type}`];
  if (exact) return exact;
  return maps.bySymbolType[`${instrument.symbol.toUpperCase()}|*`];
}

/** Coverage list for reports / methodology. */
export function scenarioSymbolCoverage(): { scenario: string; symbols: string[]; preferredIds: string[] }[] {
  return SCENARIO_INSTRUMENT_BINDINGS.map((b) => ({
    scenario: b.scenario,
    symbols: b.symbols,
    preferredIds: b.preferredIds,
  }));
}
