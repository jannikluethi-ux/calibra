/**
 * Conservative same-story detection for events (event_cluster_v1). Pure functions, no DB.
 * Two headlines are linked only when they share several significant words, have high overlap,
 * agree on any figures they both mention, and were published within the window. A shared entity
 * ("Fed", "China", "oil") alone is never enough. Nothing is merged or deleted: callers only link
 * duplicates to a canonical event.
 */
import { normalizeEventTitle } from "./dedupe";

export const CLUSTER_WINDOW_MS = 48 * 3600_000;
export const CLUSTER_METHOD = "event_cluster_v1";

const STOP = new Set(
  "a an the of to in on for and or with as at by from is are was were be been being after amid over into about than that this these those its it his her their our your new says said say report reports reported update updates live watch what why how who will would could may might can just more most up down out off vs via per amp s t".split(
    " "
  )
);

/** Words that name actors/places/assets. Sharing only these never links two stories. */
export const ENTITY_WORDS = new Set(
  "fed federal reserve ecb boj boe pboc snb imf opec us u.s usa america american china chinese japan japanese europe european eu euro eurozone uk britain british germany german france french india russia russian ukraine israel iran saudi trump biden powell lagarde yellen bessent white house congress senate treasury wall street stocks stock market markets dow nasdaq s&p sp 500 oil gold bitcoin crypto dollar yen yuan bond bonds yields rates rate inflation tariffs tariff bank banks".split(
    " "
  )
);

/** Direction words: two headlines reporting opposite or different moves are different updates. */
const DIRECTION: Record<string, "up" | "down" | "flat"> = Object.fromEntries([
  ..."rise rises rising rose jump jumps jumped climb climbs climbed gain gains gained higher soar soars surge surges rally rallies advance advances pop pops spike spikes rebound rebounds".split(" ").map((w) => [w, "up"]),
  ..."fall falls falling fell drop drops dropped slide slides slid slump slumps tumble tumbles plummet plummets lower ease eases eased decline declines sink sinks losses loss retreat retreats dip dips".split(" ").map((w) => [w, "down"]),
  ..."flat unchanged changed choppy mixed steady hold holds".split(" ").map((w) => [w, "flat"]),
]) as Record<string, "up" | "down" | "flat">;

export function directionOf(tokens: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const t of Array.from(tokens)) if (DIRECTION[t]) out.add(DIRECTION[t]);
  return out;
}

/** Subject words: if both headlines name subjects and the sets differ (oil vs gold, Fed vs ECB), they are different stories. */
const SUBJECTS = new Set(
  "oil crude brent gold silver copper platinum wheat corn bitcoin ether ethereum solana xrp dollar yen euro yuan sterling pound franc fed ecb boj boe pboc snb rba opec".split(" ")
);

export function subjectsOf(tokens: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const t of Array.from(tokens)) if (SUBJECTS.has(t)) out.add(t === "crude" || t === "brent" ? "oil" : t === "ether" ? "ethereum" : t);
  return out;
}

export function significantTokens(title: string): string[] {
  return normalizeEventTitle(title)
    .split(" ")
    .filter((t) => t && !STOP.has(t) && (t.length > 2 || /\d/.test(t)));
}

export function numberTokens(tokens: string[]): Set<string> {
  return new Set(tokens.filter((t) => /\d/.test(t)));
}

export interface Headline {
  id: string;
  title: string;
  publishedAt: string;
  sourceName?: string;
  sourceTier?: number;
}

export interface Decision {
  same: boolean;
  score: number;
  reasons: string[];
}

