/**
 * Source-health core (pure, no DB): error classes, bounded retry with exponential back-off,
 * timeouts, concurrency-limited isolated execution, price validation, and the health-state reducer.
 * Policy: a failed source never blocks other sources and is never replaced by synthetic data.
 */

export type ErrorClass =
  | "ok"
  | "unavailable" // network error, DNS failure, timeout, HTTP 4xx/5xx (except 429)
  | "invalid_data" // response received but unusable (bad JSON/XML, non-positive or non-finite price, missing fields)
  | "stale" // fetched fine but the newest observation is older than the source's freshness budget
  | "rate_limited" // HTTP 429 or provider rate-limit body
  | "no_relevant_update" // fetched fine, zero usable items (not an error of the provider)
  | "disabled"; // source switched off in config (not called)

export interface AttemptOutcome {
  ok: boolean;
  errorClass: ErrorClass;
  httpStatus?: number | null;
  error?: string | null;
  latencyMs?: number | null;
  items?: number;
  /** Newest observation time contained in the response (source publish/observation time, UTC ISO). */
  newestObservationAt?: string | null;
}

export interface HealthState {
  sourceId: string;
  status: "healthy" | "degraded" | "failing" | "stale" | "disabled" | "unknown";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  errorClass: ErrorClass | null;
  lastError: string | null;
  lastHttpStatus: number | null;
  lastLatencyMs: number | null;
  rateLimitedUntil: string | null;
  nextAttemptAfter: string | null;
  lastValidObservationAt: string | null;
  lastItems: number | null;
}

export function emptyHealth(sourceId: string): HealthState {
  return {
    sourceId,
    status: "unknown",
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    errorClass: null,
    lastError: null,
    lastHttpStatus: null,
    lastLatencyMs: null,
    rateLimitedUntil: null,
    nextAttemptAfter: null,
    lastValidObservationAt: null,
    lastItems: null,
  };
}

/** Classify an HTTP-ish failure. `status` 0/undefined = no response (network/DNS/timeout). */
export function classifyFailure(input: { status?: number | null; error?: string | null; body?: string | null }): ErrorClass {
  const s = input.status ?? 0;
  const msg = `${input.error ?? ""} ${input.body ?? ""}`;
  if (s === 429 || /too many requests|rate.?limit/i.test(msg)) return "rate_limited";
  if (/invalid (json|xml)|unexpected token|non-whitespace|parse|unable to parse|invalid data/i.test(msg) && s >= 200 && s < 300)
    return "invalid_data";
  if (/invalid (json|xml)|invalid data|not well-formed|unexpected close tag|non-whitespace before first tag/i.test(msg) && !s)
    return "invalid_data";
  return "unavailable";
}

/** Extract an HTTP status from common error messages ("Status code 403", "HTTP 429"). */
export function statusFromError(err: unknown): number | null {
  const m = String(err instanceof Error ? err.message : err).match(/(?:status code|HTTP)\s*(\d{3})/i);
  return m ? Number(m[1]) : null;
}

/** A valid quote is a finite number strictly greater than zero. Missing stays missing (null). */
export function isValidPrice(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

export function isRetryable(errorClass: ErrorClass, httpStatus?: number | null): boolean {
  if (errorClass === "rate_limited") return true;
  if (errorClass !== "unavailable") return false;
  const s = httpStatus ?? 0;
  return s === 0 || s >= 500; // network/timeout/5xx retry; other 4xx do not
}

export interface RetryOptions {
  retries?: number; // additional attempts after the first (bounded)
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential back-off delay for attempt n (0-based retry index): base * 2^n, capped. */
export function backoffDelay(n: number, baseDelayMs = 500, maxDelayMs = 8000): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** n);
}

/**
 * Run `attempt` with bounded retries. `attempt` returns an AttemptOutcome-like object plus a value.
 * Retries only when the outcome is retryable (network/5xx/429). Never more than 1 + retries calls.
 */
export async function withRetry<T>(
  attempt: () => Promise<{ outcome: AttemptOutcome; value?: T }>,
  opts: RetryOptions = {}
): Promise<{ outcome: AttemptOutcome; value?: T; attempts: number }> {
  const retries = Math.max(0, Math.min(opts.retries ?? 2, 5));
  const sleep = opts.sleep ?? sleepMs;
  let last: { outcome: AttemptOutcome; value?: T } = { outcome: { ok: false, errorClass: "unavailable", error: "not run" } };
  for (let i = 0; i <= retries; i++) {
    try {
      last = await attempt();
    } catch (e) {
      const status = statusFromError(e);
      const msg = e instanceof Error ? e.message : String(e);
      last = { outcome: { ok: false, errorClass: classifyFailure({ status, error: msg }), httpStatus: status, error: msg.slice(0, 300) } };
    }
    if (last.outcome.ok || !isRetryable(last.outcome.errorClass, last.outcome.httpStatus) || i === retries) {
      return { ...last, attempts: i + 1 };
    }
    await sleep(backoffDelay(i, opts.baseDelayMs, opts.maxDelayMs));
  }
  return { ...last, attempts: retries + 1 };
}

