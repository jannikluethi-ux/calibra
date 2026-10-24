import Link from "next/link";
import { getCountries } from "@/lib/countries/profiles";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { CountriesSearch } from "@/components/countries/Search";
import { AwaitingFirstRun } from "@/components/ui/AwaitingFirstRun";

export const dynamic = "force-dynamic";

export default function CountriesPage() {
  const countries = getCountries();

  return (
    <div className="space-y-3">
      {!countries.length && <AwaitingFirstRun what="country profiles" />}
      <div>
        <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">Country Intelligence</h1>
        <p className="text-2xs text-terminal-muted mt-0.5">
          G20 + Switzerland + major EM. Macro fields use last-known public figures with date + source labels, or &quot;insufficient evidence&quot;.
        </p>
      </div>
      <CountriesSearch countries={countries.map((c) => ({ code: c.code, name: c.name, region: c.region, isG20: c.isG20 }))} />
      <Panel title={`${countries.length} profiles`}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {countries.map((c) => (
            <Link
              key={c.code}
              href={`/countries/${c.code}`}
              className="border border-terminal-border rounded p-2 bg-terminal-surface hover:border-terminal-accent/60"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">{c.code}</span>
                <span className="text-xs">{c.name}</span>
                {c.isG20 && <Badge tone="blue">G20</Badge>}
              </div>
              <div className="text-2xs text-terminal-muted mt-1">{c.region}</div>
              <div className="text-2xs text-terminal-dim mt-1 line-clamp-2">{c.marketImpact}</div>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}
