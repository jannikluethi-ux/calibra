/**
 * Conflicting-evidence detection (conflict_v1). Disagreements are preserved, never resolved:
 * the code does not pick a side, and it never consults existing forecasts or scenarios when comparing.
 *
 *  - factual: two items report different values for the same verifiable statistic (inflation rate, GDP growth,
 *    unemployment rate, policy-rate level, size of a rate move in bp, deficit size). Checked only inside a
 *    same-story duplicate group, or for items on the same mechanism + region published within 24h.
 *    Forward-looking numbers (targets, forecasts, expectations) are excluded - they are not facts.
 *  - interpretive: two items carry opposite directional readings (hawkish vs dovish, risk-on vs risk-off)
 *    of the same mechanism + region within 48h (or inside the same duplicate group). Not verifiable.
 */
import { createHash } from "crypto";

export const CONFLICT_VERSION = "conflict_v1";

export interface ConflictInput {
  id: string;
  title: string;
  summary: string;
  sentiment: string;
  classifierConfidence: number;
  tier: number;
  sourceName: string;
  publishedAt: string;
  mechanisms: string[]; // text-matched only
  regions: string[];
  groupKey: string | null; // canonical event id of the duplicate group
}

export interface NumericClaim {
  metric: string;
  value: number;
  unit: "%" | "bp" | "usd_bn";
  /** Period basis read from the surrounding words: yoy / mom / qoq / unspecified. Claims are only compared on the same basis. */
  basis: "yoy" | "mom" | "qoq" | "unspecified";
  core: boolean;
  text: string;
}

function periodBasis(s: string): NumericClaim["basis"] {
  if (/\b(?:annual(?:ly)?|year[- ]on[- ]year|from a year (?:ago|earlier)|y\/y|yoy|12[- ]month)\b/i.test(s)) return "yoy";
  if (/\b(?:month[- ]on[- ]month|monthly|m\/m|mom|from (?:the )?(?:previous|prior) month)\b/i.test(s)) return "mom";
  if (/\b(?:quarter(?:ly)?|q\/q|qoq|annuali[sz]ed)\b/i.test(s)) return "qoq";
  return "unspecified";
}

const FORWARD = /\b(?:target|forecasts?|expect(?:s|ed|ations?)?|estimates?|projected|projections?|could|may|might|seen at|consensus|poll)\b/i;

const METRICS: { metric: string; re: RegExp; unit: NumericClaim["unit"] }[] = [
  { metric: "inflation_rate", re: /\b(?:inflation|CPI|PCE|HICP|consumer prices)\b[^.;]{0,40}?(-?\d+(?:\.\d+)?)\s?(?:%|per ?cent|percent)/gi, unit: "%" },
  { metric: "gdp_growth", re: /\b(?:GDP|economy|economic growth)\b[^.;]{0,40}?(-?\d+(?:\.\d+)?)\s?(?:%|per ?cent|percent)/gi, unit: "%" },
  { metric: "unemployment_rate", re: /\bunemployment(?: rate)?\b[^.;]{0,30}?(\d+(?:\.\d+)?)\s?(?:%|per ?cent|percent)/gi, unit: "%" },
  { metric: "policy_rate_level", re: /\b(?:policy rate|benchmark rate|key rate|deposit (?:facility )?rate|federal funds rate|bank rate)\b[^.;]{0,40}?(-?\d+(?:\.\d+)?)\s?(?:%|per ?cent|percent)/gi, unit: "%" },
  { metric: "rate_move_bp", re: /\b(?:cut|cuts|raised?|raises|hike[sd]?|lower(?:ed|s)?|increase[sd]?|reduce[sd]?)\b[^.;]{0,40}?(\d+(?:\.\d+)?)\s?(?:basis points?|bps?)\b/gi, unit: "bp" },
  { metric: "deficit_usd", re: /\bdeficit\b[^.;]{0,40}?\$\s?(\d+(?:\.\d+)?)\s?(billion|trillion|bn|tn)\b/gi, unit: "usd_bn" },
];

