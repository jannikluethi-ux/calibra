export function cryptoTier(row: {
  rank: number | null;
  quote_status: string;
  price: number | null;
}): 1 | 2 | 3 | 4 {
  const live = row.quote_status === "live" && row.price != null;
  if (!live) return 4;
  if (row.rank != null && row.rank <= 20) return 1;
  if (row.rank != null && row.rank <= 200) return 2;
  return 3;
}

export const TIER_TEXT: Record<1 | 2 | 3 | 4, string> = {
  1: "Tier 1 — rank at or under 20, with a live quote",
  2: "Tier 2 — rank at or under 200, with a live quote",
  3: "Tier 3 — other live quote (including a live quote with no stored rank)",
  4: "Tier 4 — list only, no live quote",
};

export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "Not available";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "Not available";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "Not available";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
