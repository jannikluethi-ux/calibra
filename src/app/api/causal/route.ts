import { NextResponse } from "next/server";
import { getCausalGraph, persistCausalGraph } from "@/lib/causal/graph";
import { ensureSeedData } from "@/lib/bootstrap/refresh";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureSeedData();
  return NextResponse.json(getCausalGraph());
}

export async function POST() {
  return NextResponse.json(persistCausalGraph());
}
