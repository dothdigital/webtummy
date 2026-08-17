import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@webtummy/db";
import { hashPassword, verifyPassword } from "./auth.js";
import { config } from "./config.js";
import { sendMail } from "./email.js";
import { attachExternalSubscriptionInTransaction, workspaceTypeForCommercialPlan } from "./commercial-service.js";

const ACTIVATION_TTL_MS = 72 * 60 * 60 * 1000;

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function activationHash(token: string) {
  return createHash("sha256").update(`${token}.${config.jwtSecret}`, "utf8").digest("hex");
}

function maskedEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"*".repeat(Math.max(2, name.length - 2))}@${domain}`;
}

async function usableToken(token: string) {
  const record = await prisma.externalSubscriptionActivationToken.findUnique({
    where: { tokenHash: activationHash(token) },
    include: { externalSubscription: true },
  });
  if (!record || record.usedAt || record.expiresAt <= new Date()) return null;
  if (!["active", "cancel_at_period_end"].includes(record.externalSubscription.status)) return null;
  return record;
}

export async function issueJvZooActivationEmail(externalSubscriptionId: string) {
  const external = await prisma.externalSubscription.findUniqueOrThrow({ where: { id: externalSubscriptionId } });
  if (external.activationStatus === "activated") return { sent: false, reason: "already_activated" };
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction(async (tx) => {
    await tx.externalSubscriptionActivationToken.updateMany({
      where: { externalSubscriptionId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.externalSubscriptionActivationToken.create({
      data: { externalSubscriptionId, tokenHash: activationHash(token), expiresAt: new Date(Date.now() + ACTIVATION_TTL_MS) },
    });
  });
  const link = `${config.webAppUrl.replace(/\/$/, "")}/activate/jvzoo?token=${encodeURIComponent(token)}`;
  try {
    await sendMail({
      to: external.providerCustomerEmail,
      subject: "Activate your SEnuke AI purchase",
      text: `Activate your ${external.planCode ?? "SEnuke AI"} purchase: ${link}. This secure link expires in 72 hours and can be used once.`,
      html: `<p>Thank you for purchasing SEnuke AI.</p><p><a href="${link}">Activate your ${external.planCode ?? "SEnuke AI"} access</a></p><p>This secure link expires in 72 hours and can be used once.</p>`,
    });
    await prisma.externalSubscription.update({ where: { id: external.id }, data: { activationEmailSentAt: new Date(), activationEmailError: null } });
    return { sent: true };
  } catch (error) {
    console.error("[jvzoo] activation email provider failed", { errorType: error instanceof Error ? error.name : "unknown" });
    await prisma.externalSubscription.update({ where: { id: external.id }, data: { activationEmailError: "email_delivery_failed" } });
    throw Object.assign(new Error("The activation email could not be sent right now."), { statusCode: 503, code: "activation_email_unavailable" });
  }
}

export async function requestJvZooActivation(email: string) {
  const normalized = normalizeEmail(email);
  const external = await prisma.externalSubscription.findFirst({
    where: {
      provider: "jvzoo",
      providerCustomerEmail: normalized,
      activationStatus: "unclaimed",
      status: { in: ["active", "cancel_at_period_end"] },
    },
    orderBy: { purchasedAt: "desc" },
  });
  if (external) {
    await issueJvZooActivationEmail(external.id).catch((error) => {
      // The public response must remain identical whether the purchase is
      // absent or the outbound provider is temporarily unavailable.
      console.error("[jvzoo] activation recovery email failed", { errorType: error instanceof Error ? error.name : "unknown" });
    });
  }
  return { ok: true };
}

export async function inspectJvZooActivation(token: string) {
  const record = await usableToken(token);
  if (!record) return null;
  const external = record.externalSubscription;
  const account = await prisma.user.findFirst({ where: { email: { equals: external.providerCustomerEmail, mode: "insensitive" } }, select: { id: true } });
  return {
    planCode: external.planCode,
    billingInterval: external.billingInterval,
    email: maskedEmail(external.providerCustomerEmail),
    accountExists: Boolean(account),
    expiresAt: record.expiresAt,
  };
}

export async function activateJvZooPurchase(input: { token: string; name?: string; password: string }) {
  const record = await usableToken(input.token);
  if (!record) throw Object.assign(new Error("This activation link is invalid or expired."), { statusCode: 400 });
  const external = record.externalSubscription;
  const existing = await prisma.user.findFirst({ where: { email: { equals: external.providerCustomerEmail, mode: "insensitive" } } });
  if (existing) {
    if (!existing.isActive || !(await verifyPassword(input.password, existing.passwordHash))) {
      throw Object.assign(new Error("The password for this SEnuke AI account is incorrect."), { statusCode: 401 });
    }
  } else if (!input.name?.trim()) {
    throw Object.assign(new Error("Your name is required to create the account."), { statusCode: 400 });
  }

  const workspaceType = workspaceTypeForCommercialPlan(external.planCode);
  const name = input.name?.trim() || existing?.name?.trim() || external.providerCustomerName?.trim() || "SEnuke AI Customer";
  const passwordHash = existing ? null : await hashPassword(input.password);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.externalSubscriptionActivationToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw Object.assign(new Error("This activation link has already been used or has expired."), { statusCode: 409, code: "activation_token_consumed" });

    const currentExternal = await tx.externalSubscription.findUniqueOrThrow({ where: { id: external.id } });
    if (!["active", "cancel_at_period_end"].includes(currentExternal.status)) {
      throw Object.assign(new Error("This JVZoo purchase is not currently eligible for activation."), { statusCode: 409, code: "purchase_not_eligible" });
    }

    let userId: string;
    let workspaceId: string;
    if (existing) {
      const currentUser = await tx.user.findUnique({ where: { id: existing.id }, select: { id: true, isActive: true } });
      if (!currentUser?.isActive) throw Object.assign(new Error("This SEnuke AI account is not active."), { statusCode: 409, code: "account_inactive" });
      const memberships = await tx.workspaceMembership.findMany({
        where: { userId: existing.id, status: "active", workspace: { workspaceType }, roles: { some: { role: "owner" } } },
        orderBy: { createdAt: "asc" },
        take: 2,
      });
      if (memberships.length !== 1) throw Object.assign(new Error(`This purchase requires exactly one eligible owned ${workspaceType} workspace. Contact support to select the correct workspace safely.`), { statusCode: 409, code: "eligible_workspace_selection_required" });
      userId = existing.id;
      workspaceId = memberships[0].workspaceId;
    } else {
      const accountAppeared = await tx.user.findFirst({ where: { email: { equals: currentExternal.providerCustomerEmail, mode: "insensitive" } }, select: { id: true } });
      if (accountAppeared) throw Object.assign(new Error("An account now exists for this email. Restart activation and sign in with the existing password."), { statusCode: 409, code: "account_created_concurrently" });
      const workspaceName = workspaceType === "personal" ? `${name}'s Workspace` : workspaceType === "agency" ? `${name} Agency` : `${name} Business`;
      const client = await tx.client.create({
        data: {
          name: workspaceName,
          contactEmail: currentExternal.providerCustomerEmail,
          plan: currentExternal.planCode ?? "starter",
          aiSubscriptionStatus: "active",
          subscriptionSource: "jvzoo",
          subscriptionCurrentPeriodEnd: currentExternal.currentPeriodEnd,
        },
      });
      const user = await tx.user.create({
        data: {
          email: currentExternal.providerCustomerEmail,
          passwordHash: passwordHash!,
          name,
          role: "client_admin",
          clientId: client.id,
          emailVerifiedAt: new Date(),
        },
      });
      const workspace = await tx.workspace.create({
        data: {
          legacyClientId: client.id,
          name: workspaceName,
          workspaceType,
          ownerUserId: user.id,
          commercialState: "active",
          accessMode: "full",
        },
      });
      const membership = await tx.workspaceMembership.create({
        data: { workspaceId: workspace.id, userId: user.id, status: "active", joinedAt: new Date() },
      });
      const roles = workspaceType === "personal" ? ["owner"] : ["owner", "admin"];
      await tx.workspaceMemberRole.createMany({ data: roles.map((role) => ({ membershipId: membership.id, role, grantedById: user.id })) });
      userId = user.id;
      workspaceId = workspace.id;
    }

    await attachExternalSubscriptionInTransaction(tx, { externalSubscriptionId: currentExternal.id, workspaceId, userId });
    await tx.externalSubscriptionActivationToken.updateMany({
      where: { externalSubscriptionId: currentExternal.id, usedAt: null },
      data: { usedAt: now },
    });
    return { activated: true, accountCreated: !existing, workspaceId };
  });
}
