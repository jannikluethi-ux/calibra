import { getDb } from "../db";
import { getInstrument, type InstrumentRow } from "../instruments/store";
import { prepareCryptoStore } from "../sources/prepare";
import { CONFIDENCE_FORMULA_TEXT, freshnessLabel } from "../sources/weights";
import { cryptoTier, TIER_TEXT } from "./format";
import { relatedInstruments } from "./resolve";
import { RISK_BAND_TEXT, RISK_FACTORS } from "./risk";

export interface ResearchPayload {
  found: boolean;
  instrument: InstrumentRow | null;
  tier: 1 | 2 | 3 | 4 | null;
  tier_text: string | null;
  canonical: Record<string, unknown> | null;
  price_observations: {
    source_id: string;
    source_name: string;
    source_class: string;
    value: number;
    observed_at: string | null;
    retrieved_at: string;
    source_url: string | null;
    enabled: number;
  }[];
  observations: {
    source_id: string;
    source_name: string;
    source_class: string;
    field: string;
    value: unknown;
    unit: string | null;
    currency: string | null;
    observed_at: string | null;
    retrieved_at: string;
    source_url: string | null;
    claim_type: string | null;
    enabled: number;
  }[];
  description: {
    text: string;
    source_id: string;
    source_name: string;
    claim_type: string;
    retrieved_at: string;
    source_url: string | null;
    label: string;
  } | null;
  about_status: "reported" | "fetched_no_description" | "not_fetched";
  unsourced_sections: string[];
  risk: Record<string, unknown> | null;
  related: { items: Pick<InstrumentRow, "id" | "symbol" | "name" | "data_source" | "quote_status" | "price" | "rank">[]; total: number };
  news: { event_id: string; title: string; source_name: string | null; citation_url: string | null; published_at: string | null; match_kind: string; source_id: string | null }[];
  news_count: number;
  timestamps: { retrieved_at: string[]; observed_at: string[] };
  confidence_formula: string;
  risk_bands: string;
  disagreement_note: string | null;
}

function decodeMaybe(id: string): string {
  let out = id;
  if (out.includes("%")) {
    try {
      out = decodeURIComponent(out);
    } catch {
      /* keep raw */
    }
  }
  return out;
}

