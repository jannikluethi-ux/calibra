import { NextResponse } from "next/server";
import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getSchedulerStatus, setSchedulerEnabled, isEnvSchedulerAllowed } from "@/lib/scheduler/runner";
import { startScheduler } from "@/lib/scheduler/boot";

export const dynamic = "force-dynamic";

/** GET /api/scheduler/status — next due, last runs, enabled flag */
export async function GET() {
  ensureSeedData();
  startScheduler();
  return NextResponse.json(getSchedulerStatus());
}

/**
 * PATCH /api/scheduler/status — soft enable/disable (persisted in SQLite).
 * Body: { enabled: boolean }. Env CALIBRA_SCHEDULER=0 always wins for auto-loop.
 */
export async function PATCH(req: Request) {
  ensureSeedData();
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
  setSchedulerEnabled(body.enabled);
  if (body.enabled) startScheduler();
  return NextResponse.json(getSchedulerStatus());
}
