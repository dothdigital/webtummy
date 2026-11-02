import { createHash } from "node:crypto";
import type { Prisma } from "@webtummy/db";

export function jvZooDate(value: unknown): Date | null {
  if (typeof value === "string" && /^\d{10}(?:\d{3})?$/.test(value.trim())) value = Number(value.trim());
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const date = typeof value === "number"
    ? new Date(value < 10_000_000_000 ? value * 1000 : value)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Clamp month-end purchases (Jan 31 -> Feb 28), rather than rolling into March.
export function paidPeriodEnd(interval: string | null | undefined, start: Date) {
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + (interval === "annual" ? 12 : 1));
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

export async function queueJvZooLifecycleNotice(
  tx: Prisma.TransactionClient,
  external: { id: string; workspaceId: string | null; planCode: string | null; currentPeriodEnd: Date | null },
  stage: "cancellation" | "ended",
) {
  if (!external.workspaceId || !external.currentPeriodEnd) return;
  const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: external.workspaceId }, select: { ownerUserId: true } });
  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(external.currentPeriodEnd) + " UTC";
  const plan = external.planCode ? external.planCode.charAt(0).toUpperCase() + external.planCode.slice(1) : "paid";
  const title = stage === "cancellation" ? "Your SEnuke AI renewal is cancelled" : "Your SEnuke AI paid subscription has ended";
  const body = stage === "cancellation"
    ? `Your ${plan} subscription will not renew. You can continue using your plan until ${date}. After that, your workspace becomes read-only. You can still log in to review billing and your existing work during the data-retention period. Cancelling renewal does not issue a refund.`
    : `Your ${plan} paid access ended on ${date}. Your workspace is now read-only: new AI work, publishing, and automation are paused. You can still log in to review billing and your existing work during the data-retention period. Visit Billing to review your subscription and retention details.`;
  const id = "jvzoo-notice:" + createHash("sha256").update(`${external.id}:${stage}:${external.currentPeriodEnd.toISOString()}`).digest("hex");
  await tx.workspaceNotification.upsert({
    where: { id }, update: {},
    create: { id, workspaceId: external.workspaceId, userId: workspace.ownerUserId, type: `billing_subscription_${stage}`, title, body, actionUrl: "/billing", emailEligible: true, emailStatus: "pending" },
  });
}
