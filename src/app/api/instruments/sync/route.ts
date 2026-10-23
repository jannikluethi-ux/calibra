import { NextResponse } from "next/server";
import { runGuardedJob } from "@/lib/security/job-guard";
import { latestSyncRun } from "@/lib/instruments/store";
import { runInstrumentSync } from "@/lib/instruments/sync";

export const dynamic = "force-dynamic";

export async function GET() {
  const row = latestSyncRun();
  if (!row) return NextResponse.json({ sync: null });
  let detail: unknown = null;
  try {
    detail = row.detail ? JSON.parse(row.detail) : null;
  } catch {
    detail = row.detail;
  }
  return NextResponse.json({ sync: { ...row, detail } });
}

/** Job trigger — guarded: Bearer $CALIBRA_JOB_TOKEN (see lib/security/job-guard). */
export async function POST(req: Request) {
  return runGuardedJob(req, "instrument-sync", async () => {
    const summary = await runInstrumentSync();
    const status = summary.status === "error" && summary.error === "sync already running" ? 409 : 200;
    return NextResponse.json(summary, { status });
  });
}
