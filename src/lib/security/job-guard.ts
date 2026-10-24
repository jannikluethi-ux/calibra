/**
 * Shared guard for job-trigger endpoints (fetch / derive / maintenance / scheduler control).
 *
 * - Requires `Authorization: Bearer <CALIBRA_JOB_TOKEN>`; compared in constant time.
 * - Fails closed: if CALIBRA_JOB_TOKEN is unset, blank or shorter than MIN_TOKEN_LENGTH,
 *   every guarded trigger is refused with 503 and nothing runs.
 * - Honours the automation switch: while scheduler.enabled=0 or CALIBRA_SCHEDULER is not 1 (opt-in), an
 *   authorised trigger is refused with 409 unless `?force=1` is passed (opt-out per route).
 * - In-process single-flight per job key (409 while running) and a minimum interval between
 *   accepted runs (CALIBRA_JOB_MIN_INTERVAL_S, default 30 s → 429 + Retry-After).
 *
 * The browser UI cannot hold this secret, so UI buttons that POST to guarded routes get an
 * error response by design. Read-only GET routes are not guarded.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isSchedulerEnabled } from "@/lib/scheduler/runner";

export const JOB_TOKEN_ENV = "CALIBRA_JOB_TOKEN";
export const MIN_TOKEN_LENGTH = 32;
const MAX_HEADER_TOKEN_LENGTH = 1024;
const DEFAULT_MIN_INTERVAL_S = 30;

type GuardState = { running: Set<string>; lastStart: Map<string, number> };

declare global {
  // eslint-disable-next-line no-var
  var __calibraJobGuard: GuardState | undefined;
}

function state(): GuardState {
  if (!globalThis.__calibraJobGuard) {
    globalThis.__calibraJobGuard = { running: new Set(), lastStart: new Map() };
  }
  return globalThis.__calibraJobGuard;
}

/** Test helper: clear in-process single-flight / interval state. */
export function resetJobGuardState(): void {
  globalThis.__calibraJobGuard = { running: new Set(), lastStart: new Map() };
}

function configuredToken(): string | null {
  const t = (process.env[JOB_TOKEN_ENV] ?? "").trim();
  return t.length >= MIN_TOKEN_LENGTH ? t : null;
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/** Constant-time comparison (equal-length sha256 digests, so length is not leaked either). */
export function tokensMatch(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

function minIntervalMs(override?: number): number {
  if (typeof override === "number") return Math.max(0, override);
  const raw = process.env.CALIBRA_JOB_MIN_INTERVAL_S;
  const n = raw === undefined || raw.trim() === "" ? DEFAULT_MIN_INTERVAL_S : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n * 1000 : DEFAULT_MIN_INTERVAL_S * 1000;
}

function deny(status: number, error: string, headers: Record<string, string> = {}): Response {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export type AuthCheck = { ok: true } | { ok: false; response: Response };

/** Token check only (no side effects). */
export function checkJobAuth(req: Request): AuthCheck {
  const expected = configuredToken();
  if (!expected) {
    return {
      ok: false,
      response: deny(503, "Job triggers are disabled on this server (no job token configured)."),
    };
  }
  const header = req.headers.get("authorization");
  if (!header) {
    return { ok: false, response: deny(401, "Missing job token.", { "WWW-Authenticate": "Bearer" }) };
  }
  const m = /^Bearer ([^\s,]+)$/i.exec(header.trim());
  if (!m || m[1].length > MAX_HEADER_TOKEN_LENGTH) {
    return { ok: false, response: deny(401, "Malformed Authorization header.", { "WWW-Authenticate": "Bearer" }) };
  }
  if (!tokensMatch(m[1], expected)) {
    return { ok: false, response: deny(403, "Invalid job token.") };
  }
  return { ok: true };
}

export type GuardOptions = {
  /** Refuse (409) while automation is disabled unless ?force=1. Default true. */
  respectDisabled?: boolean;
  /** Minimum ms between accepted runs of this job key. Default from env / 30 s. */
  minIntervalMs?: number;
};

/**
 * Run `fn` only if the request is authorised and no guard refuses it.
 * Always returns a Response; `fn` is never invoked when refused.
 */
export async function runGuardedJob(
  req: Request,
  job: string,
  fn: () => Promise<Response> | Response,
  opts: GuardOptions = {}
): Promise<Response> {
  const auth = checkJobAuth(req);
  if (!auth.ok) return auth.response;

  if (opts.respectDisabled !== false) {
    const force = new URL(req.url).searchParams.get("force") === "1";
    if (!force && !isSchedulerEnabled()) {
      return deny(
        409,
        "Automation is disabled (scheduler.enabled=0 or CALIBRA_SCHEDULER not set to 1). Add ?force=1 to run this job manually."
      );
    }
  }

  const s = state();
  if (s.running.has(job)) return deny(409, `Job '${job}' is already running.`);
  const interval = minIntervalMs(opts.minIntervalMs);
  const last = s.lastStart.get(job);
  const now = Date.now();
  if (last !== undefined && interval > 0 && now - last < interval) {
    const retry = Math.ceil((interval - (now - last)) / 1000);
    return deny(429, `Job '${job}' ran recently; retry in ${retry}s.`, { "Retry-After": String(retry) });
  }

  s.running.add(job);
  s.lastStart.set(job, now);
  try {
    return await fn();
  } finally {
    s.running.delete(job);
  }
}
