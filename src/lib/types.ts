/** Core domain types — Calibra (probabilistic market intelligence) */

export type SourceTier = 1 | 2 | 3 | 4;
export type TimeHorizon =
  | "1h"
  | "1d"
  | "2d"
  | "intraday"
  | "1-7d"
  | "1-4w"
  | "1-3m"
  | "3-12m"
  | "1-5y";
export type DataQuality = "live" | "cached" | "demo" | "insufficient" | "proxy";
export type EvidenceKind = "observed_fact" | "interpretation" | "model_assumption" | "scenario_estimate";

/** Outcome buckets — thresholds live on each ForecastBucket.rangeMinPct/MaxPct */
export type OutcomeBucketLabel =
  | "strong_up"
  | "mod_up"
  | "range"
  | "mod_down"
  | "severe_down";

export type ForecastStatus = "open" | "resolved" | "expired_unresolvable";

export type ResolutionMethod =
  | "closest_snapshot_within_tolerance"
  | "yahoo_historical_bar_close"
  | "seed_synthetic"
  | "insufficient_evidence";

export interface Provenance {
  source: string;
  sourceTier: SourceTier;
  url?: string;
  fetchedAt: string;
  quality: DataQuality;
  note?: string;
  /** Source-reported observation time (e.g. Yahoo regularMarketTime), UTC ISO. */
  observedAt?: string | null;
  /** True when the live fetch failed and the last valid snapshot is shown unchanged (never written to history again). */
  carriedForward?: boolean;
  /** Why the latest fetch did not produce a valid quote. */
  errorClass?: string;
}

export interface MarketSnapshot {
  symbol: string;
  name: string;
  category: "equity_index" | "crypto" | "commodity" | "rates" | "fx" | "vol";
  price: number | null;
  change1d: number | null;
  change1w: number | null;
  change1m: number | null;
  volatilityEst: number | null;
  currency?: string;
  isProxy?: boolean;
  proxyNote?: string;
  provenance: Provenance;
  catalysts?: string[];
  scenarioSnippet?: string;
}

/** Append-only price observation used for honest outcome resolution */
export interface MarketHistoryPoint {
  id: string;
  symbol: string;
  price: number;
  ts: string;
  source: string;
  quality: DataQuality;
  /** live_snapshot = from refresh; yahoo_historical_bar = OHLC backfill */
  barKind: "live_snapshot" | "yahoo_historical_bar";
  note?: string;
}

export interface FinancialEvent {
  id: string;
  title: string;
  summary: string;
  rawText: string;
  country?: string;
  region?: string;
  sector?: string;
  assetClass?: string;
  transmissionMechanism: string;
  causalChain: string[];
  expectedImpact: string;
  timeHorizon: TimeHorizon;
  impactScore: ImpactScore;
  sourceTier: SourceTier;
  sourceName: string;
  citationUrl?: string;
  publishedAt: string;
  ingestedAt: string;
  quality: DataQuality;
  tags: string[];
  classification: EventClassification;
  /** Ingestion provenance (records ingested from 2026-10-17 onward; older rows may lack it). */
  provenance?: EventProvenance;
  /** Explicit evidence layers for UI (Observed / Interpretation / Assumption / Estimate) */
  evidenceLayers?: {
    observed: string[];
    interpretation: string[];
    modelAssumptions: string[];
    scenarioEstimates: string[];
  };
}

/** Where an event record came from and what was done to it. Times are UTC ISO-8601. */
export interface EventProvenance {
  sourceId: string;
  sourceName: string;
  feedUrl: string;
  itemUrl: string | null;
  /** Publish time reported by the source; null when the item carried none (never back-filled with retrieval time). */
  sourcePublishedAt: string | null;
  retrievedAt: string;
  /** observed = taken from the source; derived = computed from observed fields; estimated = model output; missing = absent. */
  fields: Record<string, "observed" | "derived" | "estimated" | "missing">;
  transformations: string[];
  /** Filled by the clustering pass (event_clusters); originals are never merged or deleted. */
  corroboration?: { canonicalEventId: string | null; clusterSize: number; sources: string[] } | null;
  pipeline: string;
}

export type EventType =
  | "monetary_policy"
  | "fiscal"
  | "inflation"
  | "growth"
  | "labor"
  | "geopolitics"
  | "sanction"
  | "regulation"
  | "earnings"
  | "credit"
  | "commodity_supply"
  | "fx_regime"
  | "liquidity"
  | "other";

