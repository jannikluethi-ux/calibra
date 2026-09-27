"use client";

import { useEffect, useMemo, useState } from "react";
import type { CausalEdge, CausalGraph } from "@/lib/types";

const SVG_WIDTH = 900;
const SVG_HEIGHT = 560;
const NODE_RADIUS = 8;

const trendColors: Record<CausalEdge["trend"], string> = {
  strengthening: "#22c55e",
  weakening: "#ef4444",
  stable: "#6b7280",
};

const nodeColors: Record<string, string> = {
  event: "#f59e0b",
  indicator: "#38bdf8",
  asset: "#a78bfa",
  institution: "#fb7185",
  country: "#34d399",
};

type Point = { x: number; y: number };

function nodePositions(nodes: CausalGraph["nodes"]): Map<string, Point> {
  const positions = new Map<string, Point>();
  const centerX = SVG_WIDTH / 2;
  const centerY = SVG_HEIGHT / 2;
  const radius = Math.min(SVG_WIDTH, SVG_HEIGHT) * 0.39;

  // A deterministic circular layout means the graph is immediately usable without
  // waiting for a physics engine (and remains stable between renders).
  nodes.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });

  return positions;
}

function displayLabel(label: string): string {
  return label.length > 28 ? `${label.slice(0, 26)}…` : label;
}

