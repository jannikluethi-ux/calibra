import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { AlertChannel, AlertOutboxEntry, AlertRule, FiredAlert } from "../types";
import { upsertJson, getJsonAll, deleteById, getDb } from "../db";
import { getForecasts } from "../forecast/distributions";
import { getMarketSnapshots } from "../market/fetch";
import { getRiskGauges } from "../risk/gauges";
import { getScenarios } from "../scenarios/engine";
import { getEvents } from "../ingestion/rss";

const OUTBOX_PATH = path.join(process.cwd(), "data", "alert_outbox.json");

export function getAlerts(): AlertRule[] {
  return getJsonAll<AlertRule>("alerts", "created_at DESC");
}

export function createAlert(input: Omit<AlertRule, "id" | "createdAt">): AlertRule {
  const channels: AlertChannel[] = input.channels?.length
    ? Array.from(new Set(["in_app" as AlertChannel, ...input.channels]))
    : ["in_app"];
  const rule: AlertRule = {
    ...input,
    channels,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  upsertJson("alerts", "id", rule.id, rule, { created_at: rule.createdAt });
  return rule;
}

export function updateAlert(id: string, patch: Partial<AlertRule>): AlertRule | null {
  const existing = getAlerts().find((a) => a.id === id);
  if (!existing) return null;
  const next = { ...existing, ...patch, id: existing.id };
  if (next.channels && !next.channels.includes("in_app")) {
    next.channels = ["in_app", ...next.channels];
  }
  upsertJson("alerts", "id", id, next, { created_at: next.createdAt });
  return next;
}

export function deleteAlert(id: string) {
  deleteById("alerts", "id", id);
}

export function getFiredAlerts(): FiredAlert[] {
  return getJsonAll<FiredAlert>("fired_alerts", "fired_at DESC");
}

function readOutbox(): AlertOutboxEntry[] {
  try {
    if (!fs.existsSync(OUTBOX_PATH)) return [];
    const raw = fs.readFileSync(OUTBOX_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(entries: AlertOutboxEntry[]) {
  const dir = path.dirname(OUTBOX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUTBOX_PATH, JSON.stringify(entries.slice(0, 500), null, 2), "utf8");
}

export function getAlertOutbox(): AlertOutboxEntry[] {
  return readOutbox();
}

function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function queueEmail(opts: {
  to: string;
  subject: string;
  body: string;
  ruleId: string;
  firedAlertId: string;
}): AlertOutboxEntry {
  const entry: AlertOutboxEntry = {
    id: randomUUID(),
    kind: "email",
    to: opts.to,
    subject: opts.subject,
    body: opts.body,
    ruleId: opts.ruleId,
    firedAlertId: opts.firedAlertId,
    createdAt: new Date().toISOString(),
    status: "queued",
    note: smtpConfigured()
      ? "SMTP env present — delivery still demo-queued (wire transporter later)."
      : "No SMTP env — queued to data/alert_outbox.json (email NOT sent).",
  };
  const all = readOutbox();
  all.unshift(entry);
  writeOutbox(all);
  return entry;
}

function logWebhook(opts: {
  url: string;
  body: string;
  ruleId: string;
  firedAlertId: string;
}): AlertOutboxEntry {
  const entry: AlertOutboxEntry = {
    id: randomUUID(),
    kind: "webhook",
    url: opts.url,
    body: opts.body,
    ruleId: opts.ruleId,
    firedAlertId: opts.firedAlertId,
    createdAt: new Date().toISOString(),
    status: "logged",
    note: "Webhook delivery attempt logged (demo — no outbound HTTP in local foundation).",
  };
  const all = readOutbox();
  all.unshift(entry);
  writeOutbox(all);
  return entry;
}

function deliverChannels(rule: AlertRule, fa: FiredAlert): FiredAlert {
  const channels = rule.channels?.length ? rule.channels : (["in_app"] as AlertChannel[]);
  const delivered: AlertChannel[] = ["in_app"];
  const notes: string[] = ["in-app recorded"];

  if (channels.includes("email") && rule.emailAddress) {
    queueEmail({
      to: rule.emailAddress,
      subject: `[Calibra alert] ${rule.name}`,
      body: `${fa.message}\n\nFired at ${fa.firedAt}\n\nCalibra — probabilistic market intelligence; not investment advice.`,
      ruleId: rule.id,
      firedAlertId: fa.id,
    });
    delivered.push("email");
    notes.push(
      smtpConfigured()
        ? `email queued for ${rule.emailAddress} (SMTP env set; still outbox until transporter wired)`
        : `email queued to outbox for ${rule.emailAddress} (no SMTP — not sent)`
    );
  }

  if (channels.includes("webhook") && rule.webhookUrl) {
    logWebhook({
      url: rule.webhookUrl,
      body: JSON.stringify({
        alert: fa,
        rule: { id: rule.id, name: rule.name, metric: rule.metric },
        disclaimer: "Not investment advice",
      }),
      ruleId: rule.id,
      firedAlertId: fa.id,
    });
    delivered.push("webhook");
    notes.push(`webhook logged for ${rule.webhookUrl}`);
  }

  return { ...fa, channelsDelivered: delivered, deliveryNotes: notes };
}

function recentlyFired(ruleId: string, withinMs = 15 * 60 * 1000): boolean {
  const fired = getFiredAlerts().filter((f) => f.ruleId === ruleId);
  if (!fired.length) return false;
  const latest = new Date(fired[0].firedAt).getTime();
  return Date.now() - latest < withinMs;
}

export function evaluateAlerts(): FiredAlert[] {
  getDb();
  const rules = getAlerts().filter((r) => r.enabled);
  const forecasts = getForecasts();
  const markets = getMarketSnapshots();
  const gauges = getRiskGauges();
  const scenarios = getScenarios();
  const events = getEvents(50);
  const fired: FiredAlert[] = [];

  for (const rule of rules) {
    if (recentlyFired(rule.id)) continue;

    let hit = false;
    let message = "";

    if (rule.metric === "severe_down_prob" && rule.assetSymbol) {
      const f = forecasts.find((x) => x.assetSymbol === rule.assetSymbol && !x.isSeed);
      const bucket = f?.distribution.find((b) => b.label === "severe_down");
      if (bucket && bucket.probability > rule.threshold) {
        hit = true;
        message = `${rule.assetSymbol} severe_down prob ${bucket.probability}% > ${rule.threshold}%`;
      }
    } else if (rule.metric === "price_change_1d" && rule.assetSymbol) {
      const m = markets.find((x) => x.symbol === rule.assetSymbol);
      if (m?.change1d != null && Math.abs(m.change1d) >= rule.threshold) {
        hit = true;
        message = `${rule.assetSymbol} |1d| change ${m.change1d.toFixed(2)}% ≥ ${rule.threshold}%`;
      }
    } else if (rule.metric === "large_move" && rule.assetSymbol) {
      const m = markets.find((x) => x.symbol === rule.assetSymbol);
      if (m?.change1d != null && Math.abs(m.change1d) >= rule.threshold) {
        hit = true;
        message = `Large move: ${rule.assetSymbol} 1d ${m.change1d.toFixed(2)}% (threshold ${rule.threshold}%)`;
      }
    } else if (rule.metric === "risk_gauge") {
      const g = gauges.find((x) => x.id === (rule.assetSymbol || "global_risk"));
      if (g && g.score >= rule.threshold) {
        hit = true;
        message = `Risk gauge ${g.name} score ${g.score} ≥ ${rule.threshold}`;
      }
    } else if (rule.metric === "vix_level") {
      const vix = markets.find((x) => x.symbol === "VIX");
      if (vix?.price != null && vix.price >= rule.threshold) {
        hit = true;
        message = `VIX ${vix.price} ≥ ${rule.threshold}`;
      }
    } else if (rule.metric === "scenario_prob") {
      const sc = rule.scenarioId
        ? scenarios.find((s) => s.id === rule.scenarioId)
        : scenarios[0];
      if (sc) {
        const branchName = rule.scenarioBranch || "bear";
        const branch = sc[branchName];
        if (branch && branch.probability >= rule.threshold) {
          hit = true;
          message = `Scenario "${sc.title}" ${branchName} prob ${branch.probability}% ≥ ${rule.threshold}%`;
        }
      }
    } else if (rule.metric === "forecast_invalidation" && rule.assetSymbol) {
      const f = forecasts.find((x) => x.assetSymbol === rule.assetSymbol && x.status === "open" && !x.isSeed);
      if (f && f.invalidators?.length) {
        const m = markets.find((x) => x.symbol === rule.assetSymbol);
        // Soft signal: open forecast with invalidators listed + large adverse move
        if (m?.change1d != null && Math.abs(m.change1d) >= (rule.threshold || 3)) {
          hit = true;
          message = `Forecast invalidation watch: ${rule.assetSymbol} move ${m.change1d.toFixed(2)}% — review: ${f.invalidators[0]}`;
        }
      }
    } else if (rule.metric === "high_impact_event") {
      const hi = events.find((e) => e.impactScore.composite >= rule.threshold);
      if (hi) {
        hit = true;
        message = `High-impact event: "${hi.title}" composite ${hi.impactScore.composite} ≥ ${rule.threshold}`;
      }
    }

    if (hit) {
      let fa: FiredAlert = {
        id: randomUUID(),
        ruleId: rule.id,
        ruleName: rule.name,
        message,
        firedAt: new Date().toISOString(),
        acknowledged: false,
      };
      fa = deliverChannels(rule, fa);
      fired.push(fa);
      upsertJson("fired_alerts", "id", fa.id, fa, { fired_at: fa.firedAt });
      updateAlert(rule.id, { lastFiredAt: fa.firedAt });
    }
  }
  return fired;
}

export function ensureDefaultAlerts() {
  if (getAlerts().length > 0) return;
  createAlert({
    name: "BTC severe downside > 30%",
    condition: "severe_down probability",
    assetSymbol: "BTC",
    threshold: 30,
    metric: "severe_down_prob",
    enabled: true,
    channels: ["in_app"],
  });
  createAlert({
    name: "VIX above 25",
    condition: "VIX level",
    threshold: 25,
    metric: "vix_level",
    enabled: true,
    channels: ["in_app"],
  });
  createAlert({
    name: "Global risk gauge ≥ 70",
    condition: "risk gauge",
    assetSymbol: "global_risk",
    threshold: 70,
    metric: "risk_gauge",
    enabled: true,
    channels: ["in_app"],
  });
  createAlert({
    name: "High-impact event ≥ 70",
    condition: "new high-impact event",
    threshold: 70,
    metric: "high_impact_event",
    enabled: true,
    channels: ["in_app"],
  });
}
