"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ScenarioWeightBar, type ScenarioWeights } from "@/components/uncertainty/ScenarioWeightBar";
import { ProvenanceChip } from "@/components/uncertainty/ProvenanceChip";
import { lookupExpandedWeights } from "@/lib/market/scenarioSymbols";
import { changeColor } from "@/lib/format";

interface InstrumentItem {
  id: string;
  symbol: string;
  name: string;
  asset_type: string;
  exchange: string | null;
  country: string | null;
  category: string | null;
  market_cap: number | null;
  price: number | null;
  change_24h_pct: number | null;
  change_7d_pct: number | null;
  volume_24h: number | null;
  rank: number | null;
  quote_status: string;
  currency: string | null;
}

interface Facets {
  asset_types: { asset_type: string; count: number }[];
  countries: { value: string; count: number }[];
  categories: { value: string; count: number }[];
  exchanges: { value: string; count: number }[];
}

interface ListResponse {
  items: InstrumentItem[];
  total: number;
  page: number;
  pageSize: number;
  nextCursor: string | null;
  facets?: Facets;
}

const TYPE_CHIPS: { id: string; label: string }[] = [
  { id: "", label: "All" },
  { id: "crypto", label: "Crypto" },
  { id: "stock", label: "Stocks" },
  { id: "etf", label: "ETFs" },
  { id: "index", label: "Indices" },
  { id: "commodity", label: "Commodities" },
  { id: "forex", label: "Forex" },
  { id: "bond", label: "Bonds" },
  { id: "future", label: "Futures" },
  { id: "option", label: "Options" },
  { id: "fund", label: "Funds" },
];

const SORTS: { id: string; label: string; dir: "asc" | "desc" }[] = [
  { id: "market_cap", label: "Market cap", dir: "desc" },
  { id: "price", label: "Price", dir: "desc" },
  { id: "change_24h", label: "24h change", dir: "desc" },
  { id: "change_7d", label: "7d change", dir: "desc" },
  { id: "change_30d", label: "30d change", dir: "desc" },
  { id: "volume", label: "Volume", dir: "desc" },
  { id: "rank", label: "Rank", dir: "asc" },
  { id: "name", label: "Name", dir: "asc" },
  { id: "volatility", label: "Volatility", dir: "desc" },
  { id: "recently_added", label: "Recently added", dir: "desc" },
];

function miss(n: number | null | undefined): boolean {
  return n == null || !Number.isFinite(n);
}

function fmtPx(n: number | null | undefined): string {
  if (miss(n)) return "—";
  return n!.toLocaleString("en-US", { maximumFractionDigits: n! >= 1000 ? 2 : 4 });
}

