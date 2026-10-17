/**
 * Scheduled crypto data refresh (Batch 2). Free, keyless sources only:
 *  - CoinGecko /coins/markets (top 1,000 by market cap): price, market cap, FDV, volume, supply, ATH distance.
 *  - CoinGecko /coins/list?include_platform=true (daily): network + contract address per CoinGecko id.
 *  - CoinGecko category-filtered markets (daily): category membership (top 250 per category; absence = unknown).
 *  - CoinGecko /coins/{id}/market_chart (rotating, a few coins per run): 90 daily prices for volatility/drawdown/correlation.
 *  - DefiLlama /hacks (daily): security incidents, attached to instruments only via protocol id -> CoinGecko id.
 * Rate-limit aware: paced calls, a 429 stops all further CoinGecko calls in the run and sets the health cooldown.
 * Nothing is invented: failed calls leave the previous rows untouched and are recorded in source_health.
 */
import { getDb, getMeta, setMeta } from "../db";
import { fetchJson as defaultFetchJson, sleep, type HttpJson } from "../sources/http";
import { prepareCryptoStore } from "../sources/prepare";
import { recordAttempt, skipCheck } from "../sources/health";
import { upsertInstruments } from "../instruments/store";
import { marketRow, type CgMarketCoin } from "../instruments/sync";
import { blockCoingecko, coingeckoBlocked } from "../sources/cg-guard";
import { ensureCryptoIntelTables } from "./intel-schema";

export const CG = "https://api.coingecko.com/api/v3";
export const CATEGORY_SLUGS = ["stablecoins", "meme-token", "layer-1", "decentralized-finance-defi", "wrapped-tokens", "liquid-staking-tokens"];
const HACKS_URL = "https://api.llama.fi/hacks";

export type FetchJsonLike = (url: string, timeoutMs?: number) => Promise<HttpJson>;

export interface CryptoSyncOptions {
  fetchJson?: FetchJsonLike;
  now?: Date;
  paceMs?: number;
  maxPages?: number;
  historyCoins?: number;
  forceDaily?: boolean;
}

export interface CryptoSyncReport {
  startedAt: string;
  coingecko: { calls: number; rateLimited: boolean; skipped?: string; errors: string[] };
  marketsUpdated: number;
  snapshots: number;
  daily: { ran: boolean; contracts?: number; categories?: number; incidents?: number; incidentsMapped?: number; errors: string[] };
  history: { coins: string[]; points: number };
}

