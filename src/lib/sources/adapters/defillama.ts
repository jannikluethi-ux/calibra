import { getDb } from "../../db";
import { fetchJson } from "../http";
import { appendObservation } from "../observations";

const URL = "https://api.llama.fi/protocols";

export async function runDefillama(): Promise<{ httpStatus: number | null; ok: boolean; note: string; observations: number; partial: boolean }> {
  const res = await fetchJson(URL, 60000);
  if (res.rateLimited) {
    return { httpStatus: 429, ok: false, note: "DefiLlama HTTP 429. No TVL stored.", observations: 0, partial: true };
  }
  if (!res.ok || !Array.isArray(res.json)) {
    return {
      httpStatus: res.status,
      ok: false,
      note: `DefiLlama failed: HTTP ${res.status} ${res.error || "not an array"}`.slice(0, 400),
      observations: 0,
      partial: false,
    };
  }
  const db = getDb();
  const rows = db.prepare(`SELECT id, provider_id FROM instruments WHERE data_source = 'coingecko'`).all() as {
    id: string;
    provider_id: string;
  }[];
  const byGecko = new Map(rows.map((r) => [r.provider_id, r.id]));
  const retrievedAt = new Date().toISOString();
  let observations = 0;
  let withGecko = 0;
  let matched = 0;
  const insertMany = db.transaction(() => {
    for (const item of res.json as Record<string, unknown>[]) {
      const gecko = typeof item.gecko_id === "string" ? item.gecko_id.trim() : "";
      if (!gecko) continue;
      withGecko += 1;
      const instrumentId = byGecko.get(gecko);
      if (!instrumentId) continue;
      matched += 1;
      const tvl = item.tvl;
      if (typeof tvl !== "number" || !Number.isFinite(tvl)) continue;
      const wrote = appendObservation({
        instrumentId,
        field: "tvl_usd",
        value: {
          tvl,
          gecko_id: gecko,
          slug: typeof item.slug === "string" ? item.slug : null,
          protocol_name: typeof item.name === "string" ? item.name : null,
        },
        unit: "USD",
        currency: "USD",
        observedAt: null,
        retrievedAt,
        sourceId: "defillama",
        sourceUrl: URL,
        claimType: "reported_claim",
      });
      if (wrote) observations += 1;
    }
  });
  insertMany();
  return {
    httpStatus: res.status,
    ok: true,
    note: `HTTP ${res.status}. Protocols with gecko_id: ${withGecko}. Exact provider_id matches: ${matched}. TVL observations appended: ${observations}. No name-only matches.`,
    observations,
    partial: false,
  };
}
