/**
 * Scheduler runner — decides which jobs are due from Europe/Zurich wall clock.
 * Idempotent: respects last-run meta. Lock prevents overlapping ticks.
 */
import { getMeta, setMeta, getDb } from "../db";
import {
  JOB_NAMES,
  type JobName,
  getAllLastRuns,
  getLastRun,
  runNamedJob,
  isHighImpactFired,
  META_CRYPTO_RETRY,
  type JobRunResult,
} from "./jobs";

export const META_ENABLED = "scheduler.enabled";
export const META_LOCK = "scheduler.lock";
export const META_LAST_TICK = "scheduler.lastTick";
export const META_LAST_SUMMARY = "scheduler.lastSummary";

/** Intervals (ms) */
export const INTERVALS = {
  marketsFastMs: 10 * 60 * 1000, // ~10 min during session
  eventsWeekdayMs: 20 * 60 * 1000, // ~20 min weekdays
  eventsWeekendMs: 60 * 60 * 1000, // hourly weekends
  marketsSlowMs: 60 * 60 * 1000, // hourly off-hours
  cryptoMs: 6 * 60 * 60 * 1000, // crypto intelligence sync every ~6 h (CoinGecko free tier)
  cryptoRetryMs: 60 * 60 * 1000, // bounded retry after a failed / rate-limited crypto run
  lockStaleMs: 15 * 60 * 1000, // abandon stuck lock after 15 min
} as const;

/** Fast market window: weekdays 08:00–22:00 Europe/Zurich */
export const SESSION = {
  tz: "Europe/Zurich",
  startHour: 8,
  endHour: 22, // exclusive end → last fast window hour is 21:xx
  maintenanceHour: 6, // once in the 06:00 hour Zurich
} as const;

export interface ZurichParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 1=Mon … 7=Sun (ISO)
  isoDate: string; // YYYY-MM-DD in Zurich
}

export function zurichNow(d = new Date()): ZurichParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: SESSION.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayMap[parts.weekday] ?? 1,
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function isWeekday(z: ZurichParts): boolean {
  return z.weekday >= 1 && z.weekday <= 5;
}

/** Weekday 08:00 inclusive … 22:00 exclusive */
export function inFastSession(z: ZurichParts): boolean {
  return isWeekday(z) && z.hour >= SESSION.startHour && z.hour < SESSION.endHour;
}

function msSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return nowMs - t;
}

function dueByInterval(lastIso: string | null, intervalMs: number, nowMs: number): boolean {
  const age = msSince(lastIso, nowMs);
  if (age == null) return true;
  return age >= intervalMs;
}

/**
 * Env opt-in (B2 get-fix P6): automation is OFF unless CALIBRA_SCHEDULER is "1" / "true" / "on".
 * Unset, "0", "false", "off" or anything else -> not allowed: the in-process loop is not armed at boot and
 * guarded job triggers answer 409 unless ?force=1. The soft toggle (meta scheduler.enabled) applies on top.
 */
