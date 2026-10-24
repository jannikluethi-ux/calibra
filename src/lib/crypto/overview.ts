import { getDb } from "../db";

export const REGIME_RULE =
  "Regime uses only Bitcoin's stored 24h percent change (canonical change observation if one exists, otherwise the instrument column). If that input is missing, the regime is Insufficient data. If the absolute move is at least 8 percent, the label is high-volatility. Else if the move is at or below -3 percent, risk-off. Else if the move is at or above +3 percent, bullish. Otherwise neutral. This is a one-number rule, not a market-regime model.";

export function cryptoOverview() {
  const db = getDb(); // read-only: no source seeding on reads (B2 get-fix)
  const indexed = (
    db.prepare(`SELECT COUNT(*) AS c FROM instruments WHERE asset_type = 'crypto'`).get() as { c: number }
  ).c;
  const quoted = db
    .prepare(
      `SELECT COUNT(*) AS n,
              SUM(market_cap) AS mcap,
              SUM(CASE WHEN volume_24h IS NOT NULL THEN 1 ELSE 0 END) AS n_vol,
              SUM(volume_24h) AS vol
       FROM instruments
       WHERE asset_type = 'crypto' AND quote_status = 'live' AND market_cap IS NOT NULL`
    )
    .get() as { n: number; mcap: number | null; n_vol: number; vol: number | null };

  const btc = db
    .prepare(
      `SELECT market_cap, change_24h_pct, last_updated FROM instruments WHERE id = 'crypto:coingecko:bitcoin'`
    )
    .get() as { market_cap: number | null; change_24h_pct: number | null; last_updated: string | null } | undefined;
  const eth = db
    .prepare(`SELECT market_cap FROM instruments WHERE id = 'crypto:coingecko:ethereum'`)
    .get() as { market_cap: number | null } | undefined;

  const changeObs = db
    .prepare(
      `SELECT value_json, retrieved_at, observed_at, source_id
       FROM source_observations
       WHERE instrument_id = 'crypto:coingecko:bitcoin' AND field = 'change_24h_pct' AND source_id IN (
         SELECT id FROM sources WHERE enabled = 1
       )
       ORDER BY retrieved_at DESC LIMIT 1`
    )
    .get() as
    | { value_json: string; retrieved_at: string; observed_at: string | null; source_id: string }
    | undefined;

  let change: number | null = null;
  let changeInput = "missing";
  if (changeObs) {
    const parsed = JSON.parse(changeObs.value_json) as unknown;
    if (typeof parsed === "number" && Number.isFinite(parsed)) {
      change = parsed;
      changeInput = `observation ${changeObs.source_id} retrieved_at ${changeObs.retrieved_at}`;
    }
  }
  if (change == null && btc?.change_24h_pct != null) {
    change = btc.change_24h_pct;
    changeInput = `instrument column last_updated ${btc.last_updated}`;
  }

  let regime: string = "Insufficient data";
  if (change != null) {
    if (Math.abs(change) >= 8) regime = "high-volatility";
    else if (change <= -3) regime = "risk-off";
    else if (change >= 3) regime = "bullish";
    else regime = "neutral";
  }

  const globalRow = db
    .prepare(
      `SELECT value_json, retrieved_at, observed_at, source_url
       FROM source_observations
       WHERE field = 'cg_global' AND source_id = 'coingecko'
       ORDER BY retrieved_at DESC LIMIT 1`
    )
    .get() as
    | { value_json: string; retrieved_at: string; observed_at: string | null; source_url: string | null }
    | undefined;

  const mcap = quoted.mcap;
  const btcDom =
    mcap && btc?.market_cap != null && mcap > 0 ? (btc.market_cap / mcap) * 100 : null;
  const ethDom =
    mcap && eth?.market_cap != null && mcap > 0 ? (eth.market_cap / mcap) * 100 : null;

  return {
    indexed_crypto: indexed,
    quoted_with_market_cap: quoted.n,
    quoted_with_volume: quoted.n_vol,
    total_market_cap_quoted: mcap,
    total_volume_quoted: quoted.vol,
    btc_dominance_quoted_pct: btcDom,
    eth_dominance_quoted_pct: ethDom,
    stablecoin_market_cap: null as number | null,
    stablecoin_note:
      "Insufficient data. No sourced stablecoin category covers the quoted set, so a stablecoin cap is not computed.",
    regime,
    regime_rule: REGIME_RULE,
    regime_input: changeInput,
    regime_change_24h_pct: change,
    coingecko_global: globalRow
      ? {
          value: JSON.parse(globalRow.value_json),
          retrieved_at: globalRow.retrieved_at,
          observed_at: globalRow.observed_at,
          source_url: globalRow.source_url,
          label: "Single CoinGecko /global observation. Not independently verified.",
        }
      : null,
    coverage_note: `Totals use ${quoted.n} crypto assets with a live quote and a non-null market cap. They do not cover the indexed set of ${indexed}.`,
  };
}
