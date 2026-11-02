import { createHash } from "node:crypto";
import { prisma } from "@webtummy/db";
import { config } from "./config.js";
import { issueJvZooActivationEmail } from "./jvzoo-activation.js";
import { ACTIVATION_REMINDER_ACTION, ACTIVATION_REMINDER_POLICY_ID, activationReminderDay } from "./jvzoo-activation-reminder-policy.js";

export async function sendDueJvZooActivationReminders(now = new Date()) {
  if (!config.jvzooActivationRemindersEnabled) return { attempted: 0, sent: 0 };
  // A durable one-time cutoff: restarts and deployments never enroll older buyers.
  const policy = await prisma.commercialAuditEvent.upsert({
    where: { id: ACTIVATION_REMINDER_POLICY_ID }, update: {},
    create: { id: ACTIVATION_REMINDER_POLICY_ID, actorType: "system", action: "commercial.activation_reminders_enabled", reasonCode: "new_purchases_only", source: "scheduler", createdAt: now, afterJson: { days: [1, 3, 7] } },
  });
  const cutoff = policy.createdAt;
  let cursor: string | undefined;
  let attempted = 0;
  let sent = 0;
  for (;;) {
    const purchases = await prisma.externalSubscription.findMany({
      where: {
        provider: "jvzoo", activationStatus: "unclaimed", status: { in: ["active", "cancel_at_period_end"] },
        purchasedAt: { gte: new Date(Math.max(cutoff.getTime(), now.getTime() - 8 * 86_400_000)), lte: new Date(now.getTime() - 86_400_000) },
        createdAt: { gte: cutoff }, refundedAt: null, chargebackAt: null,
        OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }],
      },
      orderBy: { id: "asc" }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const purchase of purchases) {
      const day = activationReminderDay(purchase, cutoff, now);
      if (!day) continue;
      const id = "activation-reminder:" + createHash("sha256").update(`${purchase.id}:${day}`).digest("hex");
      try {
        // The primary key claims each purchase/stage once across all processes.
        // Persist before email I/O. Unknown delivery is never automatically retried.
        await prisma.commercialAuditEvent.create({ data: {
          id, actorType: "system", action: ACTIVATION_REMINDER_ACTION, reasonCode: `day_${day}`, source: "scheduler", correlationId: purchase.id,
          afterJson: { day, status: "sending", attemptedAt: now.toISOString() },
        } });
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") continue;
        throw error;
      }
      attempted += 1;
      try {
        // Re-reads purchase eligibility immediately before generating/sending a link.
        const result = await issueJvZooActivationEmail(purchase.id, { reminderDay: day, reminderEnrolledAfter: cutoff });
        if (result.sent) sent += 1;
        await prisma.commercialAuditEvent.update({ where: { id }, data: { afterJson: {
          day, status: result.sent ? "sent" : "skipped", completedAt: new Date().toISOString(), reason: result.sent ? null : result.reason ?? "not_eligible",
        } } });
      } catch {
        await prisma.commercialAuditEvent.update({ where: { id }, data: { afterJson: {
          day, status: "delivery_unconfirmed", completedAt: new Date().toISOString(), reason: "Check delivery before manually resending; automatic retry is disabled to prevent duplicates.",
        } } }).catch(() => undefined);
        console.error("[jvzoo] activation reminder delivery unconfirmed", { reminderId: id });
      }
    }
    if (purchases.length < 100) break;
    cursor = purchases[purchases.length - 1].id;
  }
  return { attempted, sent };
}

export function startJvZooActivationReminders() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await sendDueJvZooActivationReminders(); }
    catch (error) { console.error("[jvzoo] activation reminder scheduler failed", { errorType: error instanceof Error ? error.name : "unknown" }); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 5 * 60 * 1_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
