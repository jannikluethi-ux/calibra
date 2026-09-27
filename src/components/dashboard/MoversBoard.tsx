"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { brand } from "@/lib/brand";
import { fmtNum, fmtPct, changeColor } from "@/lib/format";
import { Badge, QualityBadge } from "../ui/Badge";
import type { MoverHorizon, MoverRow, MoverSide, MoversResult } from "@/lib/movers/rank";

const HORIZONS: { id: MoverHorizon; label: string }[] = [
  { id: "intraday", label: "Intraday" },
  { id: "1-7d", label: "1–7d" },
  { id: "1-4w", label: "1–4w" },
  { id: "1-3m", label: "1–3m" },
];

function ScoreBar({ score, side }: { score: number; side: MoverSide }) {
  const color = side === "up" ? "bg-terminal-teal" : "bg-terminal-amber";
  return (
    <div className="flex items-center gap-2 min-w-[88px]">
      <div className="flex-1 h-1.5 bg-terminal-border/80 rounded overflow-hidden">
        <div className={clsx("h-full rounded", color)} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <span className="num text-xs font-semibold w-7 text-right">{score}</span>
    </div>
  );
}

function MoverCard({ row, side, expanded, onToggle }: {
  row: MoverRow;
  side: MoverSide;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={clsx(
        "border rounded-md transition-all",
        side === "up"
          ? "border-terminal-teal/20 hover:border-terminal-teal/45 bg-terminal-surface/80"
          : "border-terminal-amber/20 hover:border-terminal-amber/45 bg-terminal-surface/80",
        expanded && "ring-1 ring-terminal-teal/20"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-3 py-2.5 flex items-start gap-3"
      >
        <div
          className={clsx(
            "num text-xs font-semibold w-5 shrink-0 mt-0.5",
            side === "up" ? "text-terminal-teal" : "text-terminal-amber"
          )}
        >
          {row.rank}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={row.href}
              onClick={(e) => e.stopPropagation()}
              className="text-xs font-semibold text-terminal-accent hover:underline"
            >
              {row.symbol}
            </Link>
            <span className="text-2xs text-terminal-dim truncate">{row.name}</span>
            <QualityBadge quality={row.isProxy ? "proxy" : row.dataQuality} />
            {row.insufficientEvidence && <Badge tone="amber">thin evidence</Badge>}
          </div>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap text-2xs">
            <span className="num text-terminal-text">{fmtNum(row.lastPrice, row.category === "fx" || row.category === "rates" ? 3 : 2)}</span>
            <span className={clsx("num", changeColor(row.periodChangePct))}>
              {fmtPct(row.periodChangePct)} <span className="text-terminal-muted">obs.</span>
            </span>
            <span className="text-terminal-muted">
              {side === "up" ? "P(up mass)" : "P(down mass)"}{" "}
              <span className="num text-terminal-text">
                {row.directionalProb != null ? `${row.directionalProb.toFixed(0)}%` : "—"}
              </span>
            </span>
            <span className="text-terminal-muted">
              conf <span className="num text-terminal-text">{row.confidence}%</span>
            </span>
          </div>
          {row.keyCatalyst && (
            <div className="text-2xs text-terminal-dim mt-1 line-clamp-1">
              Catalyst: {row.keyCatalyst}
            </div>
          )}
        </div>
        <div className="shrink-0 pt-0.5">
          <div className="text-2xs text-terminal-muted uppercase tracking-wider mb-0.5 text-right">
            {side === "up" ? "Upside" : "Downside"} score
          </div>
          <ScoreBar score={row.score} side={side} />
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-terminal-border/50 space-y-2 text-2xs">
          <div>
            <div className="text-terminal-teal uppercase tracking-wider mb-0.5 mt-2">Evidence</div>
            <p className="text-terminal-dim leading-relaxed">{row.evidence}</p>
          </div>
          <div>
            <div className="text-terminal-cyan uppercase tracking-wider mb-0.5">Reasoning</div>
            <p className="text-terminal-dim leading-relaxed">{row.reasoning}</p>
          </div>
          <div>
            <div className="text-terminal-amber uppercase tracking-wider mb-0.5">Scenario estimate</div>
            <p className="text-terminal-text/90 leading-relaxed">{row.scenarioEstimate}</p>
          </div>
          <div>
            <div className="text-terminal-red/80 uppercase tracking-wider mb-0.5">Uncertainty / invalidation</div>
            <p className="text-terminal-dim leading-relaxed">
              {row.uncertaintyNote} · Invalidation: {row.invalidation}
            </p>
          </div>
          <div className="flex gap-3 pt-1">
            <Link href={row.href} className="text-terminal-accent hover:underline">
              Open asset →
            </Link>
            <span className="text-terminal-muted num">
              f={row.breakdown.forecastMass?.toFixed(0) ?? "—"} · s=
              {row.breakdown.scenarioBranchProb?.toFixed(0) ?? "—"} · e=
              {row.breakdown.eventImpactAvg?.toFixed(0) ?? "—"} · m=
              {row.breakdown.momentumPct != null ? row.breakdown.momentumPct.toFixed(1) + "%" : "—"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function MoversBoard({
  initialHorizon = "1-4w",
  initialData,
  compact = false,
}: {
  initialHorizon?: MoverHorizon;
  initialData?: MoversResult;
  compact?: boolean;
}) {
  const [horizon, setHorizon] = useState<MoverHorizon>(initialHorizon);
  const [side, setSide] = useState<MoverSide>("up");
  const [data, setData] = useState<MoversResult | null>(() => initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showMethod, setShowMethod] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/movers?horizon=${horizon}&side=${side}&limit=10`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as MoversResult;
      setData(j);
      setExpanded(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [horizon, side]);

  useEffect(() => {
    load();
  }, [load]);

  const label = side === "up" ? brand.upsideLabel : brand.downsideLabel;
  const hint = side === "up" ? brand.upsideHint : brand.downsideHint;

  return (
    <section className="panel overflow-hidden relative">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-terminal-teal/50 to-transparent" />
      <div className="panel-header !normal-case !tracking-normal">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-2xs uppercase tracking-wider text-terminal-dim">Watchlist</span>
          <span className="text-xs font-semibold text-terminal-text">{label}</span>
          <Badge tone={side === "up" ? "green" : "amber"}>ESTIMATE</Badge>
          <button
            type="button"
            onClick={() => setShowMethod((v) => !v)}
            className="text-2xs text-terminal-accent hover:underline"
            title="Scoring methodology"
          >
            Methodology
          </button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex rounded border border-terminal-border overflow-hidden">
            {HORIZONS.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => setHorizon(h.id)}
                className={clsx(
                  "px-2 py-1 text-2xs transition-colors",
                  horizon === h.id
                    ? "bg-terminal-teal/15 text-terminal-teal"
                    : "text-terminal-dim hover:text-terminal-text hover:bg-terminal-surface"
                )}
              >
                {h.label}
              </button>
            ))}
          </div>
          <div className="flex rounded border border-terminal-border overflow-hidden">
            <button
              type="button"
              onClick={() => setSide("up")}
              className={clsx(
                "px-2 py-1 text-2xs",
                side === "up" ? "bg-terminal-teal/20 text-terminal-teal" : "text-terminal-dim hover:text-terminal-text"
              )}
            >
              Upside
            </button>
            <button
              type="button"
              onClick={() => setSide("down")}
              className={clsx(
                "px-2 py-1 text-2xs border-l border-terminal-border",
                side === "down" ? "bg-terminal-amber/20 text-terminal-amber" : "text-terminal-dim hover:text-terminal-text"
              )}
            >
              Downside
            </button>
          </div>
          {!compact && (
            <Link href="/movers" className="text-2xs text-terminal-accent hover:underline ml-1">
              Full board
            </Link>
          )}
        </div>
      </div>

      <div className="px-3 pt-2 pb-1">
        <p className="text-2xs text-terminal-muted leading-relaxed">{hint}</p>
        {showMethod && data && (
          <div className="mt-2 p-2 rounded bg-terminal-bg/60 border border-terminal-border text-2xs text-terminal-dim whitespace-pre-wrap leading-relaxed">
            {data.methodology}
          </div>
        )}
      </div>

      <div className="p-3 pt-1 space-y-1.5">
        {loading && !data && (
          <div className="text-xs text-terminal-muted py-6 text-center">Loading elevated-probability ranking…</div>
        )}
        {err && (
          <div className="text-xs text-terminal-red py-4">Failed to load movers: {err}</div>
        )}
        {data && !data.rows.length && (
          <div className="text-xs text-terminal-amber py-4">
            Insufficient evidence for this horizon — no instruments scored. Prefer omission over fake conviction.
          </div>
        )}
        {data?.rows.map((row) => (
          <MoverCard
            key={`${row.symbol}-${side}-${horizon}`}
            row={row}
            side={side}
            expanded={expanded === row.symbol}
            onToggle={() => setExpanded((x) => (x === row.symbol ? null : row.symbol))}
          />
        ))}
        {data?.truncatedNote && (
          <div className="text-2xs text-terminal-amber/90 pt-1">{data.truncatedNote}</div>
        )}
        {data && (
          <div className="text-2xs text-terminal-muted pt-1 flex justify-between gap-2 flex-wrap">
            <span>
              Scored {data.scoredCount}/{data.universeSize} · showing {data.rows.length}
              {loading ? " · refreshing…" : ""}
            </span>
            <span className="text-terminal-dim italic">Not buy/sell advice · scenario estimates only</span>
          </div>
        )}
      </div>
    </section>
  );
}
