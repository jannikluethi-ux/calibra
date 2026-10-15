import { ensureSeedData } from "@/lib/bootstrap/refresh";
import { getOvernightDigest } from "@/lib/digest";

export const dynamic = "force-dynamic";

export default function DigestPage() {
  ensureSeedData();
  const d = getOvernightDigest(12);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">What changed overnight</h1>
        <p className="text-sm text-terminal-muted">
          Last {d.windowHours}h of stored refreshes. Last tick {d.lastTick ?? "—"} · data quality {d.dataQuality ?? "—"}.
        </p>
        <p className="text-xs text-terminal-muted mt-1">{d.disclaimer}</p>
      </div>
      <section>
        <h2 className="font-medium mb-1">Risk gauges</h2>
        <ul className="text-sm">
          {d.riskGauges.map((g) => (
            <li key={g.id}>{g.name}: {g.score} ({g.direction})</li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="font-medium mb-1">Events ({d.newEventCount} new) — highest impact</h2>
        <ul className="text-sm">
          {d.topEvents.map((e) => (
            <li key={e.id}>{e.title} · impact {e.composite}</li>
          ))}
          {!d.topEvents.length && <li>No new events stored in this window.</li>}
        </ul>
      </section>
      <section>
        <h2 className="font-medium mb-1">Largest stored 1d moves</h2>
        <ul className="text-sm">
          {d.largestStoredMoves.map((m) => (
            <li key={m.symbol}>{m.symbol}: {m.change1d?.toFixed(2)}%</li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="font-medium mb-1">Alerts fired ({d.firedAlerts.length})</h2>
        <ul className="text-sm">
          {d.firedAlerts.slice(0, 20).map((a, i) => (
            <li key={i}>{a.firedAt} · {a.message}</li>
          ))}
          {!d.firedAlerts.length && <li>None.</li>}
        </ul>
      </section>
    </div>
  );
}
