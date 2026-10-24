/**
 * Exact list of targets that still write (or reach a provider) on GET. Shrinks with each B2 get-fix commit and must
 * end EMPTY. A listed target that turns clean fails the suite, so this list can never go stale.
 */
export const KNOWN_WRITERS: Record<"empty" | "populated", Record<string, string>> = {
  empty: {},
  populated: {
    "GET /api/instruments/[id]/series": "live provider fetch on GET",
  },
};
