/**
 * DB layer for crypto_risk_v2: builds inputs from stored data only, appends versioned scores
 * (never rewrites history), rebuilds the latest pointer, serves the high-risk list and the detail profile.
 */
import { getDb, getMeta } from "../db";
import { prepareCryptoStore } from "../sources/prepare";
import { ensureCryptoIntelTables } from "./intel-schema";
import { computeRisk, MODEL_VERSION, type RiskInputs, type RiskResult, type SecurityIncident, FACTORS, STALE_MARKET_DATA_H } from "./risk-v2";
import { realizedVol, maxDrawdown, returnOver, returnCorrelation, type DailyPoint } from "./metrics";
import { buildWhere, orderBy, PAGE_SIZE, type HighRiskQuery, STRUCTURAL_FACTOR_KEYS } from "./highrisk-query";

interface InstRow {
  id: string;
  symbol: string;
  name: string;
  provider_id: string;
  price: number | null;
  market_cap: number | null;
  volume_24h: number | null;
  circulating_supply: number | null;
  total_supply: number | null;
  max_supply: number | null;
  change_7d_pct: number | null;
  change_30d_pct: number | null;
  last_updated: string | null;
  rank: number | null;
}

interface SnapRow {
  instrument_id: string;
  retrieved_at: string;
  observed_at: string | null;
  fdv: number | null;
  ath_change_pct: number | null;
}

/** Archive legacy research_v1 rows into the append-only history (idempotent). */
export function archiveV1Assessments(): number {
  const db = prepareCryptoStore();
  ensureCryptoIntelTables(db);
  const r = db
    .prepare(
      `INSERT INTO crypto_risk_scores (instrument_id, model_version, computed_at, score, band, risk_type, confidence, confidence_label, high_risk, structural_keys, factors_json, flags_json, reasons_json, market_data_at)
       SELECT a.instrument_id, 'research_v1', a.computed_at, a.total, a.band, NULL, NULL, NULL, 0, NULL, a.components_json,
              CASE WHEN a.band_capped = 1 THEN json_array(a.cap_reason) ELSE NULL END, NULL, NULL
       FROM crypto_risk_assessments a
       WHERE NOT EXISTS (SELECT 1 FROM crypto_risk_scores s WHERE s.instrument_id = a.instrument_id AND s.model_version = 'research_v1' AND s.computed_at = a.computed_at)`
    )
    .run();
  return r.changes;
}

function loadSeries(db: ReturnType<typeof getDb>): Map<string, DailyPoint[]> {
  const m = new Map<string, DailyPoint[]>();
  const rows = db.prepare(`SELECT instrument_id, day, price FROM crypto_price_history WHERE source = 'coingecko_market_chart' ORDER BY instrument_id, day`).all() as {
    instrument_id: string;
    day: string;
    price: number;
  }[];
  for (const r of rows) {
    const a = m.get(r.instrument_id) ?? [];
    a.push({ day: r.day, price: r.price });
    m.set(r.instrument_id, a);
  }
  return m;
}

