import { NextResponse } from "next/server";
import { runWhatIf } from "@/lib/simulator/whatif";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const hypothesis = typeof body.hypothesis === "string" ? body.hypothesis : "";
  return NextResponse.json(runWhatIf(hypothesis));
}
