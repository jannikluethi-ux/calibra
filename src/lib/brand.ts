/**
 * Centralized product branding — swap name/tagline here only.
 */
export const brand = {
  name: "Calibra",
  shortName: "Calibra",
  tagline: "Probabilistic market intelligence — calibrated, traceable, never certain.",
  philosophy: "Prefer uncertainty over false precision",
  evidenceChain: "Observed → Interpreted → Estimated",
  description:
    "Calibra — probabilistic market intelligence. Event detection, scenario analysis, and forecast tracking. Calibrated, traceable, never certain.",
  /** Product framing for elevated-probability boards (never buy/sell language) */
  upsideLabel: "Elevated upside scenario probability",
  downsideLabel: "Elevated downside scenario probability",
  upsideHint:
    "Ranking where current evidence most raises estimated P(upside scenarios) for the selected horizon — not a prediction that prices will rise.",
  downsideHint:
    "Ranking where current evidence most raises estimated P(downside scenarios) for the selected horizon — not a prediction that prices will fall.",
} as const;

export type Brand = typeof brand;