export async function runCryptoMarketSync(opts: CryptoSyncOptions = {}): Promise<CryptoSyncReport> {
  const db = prepareCryptoStore();
  ensureCryptoIntelTables(db);
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const pace = opts.paceMs ?? 7000;
  const maxPages = opts.maxPages ?? 4;
  const historyCoins = opts.historyCoins ?? 8;
  const report: CryptoSyncReport = {
    startedAt: nowIso,
    coingecko: { calls: 0, rateLimited: false, errors: [] },
    marketsUpdated: 0,
    snapshots: 0,
    daily: { ran: false, errors: [] },
    history: { coins: [], points: 0 },
  };

  const sk = skipCheck("coingecko", nowIso);
  let cgOpen = !sk.skip && !coingeckoBlocked();
  if (!cgOpen) report.coingecko.skipped = sk.reason ?? "CoinGecko paused after a recent 429";
  let firstCall = true;
  let newestObs: string | null = null;
  const t0 = Date.now();

  /** One paced CoinGecko call; returns null (and closes CoinGecko for this run) on 429. */
  const cg = async (path: string): Promise<unknown | null> => {
    if (!cgOpen) return null;
    if (!firstCall && pace > 0) await sleep(pace);
    firstCall = false;
    report.coingecko.calls++;
    const res = await fetchJson(`${CG}${path}`, 60000);
    if (res.rateLimited) {
      cgOpen = false;
      report.coingecko.rateLimited = true;
      blockCoingecko();
      report.coingecko.errors.push(`429 on ${path.split("?")[0]}`);
      return null;
    }
    if (!res.ok) {
      report.coingecko.errors.push(`${path.split("?")[0]}: HTTP ${res.status} ${(res.error ?? "").slice(0, 80)}`);
      return null;
    }
    return res.json ?? null;
  };

  // 1) Market pages
  const snapStmt = db.prepare(
    `INSERT INTO crypto_market_snapshots (instrument_id, retrieved_at, observed_at, price, market_cap, fdv, volume_24h, high_24h, low_24h,
      change_24h_pct, change_7d_pct, change_30d_pct, mcap_change_24h_pct, circulating_supply, total_supply, max_supply, ath, ath_change_pct, ath_date, rank, source, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'coingecko_markets', ?)`
  );
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  for (let page = 1; page <= maxPages && cgOpen; page++) {
    const path = `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=24h,7d,30d`;
    const json = await cg(path);
    if (!Array.isArray(json)) break;
    const coins = (json as (CgMarketCoin & Record<string, unknown>)[]).filter((c) => c && typeof c.id === "string" && typeof c.symbol === "string");
    if (!coins.length) break;
    upsertInstruments(coins.map(marketRow), nowIso);
    report.marketsUpdated += coins.length;
    db.transaction(() => {
      for (const c of coins) {
        const price = n(c.current_price);
        if (price == null || price <= 0) continue; // invalid quote: no snapshot (instrument row marks it unavailable)
        const obs = typeof c.last_updated === "string" ? c.last_updated : null;
        if (obs && (!newestObs || obs > newestObs)) newestObs = obs;
        snapStmt.run(
          `crypto:coingecko:${c.id}`, nowIso, obs, price, n(c.market_cap), n(c.fully_diluted_valuation), n(c.total_volume), n(c.high_24h), n(c.low_24h),
          n(c.price_change_percentage_24h), n(c.price_change_percentage_7d_in_currency), n(c.price_change_percentage_30d_in_currency),
          n(c.market_cap_change_percentage_24h), n(c.circulating_supply), n(c.total_supply), n(c.max_supply), n(c.ath), n(c.ath_change_percentage),
          typeof c.ath_date === "string" ? c.ath_date : null, n(c.market_cap_rank), `${CG}${path}`
        );
        report.snapshots++;
      }
    })();
  }

  // 2) Daily identity / category / incident refresh
  const lastDaily = Date.parse(getMeta("crypto.daily.lastRun") ?? "");
  if (opts.forceDaily || !Number.isFinite(lastDaily) || now.getTime() - lastDaily > 24 * 3600_000) {
    report.daily.ran = true;
    const live = new Set(
      (db.prepare(`SELECT provider_id FROM instruments WHERE asset_type='crypto' AND data_source='coingecko' AND quote_status='live'`).all() as { provider_id: string }[]).map((r) => r.provider_id)
    );
    const list = await cg(`/coins/list?include_platform=true`);
    if (Array.isArray(list)) {
      const ins = db.prepare(
        `INSERT INTO crypto_contracts (instrument_id, network, contract_address, source, retrieved_at) VALUES (?, ?, ?, 'coingecko_coins_list', ?)
         ON CONFLICT(instrument_id, network) DO UPDATE SET contract_address = excluded.contract_address, retrieved_at = excluded.retrieved_at`
      );
      let c = 0;
      db.transaction(() => {
        for (const coin of list as { id?: string; platforms?: Record<string, string | null> }[]) {
          if (!coin?.id || !live.has(coin.id)) continue;
          for (const [net, addr] of Object.entries(coin.platforms ?? {})) {
            if (!net || typeof addr !== "string" || !addr.trim()) continue;
            ins.run(`crypto:coingecko:${coin.id}`, net, addr.trim(), nowIso);
            c++;
          }
        }
      })();
      setMeta("crypto.platforms.retrievedAt", nowIso);
      report.daily.contracts = c;
    }
    const catIns = db.prepare(
      `INSERT INTO crypto_categories (instrument_id, category_slug, category_name, source, retrieved_at) VALUES (?, ?, ?, 'coingecko_category_markets', ?)
       ON CONFLICT(instrument_id, category_slug) DO UPDATE SET retrieved_at = excluded.retrieved_at`
    );
    let cats = 0;
    for (const slug of CATEGORY_SLUGS) {
      const json = await cg(`/coins/markets?vs_currency=usd&category=${slug}&order=market_cap_desc&per_page=250&page=1&sparkline=false`);
      if (!Array.isArray(json)) continue;
      db.transaction(() => {
        for (const coin of json as { id?: string }[]) {
          if (!coin?.id) continue;
          catIns.run(`crypto:coingecko:${coin.id}`, slug, slug, nowIso);
          cats++;
        }
      })();
    }
    report.daily.categories = cats;

    // DefiLlama hacks (separate provider: not affected by CoinGecko limits)
    const hk = skipCheck("defillama_hacks", nowIso);
    if (!hk.skip) {
      const h0 = Date.now();
      const res = await fetchJson(HACKS_URL, 60000);
      if (res.ok && Array.isArray(res.json)) {
        const map = new Map(
          (db.prepare(`SELECT defillama_id, instrument_id FROM crypto_protocol_map WHERE instrument_id IS NOT NULL`).all() as { defillama_id: string; instrument_id: string }[]).map((r) => [r.defillama_id, r.instrument_id])
        );
        const ins = db.prepare(
          `INSERT INTO crypto_security_incidents (id, instrument_id, defillama_id, name, incident_date, amount_usd, returned_usd, classification, technique, chains_json, target_type, source, source_url, retrieved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'defillama_hacks', ?, ?)
           ON CONFLICT(id) DO UPDATE SET instrument_id = COALESCE(excluded.instrument_id, crypto_security_incidents.instrument_id), retrieved_at = excluded.retrieved_at`
        );
        let total = 0, mapped = 0, newest: string | null = null;
        db.transaction(() => {
          for (const h of res.json as Record<string, unknown>[]) {
            const date = typeof h.date === "number" && h.date > 0 ? new Date(h.date * 1000).toISOString() : null;
            const name = typeof h.name === "string" ? h.name : null;
            if (!date || !name) continue;
            const dlId = h.defillamaId == null ? null : String(h.defillamaId);
            const inst = dlId ? map.get(dlId) ?? null : null;
            const id = `dl:${dlId ?? "na"}:${date.slice(0, 10)}:${name}`.slice(0, 200);
            ins.run(id, inst, dlId, name, date, n(h.amount), n(h.returnedFunds), typeof h.classification === "string" ? h.classification : null,
              typeof h.technique === "string" ? h.technique : null, JSON.stringify(Array.isArray(h.chain) ? h.chain : []), typeof h.targetType === "string" ? h.targetType : null,
              typeof h.source === "string" && h.source ? h.source : HACKS_URL, nowIso);
            total++;
            if (inst) mapped++;
            if (!newest || date > newest) newest = date;
          }
        })();
        report.daily.incidents = total;
        report.daily.incidentsMapped = mapped;
        recordAttempt("defillama_hacks", { ok: total > 0, errorClass: total > 0 ? "ok" : "invalid_data", httpStatus: 200, latencyMs: Date.now() - h0, items: total, newestObservationAt: nowIso }, nowIso);
      } else {
        report.daily.errors.push(`hacks: HTTP ${res.status} ${(res.error ?? "").slice(0, 80)}`);
        recordAttempt("defillama_hacks", { ok: false, errorClass: res.rateLimited ? "rate_limited" : res.status === 200 ? "invalid_data" : "unavailable", httpStatus: res.status || null, latencyMs: Date.now() - h0, error: res.error ?? null }, nowIso);
      }
    }
    if (!report.coingecko.rateLimited) setMeta("crypto.daily.lastRun", nowIso);
  }

  // 3) Rotating daily price history
  if (cgOpen && historyCoins > 0) {
    const ids = pickHistoryCoins(historyCoins, nowIso);
    const ins = db.prepare(
      `INSERT OR IGNORE INTO crypto_price_history (instrument_id, day, price, market_cap, volume, source, retrieved_at) VALUES (?, ?, ?, ?, ?, 'coingecko_market_chart', ?)`
    );
    for (const pid of ids) {
      const json = (await cg(`/coins/${encodeURIComponent(pid)}/market_chart?vs_currency=usd&days=90&interval=daily`)) as
        | { prices?: [number, number][]; market_caps?: [number, number][]; total_volumes?: [number, number][] }
        | null;
      if (!json || !Array.isArray(json.prices)) continue;
      const caps = new Map((json.market_caps ?? []).map(([t, v]) => [t, v]));
      const vols = new Map((json.total_volumes ?? []).map(([t, v]) => [t, v]));
      let pts = 0;
      db.transaction(() => {
        for (const [t, p] of json.prices!) {
          // Only completed UTC days (midnight points); the trailing intraday point is skipped.
          if (t % 86400_000 !== 0 || !(p > 0)) continue;
          if (t >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) continue;
          ins.run(`crypto:coingecko:${pid}`, new Date(t).toISOString().slice(0, 10), p, n(caps.get(t)), n(vols.get(t)), nowIso);
          pts++;
        }
      })();
      report.history.coins.push(pid);
      report.history.points += pts;
    }
  }

  // Health for the CoinGecko aggregate (only when at least one call was attempted)
  if (report.coingecko.calls > 0) {
    const ok = report.marketsUpdated > 0 || report.history.coins.length > 0;
    recordAttempt(
      "coingecko",
      {
        ok,
        errorClass: ok ? "ok" : report.coingecko.rateLimited ? "rate_limited" : "unavailable",
        httpStatus: report.coingecko.rateLimited && !ok ? 429 : ok ? 200 : null,
        latencyMs: Date.now() - t0,
        items: report.marketsUpdated,
        newestObservationAt: newestObs ?? (ok ? nowIso : null),
        error: report.coingecko.errors.length ? report.coingecko.errors.join("; ").slice(0, 300) : null,
      },
      nowIso
    );
  }
  return report;
}

