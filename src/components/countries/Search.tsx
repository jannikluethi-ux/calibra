"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export function CountriesSearch({
  countries,
}: {
  countries: { code: string; name: string; region: string; isG20: boolean }[];
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return countries.filter(
      (c) =>
        c.code.toLowerCase().includes(s) ||
        c.name.toLowerCase().includes(s) ||
        c.region.toLowerCase().includes(s)
    );
  }, [q, countries]);

  return (
    <div className="panel p-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search country code, name, region…"
        className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs outline-none focus:border-terminal-accent"
      />
      {filtered.length > 0 && (
        <div className="mt-2 space-y-1">
          {filtered.map((c) => (
            <Link key={c.code} href={`/countries/${c.code}`} className="block text-xs text-terminal-accent hover:underline">
              {c.code} — {c.name} ({c.region})
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
