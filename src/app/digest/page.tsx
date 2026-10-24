import Link from "next/link";
import { getOvernightDigest } from "@/lib/digest";
import { ProvenanceChip, ageLabel } from "@/components/uncertainty/ProvenanceChip";
import { MetricDelta } from "@/components/uncertainty/MetricDelta";

export const dynamic = "force-dynamic";

function human(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Europe/Zurich",
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function publicMessage(m: string): string {
  return m.replace(/\s*[;,|·—-]?\s*email queued to outbox[^;|]*?\(no SMTP[^)]*\)/gi, "").replace(/\s*\(no SMTP[^)]*\)/gi, "").trim();
}

export default function DigestPage() {
  const d = getOvernightDigest(12);
  return (
    <article className="mx-auto max-w-[720px] space-y-10 rise-in">
      <header>
        <div className="micro-label text-accent">Overnight digest</div>
        <h1 className="mt-2 font-display text-display-l text-ink">What changed overnight</h1>
        <p className="mt-3 text-body-l text-ink-2">
          A factual summary of the last {d.windowHours} hours of stored data. Generated {human(d.generatedAt)} CEST
          {d.lastTick ? <> · last data tick {ageLabel(d.lastTick)}</> : null} · data quality{" "}
          <span className="text-ink">{d.dataQuality ?? "—"}</span>.
        </p>
        {d.material && d.materialReasons.length > 0 && (
          <div className="mt-4 card p-4">
            <div className="micro-label">Why this digest is flagged as material</div>
            <ul className="mt-2 space-y-1 text-sm text-ink-2 list-disc pl-5">
              {d.materialReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-4 text-caption text-ink-3">{d.disclaimer}</p>
      </header>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-title text-ink">Highest-impact events</h2>
          <span className="text-caption text-ink-3"><span className="num">{d.newEventCount}</span> new in window</span>
        </div>
        <ol className="space-y-2">
          {d.topEvents.map((e, i) => (
            <li key={e.id} className="card p-4 flex gap-4">
              <span className="num text-ink-3 text-sm w-5 shrink-0">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-body-l text-ink leading-snug">{e.title}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-caption text-ink-3">
                  <ProvenanceChip kind="observed" at={e.publishedAt} compact />
                  <span title="Model impact score 0–100">impact <span className="num text-ink-2">{e.composite}</span></span>
                  <span>· {human(e.publishedAt)}</span>
                </div>
              </div>
            </li>
          ))}
          {!d.topEvents.length && <li className="empty-state">No new events stored in this window.</li>}
        </ol>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-title text-ink">Largest stored 1-day moves</h2>
          <ProvenanceChip kind="observed" at={d.lastMarketUpdate} />
        </div>
        <div className="card divide-y divide-line">
          {d.largestStoredMoves.map((m) => (
            <Link key={m.symbol} href={`/assets/${m.symbol}`} className="flex items-center justify-between px-4 py-3 hover:bg-surface-2">
              <span className="text-sm font-medium text-ink">{m.symbol}</span>
              <MetricDelta value={m.change1d} unit="%" digits={2} since="prior close" />
            </Link>
          ))}
          {!d.largestStoredMoves.length && <div className="p-4 text-caption text-ink-3">No stored moves.</div>}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-title text-ink">Risk gauges</h2>
          <ProvenanceChip kind="model" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {d.riskGauges.map((g) => (
            <div key={g.id} className="card p-3">
              <div className="text-caption text-ink-2">{g.name}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="num text-metric text-ink">{g.score}</span>
                <span className="text-caption text-ink-3">{g.direction}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-title text-ink">Alerts fired</h2>
          <span className="num text-caption text-ink-3">{d.firedAlerts.length}</span>
        </div>
        <ul className="card divide-y divide-line">
          {d.firedAlerts.slice(0, 20).map((a, i) => (
            <li key={i} className="px-4 py-3">
              <div className="text-sm text-ink">{publicMessage(a.message)}</div>
              <div className="mt-1 text-caption text-ink-3">{a.ruleName} · {human(a.firedAt)}</div>
            </li>
          ))}
          {!d.firedAlerts.length && <li className="px-4 py-3 text-caption text-ink-3">None in this window.</li>}
        </ul>
        {d.firedAlerts.length > 20 && (
          <Link href="/alerts" className="mt-2 inline-block text-caption text-accent">All alerts →</Link>
        )}
      </section>
    </article>
  );
}