export type ImpactDirection = "bullish" | "bearish" | "mixed" | "unclear";

export interface TransmissionChainStep {
  /** Node label in the chain */
  node: string;
  /** Mechanism edge label INTO this node (undefined for the first/shock node) */
  edgeLabel?: string;
  /** Knowledge-graph node id when mapped */
  graphNodeId?: string;
}

export interface ExpectedImpactByAsset {
  assetClass: string;
  direction: ImpactDirection;
  /** Separate notes per horizon — do not mix short-term and structural */
  horizons: Partial<Record<TimeHorizon, string>>;
}

export interface StructuredEntities {
  countries: string[];
  institutions: string[];
  sectors: string[];
  assetClasses: string[];
  /** Named instruments only when explicit in source text */
  instruments: string[];
}

export interface EventTaxonomy {
  countries: string[];
  regions: string[];
  sectors: string[];
  assetClasses: string[];
}

export interface EventClassification {
  categories: string[];
  entities: string[];
  sentiment: "hawkish" | "dovish" | "risk_on" | "risk_off" | "neutral" | "mixed";
  confidence: number;
  method: "heuristic_v1" | "heuristic_v2";
  /** v2 structured fields */
  event_type?: EventType;
  taxonomy?: EventTaxonomy;
  structuredEntities?: StructuredEntities;
  transmission_chain?: TransmissionChainStep[];
  transmission_narrative?: string;
  expected_impact?: ExpectedImpactByAsset[];
  contradicting_evidence?: string[];
  key_assumptions?: string[];
  confidence_rationale?: string;
  classifier_version?: "heuristic_v1" | "heuristic_v2";
  /** Prior classification retained for audit when reclassified */
  previous_classification?: Omit<EventClassification, "previous_classification">;
}

export interface ImpactScoreDimensionWhy {
  magnitude: string;
  probability: string;
  marketSensitivity: string;
  transmissionSpeed: string;
  persistence: string;
  confidence: string;
}

export interface ImpactScore {
  magnitude: number; // 0-100
  probability: number;
  marketSensitivity: number;
  transmissionSpeed: number;
  persistence: number;
  confidence: number;
  composite: number;
  methodology: string;
  /** Per-dimension rationale for UI expandable panel */
  dimensionWhy?: ImpactScoreDimensionWhy;
}

export interface Scenario {
  id: string;
  eventId?: string;
  assetSymbol?: string;
  title: string;
  base: ScenarioBranch;
  bull: ScenarioBranch;
  bear: ScenarioBranch;
  tail: ScenarioBranch;
  timeHorizon: TimeHorizon;
  affectedAssets: string[];
  createdAt: string;
  updatedAt: string;
  snapshotId?: string;
  label: "estimate";
}

export interface ScenarioBranch {
  name: "base" | "bull" | "bear" | "tail";
  probability: number;
  confidence: number;
  narrative: string;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  keyAssumptions: string[];
  invalidationConditions: string[];
  affectedAssets: string[];
}

export interface Forecast {
  id: string;
  assetSymbol: string;
  assetName: string;
  horizon: TimeHorizon;
  /** Absolute ISO timestamp when the forecast window ends */
  horizonEnd: string;
  createdAt: string;
  /** Origin price at forecast creation — required for return calculation */
  asOfPrice: number | null;
  /** Alias stored for clarity in resolution path */
  originPrice: number | null;
  distribution: ForecastBucket[];
  rationale: string;
  invalidators: string[];
  dataThatWouldChange: string[];
  evidenceSnapshot: string[];
  isSeed: boolean;
  status: ForecastStatus;
  outcome?: ForecastOutcome;
  provenance: Provenance;
  /** Transparent demo labeling for backdated calibration bootstrap */
  resolutionNote?: string;
  assetClass?: string;
}

export interface ForecastBucket {
  label: OutcomeBucketLabel | string;
  rangeMinPct: number;
  rangeMaxPct: number;
  probability: number;
}

export interface ForecastOutcome {
  resolvedAt: string;
  /** Observed price/level at/near horizon end — never invented */
  outcomeValue: number;
  outcomeSource: string;
  outcomeAsof: string;
  realizedReturnPct: number;
  hitBucket: string;
  outcomeBucket: string;
  directionalCorrect: boolean | null;
  directionalHit: boolean | null;
  absoluteError: number;
  brierContribution: number;
  brierScore: number;
  notes: string;
  resolutionMethod: ResolutionMethod;
  /** UI badge: Resolved via historical bars | Resolved via live snapshot log */
  resolutionBadge?: "historical_bars" | "live_snapshot" | "seed_synthetic" | "unresolvable";
  forecastErrorNotes?: string;
}