export function isEnvSchedulerAllowed(): boolean {
  const v = (process.env.CALIBRA_SCHEDULER ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

/** True when the in-process loop has actually been armed in THIS process (independent of the enabled setting). */
export function isSchedulerStarted(): boolean {
  return globalThis.__calibraSchedulerStarted === true;
}

export function isSchedulerEnabled(): boolean {
  if (!isEnvSchedulerAllowed()) return false;
  const soft = getMeta(META_ENABLED);
  if (soft === "0" || soft === "false") return false;
  // default on when unset
  return true;
}

export function setSchedulerEnabled(enabled: boolean) {
  setMeta(META_ENABLED, enabled ? "1" : "0");
}

export function tryAcquireLock(now = new Date()): boolean {
  getDb();
  const existing = getMeta(META_LOCK);
  if (existing) {
    const age = Date.now() - new Date(existing).getTime();
    if (Number.isFinite(age) && age >= 0 && age < INTERVALS.lockStaleMs) {
      return false;
    }
  }
  setMeta(META_LOCK, now.toISOString());
  return true;
}

export function releaseLock() {
  setMeta(META_LOCK, "");
}

export interface DueDecision {
  due: JobName[];
  skipped: { job: JobName; reason: string }[];
  zurich: ZurichParts;
  inFastSession: boolean;
}

export function decideDueJobs(now = new Date()): DueDecision {
  const z = zurichNow(now);
  const nowMs = now.getTime();
  const fast = inFastSession(z);
  const due: JobName[] = [];
  const skipped: { job: JobName; reason: string }[] = [];

  // daily-maintenance: once in the Zurich morning hour (06:xx), if not yet today
  {
    const last = getLastRun("daily-maintenance");
    const lastZ = last ? zurichNow(new Date(last)) : null;
    const alreadyToday = lastZ?.isoDate === z.isoDate;
    if (z.hour === SESSION.maintenanceHour && !alreadyToday) {
      due.push("daily-maintenance");
    } else {
      skipped.push({
        job: "daily-maintenance",
        reason: alreadyToday
          ? `already ran ${lastZ?.isoDate}`
          : `waits for Zurich ${String(SESSION.maintenanceHour).padStart(2, "0")}:00 (now ${z.hour}:${String(z.minute).padStart(2, "0")})`,
      });
    }
  }

  // markets-fast XOR markets-slow
  if (fast) {
    if (dueByInterval(getLastRun("markets-fast"), INTERVALS.marketsFastMs, nowMs)) {
      due.push("markets-fast");
    } else {
      skipped.push({
        job: "markets-fast",
        reason: `last ${getLastRun("markets-fast")} < ${INTERVALS.marketsFastMs / 60000}m ago`,
      });
    }
    skipped.push({ job: "markets-slow", reason: "inside fast session 08–22 Zurich weekday" });
  } else {
    if (dueByInterval(getLastRun("markets-slow"), INTERVALS.marketsSlowMs, nowMs)) {
      due.push("markets-slow");
    } else {
      skipped.push({
        job: "markets-slow",
        reason: `last ${getLastRun("markets-slow")} < ${INTERVALS.marketsSlowMs / 60000}m ago`,
      });
    }
    skipped.push({
      job: "markets-fast",
      reason: isWeekday(z)
        ? "outside 08–22 Zurich weekday window"
        : "weekend — use markets-slow",
    });
  }

  // events
  {
    const interval = isWeekday(z) ? INTERVALS.eventsWeekdayMs : INTERVALS.eventsWeekendMs;
    if (dueByInterval(getLastRun("events"), interval, nowMs)) {
      due.push("events");
    } else {
      skipped.push({
        job: "events",
        reason: `last ${getLastRun("events")} < ${interval / 60000}m ago (${isWeekday(z) ? "weekday" : "weekend"})`,
      });
    }
  }

  // crypto: every ~6 h; after a failed/rate-limited run, a bounded number of ~1 h retries
  {
    const interval = cryptoInterval();
    if (dueByInterval(getLastRun("crypto"), interval, nowMs)) {
      due.push("crypto");
    } else {
      skipped.push({ job: "crypto", reason: `last ${getLastRun("crypto")} < ${interval / 60000}m ago` });
    }
  }

  // derive is decided after markets/events actually change in the tick — placeholder skip for status
  skipped.push({
    job: "derive",
    reason: "conditional: runs only after markets and/or events change in a tick",
  });

  return { due, skipped, zurich: z, inFastSession: fast };
}

export function cryptoInterval(): number {
  const retry = Number(getMeta(META_CRYPTO_RETRY) || 0) || 0;
  return retry > 0 ? INTERVALS.cryptoRetryMs : INTERVALS.cryptoMs;
}

export function nextDueEstimate(now = new Date()): Record<JobName, string | null> {
  const z = zurichNow(now);
  const out = {} as Record<JobName, string | null>;

  const add = (job: JobName, last: string | null, intervalMs: number) => {
    if (!last) {
      out[job] = now.toISOString();
      return;
    }
    const next = new Date(new Date(last).getTime() + intervalMs);
    out[job] = next.toISOString();
  };

  const fast = inFastSession(z);
  if (fast) {
    add("markets-fast", getLastRun("markets-fast"), INTERVALS.marketsFastMs);
    out["markets-slow"] = null; // not applicable in session
  } else {
    add("markets-slow", getLastRun("markets-slow"), INTERVALS.marketsSlowMs);
    // next fast session open: next weekday 08:00 Zurich
    out["markets-fast"] = nextZurichSessionOpen(now).toISOString();
  }

  add(
    "events",
    getLastRun("events"),
    isWeekday(z) ? INTERVALS.eventsWeekdayMs : INTERVALS.eventsWeekendMs
  );

  out.derive = null; // conditional
  add("crypto", getLastRun("crypto"), cryptoInterval());

  // next maintenance: today 06:00 if still ahead and not run; else tomorrow 06:00
  out["daily-maintenance"] = nextMaintenanceAt(now).toISOString();

  return out;
}

/** Next weekday 08:00 Europe/Zurich (minute-level scan, ≤8 days). */
function nextZurichSessionOpen(now: Date): Date {
  const start = new Date(now.getTime());
  start.setUTCSeconds(0, 0);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    const probe = new Date(start.getTime() + i * 60 * 1000);
    const z = zurichNow(probe);
    if (isWeekday(z) && z.hour === SESSION.startHour && z.minute === 0) {
      if (probe.getTime() >= now.getTime()) return probe;
    }
  }
  return new Date(now.getTime() + 12 * 60 * 60 * 1000);
}

/** Next Zurich 06:00 maintenance slot not already consumed today. */
function nextMaintenanceAt(now: Date): Date {
  const z = zurichNow(now);
  const last = getLastRun("daily-maintenance");
  const lastZ = last ? zurichNow(new Date(last)) : null;
  const alreadyToday = lastZ?.isoDate === z.isoDate;
  const start = new Date(now.getTime());
  start.setUTCSeconds(0, 0);
  for (let i = 0; i < 48 * 60; i++) {
    const probe = new Date(start.getTime() + i * 60 * 1000);
    const pz = zurichNow(probe);
    if (pz.hour === SESSION.maintenanceHour && pz.minute === 0) {
      if (pz.isoDate === z.isoDate && alreadyToday) continue;
      if (probe.getTime() < now.getTime()) continue;
      return probe;
    }
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

export interface TickResult {
  ran: string[];
  skipped: string[];
  quality: string;
  firedAlerts: number;
  noteworthy: boolean;
  summary: string;
  details: {
    zurich: ZurichParts;
    inFastSession: boolean;
    jobResults: JobRunResult[];
    skipReasons: { job: JobName; reason: string }[];
    noteworthyReasons: string[];
    priorQuality: string | null;
    enabled: boolean;
    locked: boolean;
  };
}

export async function runSchedulerTick(opts?: { force?: boolean }): Promise<TickResult> {
  getDb();
  const enabled = isSchedulerEnabled();
  if (!enabled && !opts?.force) {
    return {
      ran: [],
      skipped: [...JOB_NAMES],
      quality: getMeta("dataQuality") || "insufficient",
      firedAlerts: 0,
      noteworthy: false,
      summary: "Scheduler disabled (CALIBRA_SCHEDULER not set to 1, or UI toggle off)",
      details: {
        zurich: zurichNow(),
        inFastSession: inFastSession(zurichNow()),
        jobResults: [],
        skipReasons: JOB_NAMES.map((j) => ({ job: j, reason: "scheduler disabled" })),
        noteworthyReasons: [],
        priorQuality: getMeta("dataQuality"),
        enabled: false,
        locked: false,
      },
    };
  }

  if (!tryAcquireLock()) {
    return {
      ran: [],
      skipped: [...JOB_NAMES],
      quality: getMeta("dataQuality") || "insufficient",
      firedAlerts: 0,
      noteworthy: false,
      summary: "Skipped — another tick holds the lock",
      details: {
        zurich: zurichNow(),
        inFastSession: inFastSession(zurichNow()),
        jobResults: [],
        skipReasons: JOB_NAMES.map((j) => ({ job: j, reason: "lock held" })),
        noteworthyReasons: [],
        priorQuality: getMeta("dataQuality"),
        enabled: true,
        locked: true,
      },
    };
  }

  const priorQuality = getMeta("dataQuality");
  const noteworthyReasons: string[] = [];
  const jobResults: JobRunResult[] = [];
  const ran: string[] = [];
  let marketsOrEventsChanged = false;
  let firedAlerts = 0;

  try {
    const decision = decideDueJobs();
    const skipReasons = [...decision.skipped];

    // Run non-derive due jobs in a stable order
    const order: JobName[] = ["daily-maintenance", "markets-fast", "markets-slow", "events"];
    for (const job of order) {
      if (!decision.due.includes(job)) continue;
      const result = await runNamedJob(job);
      jobResults.push(result);
      ran.push(job);
      if ((job === "markets-fast" || job === "markets-slow" || job === "events") && result.changed) {
        marketsOrEventsChanged = true;
      }
      if (result.errors.length) {
        noteworthyReasons.push(`${job} errors: ${result.errors.join("; ")}`);
      }
    }

    // derive only if markets and/or events changed this tick
    if (marketsOrEventsChanged) {
      // remove the placeholder skip reason for derive
      const idx = skipReasons.findIndex((s) => s.job === "derive");
      if (idx >= 0) skipReasons.splice(idx, 1);
      const result = await runNamedJob("derive");
      jobResults.push(result);
      ran.push("derive");
      firedAlerts = result.firedAlertDetails?.length ?? 0;
      if (result.errors.length) {
        noteworthyReasons.push(`derive errors: ${result.errors.join("; ")}`);
      }
      for (const fa of result.firedAlertDetails ?? []) {
        if (isHighImpactFired(fa)) {
          noteworthyReasons.push(`high-impact alert: ${fa.message}`);
        }
      }
    }

    // crypto runs last (slow, paced external calls) and never triggers derive.
    // Its errors are recorded in its own meta + source health, not as tick-level noteworthy reasons.
    if (decision.due.includes("crypto")) {
      const result = await runNamedJob("crypto");
      jobResults.push(result);
      ran.push("crypto");
    }

    const quality = getMeta("dataQuality") || "insufficient";
    if (priorQuality === "live" && quality !== "live") {
      noteworthyReasons.push(`dataQuality degraded: live → ${quality}`);
    }

    const skippedJobs = JOB_NAMES.filter((j) => !ran.includes(j));
    const noteworthy = noteworthyReasons.length > 0;
    const summary =
      ran.length === 0
        ? `Idle — nothing due (Zurich ${decision.zurich.isoDate} ${String(decision.zurich.hour).padStart(2, "0")}:${String(decision.zurich.minute).padStart(2, "0")}, ${decision.inFastSession ? "session" : "off-hours"})`
        : `Ran [${ran.join(", ")}] — quality=${quality}` +
          (firedAlerts ? `, firedAlerts=${firedAlerts}` : "") +
          (noteworthy ? ` [NOTEWORTHY: ${noteworthyReasons.join(" | ")}]` : "");

    const tick: TickResult = {
      ran,
      skipped: skippedJobs,
      quality,
      firedAlerts,
      noteworthy,
      summary,
      details: {
        zurich: decision.zurich,
        inFastSession: decision.inFastSession,
        jobResults,
        skipReasons,
        noteworthyReasons,
        priorQuality,
        enabled: true,
        locked: false,
      },
    };

    setMeta(META_LAST_TICK, new Date().toISOString());
    setMeta(
      META_LAST_SUMMARY,
      JSON.stringify({
        at: new Date().toISOString(),
        ran: tick.ran,
        skipped: tick.skipped,
        quality: tick.quality,
        firedAlerts: tick.firedAlerts,
        noteworthy: tick.noteworthy,
        summary: tick.summary,
      })
    );

    return tick;
  } finally {
    releaseLock();
  }
}

export function getSchedulerStatus() {
  getDb();
  const z = zurichNow();
  const decision = decideDueJobs();
  return {
    /** Configuration: env opt-in AND soft toggle. Does not mean the loop is running. */
    enabled: isSchedulerEnabled(),
    /** Runtime: the in-process loop is armed in this server process. */
    started: isSchedulerStarted(),
    envAllowed: isEnvSchedulerAllowed(),
    envOptIn: "CALIBRA_SCHEDULER=1 arms the loop at boot (default off)",
    softEnabled: getMeta(META_ENABLED) !== "0" && getMeta(META_ENABLED) !== "false",
    zurichNow: {
      ...z,
      label: `${z.isoDate} ${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}:${String(z.second).padStart(2, "0")} Europe/Zurich`,
    },
    inFastSession: inFastSession(z),
    sessionWindow: "weekdays 08:00–22:00 Europe/Zurich",
    intervals: {
      "markets-fast": "~10 min (session)",
      "markets-slow": "~60 min (off-hours / weekend)",
      events: isWeekday(z) ? "~20 min (weekday)" : "~60 min (weekend)",
      derive: "after markets/events change in a tick",
      "daily-maintenance": `once at Zurich ${String(SESSION.maintenanceHour).padStart(2, "0")}:xx`,
      crypto: "~6 h (≤2 retries after ~1 h on failure / CoinGecko 429)",
    },
    lastRuns: getAllLastRuns(),
    nextDue: nextDueEstimate(),
    currentlyDue: decision.due,
    skipPreview: decision.skipped,
    lastTick: getMeta(META_LAST_TICK),
    lastSummary: (() => {
      try {
        const raw = getMeta(META_LAST_SUMMARY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    })(),
    lock: getMeta(META_LOCK) || null,
    dataQuality: getMeta("dataQuality"),
    lastMarketUpdate: getMeta("lastMarketUpdate"),
    lastEventUpdate: getMeta("lastEventUpdate"),
    noteworthyDefinition: {
      dataQualityDegradedFromLive: true,
      refreshErrors: true,
      highImpactAlertMetrics: ["high_impact_event", "risk_gauge", "vix_level"],
      highImpactEventCompositeThreshold: 70,
    },
  };
}
