export interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
  /** Extra path prefixes that should mark this item active. */
  match?: string[];
  short?: string;
}

/** Five primary sections (design brief v1 §5). */
export const PRIMARY: NavItem[] = [
  { href: "/", label: "Today", exact: true, match: ["/digest"], short: "Today" },
  { href: "/scenarios", label: "Scenarios", match: ["/movers", "/warnings"], short: "Scenarios" },
  { href: "/explorer", label: "Markets", match: ["/assets", "/instruments", "/countries", "/crypto"], short: "Markets" },
  { href: "/alerts", label: "Alerts", short: "Alerts" },
  { href: "/methodology", label: "Track record", match: ["/forecasts"], short: "Record" },
];

/** Everything else stays reachable, demoted to "More". */
export const SECONDARY: { label: string; items: NavItem[] }[] = [
  {
    label: "Today",
    items: [
      { href: "/digest", label: "Overnight digest" },
      { href: "/movers", label: "Elevated probability board" },
      { href: "/events", label: "Events" },
      { href: "/warnings", label: "Warnings radar" },
    ],
  },
  {
    label: "Markets",
    items: [
      { href: "/assets", label: "Assets" },
      { href: "/countries", label: "Countries" },
      { href: "/map", label: "Causal map" },
    ],
  },
  {
    label: "Crypto",
    items: [
      { href: "/crypto", label: "Crypto overview", exact: true },
      { href: "/crypto/assets", label: "Crypto assets" },
      { href: "/crypto/categories", label: "Crypto categories" },
      { href: "/crypto/high-risk", label: "High-risk crypto" },
      { href: "/crypto/coverage", label: "Crypto coverage" },
      { href: "/crypto/methodology", label: "Crypto risk methodology" },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/forecasts", label: "Forecast log" },
      { href: "/analyst", label: "AI analyst" },
      { href: "/simulator", label: "Simulator" },
      { href: "/portfolio", label: "Portfolio" },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/pricing", label: "Pricing" },
      { href: "/docs/api", label: "API docs" },
      { href: "/data-quality", label: "Data quality" },
      { href: "/settings/scheduler", label: "Scheduler" },
    ],
  },
];

export function isActive(item: NavItem, path: string): boolean {
  if (item.exact || item.href === "/") {
    if (path === item.href) return true;
  } else if (path.startsWith(item.href)) return true;
  return (item.match || []).some((m) => path.startsWith(m));
}