export function extractNumericClaims(text: string): NumericClaim[] {
  const out: NumericClaim[] = [];
  for (const m of METRICS) {
    const re = new RegExp(m.re.source, m.re.flags);
    for (const hit of Array.from(text.matchAll(re))) {
      const span = hit[0];
      if (FORWARD.test(span)) continue;
      let value = Number(hit[1]);
      if (!Number.isFinite(value)) continue;
      if (m.unit === "usd_bn") {
        const scale = (hit[2] || "").toLowerCase();
        if (scale === "trillion" || scale === "tn") value *= 1000;
      }
      const at = hit.index ?? 0;
      // Same clause only: words before the match back to the previous , . ; : and after it up to the next one.
      const head = text.slice(Math.max(0, at - 30), at).split(/[,.;:]\s/).pop() ?? "";
      const tail = (text.slice(at + span.length).split(/[,.;:](?:\s|$)/)[0] ?? "").slice(0, 40);
      const ctx = `${head}${span}${tail}`;
      out.push({ metric: m.metric, value, unit: m.unit, basis: m.unit === "%" ? periodBasis(ctx) : "unspecified", core: /\bcore\b/i.test(ctx), text: span.trim().slice(0, 160) });
    }
  }
  return out;
}

function differs(a: NumericClaim, b: NumericClaim): boolean {
  if (a.unit !== b.unit || a.basis !== b.basis || a.core !== b.core) return false;
  if (a.unit === "%") return Math.abs(a.value - b.value) >= 0.15;
  if (a.unit === "bp") return Math.abs(a.value - b.value) >= 5;
  const base = Math.max(Math.abs(a.value), Math.abs(b.value), 1e-9);
  return Math.abs(a.value - b.value) / base >= 0.05;
}

/** An item that reports several different values for the same metric/basis/core is ambiguous for that metric; drop those claims. */
export function unambiguous(claims: NumericClaim[]): NumericClaim[] {
  const key = (c: NumericClaim) => `${c.metric}|${c.basis}|${c.core}`;
  const vals = new Map<string, Set<number>>();
  for (const c of claims) vals.set(key(c), (vals.get(key(c)) ?? new Set()).add(c.value));
  const seen = new Set<string>();
  return claims.filter((c) => {
    if ((vals.get(key(c))?.size ?? 0) > 1) return false;
    if (seen.has(key(c))) return false;
    seen.add(key(c));
    return true;
  });
}

const OPPOSITE: Record<string, string> = { hawkish: "dovish", dovish: "hawkish", risk_on: "risk_off", risk_off: "risk_on" };

export interface ConflictSide {
  eventId: string;
  sourceName: string;
  tier: number;
  publishedAt: string;
  claim: string;
}

export interface DetectedConflict {
  id: string;
  kind: "factual" | "interpretive";
  topicKey: string;
  a: ConflictSide;
  b: ConflictSide;
  verifiable: boolean;
  detail: {
    metric?: string;
    sharedMechanisms: string[];
    sharedRegions: string[];
    sameDuplicateGroup: boolean;
    sourceComparison: string;
    timeComparison: string;
    verificationNote: string;
    resolution: "unresolved";
  };
}

function hoursBetween(a: string, b: string) {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 3600_000;
}

export function compareSides(a: ConflictSide, b: ConflictSide) {
  const sourceComparison =
    a.tier === b.tier
      ? `Both sources are tier ${a.tier}; source quality does not separate them.`
      : `${a.tier < b.tier ? a.sourceName : b.sourceName} is the higher-quality source (tier ${Math.min(a.tier, b.tier)} vs ${Math.max(a.tier, b.tier)}). Higher tier is context, not proof.`;
  const h = hoursBetween(a.publishedAt, b.publishedAt);
  const earlier = Date.parse(a.publishedAt) <= Date.parse(b.publishedAt) ? a : b;
  const timeComparison = h < 0.05 ? "Published at the same time." : `${earlier.sourceName} published ${h.toFixed(1)}h earlier; the later item may reflect newer information or a correction.`;
  return { sourceComparison, timeComparison };
}

