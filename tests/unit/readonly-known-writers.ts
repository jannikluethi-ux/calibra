/**
 * Exact list of targets that still write (or reach a provider) on GET. Shrinks with each B2 get-fix commit and must
 * end EMPTY. A listed target that turns clean fails the suite, so this list can never go stale.
 */
export const KNOWN_WRITERS: Record<"empty" | "populated", Record<string, string>> = {
  empty: {
    "GET /api/causal": "persists causal_graph when empty",
    "GET /api/crypto/high-risk": "source seeding",
    "GET /api/digest": "persists risk_gauges when empty",
    "GET /api/warnings": "persists warnings when empty",
    "PAGE /assets/[symbol]/page": "ensureSeedData on page (first page probed; seeds the shared empty DB, so later pages look clean until C5)",
  },
  populated: {
    "GET /api/instruments/[id]/series": "live provider fetch on GET",
  },
};
