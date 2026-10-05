import { MarketExplorer } from "@/components/explorer/MarketExplorer";

export const dynamic = "force-dynamic";

export default function ExplorerPage() {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-sm font-semibold uppercase tracking-wide text-terminal-dim">Market explorer</h1>
        <p className="text-2xs text-terminal-muted mt-0.5 max-w-3xl">
          Canonical instrument universe for search, library, and pages. Missing provider fields show Data unavailable.
          Not advice. The elevated-probability top 10 stays a scenario board.
        </p>
      </div>
      <MarketExplorer />
    </div>
  );
}