export function buildAllInputs(nowIso: string): { inst: InstRow; inputs: RiskInputs }[] {
  const db = prepareCryptoStore();
  ensureCryptoIntelTables(db);
  const insts = db
    .prepare(
      `SELECT id, symbol, name, provider_id, price, market_cap, volume_24h, circulating_supply, total_supply, max_supply, change_7d_pct, change_30d_pct, last_updated, rank
       FROM instruments WHERE asset_type = 'crypto' AND quote_status = 'live' AND price IS NOT NULL AND price > 0`
    )
    .all() as InstRow[];
  const snaps = new Map(
    (db
      .prepare(
        `SELECT s.instrument_id, s.retrieved_at, s.observed_at, s.fdv, s.ath_change_pct FROM crypto_market_snapshots s
         JOIN (SELECT instrument_id, MAX(id) AS mid FROM crypto_market_snapshots GROUP BY instrument_id) x ON x.mid = s.id`
      )
      .all() as SnapRow[]).map((r) => [r.instrument_id, r])
  );
  const series = loadSeries(db);
  const catCut = new Date(Date.parse(nowIso) - 14 * 86400_000).toISOString();
  const cats = new Map<string, string[]>();
  for (const r of db.prepare(`SELECT instrument_id, category_slug FROM crypto_categories WHERE retrieved_at >= ?`).all(catCut) as { instrument_id: string; category_slug: string }[]) {
    cats.set(r.instrument_id, [...(cats.get(r.instrument_id) ?? []), r.category_slug]);
  }
  const nets = new Map<string, string[]>();
  for (const r of db.prepare(`SELECT instrument_id, network FROM crypto_contracts`).all() as { instrument_id: string; network: string }[]) {
    nets.set(r.instrument_id, [...(nets.get(r.instrument_id) ?? []), r.network]);
  }
  const platformKnown = !!getMeta("crypto.platforms.retrievedAt");
  const symCount = new Map(
    (db.prepare(`SELECT UPPER(symbol) AS s, COUNT(*) AS c FROM instruments WHERE asset_type = 'crypto' GROUP BY UPPER(symbol)`).all() as { s: string; c: number }[]).map((r) => [r.s, r.c])
  );
  const mapped = new Set((db.prepare(`SELECT DISTINCT instrument_id FROM crypto_protocol_map WHERE instrument_id IS NOT NULL`).all() as { instrument_id: string }[]).map((r) => r.instrument_id));
  const incidents = new Map<string, SecurityIncident[]>();
  for (const r of db
    .prepare(`SELECT instrument_id, name, incident_date, amount_usd, returned_usd, classification, technique FROM crypto_security_incidents WHERE instrument_id IS NOT NULL`)
    .all() as { instrument_id: string; name: string; incident_date: string; amount_usd: number | null; returned_usd: number | null; classification: string | null; technique: string | null }[]) {
    incidents.set(r.instrument_id, [
      ...(incidents.get(r.instrument_id) ?? []),
      { name: r.name, date: r.incident_date, amountUsd: r.amount_usd, returnedUsd: r.returned_usd, classification: r.classification, technique: r.technique },
    ]);
  }
  const canon = new Map(
    (db.prepare(`SELECT instrument_id, n_sources, disagreement FROM canonical_fields WHERE field = 'price'`).all() as { instrument_id: string; n_sources: number; disagreement: number }[]).map((r) => [r.instrument_id, r])
  );

  return insts.map((inst) => {
    const s = snaps.get(inst.id);
    const ser = series.get(inst.id) ?? [];
    const c = canon.get(inst.id);
    const inputs: RiskInputs = {
      id: inst.id,
      symbol: inst.symbol,
      name: inst.name,
      now: nowIso,
      marketDataAt: s?.observed_at ?? inst.last_updated,
      retrievedAt: s?.retrieved_at ?? null,
      price: inst.price,
      marketCap: inst.market_cap != null && inst.market_cap > 0 ? inst.market_cap : null,
      fdv: s?.fdv != null && s.fdv > 0 ? s.fdv : null,
      volume24h: inst.volume_24h,
      circulating: inst.circulating_supply != null && inst.circulating_supply > 0 ? inst.circulating_supply : null,
      total: inst.total_supply != null && inst.total_supply > 0 ? inst.total_supply : null,
      max: inst.max_supply != null && inst.max_supply > 0 ? inst.max_supply : null,
      change7d: inst.change_7d_pct,
      change30d: inst.change_30d_pct,
      athChangePct: s?.ath_change_pct ?? null,
      vol30d: realizedVol(ser, 30),
      historyDays: ser.length,
      categories: cats.get(inst.id) ?? [],
      networks: nets.get(inst.id) ?? [],
      platformDataKnown: platformKnown,
      symbolCollisions: Math.max(0, (symCount.get(inst.symbol.toUpperCase()) ?? 1) - 1),
      incidents: mapped.has(inst.id) ? incidents.get(inst.id) ?? [] : null,
      priceSources: Math.max(1, c?.n_sources ?? 1),
      priceDisagreement: (c?.disagreement ?? 0) === 1,
    };
    return { inst, inputs };
  });
}

