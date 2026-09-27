import { NextResponse } from "next/server";
import { authenticateApiKey, checkRateLimit, type ApiKeyAuthResult } from "./store";

export function extractApiKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const x = req.headers.get("x-api-key");
  if (x) return x.trim();
  return null;
}

export function requireApiKeyAuth(req: Request):
  | { ok: true; auth: ApiKeyAuthResult; headers: Record<string, string> }
  | { ok: false; response: NextResponse } {
  const key = extractApiKey(req);
  if (!key) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Missing API key",
          hint: "Use Authorization: Bearer calibra_... or X-Api-Key header",
        },
        { status: 401 }
      ),
    };
  }
  const auth = authenticateApiKey(key);
  if (!auth) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 }),
    };
  }
  const rl = checkRateLimit(auth.keyId, auth.rateLimitPerMinute);
  const headers = {
    "X-RateLimit-Limit": String(rl.limit),
    "X-RateLimit-Remaining": String(rl.remaining),
  };
  if (!rl.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Rate limit exceeded", limit: rl.limit, window: "1m" },
        { status: 429, headers }
      ),
    };
  }
  return { ok: true, auth, headers };
}

export function jsonWithProvenance(
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>
) {
  const payload = {
    ...body,
    provenance: {
      generatedAt: new Date().toISOString(),
      product: "Calibra",
      disclaimer:
        "Probabilistic market intelligence — not investment advice. Never invents missing observations.",
    },
  };
  return NextResponse.json(payload, { headers: extraHeaders });
}
