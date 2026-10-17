/**
 * Crypto risk-event taxonomy, the separate qualitative event factor (crypto_event_factor_v1), and the
 * outcome log (de-pegs, exploits, top-1000 exits) kept for later validation.
 *
 * Linking: an event is attached to an asset only through its CoinGecko id (DefiLlama protocol -> gecko id map,
 * or instrument id) or a contract address. Never by ticker or name.
 * The event factor is NOT blended into crypto_risk_v2; it is shown next to it. History is append-only.
 */
import { createHash } from "crypto";
import type Database from "better-sqlite3";
import { getDb } from "../db";
import { ensureCryptoIntelTables } from "../crypto/intel-schema";
import { ensureIntelTables } from "./schema";

export const EVENT_FACTOR_VERSION = "crypto_event_factor_v1";
export const RISK_EVENT_CATEGORIES = ["exploit", "depeg", "delisting", "regulatory_action", "unlock"] as const;
export type RiskEventCategory = (typeof RISK_EVENT_CATEGORIES)[number];

/** Category coverage: which free source feeds each category. Categories without a source stay empty (missing stays missing). */
export const CATEGORY_SOURCES: Record<RiskEventCategory, { source: string | null; note: string }> = {
  exploit: { source: "DefiLlama hacks database (crypto_security_incidents), linked via DefiLlama protocol -> CoinGecko id", note: "Only incidents whose protocol maps to a CoinGecko id are attached to an asset." },
  depeg: { source: "CoinGecko prices for USD stablecoins (latest snapshot and daily history)", note: "Recorded when a USD stablecoin trades >= 2% BELOW $1 (daily history, or a latest snapshot whose source timestamp is <= 7 days old). Deviations above $1 are not recorded because yield-bearing 'USD' tokens trade above par by design. Reserve quality is not observed." },
  delisting: { source: null, note: "No free, keyless delisting feed is configured. Category is empty, not zero-risk." },
  regulatory_action: { source: "Official regulator feeds (SEC, CFTC) - only when an item contains a contract address or explicit CoinGecko id", note: "Regulator press releases rarely carry identifiers, so this category is usually empty." },
  unlock: { source: null, note: "Token-unlock schedules need a paid or keyed source. Category is empty, not zero-risk." },
};

export const DEPEG_THRESHOLD = 0.02;
export const SEVERE_DEPEG = 0.05;

export interface RiskEventRecord {
  id: string;
  instrumentId: string;
  category: RiskEventCategory;
  occurredAt: string;
  linkBasis: "coingecko_id" | "contract_address";
  source: string;
  sourceUrl: string | null;
  evidence: Record<string, unknown>;
}

function isUsdStable(symbol: string, name: string) {
  return /usd|dollar/i.test(`${symbol} ${name}`);
}