function fmtCompact(n: number | null | undefined): string {
  if (miss(n)) return "—";
  const v = n as number;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtPct(n: number | null | undefined): string {
  if (miss(n)) return "—";
  const sign = (n as number) > 0 ? "+" : "";
  return `${sign}${(n as number).toFixed(2)}%`;
}

const RECENT_KEY = "calibra.recentSearches";

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function pushRecent(q: string) {
  const t = q.trim();
  if (t.length < 2) return;
  const next = [t, ...readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

export function MarketExplorer({
  scenarioBySymbol = {},
  scenarioWeightMaps,
}: {
  /** @deprecated Prefer scenarioWeightMaps (id + symbol|type). Kept for simple symbol lookups. */
  scenarioBySymbol?: Record<string, ScenarioWeights>;
  scenarioWeightMaps?: { byId: Record<string, ScenarioWeights>; bySymbolType: Record<string, ScenarioWeights> };
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [assetType, setAssetType] = useState("");
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState("");
  const [exchange, setExchange] = useState("");
  const [mcapMin, setMcapMin] = useState("");
  const [volMin, setVolMin] = useState("");
  const [sort, setSort] = useState("market_cap");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [items, setItems] = useState<InstrumentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<InstrumentItem[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [openSuggest, setOpenSuggest] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const req = useRef(0);

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQ(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft]);

  useEffect(() => {
    if (draft.trim().length < 1) {
      setSuggest([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/instruments/suggest?q=${encodeURIComponent(draft.trim())}&limit=8`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((j) => setSuggest(j.items || []))
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [draft]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (assetType) p.set("asset_type", assetType);
    if (country) p.set("country", country);
    if (category) p.set("category", category);
    if (exchange) p.set("exchange", exchange);
    if (mcapMin.trim()) p.set("market_cap_min", mcapMin.trim());
    if (volMin.trim()) p.set("volume_min", volMin.trim());
    p.set("sort", sort);
    p.set("dir", dir);
    p.set("pageSize", "50");
    return p;
  }, [q, assetType, country, category, exchange, mcapMin, volMin, sort, dir]);

  useEffect(() => {
    const id = ++req.current;
    setLoading(true);
    setErr(null);
    const p = new URLSearchParams(queryString);
    p.set("page", "1");
    fetch(`/api/instruments?${p.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ListResponse;
      })
      .then((j) => {
        if (id !== req.current) return;
        setItems(j.items || []);
        setTotal(j.total ?? 0);
        setNextCursor(j.nextCursor);
        if (j.facets) setFacets(j.facets);
        setLoading(false);
        if (q) {
          pushRecent(q);
          setRecent(readRecent());
        }
      })
      .catch((e) => {
        if (id !== req.current) return;
        setErr(e instanceof Error ? e.message : "Failed to load");
        setLoading(false);
      });
  }, [queryString, q]);

  async function loadMore() {
    if (!nextCursor || loadingMore || loading) return;
    setLoadingMore(true);
    const p = new URLSearchParams(queryString);
    p.set("cursor", nextCursor);
    p.set("facets", "0");
    try {
      const r = await fetch(`/api/instruments?${p.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as ListResponse;
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return prev.concat((j.items || []).filter((i) => !seen.has(i.id)));
      });
      setTotal(j.total ?? total);
      setNextCursor(j.nextCursor);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load page");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCursor, loadingMore, loading, queryString]);

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of facets?.asset_types || []) m.set(row.asset_type, row.count);
    return m;
  }, [facets]);

  const allCount = useMemo(() => {
    let n = 0;
    typeCounts.forEach((c) => { n += c; });
    return n;
  }, [typeCounts]);

  const shownEnd = items.length;
  const footer =
    total === 0 ? "Showing 0 of 0 instruments" : `Showing 1–${shownEnd} of ${total} instruments`;

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="relative">
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setOpenSuggest(true);
            }}
            onFocus={() => setOpenSuggest(true)}
            placeholder="Symbol, name, provider id, exchange"
            className="w-full bg-surface-0 border border-line-strong rounded-md px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-accent"
          />
          {openSuggest && (suggest.length > 0 || recent.length > 0) && draft.trim().length < 2 && recent.length > 0 && (
            <div className="absolute z-20 mt-1 w-full border border-line-strong rounded-md bg-surface-1 shadow-card">
              <div className="px-3 py-1 micro-label text-ink-3">Recent</div>
              {recent.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="block w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2"
                  onClick={() => {
                    setDraft(r);
                    setOpenSuggest(false);
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
          {openSuggest && suggest.length > 0 && draft.trim().length >= 1 && (
            <div className="absolute z-20 mt-1 w-full border border-line-strong rounded-md bg-surface-1 shadow-card max-h-64 overflow-auto">
              {suggest.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="block w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2"
                  onClick={() => {
                    setOpenSuggest(false);
                    router.push(`/instruments/${encodeURIComponent(s.id)}`);
                  }}
                >
                  <span className="text-ink font-medium">{s.symbol}</span>{" "}
                  <span className="text-ink-2">{s.name}</span>{" "}
                  <span className="text-ink-3">{s.asset_type}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {TYPE_CHIPS.map((chip) => {
            const count = chip.id === "" ? allCount : typeCounts.get(chip.id) || 0;
            const active = assetType === chip.id;
            return (
              <button
                key={chip.label}
                type="button"
                onClick={() => setAssetType(chip.id)}
                className={clsx(
                  "px-2.5 py-1 rounded-full border text-caption transition-colors duration-[120ms]",
                  active
                    ? "border-accent text-accent bg-accent/10"
                    : "border-line text-ink-2 hover:text-ink hover:border-line-strong"
                )}
              >
                {chip.label} <span className="num text-ink-3">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mt-3">
          <label className="text-caption text-ink-3">
            Country
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="mt-1 w-full bg-surface-0 border border-line rounded-md px-2 py-1.5 text-sm text-ink"
            >
              <option value="">Any</option>
              {(facets?.countries || []).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value} ({c.count})
                </option>
              ))}
            </select>
            {!facets?.countries.length && <div className="mt-1">No country values stored</div>}
          </label>
          <label className="text-caption text-ink-3">
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full bg-surface-0 border border-line rounded-md px-2 py-1.5 text-sm text-ink"
            >
              <option value="">Any</option>
              {(facets?.categories || []).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value} ({c.count})
                </option>
              ))}
            </select>
          </label>
          <label className="text-caption text-ink-3">
            Exchange
            <select
              value={exchange}
              onChange={(e) => setExchange(e.target.value)}
              className="mt-1 w-full bg-surface-0 border border-line rounded-md px-2 py-1.5 text-sm text-ink"
            >
              <option value="">Any</option>
              {(facets?.exchanges || []).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value} ({c.count})
                </option>
              ))}
            </select>
          </label>
          <label className="text-caption text-ink-3">
            Market cap min
            <input
              value={mcapMin}
              onChange={(e) => setMcapMin(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="e.g. 1000000000"
              className="mt-1 w-full bg-surface-0 border border-line rounded-md px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="text-caption text-ink-3">
            Volume min
            <input
              value={volMin}
              onChange={(e) => setVolMin(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="e.g. 1000000"
              className="mt-1 w-full bg-surface-0 border border-line rounded-md px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="text-caption text-ink-3">
            Sort
            <select
              value={`${sort}:${dir}`}
              onChange={(e) => {
                const [s, d] = e.target.value.split(":");
                setSort(s);
                setDir(d === "asc" ? "asc" : "desc");
              }}
              className="mt-1 w-full bg-surface-0 border border-line rounded-md px-2 py-1.5 text-sm text-ink"
            >
              {SORTS.map((s) => (
                <option key={s.id + s.dir} value={`${s.id}:${s.dir}`}>
                  {s.label} {s.dir}
                </option>
              ))}
              <option value={`${sort}:${dir === "asc" ? "desc" : "asc"}`}>
                {SORTS.find((s) => s.id === sort)?.label || sort} {dir === "asc" ? "desc" : "asc"}
              </option>
            </select>
          </label>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h2 className="text-sm font-semibold text-ink">Universe</h2>
          <span className="num text-caption text-ink-3">{footer}</span>
        </div>
        {err && <div className="px-4 pt-3 text-caption text-scenario-downside">{err}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-caption text-ink-3 uppercase tracking-wider bg-surface-1">
              <tr className="border-b border-line text-left">
                <th className="py-2.5 px-4">Instrument</th>
                <th className="py-2.5 pr-3">Type</th>
                <th className="py-2.5 pr-3 text-right">Price</th>
                <th className="py-2.5 pr-3 text-right">24h</th>
                <th className="py-2.5 pr-3 text-right">Mkt cap</th>
                <th className="py-2.5 pr-3 text-right">Volume</th>
                <th className="py-2.5 pr-3 w-40">Scenario weights</th>
                <th className="py-2.5 pr-4">Quote</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const w = scenarioWeightMaps
                  ? lookupExpandedWeights(row, scenarioWeightMaps)
                  : scenarioBySymbol[row.symbol.toUpperCase()];
                return (
                <tr
                  key={row.id}
                  className="border-b border-line/50 hover:bg-surface-2/50 cursor-pointer transition-colors duration-[120ms]"
                  onClick={() => router.push(`/instruments/${encodeURIComponent(row.id)}`)}
                >
                  <td className="py-2.5 px-4 max-w-[280px]">
                    <div className="flex items-baseline gap-2">
                      <span className="text-ink font-semibold">{row.symbol}</span>
                      {!miss(row.rank) && <span className="num text-caption text-ink-3">#{row.rank}</span>}
                    </div>
                    <div className="text-caption text-ink-3 truncate">
                      {row.name}
                      {row.category ? ` · ${row.category}` : ""}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-caption text-ink-2 capitalize">{row.asset_type}</td>
                  <td className="py-2.5 pr-3 text-right num text-ink">{fmtPx(row.price)}</td>
                  <td className={clsx("py-2.5 pr-3 text-right num", miss(row.change_24h_pct) ? "text-ink-3" : changeColor(row.change_24h_pct))}>
                    {fmtPct(row.change_24h_pct)}
                  </td>
                  <td className="py-2.5 pr-3 text-right num text-ink-2">{fmtCompact(row.market_cap)}</td>
                  <td className="py-2.5 pr-3 text-right num text-ink-2">{fmtCompact(row.volume_24h)}</td>
                  <td className="py-2.5 pr-3">
                    {w ? (
                      <div title={`Model estimate: Base ${w.base}% · Upside ${w.upside}% · Downside scenario ${w.downside}% · Tail ${w.tail}%`}>
                        <ScenarioWeightBar weights={w} size="sm" showLegend={false} />
                        <div className="mt-1 text-[11px] text-ink-3 num">Downside scenario {w.downside}%</div>
                      </div>
                    ) : (
                      <span className="text-caption text-ink-3">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    {row.quote_status === "live" ? (
                      <ProvenanceChip kind="observed" compact source={row.currency ?? undefined} />
                    ) : (
                      <span className="text-caption text-ink-3">{row.quote_status === "list_only" ? "Listed only" : "No quote"}</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {loading && <div className="px-4 py-4 text-caption text-ink-3">Loading instruments…</div>}
          {!loading && items.length === 0 && (
            <div className="m-4 rounded-card border border-dashed border-line-strong p-5 text-sm text-ink-3">No instruments match these filters. Counts are from stored rows only.</div>
          )}
        </div>
        <div ref={sentinel} className="h-8" />
        <div className="px-4 pb-3 text-caption text-ink-3 flex justify-between gap-2 flex-wrap">
          <span>{footer}</span>
          <span>{loadingMore ? "Loading next page…" : nextCursor ? "Scroll for the next page" : "End of results"}</span>
        </div>
      </div>
    </div>
  );
}
