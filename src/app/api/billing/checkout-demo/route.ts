import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { setUserPlan } from "@/lib/auth/users";
import type { PlanId } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

/**
 * DEMO CHECKOUT — upgrades the logged-in user in SQLite.
 * Replace with Stripe Checkout Session when STRIPE_SECRET_KEY + price IDs exist.
 */
export async function POST(req: Request) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Login required", upgradeUrl: "/login" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const plan = String(body.plan || "pro") as PlanId;
  if (plan !== "pro" && plan !== "api") {
    return NextResponse.json({ error: "Demo checkout only supports pro or api" }, { status: 400 });
  }
  const updated = setUserPlan(user.id, plan);
  return NextResponse.json({
    mode: "DEMO_CHECKOUT",
    message:
      "DEMO CHECKOUT — plan upgraded in local DB. Replace with Stripe Checkout when STRIPE_SECRET_KEY / STRIPE_PRICE_* exist.",
    user: updated
      ? { id: updated.id, email: updated.email, plan: updated.plan }
      : null,
    stripeEnvNeeded: [
      "STRIPE_SECRET_KEY",
      "STRIPE_PRICE_PRO",
      "STRIPE_PRICE_API",
      "STRIPE_WEBHOOK_SECRET",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    ],
  });
}
