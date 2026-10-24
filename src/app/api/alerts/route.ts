import { NextResponse } from "next/server";
import {
  getAlerts,
  createAlert,
  updateAlert,
  deleteAlert,
  getFiredAlerts,
  evaluateAlerts,
  getAlertOutbox,
} from "@/lib/alerts/store";
import { getSessionUser, userPlanLimits } from "@/lib/auth/session";
import type { AlertChannel } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    alerts: getAlerts(),
    fired: getFiredAlerts(),
    outbox: getAlertOutbox(),
    smtpConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_FROM),
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (body.action === "evaluate") {
    return NextResponse.json({
      fired: evaluateAlerts(),
      alerts: getAlerts(),
      firedAll: getFiredAlerts(),
      outbox: getAlertOutbox(),
    });
  }
  if (body.action === "delete" && body.id) {
    deleteAlert(body.id);
    return NextResponse.json({ alerts: getAlerts(), outbox: getAlertOutbox() });
  }
  if (body.action === "update" && body.id) {
    const user = getSessionUser();
    const limits = userPlanLimits(user);
    const patch = { ...(body.patch || {}) };
    if (patch.channels) {
      const ch = patch.channels as AlertChannel[];
      if (ch.includes("email") && !limits.emailAlerts) {
        return NextResponse.json(
          { error: "Email alerts require Pro", upgradeUrl: "/pricing" },
          { status: 403 }
        );
      }
      if (ch.includes("webhook") && !limits.webhookAlerts) {
        return NextResponse.json(
          { error: "Webhook alerts require Pro", upgradeUrl: "/pricing" },
          { status: 403 }
        );
      }
    }
    updateAlert(body.id, patch);
    return NextResponse.json({ alerts: getAlerts(), outbox: getAlertOutbox() });
  }

  const user = getSessionUser();
  const limits = userPlanLimits(user);
  const channels: AlertChannel[] = body.channels || ["in_app"];
  if (channels.includes("email") && !limits.emailAlerts) {
    return NextResponse.json(
      { error: "Email channel requires Pro — use in-app or upgrade", upgradeUrl: "/pricing" },
      { status: 403 }
    );
  }
  if (channels.includes("webhook") && !limits.webhookAlerts) {
    return NextResponse.json(
      { error: "Webhook channel requires Pro", upgradeUrl: "/pricing" },
      { status: 403 }
    );
  }

  const alert = createAlert({
    name: body.name || "Untitled alert",
    condition: body.condition || "",
    assetSymbol: body.assetSymbol,
    scenarioId: body.scenarioId,
    scenarioBranch: body.scenarioBranch,
    threshold: Number(body.threshold) || 0,
    metric: body.metric || "vix_level",
    enabled: body.enabled !== false,
    channels,
    emailAddress: body.emailAddress,
    webhookUrl: body.webhookUrl,
    userId: user?.id,
  });
  return NextResponse.json({ alert, alerts: getAlerts(), outbox: getAlertOutbox() });
}
