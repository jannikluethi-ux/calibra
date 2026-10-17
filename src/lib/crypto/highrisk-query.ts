/**
 * High-risk list query state (pure). Parses URL search params into a validated filter object,
 * serializes it back (so filters survive navigation to a detail page and back), and builds SQL.
 * Only whitelisted values are accepted; unknown values are dropped, never interpolated.
 */
import { FACTORS, type FactorKey } from "./risk-v2";

export const VIEWS = ["high", "structural", "volatility", "all", "insufficient"] as const;
export const SORTS = ["score", "confidence", "market_cap", "volume", "name", "updated"] as const;
export const BAND_VALUES = ["low", "moderate", "elevated", "high", "extreme", "insufficient_data"] as const;
export const CONF_VALUES = ["low", "medium", "high"] as const;
export const FRESH_VALUES = ["fresh", "stale"] as const;
export const STRUCTURAL_FACTOR_KEYS = FACTORS.filter((f) => f.structural).map((f) => f.key) as FactorKey[];
export const PAGE_SIZE = 25;

export interface HighRiskQuery {
  q: string;
  view: (typeof VIEWS)[number];
  band: (typeof BAND_VALUES)[number][];
  factor: FactorKey | null;
  category: string | null;
  network: string | null;
  conf: (typeof CONF_VALUES)[number] | null;
  fresh: (typeof FRESH_VALUES)[number] | null;
  sort: (typeof SORTS)[number];
  dir: "asc" | "desc";
  page: number;
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function get(p: Params, k: string): string | undefined {
  if (p instanceof URLSearchParams) return p.get(k) ?? undefined;
  const v = p[k];
  return Array.isArray(v) ? v[0] : v;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseHighRiskQuery(p: Params): HighRiskQuery {
  const pick = <T extends readonly string[]>(v: string | undefined, list: T, dflt: T[number]): T[number] =>
    v && (list as readonly string[]).includes(v) ? (v as T[number]) : dflt;
  const q = (get(p, "q") ?? "").trim().slice(0, 80);
  const band = (get(p, "band") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is (typeof BAND_VALUES)[number] => (BAND_VALUES as readonly string[]).includes(s));
  const factorRaw = get(p, "factor");
  const factor = factorRaw && (STRUCTURAL_FACTOR_KEYS as string[]).includes(factorRaw) ? (factorRaw as FactorKey) : null;
  const category = get(p, "category");
  const network = get(p, "network");
  const confRaw = get(p, "conf");
  const freshRaw = get(p, "fresh");
  const page = Math.min(1000, Math.max(1, Math.floor(Number(get(p, "page") ?? 1)) || 1));
  const sort = pick(get(p, "sort"), SORTS, "score");
  const dirRaw = get(p, "dir");
  return {
    q,
    view: pick(get(p, "view"), VIEWS, "high"),
    band: Array.from(new Set(band)),
    factor,
    category: category && SLUG.test(category) ? category : null,
    network: network && SLUG.test(network) ? network : null,
    conf: confRaw && (CONF_VALUES as readonly string[]).includes(confRaw) ? (confRaw as HighRiskQuery["conf"]) : null,
    fresh: freshRaw && (FRESH_VALUES as readonly string[]).includes(freshRaw) ? (freshRaw as HighRiskQuery["fresh"]) : null,
    sort,
    dir: dirRaw === "asc" || dirRaw === "desc" ? dirRaw : sort === "name" ? "asc" : "desc",
    page,
  };
}

/** Serialize only non-default values (stable order) so URLs stay short and comparable. */
export function toQueryString(q: HighRiskQuery, overrides: Partial<HighRiskQuery> = {}): string {
  const v = { ...q, ...overrides };
  const d = parseHighRiskQuery({});
  const sp = new URLSearchParams();
  if (v.q) sp.set("q", v.q);
  if (v.view !== d.view) sp.set("view", v.view);
  if (v.band.length) sp.set("band", v.band.join(","));
  if (v.factor) sp.set("factor", v.factor);
  if (v.category) sp.set("category", v.category);
  if (v.network) sp.set("network", v.network);
  if (v.conf) sp.set("conf", v.conf);
  if (v.fresh) sp.set("fresh", v.fresh);
  if (v.sort !== d.sort) sp.set("sort", v.sort);
  const defaultDir = v.sort === "name" ? "asc" : "desc";
  if (v.dir !== defaultDir) sp.set("dir", v.dir);
  if (v.page > 1) sp.set("page", String(v.page));
  return sp.toString();
}

/** Safe "return to list" target from a detail page's `from` param (must be a high-risk list query). */
export function backHref(from: string | undefined): string {
  if (!from) return "/crypto/high-risk";
  const parsed = parseHighRiskQuery(new URLSearchParams(from));
  const qs = toQueryString(parsed);
  return qs ? `/crypto/high-risk?${qs}` : "/crypto/high-risk";
}

export function buildWhere(q: HighRiskQuery, nowIso: string, staleHours = 36): { where: string; params: unknown[] } {
  const w: string[] = [];
  const params: unknown[] = [];
  switch (q.view) {
    case "high":
      w.push("l.high_risk = 1");
      break;
    case "structural":
      w.push("l.risk_type = 'structural'");
      break;
    case "volatility":
      w.push("l.risk_type = 'volatility_only'");
      break;
    case "insufficient":
      w.push("l.risk_type = 'insufficient_data'");
      break;
  }
  if (q.band.length) {
    w.push(`l.band IN (${q.band.map(() => "?").join(",")})`);
    params.push(...q.band);
  }
  if (q.factor) {
    w.push("l.structural_keys LIKE ?");
    params.push(`%|${q.factor}|%`);
  }
  if (q.category) {
    w.push("EXISTS (SELECT 1 FROM crypto_categories c WHERE c.instrument_id = l.instrument_id AND c.category_slug = ?)");
    params.push(q.category);
  }
  if (q.network) {
    w.push("EXISTS (SELECT 1 FROM crypto_contracts k WHERE k.instrument_id = l.instrument_id AND k.network = ?)");
    params.push(q.network);
  }
  if (q.conf) {
    const min = q.conf === "high" ? 70 : q.conf === "medium" ? 45 : 0;
    w.push("l.confidence >= ?");
    params.push(min);
  }
  if (q.fresh) {
    const cut = new Date(Date.parse(nowIso) - staleHours * 3600_000).toISOString();
    w.push(q.fresh === "fresh" ? "l.market_data_at >= ?" : "(l.market_data_at IS NULL OR l.market_data_at < ?)");
    params.push(cut);
  }
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    w.push(
      `(i.name LIKE ? ESCAPE '\\' OR i.symbol = ? COLLATE NOCASE OR i.provider_id = ? OR l.instrument_id = ? OR EXISTS (SELECT 1 FROM crypto_contracts k2 WHERE k2.instrument_id = l.instrument_id AND k2.contract_address = ? COLLATE NOCASE))`
    );
    params.push(like, q.q, q.q.toLowerCase(), q.q, q.q);
  }
  return { where: w.length ? `WHERE ${w.join(" AND ")}` : "", params };
}

export function orderBy(q: HighRiskQuery): string {
  const dir = q.dir === "asc" ? "ASC" : "DESC";
  const col: Record<HighRiskQuery["sort"], string> = {
    score: "l.score",
    confidence: "l.confidence",
    market_cap: "i.market_cap",
    volume: "i.volume_24h",
    name: "i.name COLLATE NOCASE",
    updated: "l.market_data_at",
  };
  // NULLs always last regardless of direction; tie-break by id for stable paging.
  return `ORDER BY (${col[q.sort]} IS NULL), ${col[q.sort]} ${dir}, l.instrument_id ASC`;
}

/** Detail-page link that carries the list state so "Back to list" restores filters, sort and page. */
export function detailHref(instrumentId: string, q: HighRiskQuery): string {
  return `/crypto/${encodeURIComponent(instrumentId)}?from=${encodeURIComponent(toQueryString(q))}`;
}
