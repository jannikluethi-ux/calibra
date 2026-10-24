/**
 * In-process scheduler loop. Calls tick decision every ~60s while the Next
 * server is up. Does NOT pull Yahoo every 60s — only when jobs are due.
 *
 * Opt-in (B2 get-fix): armed at boot only when CALIBRA_SCHEDULER=1 (default OFF in dev & prod).
 * Soft disable via meta / UI still respected inside runSchedulerTick.
 */
import { isEnvSchedulerAllowed, runSchedulerTick } from "./runner";

const TICK_MS = 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __calibraSchedulerStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __calibraSchedulerTimer: ReturnType<typeof setInterval> | undefined;
}

export function startScheduler(): void {
  if (typeof globalThis === "undefined") return;
  if (globalThis.__calibraSchedulerStarted) return;
  if (!isEnvSchedulerAllowed()) {
    console.info("[calibra-scheduler] not armed (opt-in: set CALIBRA_SCHEDULER=1 and restart)");
    return;
  }

  globalThis.__calibraSchedulerStarted = true;
  console.info(
    `[calibra-scheduler] starting (interval ${TICK_MS / 1000}s). Opt-in via CALIBRA_SCHEDULER=1; unset to disable`
  );

  // First tick after a short delay so boot isn't blocked by Yahoo
  const kick = () => {
    runSchedulerTick().catch((e) => {
      console.error("[calibra-scheduler] tick error", e);
    });
  };
  setTimeout(kick, 8_000);

  globalThis.__calibraSchedulerTimer = setInterval(kick, TICK_MS);
  // Don't keep the process alive solely because of the timer in some runtimes
  if (typeof globalThis.__calibraSchedulerTimer === "object" && "unref" in globalThis.__calibraSchedulerTimer) {
    try {
      (globalThis.__calibraSchedulerTimer as NodeJS.Timeout).unref?.();
    } catch {
      /* ignore */
    }
  }
}

export function stopScheduler(): void {
  if (globalThis.__calibraSchedulerTimer) {
    clearInterval(globalThis.__calibraSchedulerTimer);
    globalThis.__calibraSchedulerTimer = undefined;
  }
  globalThis.__calibraSchedulerStarted = false;
}
