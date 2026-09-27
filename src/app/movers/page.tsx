import { MoversBoard } from "@/components/dashboard/MoversBoard";
import { rankMovers } from "@/lib/movers/rank";
import { brand } from "@/lib/brand";
import { BrandMark } from "@/components/brand/BrandMark";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default function MoversPage() {
  const initialMovers = rankMovers("1-4w", "up", 10);

  return (
    <div className="space-y-3">
      <div className="hero-strip px-4 py-3 flex items-start gap-3">
        <BrandMark size={32} />
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display text-sm font-semibold tracking-wide">{brand.name}</h1>
            <Badge tone="green">Elevated probability board</Badge>
          </div>
          <p className="text-2xs text-terminal-dim mt-1 max-w-3xl leading-relaxed">
            {brand.upsideHint} Toggle downside for balance. Every row expands to Evidence → Reasoning →
            Scenario estimate → Uncertainty / invalidation. Never buy/sell language.
          </p>
        </div>
      </div>
      <MoversBoard initialHorizon="1-4w" initialData={initialMovers} compact />
    </div>
  );
}
