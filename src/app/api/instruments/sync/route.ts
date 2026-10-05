import { NextResponse } from "next/server";
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

export async function POST() {
  const summary = await runInstrumentSync();
  const status = summary.status === "error" && summary.error === "sync already running" ? 409 : 200;
  return NextResponse.json(summary, { status });
}
