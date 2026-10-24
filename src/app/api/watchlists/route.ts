import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createWatchlist, listWatchlists } from "@/lib/instruments/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });
  return NextResponse.json({ items: listWatchlists(user.id) });
}

export async function POST(req: Request) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const watchlist = createWatchlist(user.id, name);
  return NextResponse.json({ watchlist });
}
