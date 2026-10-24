import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api-keys/store";
import { getPlan } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const plan = getPlan(user.plan);
  return NextResponse.json({
    keys: listApiKeys(user.id),
    plan: user.plan,
    limits: {
      allowed: plan.limits.apiKeysAllowed,
      max: plan.limits.apiKeysMax,
      ratePerMinute: plan.limits.apiRatePerMinute,
    },
  });
}

export async function POST(req: Request) {
  const user = getSessionUser();
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.action === "revoke" && body.id) {
    const ok = revokeApiKey(user.id, body.id);
    return NextResponse.json({ ok, keys: listApiKeys(user.id) });
  }
  try {
    const created = createApiKey(user.id, body.name);
    return NextResponse.json({
      key: created,
      warning: "Copy the plaintext key now — it will not be shown again.",
      keys: listApiKeys(user.id),
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Could not create key",
        upgradeUrl: "/pricing",
      },
      { status: 403 }
    );
  }
}
