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
      <form className="flex flex-wrap gap-2 text-sm" action="/crypto/assets">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search symbol or name"
          className="form-control max-w-xs"
        />
        <select name="sort" defaultValue={sort} className="form-control w-auto">
          <option value="rank">Rank</option>
          <option value="market_cap">Market cap</option>
          <option value="volume">Volume</option>
          <option value="change_24h">24h change</option>
          <option value="name">Name</option>
        </select>
        <select name="dir" defaultValue={dir} className="form-control w-auto">
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-caption uppercase tracking-wider text-ink-3 bg-surface-1">
            <tr>
              <th className="text-left py-2.5 px-3">Name</th>
              <th className="text-left py-2.5 px-3">Tier</th>
              <th className="text-right py-2.5 px-3">Rank</th>
              <th className="text-right py-2.5 px-3">Price</th>
              <th className="text-right py-2.5 px-3">Market cap</th>
              <th className="text-right py-2.5 px-3">24h</th>
              <th className="text-left py-2.5 px-3">Quote</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((row) => (
              <tr key={row.id} className="border-t border-line/50">
                <td className="p-2.5">
                  <Link className="text-accent" href={`/crypto/${encodeURIComponent(row.id)}`}>
                    {row.name}
                  </Link>
                  <div className="text-caption text-ink-3">{row.symbol} · {row.data_source}</div>
                </td>
                <td className="p-2.5">{cryptoTier(row)}</td>
                <td className="p-2.5 text-right num">{row.rank ?? "Unknown"}</td>
                <td className="p-2.5 text-right num">{fmtPrice(row.price)}</td>
                <td className="p-2.5 text-right num">{fmtCompact(row.market_cap)}</td>
                <td className="p-2.5 text-right num">{fmtPct(row.change_24h_pct)}</td>
                <td className="p-2.5">{row.quote_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3 text-sm">
        {page > 1 ? <Link className="text-accent" href={qs(page - 1)}>Previous</Link> : <span className="text-ink-3">Previous</span>}
        <span className="text-ink-3">Page {result.page}</span>
        {result.nextCursor ? <Link className="text-accent" href={qs(page + 1)}>Next</Link> : <span className="text-ink-3">Next</span>}
      </div>
    </div>
  );
}
