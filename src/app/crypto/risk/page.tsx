import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The research_v1 "Higher-uncertainty" table is superseded by the v2 high-risk section.
 * v1 rows are kept (archived as model_version research_v1 in crypto_risk_scores) and shown in each asset's history.
 */
export default function LegacyRiskPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val != null && ["q", "view", "band", "factor", "category", "network", "conf", "fresh", "sort", "dir", "page"].includes(k)) sp.set(k, val);
  }
  const qs = sp.toString();
  redirect(qs ? `/crypto/high-risk?${qs}` : "/crypto/high-risk");
}