/** Reject after `ms` with a timeout error (classified as unavailable). */
export function withTimeout<T>(p: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => {
      t = setTimeout(() => rej(new Error(`timeout after ${ms}ms (${label})`)), ms);
    }),
  ]);
}

/** Run fn over items with at most `limit` in flight. Failures are isolated (settled results, input order). */
export async function mapWithConcurrency<I, O>(
  items: I[],
  limit: number,
  fn: (item: I, index: number) => Promise<O>
): Promise<PromiseSettledResult<O>[]> {
  const out: PromiseSettledResult<O>[] = new Array(items.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  async function lane() {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: lanes }, lane));
  return out;
}

/** Circuit-breaker back-off after consecutive failures: 0 → none, then 5 min doubling, capped at 6 h. */
export function breakerDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures < 3) return 0;
  return Math.min(6 * 3600_000, 5 * 60_000 * 2 ** (consecutiveFailures - 3));
}

/**
 * Fold one attempt into the health state. `maxAgeMs` is the source's freshness budget for its newest observation.
 */
export function nextHealthState(
  prev: HealthState,
  o: AttemptOutcome,
  nowIso: string,
  maxAgeMs: number,
  rateLimitCooldownMs = 15 * 60_000
): HealthState {
  const now = Date.parse(nowIso);
  const s: HealthState = { ...prev, lastAttemptAt: nowIso, lastHttpStatus: o.httpStatus ?? null, lastLatencyMs: o.latencyMs ?? null };
  if (o.errorClass === "disabled") {
    return { ...s, status: "disabled", errorClass: "disabled", lastError: o.error ?? "disabled in config", nextAttemptAfter: null };
  }
  if (o.ok) {
    const newest = o.newestObservationAt ?? null;
    const lastValid = newest && (!prev.lastValidObservationAt || newest > prev.lastValidObservationAt) ? newest : prev.lastValidObservationAt;
    const age = lastValid ? now - Date.parse(lastValid) : Infinity;
    const cls: ErrorClass = age > maxAgeMs ? "stale" : (o.items ?? 0) === 0 ? "no_relevant_update" : "ok";
    return {
      ...s,
      status: cls === "ok" ? "healthy" : cls === "stale" ? "stale" : "healthy",
      lastSuccessAt: nowIso,
      consecutiveFailures: 0,
      errorClass: cls,
      lastError: o.error ? o.error.slice(0, 300) : null, // partial problems (e.g. some symbols invalid) stay visible
      rateLimitedUntil: null,
      nextAttemptAfter: null,
      lastValidObservationAt: lastValid,
      lastItems: o.items ?? 0,
    };
  }
  const fails = prev.consecutiveFailures + 1;
  const rl = o.errorClass === "rate_limited" ? new Date(now + rateLimitCooldownMs).toISOString() : prev.rateLimitedUntil;
  const br = breakerDelayMs(fails);
  const nextAfter = Math.max(rl ? Date.parse(rl) : 0, br ? now + br : 0);
  return {
    ...s,
    status: fails >= 3 ? "failing" : "degraded",
    lastFailureAt: nowIso,
    consecutiveFailures: fails,
    errorClass: o.errorClass,
    lastError: (o.error ?? "").slice(0, 300) || null,
    rateLimitedUntil: rl,
    nextAttemptAfter: nextAfter > now ? new Date(nextAfter).toISOString() : null,
    lastItems: o.items ?? null,
  };
}

/** Should we skip calling this source now (rate-limit cooldown or circuit-breaker back-off)? */
export function shouldSkip(state: HealthState | null, nowIso: string): { skip: boolean; reason?: string } {
  if (!state?.nextAttemptAfter) return { skip: false };
  if (Date.parse(state.nextAttemptAfter) > Date.parse(nowIso)) {
    return {
      skip: true,
      reason: state.errorClass === "rate_limited" ? `rate-limited until ${state.nextAttemptAfter}` : `back-off after ${state.consecutiveFailures} failures until ${state.nextAttemptAfter}`,
    };
  }
  return { skip: false };
}

/** Data age in ms of the last valid observation (null when never observed). */
export function dataAgeMs(state: HealthState, nowIso: string): number | null {
  return state.lastValidObservationAt ? Date.parse(nowIso) - Date.parse(state.lastValidObservationAt) : null;
}
