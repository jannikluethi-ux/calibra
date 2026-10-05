import { NextResponse } from "next/server";
import { getResearch } from "@/lib/crypto/research";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ found: false, error: "id required" }, { status: 400 });
  return NextResponse.json(getResearch(id));
}