export interface RiskGauge {
  id: string;
  name: string;
  score: number; // 0-100
  direction: "rising" | "falling" | "stable";
  confidence: number;
  rationale: string;
  methodology: string;
  inputs: string[];
}

export interface WarningSignal {
  id: string;
  title: string;
  signal: string;
  evidence: string[];
  historicalPrecedent: string;
  transmission: string;
  confidence: number;
  severity: "low" | "medium" | "high" | "critical";
  relatedAssets: string[];
  createdAt: string;
  active: boolean;
}

export interface CausalNode {
  id: string;
  label: string;
  type: "event" | "indicator" | "asset" | "institution" | "country";
  group?: string;
}

export interface CausalEdge {
  id: string;
  source: string;
  target: string;
  strength: number;
  trend: "strengthening" | "weakening" | "stable";
  mechanism: string;
  historicalExamples: string[];
  currentEvidence: string[];
  caveats: string;
  /** Typical directional sign of the transmission */
  typicalSign?: "positive" | "negative" | "mixed";
  /** Typical time horizon for this edge */
  typicalHorizon?: TimeHorizon;
  /** Knowledge-graph version that authored this edge */
  graphVersion?: string;
  /** Event ids that currently activate this edge */
  activatedByEventIds?: string[];
}

export interface CausalGraph {
  nodes: CausalNode[];
  edges: CausalEdge[];
  updatedAt: string;
  graphVersion?: string;
}

export interface CountryProfile {
  code: string;
  name: string;
  region: string;
  isG20: boolean;
  macro: Record<string, MacroField>;
  political: string;
  regulatory: string;
  marketImpact: string;
  activeEvents: string[];
  lastUpdated: string;
}

export interface MacroField {
  label: string;
  value: string | number | null;
  unit?: string;
  asOf?: string;
  source?: string;
  quality: DataQuality;
}

export type AlertChannel = "in_app" | "email" | "webhook";

export type AlertMetric =
  | "severe_down_prob"
  | "price_change_1d"
  | "risk_gauge"
  | "vix_level"
  | "scenario_prob"
  | "forecast_invalidation"
  | "large_move"
  | "high_impact_event";

export interface AlertRule {
  id: string;
  name: string;
  condition: string;
  assetSymbol?: string;
  /** For scenario_prob: scenario id or branch name */
  scenarioId?: string;
  scenarioBranch?: "base" | "bull" | "bear" | "tail";
  threshold: number;
  metric: AlertMetric | string;
  enabled: boolean;
  createdAt: string;
  lastFiredAt?: string;
  /** Channels — in_app always on; email/webhook Pro */
  channels?: AlertChannel[];
  emailAddress?: string;
  webhookUrl?: string;
  userId?: string;
  /** Minimum minutes between firings (default 15). */
  cooldownMinutes?: number;
  /** risk_gauge only: fire on upward cross of threshold, or a rise of reFireOnRise points since last fire. */
  riseOnly?: boolean;
  reFireOnRise?: number;
  /** Last observed metric value (used for cross detection). */
  lastValue?: number;
  lastFiredValue?: number;
}

export interface FiredAlert {
  id: string;
  ruleId: string;
  ruleName: string;
  message: string;
  firedAt: string;
  acknowledged: boolean;
  channelsDelivered?: AlertChannel[];
  deliveryNotes?: string[];
}

export interface AlertOutboxEntry {
  id: string;
  kind: "email" | "webhook";
  to?: string;
  url?: string;
  subject?: string;
  body: string;
  ruleId?: string;
  firedAlertId?: string;
  createdAt: string;
  status: "queued" | "logged" | "failed";
  note: string;
}

export interface PortfolioHolding {
  symbol: string;
  name?: string;
  weight?: number;
  quantity?: number;
  assetClass?: string;
  /** Canonical instrument id when a single venue resolved. Omitted when ambiguous. */
  instrumentId?: string;
}

export interface MetaState {
  lastMarketUpdate: string | null;
  lastEventUpdate: string | null;
  lastRiskUpdate: string | null;
  dataQuality: DataQuality;
  notes: string[];
}
