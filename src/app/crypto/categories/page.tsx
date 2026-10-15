import Link from "next/link";
import { getDb } from "@/lib/db";
import { prepareCryptoStore } from "@/lib/sources/prepare";
import { Panel } from "@/components/ui/Panel";
import { CryptoHeader } from "@/components/crypto/CryptoHeader";

export const dynamic = "force-dynamic";

export default function CryptoCategoriesPage() {
  prepareCryptoStore();
  const rows = getDb()
    .prepare(
      `SELECT o.instrument_id, o.value_json
       FROM source_observations o
       JOIN sources s ON s.id = o.source_id AND s.enabled = 1
       WHERE o.field = 'categories' AND o.instrument_id IS NOT NULL
       ORDER BY o.retrieved_at DESC`
    )
    .all() as { instrument_id: string; value_json: string }[];

  const latest = new Map<string, string[]>();
  for (const row of rows) {
    if (latest.has(row.instrument_id)) continue;
    const parsed = JSON.parse(row.value_json) as unknown;
    if (Array.isArray(parsed)) {
      latest.set(
        row.instrument_id,
        parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      );
    }
  }
  const counts = new Map<string, number>();
  for (const cats of Array.from(latest.values())) {
    for (const cat of Array.from(new Set(cats))) counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  const list = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return (
    <div className="space-y-3 max-w-3xl">
      <CryptoHeader title="Categories">
          Categories come only from stored observations. Coins with a sourced category list: {latest.size}.
        </CryptoHeader>
      {list.length === 0 ? (
        <Panel title="Empty">
          <p className="text-xs text-terminal-dim">
            No category observations are stored. Count: 0. This page does not invent a layer list.
          </p>
        </Panel>
      ) : (
        <Panel title="Stored categories">
          <table className="w-full text-xs">
            <thead className="text-2xs uppercase text-terminal-muted">
              <tr>
                <th className="text-left py-1">Category</th>
                <th className="text-right py-1">Coins</th>
              </tr>
            </thead>
            <tbody>
              {list.map(([name, count]) => (
                <tr key={name} className="border-t border-terminal-border">
                  <td className="py-1">{name}</td>
                  <td className="py-1 text-right">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-2xs text-terminal-muted mt-2">
            These strings are whatever the provider returned for the coins that were fetched. They are reported claims.
          </p>
        </Panel>
      )}
      <Link className="text-2xs text-terminal-teal" href="/crypto/coverage">Coverage</Link>
    </div>
  );
}