export function collectRiskEvents(db: Database.Database, nowIso: string): RiskEventRecord[] {
  const out: RiskEventRecord[] = [];
  // exploits
  for (const r of db
    .prepare(`SELECT id, instrument_id, defillama_id, name, incident_date, amount_usd, returned_usd, classification, technique, source, source_url FROM crypto_security_incidents WHERE instrument_id IS NOT NULL`)
    .all() as Record<string, unknown>[]) {
    out.push({
      id: `exploit:${r.id}`,
      instrumentId: String(r.instrument_id),
      category: "exploit",
      occurredAt: String(r.incident_date),
      linkBasis: "coingecko_id",
      source: String(r.source),
      sourceUrl: (r.source_url as string) ?? null,
      evidence: { incident: r.name, amountUsd: r.amount_usd, returnedUsd: r.returned_usd, classification: r.classification, technique: r.technique, defillamaId: r.defillama_id, link: "DefiLlama protocol id -> CoinGecko id (crypto_protocol_map)" },
    });
  }
  // de-pegs: USD stablecoins (CoinGecko category 'stablecoins') - daily history and latest snapshot
  const stables = db
    .prepare(`SELECT DISTINCT i.id, i.symbol, i.name FROM crypto_categories c JOIN instruments i ON i.id = c.instrument_id WHERE c.category_slug = 'stablecoins'`)
    .all() as { id: string; symbol: string; name: string }[];
  const since = new Date(Date.parse(nowIso) - 120 * 86400_000).toISOString().slice(0, 10);
  const hist = db.prepare(`SELECT day, price, source FROM crypto_price_history WHERE instrument_id = ? AND day >= ? ORDER BY day`);
  const snap = db.prepare(`SELECT retrieved_at, observed_at, price, source, source_url FROM crypto_market_snapshots WHERE instrument_id = ? ORDER BY id DESC LIMIT 1`);
  for (const s of stables) {
    if (!isUsdStable(s.symbol, s.name)) continue;
    for (const h of hist.all(s.id, since) as { day: string; price: number; source: string }[]) {
      const dev = 1 - h.price; // below-peg only: yield-bearing "USD" tokens legitimately trade above $1
      if (dev >= DEPEG_THRESHOLD) {
        out.push({ id: `depeg:${s.id}:${h.day}`, instrumentId: s.id, category: "depeg", occurredAt: `${h.day}T00:00:00.000Z`, linkBasis: "coingecko_id", source: h.source, sourceUrl: null, evidence: { price: h.price, deviationPct: +(dev * 100).toFixed(2), basis: "daily price history", severe: dev >= SEVERE_DEPEG } });
      }
    }
    const l = snap.get(s.id) as { retrieved_at: string; observed_at: string | null; price: number | null; source: string; source_url: string | null } | undefined;
    const fresh = l && (!l.observed_at || Date.parse(l.retrieved_at) - Date.parse(l.observed_at) <= 7 * 86400_000);
    if (l && l.price != null && fresh) {
      const dev = 1 - l.price;
      if (dev >= DEPEG_THRESHOLD) {
        const at = l.observed_at ?? l.retrieved_at;
        out.push({ id: `depeg:${s.id}:${at.slice(0, 10)}`, instrumentId: s.id, category: "depeg", occurredAt: at, linkBasis: "coingecko_id", source: l.source, sourceUrl: l.source_url, evidence: { price: l.price, deviationPct: +(dev * 100).toFixed(2), basis: "latest market snapshot", severe: dev >= SEVERE_DEPEG } });
      }
    }
  }
  // regulatory actions: identifier-linked mappings from regulator feeds
  for (const r of db
    .prepare(
      `SELECT m.event_id, m.instrument_id, m.link_basis, m.rationale, e.published_at, json_extract(e.data,'$.sourceName') AS src, json_extract(e.data,'$.citationUrl') AS url,
              json_extract(e.data,'$.provenance.sourceId') AS sid
       FROM event_instrument_mappings m JOIN events e ON e.id = m.event_id
       WHERE m.link_basis IN ('contract_address','coingecko_id') AND m.instrument_id LIKE 'crypto:%'`
    )
    .all() as Record<string, unknown>[]) {
    if (!["rss_sec", "rss_cftc"].includes(String(r.sid))) continue;
    out.push({ id: `regulatory_action:${r.event_id}:${r.instrument_id}`, instrumentId: String(r.instrument_id), category: "regulatory_action", occurredAt: String(r.published_at), linkBasis: r.link_basis as RiskEventRecord["linkBasis"], source: String(r.src), sourceUrl: (r.url as string) ?? null, evidence: { eventId: r.event_id, rationale: r.rationale } });
  }
  // de-duplicate ids (history + snapshot can produce the same day)
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

export type FactorLevel = "high" | "elevated" | "noted";

/** Qualitative factor from the risk-event records of one asset. Pure. */
export function eventFactorLevel(records: Pick<RiskEventRecord, "id" | "category" | "occurredAt" | "evidence">[], nowIso: string): { level: FactorLevel; reasons: string[]; evidenceIds: string[] } {
  const now = Date.parse(nowIso);
  const ageD = (iso: string) => (now - Date.parse(iso)) / 86400_000;
  const reasons: string[] = [];
  const ev: string[] = [];
  let level: FactorLevel = "noted";
  const bump = (l: FactorLevel) => {
    if (l === "high" || (l === "elevated" && level === "noted")) level = l;
  };
  for (const r of records) {
    const d = ageD(r.occurredAt);
    if (r.category === "exploit" && d <= 365) {
      const amt = Number(r.evidence.amountUsd ?? 0) - Number(r.evidence.returnedUsd ?? 0);
      if (amt >= 10_000_000) {
        bump("high");
        reasons.push(`Exploit within 365 days with net loss ≥ $10M (${String(r.evidence.incident ?? "")}).`);
      } else {
        bump("elevated");
        reasons.push(`Exploit within 365 days (${String(r.evidence.incident ?? "")}).`);
      }
      ev.push(r.id);
    } else if (r.category === "depeg" && d <= 90) {
      if (r.evidence.severe) {
        bump("high");
        reasons.push(`De-peg ≥ 5% within 90 days (${String(r.evidence.deviationPct)}%).`);
      } else {
        bump("elevated");
        reasons.push(`De-peg ≥ 2% within 90 days (${String(r.evidence.deviationPct)}%).`);
      }
      ev.push(r.id);
    } else if (r.category === "regulatory_action" && d <= 180) {
      bump("high");
      reasons.push("Regulatory action naming this asset within 180 days.");
      ev.push(r.id);
    }
  }
  if (level === "noted") {
    reasons.push("Risk events on record, all outside the look-back windows.");
    ev.push(...records.slice(0, 5).map((r) => r.id));
  }
  return { level, reasons: Array.from(new Set(reasons)).slice(0, 6), evidenceIds: ev.slice(0, 20) };
}

export interface CryptoEventRunResult {
  records: number;
  newRecords: number;
  byCategory: Record<string, number>;
  factorRows: number;
  newFactorRows: number;
  outcomes: { newDepegs: number; newExploits: number; newExits: number; exitCheck: string };
}

export function runCryptoRiskEvents(nowIso = new Date().toISOString(), db: Database.Database = getDb()): CryptoEventRunResult {
  ensureCryptoIntelTables(db);
  ensureIntelTables(db);
  const records = collectRiskEvents(db, nowIso);
  const ins = db.prepare(`INSERT OR IGNORE INTO crypto_risk_event_log (id, instrument_id, category, occurred_at, link_basis, source, source_url, evidence_json, detected_at) VALUES (?,?,?,?,?,?,?,?,?)`);
  const lastF = db.prepare(`SELECT input_hash FROM crypto_event_factor_scores WHERE instrument_id = ? ORDER BY id DESC LIMIT 1`);
  const insF = db.prepare(`INSERT INTO crypto_event_factor_scores (instrument_id, model_version, computed_at, level, input_hash, reasons_json, evidence_ids_json) VALUES (?,?,?,?,?,?,?)`);
  const insO = db.prepare(`INSERT OR IGNORE INTO crypto_outcome_log (id, kind, instrument_id, observed_at, logged_at, source, detail_json) VALUES (?,?,?,?,?,?,?)`);
  const riskAt = db.prepare(`SELECT score, band, high_risk, model_version, computed_at FROM crypto_risk_latest WHERE instrument_id = ?`);
  let newRecords = 0;
  let newFactorRows = 0;
  let factorRows = 0;
  const byCategory: Record<string, number> = Object.fromEntries(RISK_EVENT_CATEGORIES.map((c) => [c, 0]));
  const outcomes = { newDepegs: 0, newExploits: 0, newExits: 0, exitCheck: "" };
  db.transaction(() => {
    for (const r of records) {
      newRecords += ins.run(r.id, r.instrumentId, r.category, r.occurredAt, r.linkBasis, r.source, r.sourceUrl, JSON.stringify(r.evidence), nowIso).changes;
      byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
      if (r.category === "depeg" || r.category === "exploit") {
        const risk = riskAt.get(r.instrumentId) ?? null;
        const n = insO.run(r.id, r.category, r.instrumentId, r.occurredAt, nowIso, r.source, JSON.stringify({ ...r.evidence, riskAtLogging: risk, note: "riskAtLogging is the latest score when the outcome was logged, which may postdate the outcome" })).changes;
        if (r.category === "depeg") outcomes.newDepegs += n;
        else outcomes.newExploits += n;
      }
    }
    // factor per asset (append only when inputs change)
    const byInst = new Map<string, RiskEventRecord[]>();
    for (const r of records) byInst.set(r.instrumentId, [...(byInst.get(r.instrumentId) ?? []), r]);
    for (const [inst, recs] of Array.from(byInst.entries())) {
      const f = eventFactorLevel(recs, nowIso);
      const hash = createHash("sha256").update(JSON.stringify([EVENT_FACTOR_VERSION, f.level, f.reasons, f.evidenceIds])).digest("hex").slice(0, 32);
      factorRows++;
      const prev = lastF.get(inst) as { input_hash: string } | undefined;
      if (prev?.input_hash === hash) continue;
      insF.run(inst, EVENT_FACTOR_VERSION, nowIso, f.level, hash, JSON.stringify(f.reasons), JSON.stringify(f.evidenceIds));
      newFactorRows++;
    }
    // top-1000 exits: compare the two most recent complete market syncs
    const syncs = db.prepare(`SELECT retrieved_at, COUNT(*) AS n FROM crypto_market_snapshots GROUP BY retrieved_at ORDER BY retrieved_at DESC LIMIT 2`).all() as { retrieved_at: string; n: number }[];
    if (syncs.length < 2) {
      outcomes.exitCheck = "needs two market syncs; only one recorded so far";
    } else if (syncs[0].n < 900 || syncs[1].n < 900) {
      outcomes.exitCheck = `skipped: a sync is partial (${syncs[0].n} / ${syncs[1].n} rows)`;
    } else {
      const latest = new Set((db.prepare(`SELECT instrument_id FROM crypto_market_snapshots WHERE retrieved_at = ?`).all(syncs[0].retrieved_at) as { instrument_id: string }[]).map((r) => r.instrument_id));
      const prev = db.prepare(`SELECT instrument_id, rank, market_cap FROM crypto_market_snapshots WHERE retrieved_at = ?`).all(syncs[1].retrieved_at) as { instrument_id: string; rank: number | null; market_cap: number | null }[];
      for (const p of prev) {
        if (latest.has(p.instrument_id)) continue;
        const risk = riskAt.get(p.instrument_id) ?? null;
        outcomes.newExits += insO.run(`top1000_exit:${p.instrument_id}:${syncs[0].retrieved_at}`, "top1000_exit", p.instrument_id, syncs[0].retrieved_at, nowIso, "coingecko /coins/markets (top 1000 by market cap)", JSON.stringify({ previousRank: p.rank, previousMarketCap: p.market_cap, previousSync: syncs[1].retrieved_at, latestSync: syncs[0].retrieved_at, riskAtLogging: risk, note: "Left the top-1000 list between two syncs; may be a rank change, not a delisting" })).changes;
      }
      outcomes.exitCheck = `compared ${syncs[1].retrieved_at} -> ${syncs[0].retrieved_at}`;
    }
  })();
  return { records: records.length, newRecords, byCategory, factorRows, newFactorRows, outcomes };
}

export function latestEventFactor(instrumentId: string, db: Database.Database = getDb()) {
  ensureIntelTables(db);
  const rows = db.prepare(`SELECT * FROM crypto_event_factor_scores WHERE instrument_id = ? ORDER BY id DESC`).all(instrumentId) as Record<string, unknown>[];
  const events = db.prepare(`SELECT * FROM crypto_risk_event_log WHERE instrument_id = ? ORDER BY occurred_at DESC LIMIT 25`).all(instrumentId) as Record<string, unknown>[];
  return {
    latest: rows[0]
      ? { level: String(rows[0].level) as FactorLevel, computedAt: String(rows[0].computed_at), modelVersion: String(rows[0].model_version), reasons: JSON.parse(String(rows[0].reasons_json)) as string[], evidenceIds: JSON.parse(String(rows[0].evidence_ids_json)) as string[] }
      : null,
    historyCount: rows.length,
    events: events.map((e) => ({ id: String(e.id), category: String(e.category), occurredAt: String(e.occurred_at), linkBasis: String(e.link_basis), source: String(e.source), sourceUrl: (e.source_url as string) ?? null, evidence: JSON.parse(String(e.evidence_json)) as Record<string, unknown> })),
  };
}

export function outcomeLogSummary(db: Database.Database = getDb()) {
  ensureIntelTables(db);
  const byKind = db.prepare(`SELECT kind, COUNT(*) AS n, MAX(observed_at) AS latest FROM crypto_outcome_log GROUP BY kind`).all() as { kind: string; n: number; latest: string }[];
  const recent = db.prepare(`SELECT id, kind, instrument_id, observed_at, logged_at, source FROM crypto_outcome_log ORDER BY observed_at DESC LIMIT 15`).all() as { id: string; kind: string; instrument_id: string; observed_at: string; logged_at: string; source: string }[];
  return { byKind, recent };
}
