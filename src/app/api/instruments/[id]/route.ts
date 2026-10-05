import { NextResponse } from "next/server";
import { getInstrument } from "@/lib/instruments/store";
import { linkedEvents, macroLinks } from "@/lib/instruments/context";
import { seriesSupport } from "@/lib/instruments/series";

export const dynamic = "force-dynamic";

function decodeId(id: string) {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const inst = getInstrument(decodeId(params.id));
  if (!inst) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const events = linkedEvents(inst, 8);
  const macro = macroLinks(inst);
  return NextResponse.json({
    instrument: inst,
    events: events.events.map((e) => ({
      id: e.id,
      title: e.title,
      summary: e.summary,
      publishedAt: e.publishedAt,
      sourceName: e.sourceName,
      citationUrl: e.citationUrl,
      quality: e.quality,
    })),
    eventsNote: events.note,
    macro,
    ranges: seriesSupport(inst),
  });
}
