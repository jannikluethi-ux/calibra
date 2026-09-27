export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Europe/Zurich",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) + " CET/CEST";
  } catch {
    return iso;
  }
}

export function changeColor(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "text-terminal-muted";
  if (n > 0) return "text-terminal-green";
  if (n < 0) return "text-terminal-red";
  return "text-terminal-dim";
}
