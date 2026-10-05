import { NextResponse } from "next/server";
import { resolveCryptoQuery } from "@/lib/crypto/resolve";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") || "";
  return NextResponse.json(resolveCryptoQuery(q));
}
