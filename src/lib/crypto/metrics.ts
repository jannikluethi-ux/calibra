/**
 * Behavior metrics from a daily price series (pure). Values are model-derived from measured/reported prices.
 * Every metric returns null when the series is too short; nothing is extrapolated.
 */
export interface DailyPoint {
  day: string; // YYYY-MM-DD (UTC)
  price: number;
}

export const MIN_DAYS_VOL = 20;
export const MIN_PAIRS_CORR = 30;

function clean(series: DailyPoint[]): DailyPoint[] {
  const byDay = new Map<string, number>();
  for (const p of series) if (Number.isFinite(p.price) && p.price > 0) byDay.set(p.day, p.price);
  return Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, price]) => ({ day, price }));
}

export function returnOver(series: DailyPoint[], days: number): number | null {
  const s = clean(series);
  if (s.length < days + 1) return null;
  const last = s[s.length - 1].price;
  const prev = s[s.length - 1 - days].price;
  return Math.round(((last / prev - 1) * 100) * 100) / 100;
}

/** Annualized realized volatility (%) of daily log returns over the last `window` days. */
export function realizedVol(series: DailyPoint[], window = 30): number | null {
  const s = clean(series).slice(-(window + 1));
  if (s.length < Math.min(window, MIN_DAYS_VOL) + 1) return null;
  const r: number[] = [];
  for (let i = 1; i < s.length; i++) r.push(Math.log(s[i].price / s[i - 1].price));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.round(Math.sqrt(v) * Math.sqrt(365) * 100 * 10) / 10;
}

/** Maximum peak-to-trough decline (%) within the series (negative number or 0). */
export function maxDrawdown(series: DailyPoint[]): number | null {
  const s = clean(series);
  if (s.length < MIN_DAYS_VOL) return null;
  let peak = s[0].price;
  let mdd = 0;
  for (const p of s) {
    peak = Math.max(peak, p.price);
    mdd = Math.min(mdd, p.price / peak - 1);
  }
  return Math.round(mdd * 100 * 10) / 10;
}

/** Pearson correlation of daily log returns on matching days; null with fewer than MIN_PAIRS_CORR pairs. */
export function returnCorrelation(a: DailyPoint[], b: DailyPoint[]): { value: number | null; pairs: number } {
  const ra = logReturnsByDay(clean(a));
  const rb = logReturnsByDay(clean(b));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [day, x] of Array.from(ra.entries())) {
    const y = rb.get(day);
    if (y != null) {
      xs.push(x);
      ys.push(y);
    }
  }
  if (xs.length < MIN_PAIRS_CORR) return { value: null, pairs: xs.length };
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return { value: null, pairs: xs.length };
  return { value: Math.round((num / Math.sqrt(dx * dy)) * 100) / 100, pairs: xs.length };
}

function logReturnsByDay(s: DailyPoint[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 1; i < s.length; i++) m.set(s[i].day, Math.log(s[i].price / s[i - 1].price));
  return m;
}
