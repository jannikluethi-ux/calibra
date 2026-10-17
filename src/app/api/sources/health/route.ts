import { NextResponse } from "next/server";
import { listSourceHealth } from "@/lib/sources/health";

export const dynamic = "force-dynamic";

/** Read-only source-health registry (status, last success, data age, failures, rate limits, error class). */
export async function GET() {
  return NextResponse.json({ generatedAt: new Date().toISOString(), sources: listSourceHealth() });
}
