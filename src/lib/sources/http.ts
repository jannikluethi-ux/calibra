export interface HttpJson {
  status: number;
  ok: boolean;
  json?: unknown;
  error?: string;
  rateLimited: boolean;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Backend-only HTTP. Pages must not call this. */
export async function fetchJson(url: string, timeoutMs = 30000): Promise<HttpJson> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; Calibra/0.1; research)",
      },
      cache: "no-store",
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (res.status === 429 || text.startsWith("Too Many Requests") || text.includes("Rate Limit")) {
      return { status: 429, ok: false, rateLimited: true, error: text.slice(0, 180) };
    }
    if (!res.ok) {
      return { status: res.status, ok: false, rateLimited: false, error: text.slice(0, 200) };
    }
    try {
      return { status: res.status, ok: true, rateLimited: false, json: JSON.parse(text) as unknown };
    } catch {
      return { status: res.status, ok: false, rateLimited: false, error: "Invalid JSON" };
    }
  } catch (err) {
    return {
      status: 0,
      ok: false,
      rateLimited: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
