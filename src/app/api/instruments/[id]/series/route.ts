import { NextResponse } from "next/server";
import { getInstrument } from "@/lib/instruments/store";
import { loadSeries } from "@/lib/instruments/series";

export const dynamic = "force-dynamic";

function decodeId(id: string) {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const inst = getInstrument(decodeId(params.id));
  if (!inst) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const range = new URL(req.url).searchParams.get("range") || "1M";
  const series = await loadSeries(inst, range);
  return NextResponse.json(series);
}