export function getResearch(rawId: string): ResearchPayload {
  prepareCryptoStore();
  const id = decodeMaybe(rawId);
  const instrument = getInstrument(id);
  const emptyNews: ResearchPayload["news"] = [];
  if (!instrument) {
    return {
      found: false,
      instrument: null,
      tier: null,
      tier_text: null,
      canonical: null,
      price_observations: [],
      observations: [],
      description: null,
      about_status: "not_fetched",
      unsourced_sections: ["founders", "funding", "bull_case", "bear_case", "current_state"],
      risk: null,
      related: { items: [], total: 0 },
      news: emptyNews,
      news_count: 0,
      timestamps: { retrieved_at: [], observed_at: [] },
      confidence_formula: CONFIDENCE_FORMULA_TEXT,
      risk_bands: RISK_BAND_TEXT,
      disagreement_note: null,
    };
  }

  const db = getDb();
  const obsRows = db
    .prepare(
      `SELECT o.field, o.value_json, o.unit, o.currency, o.observed_at, o.retrieved_at, o.source_url, o.claim_type,
              o.source_id, s.name AS source_name, s.source_class, s.enabled
       FROM source_observations o
       JOIN sources s ON s.id = o.source_id
       WHERE o.instrument_id = ?
       ORDER BY o.field, o.retrieved_at DESC`
    )
    .all(instrument.id) as {
    field: string;
    value_json: string;
    unit: string | null;
    currency: string | null;
    observed_at: string | null;
    retrieved_at: string;
    source_url: string | null;
    claim_type: string | null;
    source_id: string;
    source_name: string;
    source_class: string;
    enabled: number;
  }[];

  const observations = obsRows.map((row) => ({
    source_id: row.source_id,
    source_name: row.source_name,
    source_class: row.source_class,
    field: row.field,
    value: JSON.parse(row.value_json) as unknown,
    unit: row.unit,
    currency: row.currency,
    observed_at: row.observed_at,
    retrieved_at: row.retrieved_at,
    source_url: row.source_url,
    claim_type: row.claim_type,
    enabled: row.enabled,
  }));

  const price_observations = observations
    .filter((o) => o.field === "price" && typeof o.value === "number")
    .map((o) => ({
      source_id: o.source_id,
      source_name: o.source_name,
      source_class: o.source_class,
      value: o.value as number,
      observed_at: o.observed_at,
      retrieved_at: o.retrieved_at,
      source_url: o.source_url,
      enabled: o.enabled,
    }));

  const canonicalRows = db
    .prepare(`SELECT * FROM canonical_fields WHERE instrument_id = ?`)
    .all(instrument.id) as {
    field: string;
    consensus_value_json: string | null;
    method: string;
    confidence: number | null;
    n_sources: number;
    disagreement: number;
    spread: number | null;
    as_of: string | null;
    stale: number;
  }[];

  const canonical: Record<string, unknown> = {};
  for (const row of canonicalRows) {
    const retrieved = observations.filter((o) => o.field === row.field && o.enabled === 1).map((o) => o.retrieved_at);
    const newest = retrieved.sort().at(-1) ?? null;
    const age = newest ? Date.now() - new Date(newest).getTime() : null;
    canonical[row.field] = {
      value: row.consensus_value_json == null ? null : (JSON.parse(row.consensus_value_json) as unknown),
      method: row.method,
      confidence: row.confidence,
      n_sources: row.n_sources,
      disagreement: row.disagreement,
      spread: row.spread,
      as_of: row.as_of,
      stale: row.stale === 1,
      freshness: freshnessLabel(age),
      newest_retrieved_at: newest,
    };
  }

  const desc = observations.find((o) => o.field === "description" && o.value && typeof o.value === "object");
  const descText =
    desc && desc.value && typeof desc.value === "object" && "text" in (desc.value as object)
      ? String((desc.value as { text: unknown }).text)
      : null;
  const description = desc && descText
    ? {
        text: descText,
        source_id: desc.source_id,
        source_name: desc.source_name,
        claim_type: desc.claim_type || "reported_claim",
        retrieved_at: desc.retrieved_at,
        source_url: desc.source_url,
        label: "Reported by CoinGecko",
      }
    : null;
  const projectRows = observations.filter((o) => o.source_id === "coingecko_project");
  const about_status = description
    ? "reported"
    : projectRows.length
      ? "fetched_no_description"
      : "not_fetched";

  const riskRow = db
    .prepare(`SELECT * FROM crypto_risk_assessments WHERE instrument_id = ?`)
    .get(instrument.id) as
    | {
        computed_at: string;
        total: number;
        band: string;
        components_json: string;
        factors_scored: number;
        factors_possible: number;
        market_factors_scored: number;
        band_capped: number;
        cap_reason: string | null;
      }
    | undefined;

  const related = relatedInstruments(instrument, 8);
  const newsCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM instrument_event_links WHERE instrument_id = ? AND match_kind IN ('contract_address','coingecko_id')`).get(instrument.id) as {
      c: number;
    }
  ).c;
  const newsRows = db
    .prepare(
      `SELECT l.event_id, l.match_kind, l.source_id, e.published_at, e.data
       FROM instrument_event_links l
       JOIN events e ON e.id = l.event_id
       WHERE l.instrument_id = ? AND l.match_kind IN ('contract_address','coingecko_id')
       ORDER BY e.published_at DESC
       LIMIT 8`
    )
    .all(instrument.id) as {
    event_id: string;
    match_kind: string;
    source_id: string | null;
    published_at: string;
    data: string;
  }[];
  const news = newsRows.map((row) => {
    let title = "Unknown";
    let citation: string | null = null;
    let sourceName: string | null = null;
    try {
      const parsed = JSON.parse(row.data) as { title?: string; citationUrl?: string; sourceName?: string };
      title = parsed.title || title;
      citation = parsed.citationUrl || null;
      sourceName = parsed.sourceName || null;
    } catch {
      /* leave unknown */
    }
    return {
      event_id: row.event_id,
      title,
      source_name: sourceName,
      citation_url: citation,
      published_at: row.published_at,
      match_kind: row.match_kind,
      source_id: row.source_id,
    };
  });

  const priceCanon = canonical.price as { disagreement?: number; n_sources?: number } | undefined;
  let disagreement_note: string | null = null;
  if (price_observations.length >= 2) {
    const enabledPrices = price_observations.filter((p) => p.enabled === 1);
    const shown = (enabledPrices.length ? enabledPrices : price_observations)
      .map((p) => `${p.source_name} ${p.value}`)
      .join("; ");
    if (priceCanon?.disagreement === 1) {
      disagreement_note = `Discrepancy: enabled price sources differ by more than the 1% threshold. Median is a consensus statistic only. Originals remain. Values: ${shown}.`;
    } else {
      disagreement_note = `The enabled prices are within the 1% threshold. Both values are shown and neither was discarded. Values: ${shown}.`;
    }
  } else if (price_observations.length === 1) {
    disagreement_note = "Only one price source is stored for this coin, so there is no cross-source check.";
  }

  const tier = cryptoTier(instrument);
  return {
    found: true,
    instrument,
    tier,
    tier_text: TIER_TEXT[tier],
    canonical,
    price_observations,
    observations,
    description,
    about_status,
    unsourced_sections: ["founders", "funding", "bull_case", "bear_case", "current_state"],
    risk: riskRow
      ? {
          computed_at: riskRow.computed_at,
          total: riskRow.total,
          band: riskRow.band,
          components: JSON.parse(riskRow.components_json) as unknown,
          factors_scored: riskRow.factors_scored,
          factors_possible: riskRow.factors_possible,
          market_factors_scored: riskRow.market_factors_scored,
          band_capped: riskRow.band_capped === 1,
          cap_reason: riskRow.cap_reason,
          factor_order: RISK_FACTORS,
        }
      : null,
    related: {
      total: related.total,
      items: related.items.map((i) => ({
        id: i.id,
        symbol: i.symbol,
        name: i.name,
        data_source: i.data_source,
        quote_status: i.quote_status,
        price: i.price,
        rank: i.rank,
      })),
    },
    news,
    news_count: newsCount,
    timestamps: {
      retrieved_at: Array.from(new Set(observations.map((o) => o.retrieved_at))),
      observed_at: Array.from(new Set(observations.map((o) => o.observed_at).filter((x): x is string => !!x))),
    },
    confidence_formula: CONFIDENCE_FORMULA_TEXT,
    risk_bands: RISK_BAND_TEXT,
    disagreement_note,
  };
}
