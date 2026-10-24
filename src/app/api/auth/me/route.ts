import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getPlan } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ user: null });
  }
  const plan = getPlan(user.plan);
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      plan: user.plan,
      displayName: user.displayName,
      createdAt: user.createdAt,
    },
    plan: {
      id: plan.id,
      name: plan.name,
      limits: plan.limits,
    },
  });
}