function SvgCausalGraph({ graph, onSelect }: { graph: CausalGraph; onSelect: (edge: CausalEdge) => void }) {
  const positions = useMemo(() => nodePositions(graph.nodes), [graph.nodes]);

  return (
    <div className="relative h-[520px] w-full">
      <svg
        aria-label="Causal financial transmission graph"
        className="h-full w-full"
        role="img"
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {(Object.keys(trendColors) as CausalEdge["trend"][]).map((trend) => (
            <marker
              key={trend}
              id={`causal-arrow-${trend}`}
              markerHeight="6"
              markerWidth="6"
              orient="auto-start-reverse"
              refX="7"
              refY="3"
              viewBox="0 0 10 6"
            >
              <path d="M 0 0 L 10 3 L 0 6 z" fill={trendColors[trend]} />
            </marker>
          ))}
        </defs>

        {graph.edges.map((edge) => {
          const source = positions.get(edge.source);
          const target = positions.get(edge.target);
          if (!source || !target) return null;
          const color = trendColors[edge.trend];
          return (
            <line
              key={edge.id}
              aria-label={`${edge.source} to ${edge.target}, ${edge.trend}`}
              className="cursor-pointer transition-opacity"
              markerEnd={`url(#causal-arrow-${edge.trend})`}
              onClick={() => onSelect(edge)}
              opacity={0.72}
              stroke={color}
              strokeWidth={Math.max(1, edge.strength * 3)}
              x1={source.x}
              x2={target.x}
              y1={source.y}
              y2={target.y}
            >
              <title>
                {`${edge.source} → ${edge.target}: ${edge.trend}`}
              </title>
            </line>
          );
        })}

        {graph.nodes.map((node) => {
          const point = positions.get(node.id);
          if (!point) return null;
          const color = nodeColors[node.type] || "#94a3b8";

          return (
            <g
              key={node.id}
              className="cursor-pointer"
              onClick={() => {
                const edge = graph.edges.find((candidate) => candidate.source === node.id || candidate.target === node.id);
                if (edge) onSelect(edge);
              }}
            >
              <circle cx={point.x} cy={point.y} fill="#0d1117" r={NODE_RADIUS + 4} stroke={color} strokeOpacity="0.3" />
              <circle cx={point.x} cy={point.y} fill={color} r={NODE_RADIUS} stroke="#e5e7eb" strokeWidth="1" />
              <text
                className="pointer-events-none select-none"
                fill="#d1d5db"
                fontSize="11"
                textAnchor={point.x < SVG_WIDTH / 2 - 20 ? "start" : point.x > SVG_WIDTH / 2 + 20 ? "end" : "middle"}
                x={point.x + (point.x < SVG_WIDTH / 2 - 20 ? 14 : point.x > SVG_WIDTH / 2 + 20 ? -14 : 0)}
                y={point.y + (point.y < 30 ? 24 : point.y > SVG_HEIGHT - 30 ? -16 : 4)}
              >
                {displayLabel(node.label)}
              </text>
              <title>{node.label}</title>
            </g>
          );
        })}
      </svg>

      <div className="absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded border border-terminal-border bg-terminal-bg/90 px-2 py-1 text-2xs text-terminal-muted">
        {(Object.keys(trendColors) as CausalEdge["trend"][]).map((trend) => (
          <span key={trend} className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-4 rounded" style={{ backgroundColor: trendColors[trend] }} />
            {trend}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CausalMapClient({ graph }: { graph: CausalGraph }) {
  const [selected, setSelected] = useState<CausalEdge | null>(null);
  const [forceGraphError, setForceGraphError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fallbackTimer = window.setTimeout(() => {
      if (!cancelled) setForceGraphError("ForceGraph timed out; using the SVG layout.");
    }, 2000);

    // The SVG graph is the primary renderer. Keep the optional physics engine
    // isolated so a failed or hanging chunk can never block the map.
    import("react-force-graph-2d")
      .then(() => {
        window.clearTimeout(fallbackTimer);
      })
      .catch((error: unknown) => {
        window.clearTimeout(fallbackTimer);
        if (!cancelled) {
          setForceGraphError(error instanceof Error ? `ForceGraph unavailable: ${error.message}` : "ForceGraph unavailable.");
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <div className="panel overflow-hidden" style={{ height: 560 }}>
        <SvgCausalGraph graph={graph} onSelect={setSelected} />
        <div className="px-3 pb-2 text-2xs text-terminal-muted">
          SVG layout active — click a node or edge to inspect its causal mechanism.
          {forceGraphError ? ` ${forceGraphError}` : ""}
        </div>
      </div>
      <div className="panel max-h-[560px] space-y-2 overflow-y-auto p-3 text-xs">
        <div className="text-2xs uppercase tracking-wider text-terminal-dim">Edge inspector</div>
        {graph.graphVersion && <div className="text-2xs text-terminal-muted">Knowledge graph {graph.graphVersion}</div>}
        {selected ? (
          <>
            <div className="font-medium">
              {selected.source} → {selected.target}
            </div>
            <div className="text-terminal-muted">
              strength {(selected.strength * 100).toFixed(0)}% · {selected.trend}
              {selected.typicalSign ? ` · sign ${selected.typicalSign}` : ""}
              {selected.typicalHorizon ? ` · typical ${selected.typicalHorizon}` : ""}
            </div>
            <div>
              <div className="text-2xs text-terminal-accent">Mechanism</div>
              {selected.mechanism}
            </div>
            {selected.typicalSign && (
              <div>
                <div className="text-2xs text-terminal-accent">Typical sign / horizon</div>
                <div className="text-terminal-dim">
                  {selected.typicalSign} · {selected.typicalHorizon || "n/a"} — MODEL ASSUMPTION from curated graph, not a live measurement.
                </div>
              </div>
            )}
            <div>
              <div className="text-2xs text-terminal-accent">Historical examples (labeled analogies)</div>
              <ul className="ml-4 list-disc text-terminal-dim">
                {selected.historicalExamples.map((example, index) => (
                  <li key={index}>{example}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-2xs text-terminal-accent">Current evidence</div>
              <ul className="ml-4 list-disc text-terminal-dim">
                {selected.currentEvidence.map((evidence, index) => (
                  <li key={index}>{evidence}</li>
                ))}
              </ul>
            </div>
            {selected.activatedByEventIds && selected.activatedByEventIds.length > 0 && (
              <div>
                <div className="text-2xs text-terminal-accent">Activated by events</div>
                <div className="num text-2xs text-terminal-dim">
                  {selected.activatedByEventIds.length} recent event(s) matched activate tags
                </div>
              </div>
            )}
            <div className="text-2xs text-terminal-amber">
              Caveat: {selected.caveats} Correlations are not permanent.
              {selected.graphVersion ? ` (edge from ${selected.graphVersion})` : ""}
            </div>
          </>
        ) : (
          <div className="text-terminal-muted">Click a node or edge to inspect mechanism, typical sign/horizon, evidence, and caveats.</div>
        )}
        <div className="border-t border-terminal-border pt-2 text-2xs text-terminal-muted">Updated {graph.updatedAt}</div>
      </div>
    </div>
  );
}
