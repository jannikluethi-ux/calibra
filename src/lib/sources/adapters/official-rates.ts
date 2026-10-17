/**
 * Official rates (keyless, primary sources) used for corroboration and the data-quality summary:
 *  - U.S. Department of the Treasury, Daily Treasury Par Yield Curve Rates (CSV, public domain).
 *  - Deutsche Bundesbank time-series API, 10-year Bund yield from the term structure (BBSIS ... R10XX), CSV.
 * Writes append-only source_observations (observed_at = source date, retrieved_at = now). Does not change
 * market snapshots, forecasts or the meaning of existing series.
 */
import { appendObservation } from "../observations";
import { prepareCryptoStore } from "../prepare";
import { recordAttempt, skipCheck } from "../health";
import { classifyFailure, statusFromError, withRetry, withTimeout, type AttemptOutcome } from "../health-core";

export type FetchText = (url: string) => Promise<{ status: number; text: string }>;
const defaultFetchText: FetchText = async (url) => {
  const res = await withTimeout(fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Calibra/0.1; research)" }, cache: "no-store" }), 20000, url);
  return { status: res.status, text: await res.text() };
};

export const UST_URL = (year: number) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
export const BUBA_URL =
  "https://api.statistiken.bundesbank.de/rest/data/BBSIS/D.I.ZAR.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A?format=csv&lastNObservations=5";

/** Parse the Treasury CSV: header row with "2 Yr"/"10 Yr", dates MM/DD/YYYY, newest first. */
export function parseTreasuryCsv(text: string): { date: string; y2: number | null; y10: number | null } | null {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const head = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  const i2 = head.indexOf("2 Yr");
  const i10 = head.indexOf("10 Yr");
  if (head[0] !== "Date" || i2 < 0 || i10 < 0) return null;
  const rows = lines.slice(1).map((l) => l.split(","));
  const toIso = (d: string) => {
    const m = d.replace(/"/g, "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
  };
  const parsed = rows.map((r) => ({ date: toIso(r[0]), y2: Number(r[i2]), y10: Number(r[i10]) })).filter((r) => r.date);
  if (!parsed.length) return null;
  parsed.sort((a, b) => (a.date! < b.date! ? 1 : -1));
  const p = parsed[0];
  const ok = (x: number) => (Number.isFinite(x) && x > -5 && x < 30 ? x : null);
  return { date: p.date!, y2: ok(p.y2), y10: ok(p.y10) };
}

/** Parse the Bundesbank CSV (semicolon separated, decimal comma, rows "YYYY-MM-DD;3,45;"). */
export function parseBundesbankCsv(text: string): { date: string; y10: number } | null {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.match(/^(\d{4}-\d{2}-\d{2});(-?\d+(?:,\d+)?);/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ date: m[1], y10: Number(m[2].replace(",", ".")) }))
    .filter((r) => Number.isFinite(r.y10) && r.y10 > -5 && r.y10 < 30);
  if (!rows.length) return null;
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return rows[0];
}

async function runOne(
  sourceId: string,
  url: string,
  fetchText: FetchText,
  parse: (t: string) => { date: string; values: Record<string, number | null> } | null,
  retryBaseMs: number
): Promise<AttemptOutcome> {
  const sk = skipCheck(sourceId);
  if (sk.skip) return { ok: false, errorClass: "unavailable", error: `skipped: ${sk.reason}` };
  const t0 = Date.now();
  const r = await withRetry<{ date: string; values: Record<string, number | null> }>(
    async () => {
      try {
        const res = await fetchText(url);
        if (res.status !== 200) {
          return { outcome: { ok: false, errorClass: classifyFailure({ status: res.status, body: res.text.slice(0, 200) }), httpStatus: res.status, error: `HTTP ${res.status}` } };
        }
        const p = parse(res.text);
        if (!p) return { outcome: { ok: false, errorClass: "invalid_data", httpStatus: 200, error: "unparseable or out-of-range response" } };
        return { outcome: { ok: true, errorClass: "ok", httpStatus: 200 }, value: p };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { outcome: { ok: false, errorClass: classifyFailure({ status: statusFromError(e), error: msg }), httpStatus: statusFromError(e), error: msg.slice(0, 200) } };
      }
    },
    { retries: 1, baseDelayMs: retryBaseMs }
  );
  const retrievedAt = new Date().toISOString();
  let items = 0;
  if (r.outcome.ok && r.value) {
    for (const [inst, v] of Object.entries(r.value.values)) {
      if (v == null) continue;
      appendObservation({ instrumentId: inst, field: "yield_pct", value: v, unit: "percent", observedAt: r.value.date, retrievedAt, sourceId, sourceUrl: url, claimType: "observed_official" });
      items++;
    }
  }
  const outcome: AttemptOutcome = {
    ...r.outcome,
    ok: r.outcome.ok && items > 0,
    errorClass: r.outcome.ok && items === 0 ? "invalid_data" : r.outcome.errorClass,
    latencyMs: Date.now() - t0,
    items,
    newestObservationAt: r.value ? `${r.value.date}T00:00:00.000Z` : null,
  };
  recordAttempt(sourceId, outcome);
  return outcome;
}

export async function runOfficialRates(opts: { fetchText?: FetchText; now?: Date; retryBaseMs?: number } = {}) {
  prepareCryptoStore(); // ensures source tables + seed rows (observations reference sources.id)
  const fetchText = opts.fetchText ?? defaultFetchText;
  const now = opts.now ?? new Date();
  const base = opts.retryBaseMs ?? 1000;
  // Isolated: one failing source never blocks the other.
  const [ust, buba] = await Promise.allSettled([
    runOne("ust_yield_curve", UST_URL(now.getUTCFullYear()), fetchText, (t) => {
      const p = parseTreasuryCsv(t);
      return p ? { date: p.date, values: { "rates:UST2Y": p.y2, "rates:UST10Y": p.y10 } } : null;
    }, base),
    runOne("bundesbank_yields", BUBA_URL, fetchText, (t) => {
      const p = parseBundesbankCsv(t);
      return p ? { date: p.date, values: { "rates:DE10Y": p.y10 } } : null;
    }, base),
  ]);
  return {
    ust: ust.status === "fulfilled" ? ust.value : { ok: false, errorClass: "unavailable" as const, error: String(ust.reason) },
    bundesbank: buba.status === "fulfilled" ? buba.value : { ok: false, errorClass: "unavailable" as const, error: String(buba.reason) },
  };
}