/** BTC and ETH first (needed for correlations), then live coins by market cap whose history is oldest or missing. */
export function pickHistoryCoins(limit: number, nowIso: string): string[] {
  const db = getDb();
  const dayAgo = new Date(Date.parse(nowIso) - 20 * 3600_000).toISOString();
  const last = (pid: string) =>
    (db.prepare(`SELECT MAX(retrieved_at) AS m FROM crypto_price_history WHERE instrument_id = ?`).get(`crypto:coingecko:${pid}`) as { m: string | null }).m;
  const out: string[] = [];
  for (const pid of ["bitcoin", "ethereum"]) {
    const l = last(pid);
    if (!l || l < dayAgo) out.push(pid);
  }
  const rows = db
    .prepare(
      `SELECT i.provider_id AS pid, h.last AS last FROM instruments i
       LEFT JOIN (SELECT instrument_id, MAX(retrieved_at) AS last FROM crypto_price_history GROUP BY instrument_id) h ON h.instrument_id = i.id
       WHERE i.asset_type='crypto' AND i.data_source='coingecko' AND i.quote_status='live' AND i.provider_id NOT IN ('bitcoin','ethereum')
       ORDER BY (h.last IS NOT NULL), h.last, COALESCE(i.market_cap, 0) DESC
       LIMIT ?`
    )
    .all(limit * 2) as { pid: string; last: string | null }[];
  for (const r of rows) {
    if (out.length >= limit) break;
    if (r.last && r.last >= dayAgo) continue;
    out.push(r.pid);
  }
  return out.slice(0, limit);
}