export function decideSameStory(a: Headline, b: Headline, windowMs = CLUSTER_WINDOW_MS): Decision {
  const dt = Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  if (!Number.isFinite(dt) || dt > windowMs) return { same: false, score: 0, reasons: ["outside time window"] };
  const na = normalizeEventTitle(a.title);
  const nb = normalizeEventTitle(b.title);
  if (na && na === nb) return { same: true, score: 1, reasons: ["identical normalized title"] };
  const ta = new Set(significantTokens(a.title));
  const tb = new Set(significantTokens(b.title));
  if (ta.size < 3 || tb.size < 3) return { same: false, score: 0, reasons: ["too few significant words to compare"] };
  const shared = Array.from(ta).filter((t) => tb.has(t));
  const union = new Set([...Array.from(ta), ...Array.from(tb)]);
  const jaccard = shared.length / union.size;
  const containment = shared.length / Math.min(ta.size, tb.size);
  const numA = numberTokens(Array.from(ta));
  const numB = numberTokens(Array.from(tb));
  if (numA.size && numB.size) {
    const sameNums = numA.size === numB.size && Array.from(numA).every((n) => numB.has(n));
    if (!sameNums) return { same: false, score: jaccard, reasons: [`different figures (${Array.from(numA).join("/")} vs ${Array.from(numB).join("/")})`] };
  }
  const subA = subjectsOf(ta);
  const subB = subjectsOf(tb);
  if (subA.size && subB.size && !(subA.size === subB.size && Array.from(subA).every((x) => subB.has(x)))) {
    return { same: false, score: jaccard, reasons: [`different subjects (${Array.from(subA).join("/")} vs ${Array.from(subB).join("/")})`] };
  }
  const dirA = directionOf(ta);
  const dirB = directionOf(tb);
  const sameDir = dirA.size === dirB.size && Array.from(dirA).every((d) => dirB.has(d));
  if (dirA.size && dirB.size && !sameDir) {
    return { same: false, score: jaccard, reasons: [`different direction (${Array.from(dirA).join("/")} vs ${Array.from(dirB).join("/")})`] };
  }
  const nonEntityShared = shared.filter((t) => !ENTITY_WORDS.has(t) && !/\d/.test(t));
  if (nonEntityShared.length < 2) return { same: false, score: jaccard, reasons: ["shared words are only entities/figures"] };
  if (shared.length < 4) return { same: false, score: jaccard, reasons: [`only ${shared.length} shared significant words`] };
  const same = jaccard >= 0.65 || (containment >= 0.85 && Math.min(ta.size, tb.size) >= 5);
  return {
    same,
    score: Math.round(jaccard * 1000) / 1000,
    reasons: [
      `shared=${shared.length} (${shared.slice(0, 8).join(",")})`,
      `jaccard=${jaccard.toFixed(2)}`,
      `containment=${containment.toFixed(2)}`,
      same ? "linked" : "overlap below threshold",
    ],
  };
}

/** Canonical member: best (lowest) source tier, then earliest publish time, then id. */
export function pickCanonical<T extends Headline>(items: T[]): T {
  return [...items].sort(
    (x, y) => (x.sourceTier ?? 9) - (y.sourceTier ?? 9) || x.publishedAt.localeCompare(y.publishedAt) || x.id.localeCompare(y.id)
  )[0];
}

/**
 * Greedy, non-chaining clustering: each event joins a cluster only if it matches that cluster's
 * canonical directly (A~B and B~C does not link A and C). Input any order; output clusters of size >= 1.
 */
export function clusterHeadlines<T extends Headline>(items: T[], windowMs = CLUSTER_WINDOW_MS): { canonical: T; members: { item: T; decision: Decision }[] }[] {
  const ordered = [...items].sort((x, y) => x.publishedAt.localeCompare(y.publishedAt) || x.id.localeCompare(y.id));
  const clusters: { canonical: T; members: { item: T; decision: Decision }[] }[] = [];
  for (const it of ordered) {
    let best: { c: (typeof clusters)[number]; d: Decision } | null = null;
    for (const c of clusters) {
      if (Date.parse(it.publishedAt) - Date.parse(c.canonical.publishedAt) > windowMs) continue;
      const d = decideSameStory(c.canonical, it, windowMs);
      if (d.same && (!best || d.score > best.d.score)) best = { c, d };
    }
    if (best) best.c.members.push({ item: it, decision: best.d });
    else clusters.push({ canonical: it, members: [{ item: it, decision: { same: true, score: 1, reasons: ["seed"] } }] });
  }
  // Re-pick canonical by tier/time inside each cluster (members already matched the seed directly).
  for (const c of clusters) {
    if (c.members.length > 1) c.canonical = pickCanonical(c.members.map((m) => m.item));
  }
  return clusters;
}