function conflictId(kind: string, topic: string, a: ConflictSide, b: ConflictSide) {
  const [x, y] = [a, b].sort((p, q) => (p.eventId < q.eventId ? -1 : 1));
  return createHash("sha256").update([CONFLICT_VERSION, kind, topic, x.eventId, x.claim, y.eventId, y.claim].join("|")).digest("hex").slice(0, 24);
}

const side = (e: ConflictInput, claim: string): ConflictSide => ({ eventId: e.id, sourceName: e.sourceName, tier: e.tier, publishedAt: e.publishedAt, claim });

/** Pure detection over a set of recent events. Pairs are compared once; results are stable for the same input. */
export function detectConflicts(items: ConflictInput[]): DetectedConflict[] {
  const out: DetectedConflict[] = [];
  const claims = new Map(items.map((e) => [e.id, unambiguous(extractNumericClaims(`${e.title}. ${e.summary}`))]));
  const sorted = [...items].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const h = hoursBetween(a.publishedAt, b.publishedAt);
      if (h > 48) break;
      if (a.sourceName === b.sourceName && a.title === b.title) continue;
      const sameGroup = !!a.groupKey && a.groupKey === b.groupKey;
      const sharedMech = a.mechanisms.filter((m) => b.mechanisms.includes(m));
      const sharedReg = a.regions.filter((r) => b.regions.includes(r));
      const sameTopic = sharedMech.length > 0 && sharedReg.length > 0;
      // factual
      if (sameGroup || (sameTopic && h <= 24)) {
        for (const ca of claims.get(a.id) || []) {
          for (const cb of claims.get(b.id) || []) {
            if (ca.metric !== cb.metric || !differs(ca, cb)) continue;
            const sa = side(a, ca.text);
            const sb = side(b, cb.text);
            const topic = `${ca.metric}|${sharedReg.join("+") || "group"}`;
            out.push({
              id: conflictId("factual", topic, sa, sb),
              kind: "factual",
              topicKey: topic,
              a: sa,
              b: sb,
              verifiable: true,
              detail: {
                metric: ca.metric,
                sharedMechanisms: sharedMech,
                sharedRegions: sharedReg,
                sameDuplicateGroup: sameGroup,
                ...compareSides(sa, sb),
                verificationNote: "Verifiable: compare both figures with the primary statistical or official release. Not checked automatically.",
                resolution: "unresolved",
              },
            });
          }
        }
      }
      // interpretive
      if ((sameGroup || sameTopic) && OPPOSITE[a.sentiment] === b.sentiment && a.classifierConfidence >= 0.5 && b.classifierConfidence >= 0.5) {
        const sa = side(a, `Reading: ${a.sentiment} — "${a.title.slice(0, 120)}"`);
        const sb = side(b, `Reading: ${b.sentiment} — "${b.title.slice(0, 120)}"`);
        const topic = `${(sharedMech[0] ?? "group")}|${sharedReg.join("+") || "group"}`;
        out.push({
          id: conflictId("interpretive", topic, sa, sb),
          kind: "interpretive",
          topicKey: topic,
          a: sa,
          b: sb,
          verifiable: false,
          detail: {
            sharedMechanisms: sharedMech,
            sharedRegions: sharedReg,
            sameDuplicateGroup: sameGroup,
            ...compareSides(sa, sb),
            verificationNote: "Not verifiable: a disagreement about meaning or direction, not about a reported fact. Readings are heuristic classifier output.",
            resolution: "unresolved",
          },
        });
      }
    }
  }
  return out;
}

/** Effect of open conflicts on a scenario set (documented rule W4 / C2 in the methodology). */
export function conflictEffect(conflicts: { kind: "factual" | "interpretive" }[]) {
  const n = Math.min(conflicts.length, 2);
  const factual = conflicts.filter((c) => c.kind === "factual").length;
  const interpretive = conflicts.filter((c) => c.kind === "interpretive").length;
  return {
    shrinkSteps: n, // each step moves weights 25% toward uniform
    cancelTilt: interpretive > 0,
    confidencePenalty: Math.min(30, factual * 15 + interpretive * 10),
  };
}
