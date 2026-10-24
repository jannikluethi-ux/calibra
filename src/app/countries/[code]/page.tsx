import Link from "next/link";
import { notFound } from "next/navigation";
import { getCountries, getCountry } from "@/lib/countries/profiles";
import { getEvents } from "@/lib/ingestion/rss";
import { Panel } from "@/components/ui/Panel";
import { Badge, QualityBadge } from "@/components/ui/Badge";
import { AwaitingFirstRun } from "@/components/ui/AwaitingFirstRun";

export const dynamic = "force-dynamic";

export default function CountryDetailPage({ params }: { params: { code: string } }) {
  const country = getCountry(params.code);
  if (!country) {
    if (!getCountries().length) return <AwaitingFirstRun what="country profiles" />;
    notFound();
  }
  const events = getEvents(50).filter(
    (e) => e.country === country.code || e.title.toLowerCase().includes(country.name.toLowerCase().slice(0, 5))
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link href="/countries" className="text-2xs text-terminal-accent">
          ← Countries
        </Link>
        <h1 className="text-sm font-semibold">
          {country.code} — {country.name}
        </h1>
        {country.isG20 && <Badge tone="blue">G20</Badge>}
        <Badge>{country.region}</Badge>
      </div>

      <Panel title="Macro fields (labeled sources)">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {Object.entries(country.macro).map(([key, f]) => (
            <div key={key} className="border border-terminal-border rounded p-2 bg-terminal-surface">
              <div className="flex justify-between gap-1">
                <div className="text-2xs text-terminal-dim">{f.label}</div>
                <QualityBadge quality={f.quality} />
              </div>
              <div className="num text-sm mt-1">
                {f.value == null ? "Insufficient evidence" : `${f.value}${f.unit ? ` ${f.unit}` : ""}`}
              </div>
              <div className="text-2xs text-terminal-muted mt-1">
                asOf={f.asOf || "—"} · {f.source || "—"}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Panel title="Political">{country.political}</Panel>
        <Panel title="Regulatory">{country.regulatory}</Panel>
        <Panel title="Market impact">{country.marketImpact}</Panel>
      </div>

      <Panel title="Related events in store">
        {events.length ? (
          <ul className="space-y-1 text-xs">
            {events.slice(0, 10).map((e) => (
              <li key={e.id} className="flex gap-2">
                <QualityBadge quality={e.quality} />
                <span>{e.title}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-terminal-amber text-xs">No matching events in current store.</div>
        )}
      </Panel>
    </div>
  );
}
