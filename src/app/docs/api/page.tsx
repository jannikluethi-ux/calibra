import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { DisclaimerStrip } from "@/components/billing/UpgradeBanner";

export const dynamic = "force-dynamic";

export default function ApiDocsPage() {
  return (
    <div className="max-w-3xl space-y-3">
      <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">
        Calibra API
      </h1>
      <Panel title="Auth">
        <div className="text-xs space-y-2 text-terminal-dim leading-relaxed">
          <p>
            Create keys at{" "}
            <Link href="/account/api-keys" className="text-terminal-accent">
              /account/api-keys
            </Link>{" "}
            (Pro optional limited; API plan full). Free keys are not issued.
          </p>
          <p>
            Pass <code className="text-terminal-teal">Authorization: Bearer calibra_…</code> or{" "}
            <code className="text-terminal-teal">X-Api-Key: calibra_…</code>.
          </p>
          <p>Responses include a <code>provenance.generatedAt</code> timestamp. Data is never invented.</p>
        </div>
      </Panel>

      <Panel title="Endpoints">
        <ul className="text-xs space-y-2 font-mono text-terminal-text">
          <li>GET /api/v1/events</li>
          <li>GET /api/v1/scenarios</li>
          <li>GET /api/v1/forecasts?includeSeed=0</li>
          <li>GET /api/v1/movers?horizon=1-4w&amp;side=up</li>
          <li>GET /api/v1/calibration?cohort=live</li>
        </ul>
      </Panel>

      <Panel title="Example curl">
        <pre className="text-2xs bg-terminal-bg border border-terminal-border rounded p-3 overflow-x-auto text-terminal-teal whitespace-pre-wrap">{`curl -sS -H "Authorization: Bearer calibra_YOUR_KEY" \\
  "http://localhost:3456/api/v1/movers?horizon=1-4w&side=up"`}</pre>
        <DisclaimerStrip />
      </Panel>

      <p className="text-2xs text-terminal-muted">
        Full monetization plan:{" "}
        <code className="text-terminal-dim">docs/MONETIZATION.md</code> ·{" "}
        <Link href="/pricing" className="text-terminal-accent">
          Pricing
        </Link>{" "}
        ·{" "}
        <Link href="/methodology" className="text-terminal-accent">
          Methodology
        </Link>
      </p>
    </div>
  );
}
