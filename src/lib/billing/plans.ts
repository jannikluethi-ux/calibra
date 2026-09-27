/**
 * Calibra plan definitions — Free | Pro | API.
 * Pricing numbers are draft suggestions only (see docs/MONETIZATION.md).
 */

export type PlanId = "free" | "pro" | "api";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  /** Draft suggestion in CHF / month — not a committed list price */
  draftPriceChfMonthly: number | null;
  draftPriceNote: string;
  features: string[];
  limits: {
    eventsPageSize: number;
    scenariosTeaser: number;
    moversLimit: number;
    moversDelayedHours: number;
    apiKeysAllowed: boolean;
    apiKeysMax: number;
    apiRatePerMinute: number;
    emailAlerts: boolean;
    webhookAlerts: boolean;
    portfolio: boolean;
    analyst: boolean;
    simulator: boolean;
    exports: boolean;
    fullCalibration: boolean;
    fullEvents: boolean;
    fullScenarios: boolean;
    fullMap: boolean;
  };
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Dashboard, limited events, elevated-prob teaser, methodology.",
    draftPriceChfMonthly: 0,
    draftPriceNote: "CHF 0 — draft suggestion",
    features: [
      "Dashboard & risk gauges",
      "Elevated-prob board (top 5, delayed framing)",
      "Events teaser (last 20)",
      "Methodology & Live calibration summary",
      "In-app alerts (basic)",
    ],
    limits: {
      eventsPageSize: 20,
      scenariosTeaser: 3,
      moversLimit: 5,
      moversDelayedHours: 6,
      apiKeysAllowed: false,
      apiKeysMax: 0,
      apiRatePerMinute: 0,
      emailAlerts: false,
      webhookAlerts: false,
      portfolio: false,
      analyst: false,
      simulator: false,
      exports: false,
      fullCalibration: false,
      fullEvents: false,
      fullScenarios: false,
      fullMap: false,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "Full terminal: events, scenarios, map, alerts, portfolio, calibration.",
    draftPriceChfMonthly: 199,
    draftPriceNote: "Draft suggestion: CHF 149–249 / seat / month (shown mid: 199)",
    features: [
      "Full events, scenarios, causal map",
      "Live calibration detail + exports",
      "Alerts: in-app + email + webhook",
      "Portfolio impact, Analyst, Simulator",
      "Optional limited API key (60 req/min)",
    ],
    limits: {
      eventsPageSize: 500,
      scenariosTeaser: 999,
      moversLimit: 20,
      moversDelayedHours: 0,
      apiKeysAllowed: true,
      apiKeysMax: 2,
      apiRatePerMinute: 60,
      emailAlerts: true,
      webhookAlerts: true,
      portfolio: true,
      analyst: true,
      simulator: true,
      exports: true,
      fullCalibration: true,
      fullEvents: true,
      fullScenarios: true,
      fullMap: true,
    },
  },
  api: {
    id: "api",
    name: "API",
    tagline: "Pro features + full API keys and higher rate limits.",
    draftPriceChfMonthly: 499,
    draftPriceNote: "Draft suggestion: CHF 399–799 / org / month (shown mid: 499)",
    features: [
      "Everything in Pro",
      "Full API keys (up to 10)",
      "Higher rate limits (600 req/min)",
      "Programmatic events / scenarios / forecasts / movers / calibration",
    ],
    limits: {
      eventsPageSize: 1000,
      scenariosTeaser: 999,
      moversLimit: 20,
      moversDelayedHours: 0,
      apiKeysAllowed: true,
      apiKeysMax: 10,
      apiRatePerMinute: 600,
      emailAlerts: true,
      webhookAlerts: true,
      portfolio: true,
      analyst: true,
      simulator: true,
      exports: true,
      fullCalibration: true,
      fullEvents: true,
      fullScenarios: true,
      fullMap: true,
    },
  },
};

export const DEMO_CREDENTIALS = [
  { email: "pro@calibra.local", password: "calibra-pro-demo", plan: "pro" as PlanId },
  { email: "free@calibra.local", password: "calibra-free-demo", plan: "free" as PlanId },
];

export function planAtLeast(userPlan: PlanId, required: PlanId): boolean {
  const rank: Record<PlanId, number> = { free: 0, pro: 1, api: 2 };
  return rank[userPlan] >= rank[required];
}

export function getPlan(id: PlanId | string | null | undefined): PlanDefinition {
  if (id === "pro" || id === "api" || id === "free") return PLANS[id];
  return PLANS.free;
}
