import { Panel } from "./Panel";

/**
 * Empty state for an unseeded / not-yet-refreshed DB (B2 get-fix rec. 3). Pages are read-only and never seed on a
 * request; data appears after an operator runs `npm run seed` or the token-guarded refresh/scheduler job.
 */
export function AwaitingFirstRun({ what }: { what: string }) {
  return (
    <Panel title="Awaiting first run">
      <p className="text-xs text-terminal-muted" data-testid="awaiting-first-run">
        No {what} stored yet. This page only reads stored data; it fills in after the first seed or data refresh is
        run by an operator. Nothing shown here is a live market claim.
      </p>
    </Panel>
  );
}
