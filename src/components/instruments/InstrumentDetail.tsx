"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Panel } from "@/components/ui/Panel";
import { Badge, QualityBadge } from "@/components/ui/Badge";
import { changeColor } from "@/lib/format";

interface Instrument {
  id: string;
  symbol: string;
  name: string;
  asset_type: string;
  exchange: string | null;
  exchange_code: string | null;
  country: string | null;
  currency: string | null;
  sector: string | null;
  industry: string | null;
  blockchain: string | null;
  category: string | null;
  market_cap: number | null;
  price: number | null;
  change_24h_pct: number | null;
  change_7d_pct: number | null;
  change_30d_pct: number | null;
  volume_24h: number | null;
  circulating_supply: number | null;
  total_supply: number | null;
  max_supply: number | null;
  rank: number | null;
  volatility: number | null;
  logo_url: string | null;
  data_source: string;
  provider_id: string;
  quote_status: string;
  listed_status: string;
  last_updated: string | null;
  raw_symbol_key: string | null;
  legacy_symbol: string | null;
  volume_basis: string | null;
}

interface EventRow {
  id: string;
  title: string;
  summary: string;
  publishedAt: string;
  sourceName: string;
  citationUrl?: string;
  quality: string;
}

interface MacroLink {
  code: string;
  name: string;
  href: string;
  policyRate: { label: string; value: string | number | null; unit?: string; source: string; quality: string } | null;
}

interface DetailPayload {
  instrument: Instrument;
  events: EventRow[];
  eventsNote: string;
  macro: { links: MacroLink[]; note: string };
  ranges: { range: string; supported: boolean }[];
}

interface SeriesPayload {
  range: string;
  supported: boolean;
  points: { t: string; v: number }[];
  source: string | null;
  note: string;
}

function miss(n: number | null | undefined) {
  return n == null || !Number.isFinite(Number(n));
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (miss(n)) return "Data unavailable";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: digits });
}

