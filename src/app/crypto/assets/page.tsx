import Link from "next/link";
import { queryInstruments } from "@/lib/instruments/store";
import { cryptoTier, fmtCompact, fmtPrice, fmtPct } from "@/lib/crypto/format";
import { CryptoHeader } from "@/components/crypto/CryptoHeader";

export const dynamic = "force-dynamic";

export default function CryptoAssetsPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string; sort?: string; dir?: string };
}) {
  const page = Math.max(1, Number(searchParams.page || 1) || 1);
  const sort = searchParams.sort || "rank";
  const dir = searchParams.dir === "desc" ? "desc" : searchParams.dir === "asc" ? "asc" : sort === "rank" || sort === "name" ? "asc" : "desc";
  const q = searchParams.q || "";
  const result = queryInstruments({
    q,
    asset_type: "crypto",
    sort,
    dir,
    page,
    pageSize: 50,
  });
  const qs = (nextPage: number) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    p.set("sort", sort);
    p.set("dir", dir);
    p.set("page", String(nextPage));
    return `/crypto/assets?${p.toString()}`;
  };

  return (
    <div className="space-y-3">
      <CryptoHeader title="Crypto assets">
          Server-paged instruments with asset_type crypto. {result.total.toLocaleString("en-US")} rows. Missing numbers stay Not available.
        </CryptoHeader>
      <form className="flex flex-wrap gap-2 text-xs" action="/crypto/assets">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search symbol or name"
          className="bg-terminal-surface border border-terminal-border rounded px-2 py-1"
        />
        <select name="sort" defaultValue={sort} className="bg-terminal-surface border border-terminal-border rounded px-2 py-1">
          <option value="rank">Rank</option>
          <option value="market_cap">Market cap</option>
          <option value="volume">Volume</option>
          <option value="change_24h">24h change</option>
          <option value="name">Name</option>
        </select>
        <select name="dir" defaultValue={dir} className="bg-terminal-surface border border-terminal-border rounded px-2 py-1">
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
        <button className="px-2 py-1 border border-terminal-border rounded" type="submit">Apply</button>
      </form>
      <div className="overflow-x-auto border border-terminal-border rounded">
        <table className="w-full text-xs">
          <thead className="text-2xs uppercase text-terminal-muted bg-terminal-surface">
            <tr>
              <th className="text-left p-2">Name</th>
              <th className="text-left p-2">Tier</th>
              <th className="text-right p-2">Rank</th>
              <th className="text-right p-2">Price</th>
              <th className="text-right p-2">Market cap</th>
              <th className="text-right p-2">24h</th>
              <th className="text-left p-2">Quote</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((row) => (
              <tr key={row.id} className="border-t border-terminal-border">
                <td className="p-2">
                  <Link className="text-terminal-teal" href={`/crypto/${encodeURIComponent(row.id)}`}>
                    {row.name}
                  </Link>
                  <div className="text-2xs text-terminal-muted">{row.symbol} · {row.data_source}</div>
                </td>
                <td className="p-2">{cryptoTier(row)}</td>
                <td className="p-2 text-right">{row.rank ?? "Unknown"}</td>
                <td className="p-2 text-right">{fmtPrice(row.price)}</td>
                <td className="p-2 text-right">{fmtCompact(row.market_cap)}</td>
                <td className="p-2 text-right">{fmtPct(row.change_24h_pct)}</td>
                <td className="p-2">{row.quote_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3 text-xs">
        {page > 1 ? <Link className="text-terminal-teal" href={qs(page - 1)}>Previous</Link> : <span className="text-terminal-muted">Previous</span>}
        <span className="text-terminal-muted">Page {result.page}</span>
        {result.nextCursor ? <Link className="text-terminal-teal" href={qs(page + 1)}>Next</Link> : <span className="text-terminal-muted">Next</span>}
      </div>
    </div>
  );
}
