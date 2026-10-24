import { NextResponse } from "next/server";
import { getInstrument } from "@/lib/instruments/store";
import { getCachedSeries, prefetchSeries } from "@/lib/instruments/series-cache";
import { runGuardedJob } from "@/lib/security/job-guard";

export const dynamic = "force-dynamic";

function decodeId(id: string) {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/** Read-only: serves the stored series; never contacts a provider (B2 get-fix P2). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const inst = getInstrument(decodeId(params.id));
  if (!inst) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const range = new URL(req.url).searchParams.get("range") || "1M";
  return NextResponse.json(getCachedSeries(inst.id, range));
}

/**
 * Prefetch job — guarded: Bearer $CALIBRA_JOB_TOKEN, automation switch (?force=1), single-flight + minimum interval
 * per (instrument, range), cache TTL, provider gap and timeout. Provider errors -> 503 (cache untouched).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const id = decodeId(params.id);
  const range = new URL(req.url).searchParams.get("range") || "1M";
  return runGuardedJob(req, `series-prefetch:${id}:${range}`, async () => {
    const inst = getInstrument(id);
    if (!inst) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const out = await prefetchSeries(inst, range);
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (out.status === 429 && "retryAfterS" in out.body && out.body.retryAfterS) headers["Retry-After"] = String(out.body.retryAfterS);
    return NextResponse.json(out.body, { status: out.status, headers });
  });
}
