import { getEvents } from "../ingestion/rss";
import { getScenarios } from "../scenarios/engine";
import { getMarketSnapshots } from "../market/fetch";
import { getWarnings } from "../warnings/detect";
import { getForecasts } from "../forecast/distributions";
import { getRiskGauges } from "../risk/gauges";

export interface AnalystMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnalystResponse {
  answer: string;
  structure: {
    evidence: string[];
    reasoning: string[];
    scenario: string[];
    uncertainty: string[];
  };
  usedSources: string[];
  insufficient: boolean;
}

function matchItems(q: string) {
  const query = q.toLowerCase();
  const events = getEvents(50).filter(
    (e) =>
      e.title.toLowerCase().includes(query) ||
      e.tags.some((t) => query.includes(t)) ||
      e.classification.categories.some((c) => query.includes(c)) ||
      (e.country && query.includes(e.country.toLowerCase()))
  );
  const markets = getMarketSnapshots().filter(
    (m) =>
      query.includes(m.symbol.toLowerCase()) ||
      m.name.toLowerCase().includes(query) ||
      query.split(/\s+/).some((w) => m.name.toLowerCase().includes(w) && w.length > 3)
  );
  const scenarios = getScenarios().filter(
    (s) =>
      s.title.toLowerCase().includes(query) ||
      s.affectedAssets.some((a) => query.includes(a.toLowerCase()))
  );
  const warnings = getWarnings().filter(
    (w) =>
      w.title.toLowerCase().includes(query) ||
      w.relatedAssets.some((a) => query.includes(a.toLowerCase()))
  );
  const forecasts = getForecasts().filter((f) => query.includes(f.assetSymbol.toLowerCase()));
  return { events, markets, scenarios, warnings, forecasts, gauges: getRiskGauges() };
}

export function answerQuestion(question: string): AnalystResponse {
  const q = question.trim();
  if (!q) {
    return {
      answer: "Insufficient evidence: empty question.",
      structure: { evidence: [], reasoning: [], scenario: [], uncertainty: ["No question provided."] },
      usedSources: [],
      insufficient: true,
    };
  }

  const { events, markets, scenarios, warnings, forecasts, gauges } = matchItems(q);
  const broad =
    /risk|market|overview|global|what.?s going|summary|dashboard/i.test(q) ||
    (events.length === 0 && markets.length === 0);

  const evidence: string[] = [];
  const reasoning: string[] = [];
  const scenario: string[] = [];
  const uncertainty: string[] = [];
  const usedSources: string[] = [];

  if (broad) {
    for (const g of gauges.slice(0, 6)) {
      evidence.push(`OBSERVED/DERIVED gauge ${g.name}: score=${g.score}, dir=${g.direction}, conf=${g.confidence}% — ${g.rationale}`);
      usedSources.push(`risk:${g.id}`);
    }
    for (const m of getMarketSnapshots().filter((x) => x.price != null).slice(0, 8)) {
      evidence.push(
        `OBSERVED ${m.symbol} (${m.name}): px=${m.price}, 1d=${m.change1d?.toFixed?.(2)}%, quality=${m.provenance.quality}, asOf=${m.provenance.fetchedAt}`
      );
      usedSources.push(`market:${m.symbol}`);
    }
    for (const e of getEvents(5)) {
      evidence.push(`[${e.quality}] EVENT: ${e.title} | ${e.sourceName} | tier ${e.sourceTier}`);
      usedSources.push(`event:${e.id}`);
    }
  }

  for (const m of markets.slice(0, 6)) {
    evidence.push(
      `OBSERVED ${m.symbol}: price=${m.price}, 1w=${m.change1w}%, 1m=${m.change1m}%, volEst=${m.volatilityEst}, provenance=${m.provenance.source} @ ${m.provenance.fetchedAt} (${m.provenance.quality})${m.isProxy ? ` PROXY: ${m.proxyNote}` : ""}`
    );
    usedSources.push(`market:${m.symbol}`);
  }

  for (const e of events.slice(0, 6)) {
    evidence.push(
      `[${e.quality}] ${e.title} — chain: ${e.causalChain.join(" → ")} — source: ${e.sourceName} (tier ${e.sourceTier}) ${e.citationUrl ?? ""}`
    );
    reasoning.push(`INTERPRETATION: ${e.transmissionMechanism.slice(0, 280)}`);
    usedSources.push(`event:${e.id}`);
  }

  for (const s of scenarios.slice(0, 3)) {
    scenario.push(
      `ESTIMATE ${s.title}: Base ${s.base.probability}% / Bull ${s.bull.probability}% / Bear ${s.bear.probability}% / Tail ${s.tail.probability}% (horizon ${s.timeHorizon}). Base: ${s.base.narrative.slice(0, 200)}`
    );
    uncertainty.push(...s.base.contradictingEvidence.slice(0, 2));
    usedSources.push(`scenario:${s.id}`);
  }

  for (const w of warnings.slice(0, 3)) {
    evidence.push(`WARNING: ${w.title} — ${w.signal} (conf ${w.confidence}%)`);
    reasoning.push(`Transmission: ${w.transmission}`);
    usedSources.push(`warning:${w.id}`);
  }

  for (const f of forecasts.slice(0, 3)) {
    scenario.push(
      `FORECAST ESTIMATE ${f.assetSymbol} ${f.horizon}: ${f.distribution.map((b) => `${b.label}=${b.probability}%`).join(", ")} | ${f.rationale.slice(0, 180)}`
    );
    uncertainty.push(...f.invalidators.slice(0, 2));
    usedSources.push(`forecast:${f.id}`);
  }

  const insufficient =
    evidence.length === 0 && scenario.length === 0 && !broad;

  if (insufficient) {
    uncertainty.push(
      "Insufficient evidence in the current event/scenario/market store to answer reliably. Try refreshing data or asking about a covered asset (SPX, BTC, US10Y, …) or recent event theme (Fed, BOJ, inflation)."
    );
  } else {
    uncertainty.push(
      "Answers are constrained to the local store. No external knowledge claimed beyond stored snapshots.",
      "Simulations ≠ forecasts ≠ facts. Probabilities are heuristic estimates."
    );
  }

  if (reasoning.length === 0 && evidence.length > 0) {
    reasoning.push(
      "INTERPRETATION: Combining stored market snapshots and classified events into a structured brief. No additional facts invented."
    );
  }

  const answer = [
    "## Evidence",
    evidence.length ? evidence.map((e) => `• ${e}`).join("\n") : "• Insufficient stored evidence.",
    "",
    "## Reasoning",
    reasoning.length ? reasoning.map((e) => `• ${e}`).join("\n") : "• Insufficient basis for interpretation.",
    "",
    "## Scenario",
    scenario.length ? scenario.map((e) => `• ${e}`).join("\n") : "• No matching scenario estimates in store.",
    "",
    "## Uncertainty",
    uncertainty.map((e) => `• ${e}`).join("\n"),
  ].join("\n");

  return { answer, structure: { evidence, reasoning, scenario, uncertainty }, usedSources, insufficient };
}