/** Score every live crypto asset; append to history when changed (or daily); rebuild the latest pointer. */
export function scoreAllCryptoV2(nowIso = new Date().toISOString()): { scored: number; appended: number; highRisk: number } {
  const db = getDb();
  archiveV1Assessments();
  const all = buildAllInputs(nowIso);
  const prev = new Map(
    (db.prepare(`SELECT instrument_id, score_id, score, band, risk_type, confidence, computed_at FROM crypto_risk_latest WHERE model_version = ?`).all(MODEL_VERSION) as {
      instrument_id: string;
      score_id: number;
      score: number | null;
      band: string;
      risk_type: string;
      confidence: number;
      computed_at: string;
    }[]).map((r) => [r.instrument_id, r])
  );
  const ins = db.prepare(
    `INSERT INTO crypto_risk_scores (instrument_id, model_version, computed_at, score, band, risk_type, confidence, confidence_label, high_risk, structural_keys, factors_json, flags_json, reasons_json, market_data_at, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const latest = db.prepare(
    `INSERT INTO crypto_risk_latest (instrument_id, score_id, model_version, computed_at, score, band, risk_type, confidence, confidence_label, high_risk, structural_keys, reasons_json, market_data_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(instrument_id) DO UPDATE SET score_id = excluded.score_id, model_version = excluded.model_version, computed_at = excluded.computed_at,
       score = excluded.score, band = excluded.band, risk_type = excluded.risk_type, confidence = excluded.confidence, confidence_label = excluded.confidence_label,
       high_risk = excluded.high_risk, structural_keys = excluded.structural_keys, reasons_json = excluded.reasons_json, market_data_at = excluded.market_data_at`
  );
  let appended = 0;
  let high = 0;
  const liveIds = new Set<string>();
  db.transaction(() => {
    for (const { inst, inputs } of all) {
      liveIds.add(inst.id);
      const r = computeRisk(inputs);
      if (r.highRisk) high++;
      const p = prev.get(inst.id);
      const changed = !p || p.score !== r.score || p.band !== r.band || p.risk_type !== r.riskType || p.confidence !== r.confidence;
      const old = p && Date.parse(nowIso) - Date.parse(p.computed_at) > 24 * 3600_000;
      let scoreId = p?.score_id ?? 0;
      if (changed || old) {
        const res = ins.run(inst.id, MODEL_VERSION, nowIso, r.score, r.band, r.riskType, r.confidence, r.confidenceLabel, r.highRisk ? 1 : 0,
          `|${r.structuralKeys.join("|")}|`, JSON.stringify(r.factors), JSON.stringify(r.flags), JSON.stringify(r.reasons), inputs.marketDataAt,
          JSON.stringify({ coverage: r.coverage, confidenceParts: r.confidenceParts }));
        scoreId = Number(res.lastInsertRowid);
        appended++;
      }
      latest.run(inst.id, scoreId, MODEL_VERSION, changed || old ? nowIso : p!.computed_at, r.score, r.band, r.riskType, r.confidence, r.confidenceLabel,
        r.highRisk ? 1 : 0, `|${r.structuralKeys.join("|")}|`, JSON.stringify(r.reasons), inputs.marketDataAt);
    }
    // Instruments no longer live keep their history rows; only the derived pointer is removed.
    for (const id of Array.from(prev.keys())) if (!liveIds.has(id)) db.prepare(`DELETE FROM crypto_risk_latest WHERE instrument_id = ?`).run(id);
  })();
  return { scored: all.length, appended, highRisk: high };
}

export interface HighRiskRow {
  instrument_id: string;
  name: string;
  symbol: string;
  provider_id: string;
  market_cap: number | null;
  volume_24h: number | null;
  score: number | null;
  band: string;
  risk_type: string;
  confidence: number;
  confidence_label: string;
  high_risk: number;
  structural_keys: string;
  reasons: string[];
  market_data_at: string | null;
  stale: boolean;
  symbol_collisions: number;
}

export function listHighRisk(q: HighRiskQuery, nowIso = new Date().toISOString()) {
  const db = prepareCryptoStore();
  ensureCryptoIntelTables(db);
  const { where, params } = buildWhere(q, nowIso, STALE_MARKET_DATA_H);
  const base = `FROM crypto_risk_latest l JOIN instruments i ON i.id = l.instrument_id ${where}`;
  const total = (db.prepare(`SELECT COUNT(*) AS c ${base}`).get(...params) as { c: number }).c;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(q.page, pages);
  const rows = db
    .prepare(
      `SELECT l.instrument_id, i.name, i.symbol, i.provider_id, i.market_cap, i.volume_24h, l.score, l.band, l.risk_type, l.confidence, l.confidence_label,
              l.high_risk, l.structural_keys, l.reasons_json, l.market_data_at,
              (SELECT COUNT(*) - 1 FROM instruments x WHERE x.asset_type = 'crypto' AND UPPER(x.symbol) = UPPER(i.symbol)) AS symbol_collisions
       ${base} ${orderBy(q)} LIMIT ? OFFSET ?`
    )
    .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE) as (Omit<HighRiskRow, "reasons" | "stale"> & { reasons_json: string })[];
  const cut = Date.parse(nowIso) - STALE_MARKET_DATA_H * 3600_000;
  const out: HighRiskRow[] = rows.map((r) => {
    const { reasons_json, ...rest } = r;
    return { ...rest, reasons: JSON.parse(reasons_json) as string[], stale: !r.market_data_at || Date.parse(r.market_data_at) < cut };
  });
  return { total, page, pages, rows: out };
}

/** Facets for the filter UI: only values that exist in scored data are offered. */
export function highRiskFacets() {
  const db = prepareCryptoStore();
  ensureCryptoIntelTables(db);
  const views = db.prepare(`SELECT risk_type, COUNT(*) AS c, SUM(high_risk) AS h FROM crypto_risk_latest GROUP BY risk_type`).all() as { risk_type: string; c: number; h: number }[];
  const bands = db.prepare(`SELECT band, COUNT(*) AS c FROM crypto_risk_latest GROUP BY band`).all() as { band: string; c: number }[];
  const categories = db
    .prepare(`SELECT c.category_slug AS v, COUNT(*) AS c FROM crypto_categories c JOIN crypto_risk_latest l ON l.instrument_id = c.instrument_id GROUP BY c.category_slug ORDER BY c DESC`)
    .all() as { v: string; c: number }[];
  const networks = db
    .prepare(`SELECT k.network AS v, COUNT(*) AS c FROM crypto_contracts k JOIN crypto_risk_latest l ON l.instrument_id = k.instrument_id GROUP BY k.network ORDER BY c DESC LIMIT 20`)
    .all() as { v: string; c: number }[];
  const factors = STRUCTURAL_FACTOR_KEYS.map((k) => ({
    v: k,
    label: FACTORS.find((f) => f.key === k)!.label,
    c: (db.prepare(`SELECT COUNT(*) AS c FROM crypto_risk_latest WHERE structural_keys LIKE ?`).get(`%|${k}|%`) as { c: number }).c,
  })).filter((f) => f.c > 0);
  const total = views.reduce((s, v) => s + v.c, 0);
  const highRisk = views.reduce((s, v) => s + (v.h ?? 0), 0);
  const lastScored = (db.prepare(`SELECT MAX(computed_at) AS m FROM crypto_risk_latest`).get() as { m: string | null }).m;
  return { views, bands, categories, networks, factors, total, highRisk, lastScored };
}

export interface RiskProfile {
  instrumentId: string;
  latest: (RiskResult & { computedAt: string; scoreId: number; marketDataAt: string | null }) | null;
  history: { model_version: string; computed_at: string; score: number | null; band: string; risk_type: string | null; confidence: number | null }[];
  inputs: RiskInputs | null;
  snapshot: Record<string, unknown> | null;
  behavior: { return7d: number | null; return30d: number | null; return90d: number | null; longHorizonDays: number | null; vol30d: number | null; maxDrawdown90d: number | null; corrBtc: { value: number | null; pairs: number }; corrEth: { value: number | null; pairs: number }; historyDays: number; firstDay: string | null; lastDay: string | null };
  contracts: { network: string; contract_address: string; retrieved_at: string }[];
  categories: { category_slug: string; retrieved_at: string }[];
  incidents: { name: string; incident_date: string; amount_usd: number | null; returned_usd: number | null; classification: string | null; technique: string | null; source_url: string | null }[];
  protocolMapped: boolean;
  collisions: { id: string; name: string; symbol: string; quote_status: string; market_cap: number | null }[];
}

export function getRiskProfile(instrumentId: string, nowIso = new Date().toISOString()): RiskProfile {
  const db = prepareCryptoStore();
  ensureCryptoIntelTables(db);
  const lat = db.prepare(`SELECT score_id, computed_at, market_data_at FROM crypto_risk_latest WHERE instrument_id = ?`).get(instrumentId) as
    | { score_id: number; computed_at: string; market_data_at: string | null }
    | undefined;
  let latest: RiskProfile["latest"] = null;
  if (lat) {
    const row = db.prepare(`SELECT * FROM crypto_risk_scores WHERE id = ?`).get(lat.score_id) as Record<string, unknown> | undefined;
    if (row) {
      const detail = row.detail_json ? (JSON.parse(String(row.detail_json)) as { coverage: number; confidenceParts: Record<string, number> }) : { coverage: 0, confidenceParts: {} };
      latest = {
        modelVersion: String(row.model_version),
        score: row.score as number | null,
        band: row.band as RiskResult["band"],
        riskType: row.risk_type as RiskResult["riskType"],
        highRisk: row.high_risk === 1,
        confidence: row.confidence as number,
        confidenceLabel: row.confidence_label as RiskResult["confidenceLabel"],
        confidenceParts: detail.confidenceParts,
        coverage: detail.coverage,
        factors: JSON.parse(String(row.factors_json)),
        structuralKeys: String(row.structural_keys ?? "").split("|").filter(Boolean) as RiskResult["structuralKeys"],
        reasons: JSON.parse(String(row.reasons_json ?? "[]")),
        flags: JSON.parse(String(row.flags_json ?? "[]")),
        computedAt: String(row.computed_at),
        scoreId: lat.score_id,
        marketDataAt: lat.market_data_at,
      };
    }
  }
  const history = db
    .prepare(`SELECT model_version, computed_at, score, band, risk_type, confidence FROM crypto_risk_scores WHERE instrument_id = ? ORDER BY computed_at DESC, id DESC LIMIT 30`)
    .all(instrumentId) as RiskProfile["history"];
  const entry = buildAllInputs(nowIso).find((x) => x.inst.id === instrumentId) ?? null;
  const snapshot = (db.prepare(`SELECT * FROM crypto_market_snapshots WHERE instrument_id = ? ORDER BY id DESC LIMIT 1`).get(instrumentId) as Record<string, unknown> | undefined) ?? null;
  const ser = (id: string) =>
    (db.prepare(`SELECT day, price FROM crypto_price_history WHERE instrument_id = ? AND source = 'coingecko_market_chart' ORDER BY day`).all(id) as DailyPoint[]);
  const own = ser(instrumentId);
  const btc = instrumentId === "crypto:coingecko:bitcoin" ? [] : ser("crypto:coingecko:bitcoin");
  const eth = instrumentId === "crypto:coingecko:ethereum" ? [] : ser("crypto:coingecko:ethereum");
  // Long horizon = the full stored window when it spans at least 80 days (shown with its exact length).
  const longHorizonDays = own.length - 1 >= 80 ? own.length - 1 : null;
  const behavior = {
    return7d: returnOver(own, 7),
    return30d: returnOver(own, 30),
    return90d: longHorizonDays ? returnOver(own, longHorizonDays) : null,
    longHorizonDays,
    vol30d: realizedVol(own, 30),
    maxDrawdown90d: maxDrawdown(own),
    corrBtc: btc.length ? returnCorrelation(own, btc) : { value: null, pairs: 0 },
    corrEth: eth.length ? returnCorrelation(own, eth) : { value: null, pairs: 0 },
    historyDays: own.length,
    firstDay: own[0]?.day ?? null,
    lastDay: own[own.length - 1]?.day ?? null,
  };
  const contracts = db.prepare(`SELECT network, contract_address, retrieved_at FROM crypto_contracts WHERE instrument_id = ? ORDER BY network`).all(instrumentId) as RiskProfile["contracts"];
  const categories = db.prepare(`SELECT category_slug, retrieved_at FROM crypto_categories WHERE instrument_id = ? ORDER BY category_slug`).all(instrumentId) as RiskProfile["categories"];
  const incidents = db
    .prepare(`SELECT name, incident_date, amount_usd, returned_usd, classification, technique, source_url FROM crypto_security_incidents WHERE instrument_id = ? ORDER BY incident_date DESC`)
    .all(instrumentId) as RiskProfile["incidents"];
  const protocolMapped = !!db.prepare(`SELECT 1 FROM crypto_protocol_map WHERE instrument_id = ? LIMIT 1`).get(instrumentId);
  const sym = db.prepare(`SELECT symbol FROM instruments WHERE id = ?`).get(instrumentId) as { symbol: string } | undefined;
  const collisions = sym
    ? (db
        .prepare(`SELECT id, name, symbol, quote_status, market_cap FROM instruments WHERE asset_type = 'crypto' AND UPPER(symbol) = UPPER(?) AND id != ? ORDER BY market_cap DESC NULLS LAST LIMIT 20`)
        .all(sym.symbol, instrumentId) as RiskProfile["collisions"])
    : [];
  return { instrumentId, latest, history, inputs: entry?.inputs ?? null, snapshot, behavior, contracts, categories, incidents, protocolMapped, collisions };
}
