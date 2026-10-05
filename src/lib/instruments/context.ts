import { getDb, getJsonById } from "../db";
import type { CountryProfile, FinancialEvent } from "../types";
import type { InstrumentRow } from "./store";

const CURRENCY_COUNTRY: Record<string, string> = {
  USD: "US",
  EUR: "EU",
  GBP: "GB",
  JPY: "JP",
  CHF: "CH",
  CNY: "CN",
  INR: "IN",
  BRL: "BR",
  CAD: "CA",
  AUD: "AU",
  KRW: "KR",
  MXN: "MX",
  SAR: "SA",
  ZAR: "ZA",
  TRY: "TR",
  ARS: "AR",
  IDR: "ID",
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match stored RSS/demo events by symbol or name. Never invents articles. */
export function linkedEvents(inst: InstrumentRow, limit = 8): { events: FinancialEvent[]; note: string } {
  const name = inst.name.trim();
  const needles: string[] = [];
  if (name.length >= 4) needles.push(name.toLowerCase());
  const sym = inst.symbol.trim().toLowerCase();
  const legacy = (inst.legacy_symbol || "").trim().toLowerCase();
  if (sym.length >= 3 && sym !== name.toLowerCase()) needles.push(sym);
  if (legacy && legacy.length >= 3 && !needles.includes(legacy)) needles.push(legacy);

  if (!needles.length) {
    return { events: [], note: "No linked events are in the store." };
  }

  const clauses = needles.map(() => `instr(lower(data), ?) > 0`).join(" OR ");
  const rows = getDb()
    .prepare(`SELECT data FROM events WHERE ${clauses} ORDER BY published_at DESC LIMIT 60`)
    .all(...needles) as { data: string }[];

  const symRe = sym.length >= 2 ? new RegExp(`\\b${escapeRe(sym)}\\b`, "i") : null;
  const legacyRe = legacy.length >= 2 ? new RegExp(`\\b${escapeRe(legacy)}\\b`, "i") : null;
  const out: FinancialEvent[] = [];
  for (const row of rows) {
    let ev: FinancialEvent;
    try {
      ev = JSON.parse(row.data) as FinancialEvent;
    } catch {
      continue;
    }
    const title = `${ev.title || ""} ${ev.summary || ""}`;
    const tags = (ev.tags || []).map((t) => t.toLowerCase());
    const chain = (ev.causalChain || []).map((c) => c.toLowerCase());
    const entities = (ev.classification?.entities || []).map((e) => e.toLowerCase());
    const nameHit =
      name.length >= 4 &&
      (title.toLowerCase().includes(name.toLowerCase()) ||
        tags.includes(name.toLowerCase()) ||
        entities.some((e) => e.includes(name.toLowerCase())));
    const tokenHit = (token: string, re: RegExp | null) =>
      !!token &&
      (tags.includes(token) ||
        chain.includes(token) ||
        entities.includes(token) ||
        (re ? re.test(title) : false));
    if (nameHit || tokenHit(sym, symRe) || tokenHit(legacy, legacyRe)) {
      out.push(ev);
    }
    if (out.length >= limit) break;
  }
  if (!out.length) return { events: [], note: "No linked events are in the store." };
  return {
    events: out.map((e) => ({
      ...e,
      rawText: "",
    })),
    note: `${out.length} linked event(s) from the existing store`,
  };
}

export interface MacroLink {
  code: string;
  name: string;
  href: string;
  policyRate: { label: string; value: string | number | null; unit?: string; source: string; quality: string } | null;
}

export function macroLinks(inst: InstrumentRow): { links: MacroLink[]; note: string } {
  const codes = new Set<string>();
  const country = (inst.country || "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(country)) codes.add(country);
  const ccy = (inst.currency || "").trim().toUpperCase();
  if (CURRENCY_COUNTRY[ccy]) codes.add(CURRENCY_COUNTRY[ccy]);
  const raw = (inst.raw_symbol_key || "").toUpperCase();
  const pair = raw.match(/^([A-Z]{3})([A-Z]{3})=X$/);
  if (pair) {
    if (CURRENCY_COUNTRY[pair[1]]) codes.add(CURRENCY_COUNTRY[pair[1]]);
    if (CURRENCY_COUNTRY[pair[2]]) codes.add(CURRENCY_COUNTRY[pair[2]]);
  }
  if (inst.asset_type === "crypto" && (ccy === "USD" || ccy === "")) {
    /* USD-quoted crypto links to stored US rates only when a quote established USD. */
    if (ccy === "USD") codes.add("US");
  }

  const links: MacroLink[] = [];
  Array.from(codes).forEach((code) => {
    const profile = getJsonById<CountryProfile>("countries", "code", code);
    if (!profile) return;
    const rate = profile.macro?.policyRate;
    links.push({
      code: profile.code,
      name: profile.name,
      href: `/countries/${profile.code}`,
      policyRate:
        rate && rate.value != null
          ? {
              label: rate.label,
              value: rate.value,
              unit: rate.unit,
              source: rate.source || "stored profile",
              quality: rate.quality,
            }
          : null,
    });
  });
  if (!links.length) {
    return { links: [], note: "No stored macro mapping for this instrument." };
  }
  return { links, note: "Stored country profile only. No new macro series." };
}
