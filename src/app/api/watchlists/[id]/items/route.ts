import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { addWatchlistItem, getWatchlist, removeWatchlistItem, watchlistItems } from "@/lib/instruments/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const wl = getWatchlist(user.id, params.id);
  if (!wl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ watchlist: wl, items: watchlistItems(wl.id) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const wl = getWatchlist(user.id, params.id);
  if (!wl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const instrumentId = String(body.instrumentId || body.instrument_id || "");
  if (!instrumentId) return NextResponse.json({ error: "instrumentId required" }, { status: 400 });
  const result = addWatchlistItem(wl.id, instrumentId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true, instrumentId: result.instrument.id });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const wl = getWatchlist(user.id, params.id);
  if (!wl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const instrumentId = new URL(req.url).searchParams.get("instrumentId") || "";
  if (!instrumentId) return NextResponse.json({ error: "instrumentId required" }, { status: 400 });
  removeWatchlistItem(wl.id, instrumentId);
  return NextResponse.json({ ok: true });
}
