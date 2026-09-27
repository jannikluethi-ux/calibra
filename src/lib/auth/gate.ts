import { NextResponse } from "next/server";
import { getSessionUser, userCanAccess, userPlanLimits } from "./session";
import type { PlanId } from "../billing/plans";
import type { UserRecord } from "./users";

export function getAuthContext(): {
  user: UserRecord | null;
  limits: ReturnType<typeof userPlanLimits>;
} {
  const user = getSessionUser();
  return { user, limits: userPlanLimits(user) };
}

export function requirePlanOrUpgrade(
  required: PlanId
): { ok: true; user: UserRecord } | { ok: false; response: NextResponse } {
  const user = getSessionUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Login required", upgradeUrl: "/login", requiredPlan: required },
        { status: 401 }
      ),
    };
  }
  if (!userCanAccess(user, required)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Plan upgrade required",
          currentPlan: user.plan,
          requiredPlan: required,
          upgradeUrl: "/pricing",
        },
        { status: 403 }
      ),
    };
  }
  return { ok: true, user };
}
