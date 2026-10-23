import { NextResponse } from "next/server";
import { runGuardedJob } from "@/lib/security/job-guard";
import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getSchedulerStatus, setSchedulerEnabled, isEnvSchedulerAllowed } from "@/lib/scheduler/runner";
import { startScheduler } from "@/lib/scheduler/boot";

export const dynamic = "force-dynamic";

/**
 * GET /api/scheduler/status — next due, last runs, enabled flag.
 * Read-only (B2.2): no seeding, does not (re-)arm the in-process loop (that happens at boot in
 * src/instrumentation.ts or via the token-guarded PATCH/tick). Also used as the health probe by
 * scripts/ensure-prod.sh and scripts/uptime-check.sh.
 */
export async function GET() {
  return NextResponse.json(getSchedulerStatus());
}

/**
 * PATCH /api/scheduler/status — soft enable/disable (persisted in SQLite).
 * Body: { enabled: boolean }. Env CALIBRA_SCHEDULER=0 always wins for auto-loop.
 * Requires `Authorization: Bearer $CALIBRA_JOB_TOKEN` (see lib/security/job-guard).
 */
export async function PATCH(req: Request) {
  return runGuardedJob(
    req,
    "scheduler-toggle",
    async () => {
      const body = await req.json().catch(() => null);
      if (!body || typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "Body must be { enabled: boolean }" }, { status: 400 });
      }
      if (body.enabled && !isEnvSchedulerAllowed()) {
        return NextResponse.json(
          {
            error: "CALIBRA_SCHEDULER=0 — env hard-disable; unset or set to 1 and restart to enable",
            status: getSchedulerStatus(),
          },
          { status: 409 }
        );
      }
      ensureSeedData();
      setSchedulerEnabled(body.enabled);
      if (body.enabled) startScheduler();
      return NextResponse.json(getSchedulerStatus());
    },
    { respectDisabled: false, minIntervalMs: 0 }
  );
}