function fmtCompact(n: number | null | undefined): string {
  if (miss(n)) return "Data unavailable";
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtPct(n: number | null | undefined): string {
  if (miss(n)) return "Data unavailable";
  const v = Number(n);
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function text(v: string | null | undefined): string {
  return v && v.trim() ? v : "Data unavailable";
}

function Spark({ points }: { points: { t: string; v: number }[] }) {
  const d = useMemo(() => {
    if (points.length < 2) return "";
    const vs = points.map((p) => p.v);
    const min = Math.min(...vs);
    const max = Math.max(...vs);
    const span = max - min || 1;
    return points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * 100;
        const y = 100 - ((p.v - min) / span) * 100;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [points]);
  if (!d) return <div className="text-xs text-terminal-muted">Data unavailable</div>;
  const up = points[points.length - 1].v >= points[0].v;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-40">
      <path d={d} fill="none" stroke={up ? "#3dcc9a" : "#f07167"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function InstrumentDetail({ id }: { id: string }) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState("1M");
  const [series, setSeries] = useState<SeriesPayload | null>(null);
  const [seriesErr, setSeriesErr] = useState<string | null>(null);
  const [user, setUser] = useState<{ email: string } | null | undefined>(undefined);
  const [wlMsg, setWlMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch(`/api/instruments/${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Instrument not in the universe" : `HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (!cancel) setData(j);
      })
      .catch((e) => {
        if (!cancel) setErr(e instanceof Error ? e.message : "Failed");
      });
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => {
        if (!cancel) setUser(j.user || null);
      })
      .catch(() => {
        if (!cancel) setUser(null);
      });
    return () => {
      cancel = true;
    };
  }, [id]);

  useEffect(() => {
    if (!data) return;
    let cancel = false;
    setSeries(null);
    setSeriesErr(null);
    const supported = data.ranges.find((r) => r.range === range)?.supported;
    if (!supported) {
      setSeries({ range, supported: false, points: [], source: null, note: "Data unavailable" });
      return;
    }
    fetch(`/api/instruments/${encodeURIComponent(id)}/series?range=${encodeURIComponent(range)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (!cancel) setSeries(j);
      })
      .catch(() => {
        if (!cancel) setSeriesErr("Data unavailable");
      });
    return () => {
      cancel = true;
    };
  }, [id, range, data]);

  async function addWatch() {
    setWlMsg(null);
    if (!user) {
      setWlMsg("Login required to create a watchlist.");
      return;
    }
    const lists = await fetch("/api/watchlists").then((r) => r.json());
    if (lists.error) {
      setWlMsg(lists.error);
      return;
    }
    let wlId = lists.items?.[0]?.id as string | undefined;
    if (!wlId) {
      const created = await fetch("/api/watchlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Watchlist" }),
      }).then((r) => r.json());
      wlId = created.watchlist?.id;
    }
    if (!wlId) {
      setWlMsg("Could not open a watchlist.");
      return;
    }
    const res = await fetch(`/api/watchlists/${wlId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instrumentId: id }),
    });
    const j = await res.json();
    setWlMsg(res.ok ? "Added to watchlist." : j.error || "Could not add");
  }

  if (err) {
    return <div className="empty-state">{err}</div>;
  }
  if (!data) {
    return <div className="text-xs text-terminal-muted">Loading instrument…</div>;
  }
  const inst = data.instrument;
  const volumeLabel =
    inst.volume_basis === "yahoo_regular_market_volume"
      ? "Volume (Yahoo session)"
      : inst.asset_type === "crypto"
        ? "Volume 24h"
        : "Volume";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/explorer" className="text-2xs text-terminal-accent">
          ← Market explorer
        </Link>
        {inst.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={inst.logo_url} alt="" className="w-6 h-6 rounded-full" />
        ) : null}
        <h1 className="text-sm font-semibold">
          {inst.name} <span className="text-terminal-accent">{inst.symbol}</span>
        </h1>
        <Badge>{inst.asset_type}</Badge>
        <Badge tone={inst.quote_status === "live" ? "green" : "amber"}>{inst.quote_status}</Badge>
        <span className="text-2xs text-terminal-muted num">{inst.id}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          ["Price", fmtNum(inst.price, inst.price != null && inst.price < 2 ? 6 : 2), false],
          ["24h", fmtPct(inst.change_24h_pct), true],
          ["7d", fmtPct(inst.change_7d_pct), true],
          ["30d", fmtPct(inst.change_30d_pct), true],
          ["Market cap", fmtCompact(inst.market_cap), false],
          [volumeLabel, fmtCompact(inst.volume_24h), false],
          ["Rank", miss(inst.rank) ? "Data unavailable" : String(inst.rank), false],
          ["Volatility", miss(inst.volatility) ? "Data unavailable" : `${fmtNum(inst.volatility, 1)}%`, false],
        ].map(([k, v, colored]) => (
          <div key={String(k)} className="panel p-2">
            <div className="text-2xs text-terminal-muted">{k}</div>
            <div
              className={clsx(
                "num text-sm",
                colored && String(v) !== "Data unavailable" ? changeColor(Number(String(v).replace("%", ""))) : ""
              )}
            >
              {v}
            </div>
          </div>
        ))}
      </div>

      <Panel
        title="Chart"
        right={<span className="normal-case tracking-normal text-terminal-muted">{series?.source || "lazy provider fetch"}</span>}
      >
        <div className="flex flex-wrap gap-1 mb-2">
          {data.ranges.map((r) => (
            <button
              key={r.range}
              type="button"
              onClick={() => setRange(r.range)}
              className={clsx(
                "px-2 py-1 text-2xs rounded border",
                range === r.range
                  ? "border-terminal-teal text-terminal-teal"
                  : "border-terminal-border text-terminal-dim"
              )}
            >
              {r.range}
              {!r.supported ? " · n/a" : ""}
            </button>
          ))}
        </div>
        {seriesErr && <div className="text-xs text-terminal-muted">Data unavailable</div>}
        {!series && !seriesErr && <div className="text-xs text-terminal-muted">Loading range…</div>}
        {series && !series.supported && <div className="text-xs text-terminal-muted">Data unavailable</div>}
        {series && series.supported && <Spark points={series.points} />}
        {series?.note && series.supported && (
          <div className="text-2xs text-terminal-muted mt-1">{series.points.length} points · {series.note}</div>
        )}
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Panel title="Reference">
          <ul className="text-xs text-terminal-dim space-y-1">
            <li>Exchange: {text(inst.exchange)}{inst.exchange_code ? ` (${inst.exchange_code})` : ""}</li>
            <li>Country: {text(inst.country)}</li>
            <li>Currency: {text(inst.currency)}</li>
            <li>Sector: {text(inst.sector)}</li>
            <li>Industry: {text(inst.industry)}</li>
            <li>Category: {text(inst.category)}</li>
            <li>Blockchain: {text(inst.blockchain)}</li>
            <li>Circulating supply: {fmtNum(inst.circulating_supply, 0)}</li>
            <li>Total supply: {fmtNum(inst.total_supply, 0)}</li>
            <li>Max supply: {fmtNum(inst.max_supply, 0)}</li>
            <li>Source: {inst.data_source} · provider id {inst.provider_id}</li>
            <li>Listed: {inst.listed_status}</li>
            <li>Quote updated: {inst.quote_status === "live" && inst.last_updated ? inst.last_updated : "Data unavailable"}</li>
            {inst.legacy_symbol && <li>Tracked alias: {inst.legacy_symbol}</li>}
          </ul>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {user === undefined ? null : user ? (
              <button
                type="button"
                onClick={addWatch}
                className="px-2.5 py-1 border border-terminal-border rounded text-xs hover:border-terminal-teal"
              >
                Add to watchlist
              </button>
            ) : (
              <Link href="/login" className="text-xs text-terminal-accent">
                Log in to add a watchlist
              </Link>
            )}
            {wlMsg && <span className="text-2xs text-terminal-dim">{wlMsg}</span>}
          </div>
        </Panel>

        <Panel title="Linked events">
          <div className="text-2xs text-terminal-muted mb-2">{data.eventsNote}</div>
          {data.events.length ? (
            <ul className="space-y-2 text-xs">
              {data.events.map((e) => (
                <li key={e.id}>
                  <QualityBadge quality={e.quality} />{" "}
                  {e.citationUrl ? (
                    <a href={e.citationUrl} className="text-terminal-text hover:underline" target="_blank" rel="noreferrer">
                      {e.title}
                    </a>
                  ) : (
                    <span>{e.title}</span>
                  )}
                  <div className="text-2xs text-terminal-muted">{e.sourceName}</div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-terminal-dim">No linked events are in the store.</div>
          )}
        </Panel>
      </div>

      <Panel title="Macro context">
        <div className="text-2xs text-terminal-muted mb-2">{data.macro.note}</div>
        {data.macro.links.length ? (
          <ul className="space-y-2 text-xs">
            {data.macro.links.map((m) => (
              <li key={m.code} className="border border-terminal-border rounded p-2">
                <Link href={m.href} className="text-terminal-accent">
                  {m.name} ({m.code})
                </Link>
                <div className="text-terminal-dim mt-1">
                  {m.policyRate
                    ? `${m.policyRate.label}: ${m.policyRate.value}${m.policyRate.unit ? " " + m.policyRate.unit : ""} · ${m.policyRate.source} · ${m.policyRate.quality}`
                    : "Policy rate: Data unavailable"}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-xs text-terminal-dim">No stored macro mapping for this instrument.</div>
        )}
      </Panel>
    </div>
  );
}
