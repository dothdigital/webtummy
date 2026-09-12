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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
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
      subject: "Activate your SEnuke AI workspace",
      text: `Thank you for your SEnuke AI purchase. We’re excited to have you with us.

Your SEnuke AI workspace is ready to be activated.

Click the link below to begin activation of your workspace and create your login:

ACTIVATE YOUR WORKSPACE
${link}

For security, this activation link will expire in 72 hours.

Once your workspace is activated, you’ll be able to log in and begin setting up your business so SEnuke AI can start understanding where you are, identifying opportunities, and building your growth strategy.

Welcome to SEnuke AI.

The SEnuke AI Team`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#1e293b;max-width:600px;margin:0 auto;padding:24px;">
<p>Thank you for your SEnuke AI purchase. We’re excited to have you with us.</p>
<p>Your SEnuke AI workspace is ready to be activated.</p>
<p>Click the link below to begin activation of your workspace and create your login:</p>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td align="center" bgcolor="#0f766e" style="border-radius:6px;mso-padding-alt:16px 24px;"><a href="${escapeHtml(link)}" style="display:inline-block;background-color:#0f766e;border:1px solid #0f766e;border-radius:6px;padding:16px 24px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;text-align:center;text-decoration:none;">ACTIVATE YOUR WORKSPACE</a></td></tr></table>
<p>For security, this activation link will expire in 72 hours.</p>
<p>Once your workspace is activated, you’ll be able to log in and begin setting up your business so SEnuke AI can start understanding where you are, identifying opportunities, and building your growth strategy.</p>
<p>Welcome to SEnuke AI.</p>
<p>The SEnuke AI Team</p>
</div>`,
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

async function issueJvZooWelcomeEmail(input: { email: string; name: string; planCode: string | null }) {
  const loginUrl = `${config.webAppUrl.replace(/\/$/, "")}/login`;
  const safeName = escapeHtml(input.name);
  await sendMail({
    to: input.email,
    subject: "Welcome to SEnuke AI. Your Workspace Is Active",
    text: `Welcome, ${input.name}!

Your SEnuke AI workspace is now active and ready to use.

You can log in anytime using the link below:

LOGIN TO SENUKE AI
${loginUrl}

Welcome to SEnuke AI, The AI Growth Operating System.

Once you log in, SEnuke AI will guide you through setting up your workspace so it can begin understanding your business, identifying opportunities, and building your growth strategy.

We’re excited to have you with us.

The SEnuke AI Team`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#1e293b;max-width:600px;margin:0 auto;padding:24px;">
<p>Welcome, ${safeName}!</p>
<p>Your SEnuke AI workspace is now active and ready to use.</p>
<p>You can log in anytime using the link below:</p>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td align="center" bgcolor="#0f766e" style="border-radius:6px;mso-padding-alt:16px 24px;"><a href="${escapeHtml(loginUrl)}" style="display:inline-block;background-color:#0f766e;border:1px solid #0f766e;border-radius:6px;padding:16px 24px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;text-align:center;text-decoration:none;">LOGIN TO SENUKE AI</a></td></tr></table>
<p>Welcome to SEnuke AI, The AI Growth Operating System.</p>
<p>Once you log in, SEnuke AI will guide you through setting up your workspace so it can begin understanding your business, identifying opportunities, and building your growth strategy.</p>
<p>We’re excited to have you with us.</p>
<p>The SEnuke AI Team</p>
</div>`,
  });
}

export async function activateJvZooPurchase(input: { token: string; name?: string; password: string }) {
  const record = await usableToken(input.token);
  if (!record) throw Object.assign(new Error("This activation link is invalid or expired."), { statusCode: 400 });
  const external = record.externalSubscription;
  const existing = await prisma.user.findFirst({ where: { email: { equals: external.providerCustomerEmail, mode: "insensitive" } } });
  if (existing) {
    if (!existing.isActive || !(await verifyPassword(input.password, existing.passwordHash))) {
      throw Object.assign(new Error("The password for this SEnuke AI - AI Growth Operating System account is incorrect."), { statusCode: 401 });
    }
  } else if (!input.name?.trim()) {
    throw Object.assign(new Error("Your name is required to create the account."), { statusCode: 400 });
  }

  const workspaceType = workspaceTypeForCommercialPlan(external.planCode);
  const name = input.name?.trim() || existing?.name?.trim() || external.providerCustomerName?.trim() || "SEnuke AI - AI Growth Operating System Customer";
  const passwordHash = existing ? null : await hashPassword(input.password);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
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
      if (!currentUser?.isActive) throw Object.assign(new Error("This SEnuke AI - AI Growth Operating System account is not active."), { statusCode: 409, code: "account_inactive" });
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
  if (result.accountCreated) {
    await issueJvZooWelcomeEmail({ email: external.providerCustomerEmail, name, planCode: external.planCode }).catch((error) => {
      // Account activation must not be rolled back when an optional onboarding
      // message fails; Operations can resend onboarding separately.
      console.error("[jvzoo] post-activation welcome email failed", { errorType: error instanceof Error ? error.name : "unknown" });
    });
  }
  return result;
}
