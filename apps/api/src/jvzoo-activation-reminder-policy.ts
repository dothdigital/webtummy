export const ACTIVATION_REMINDER_DAYS = [1, 3, 7] as const;
export type ActivationReminderDay = typeof ACTIVATION_REMINDER_DAYS[number];
export const ACTIVATION_REMINDER_POLICY_ID = "jvzoo-activation-reminders-v1";
export const ACTIVATION_REMINDER_ACTION = "commercial.activation_reminder";
const DAY_MS = 86_400_000;

type Purchase = {
  provider: string; activationStatus: string; status: string;
  purchasedAt: Date; createdAt: Date; currentPeriodEnd: Date | null;
  refundedAt: Date | null; chargebackAt: Date | null;
  activationEmailSentAt: Date | null;
};

export function activationReminderDay(purchase: Purchase, enabledAt: Date, now: Date): ActivationReminderDay | null {
  if (purchase.provider !== "jvzoo" || purchase.activationStatus !== "unclaimed") return null;
  if (!["active", "cancel_at_period_end"].includes(purchase.status)) return null;
  if (purchase.refundedAt || purchase.chargebackAt || (purchase.currentPeriodEnd && purchase.currentPeriodEnd <= now)) return null;
  // Both dates exclude old purchases arriving through a late/replayed webhook.
  if (purchase.purchasedAt < enabledAt || purchase.createdAt < enabledAt) return null;
  if (purchase.activationEmailSentAt && now.getTime() - purchase.activationEmailSentAt.getTime() < DAY_MS / 2) return null;
  const age = (now.getTime() - purchase.purchasedAt.getTime()) / DAY_MS;
  // Catch up only the current stage, never a burst of missed messages.
  if (age >= 7 && age < 8) return 7;
  if (age >= 3 && age < 7) return 3;
  if (age >= 1 && age < 3) return 1;
  return null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function activationReminderContent(day: ActivationReminderDay, link: string, supportEmail: string) {
  const copy = {
    1: { subject: "Your SEnuke AI workspace is waiting for activation", intro: "Thank you for purchasing SEnuke AI. You haven’t activated your workspace yet. Use the secure link below to create your login and get started." },
    3: { subject: "Need help activating your SEnuke AI account?", intro: "Your SEnuke AI purchase is ready, but your workspace hasn’t been activated. If your earlier link expired, use this fresh link to finish setting up your account." },
    7: { subject: "A final reminder to activate your SEnuke AI workspace", intro: "This is the last email in your activation reminder sequence. Your workspace is still waiting for activation. Use the secure link below whenever you’re ready to get started." },
  }[day];
  const expiry = "This activation link expires in 72 hours. It does not extend your purchased access period.";
  const help = `Need help? Contact ${supportEmail}.`;
  return {
    subject: copy.subject,
    text: `${copy.intro}\n\nACTIVATE YOUR WORKSPACE\n${link}\n\n${expiry}\n\n${help}\n\nThe SEnuke AI Team`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#1e293b;max-width:600px;margin:0 auto;padding:24px;"><p>${escapeHtml(copy.intro)}</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f766e;border-radius:6px;padding:16px 24px;color:#fff;font-weight:bold;text-decoration:none;">ACTIVATE YOUR WORKSPACE</a></p><p>${escapeHtml(expiry)}</p><p>${escapeHtml(help)}</p><p>The SEnuke AI Team</p></div>`,
  };
}
