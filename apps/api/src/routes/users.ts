import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { hashPassword } from "../auth.js";
import { normalizePlanCode, trialEndsFrom } from "../billing.js";
import { changeWorkspaceCommercialPlan, ensureCommercialDefaults, workspaceTypeForCommercialPlan } from "../commercial-service.js";
import { ensureWorkspaceCapacityAccount } from "../commercial-capacity.js";
import { requireAuth, requireRole } from "../middleware.js";
import { rolesConsumeSeat } from "@webtummy/core/workspace-permissions";
import { workspaceSeatUsage } from "../workspace-access.js";
import { sendPasswordResetEmail } from "./auth.js";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole("super_admin"));

function publicUser(user: {
  id: string;
  email: string;
  name: string | null;
  role: "super_admin" | "client_admin" | "client_user";
  clientId: string | null;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  client: {
    id: string; name: string; contactEmail: string | null; plan: string; isActive: boolean; createdAt: Date;
    aiSubscriptionStatus: string; trialStartedAt: Date | null; trialEndsAt: Date | null; manualAccessEndsAt: Date | null; graceEndsAt: Date | null;
    subscriptionSource: string; offlineAutoRenew: boolean; offlineNextRenewalAt: Date | null;
    offlinePayments: Array<{ id: string; amountCents: number; method: string; duration: string; reference: string | null; notes: string | null; autoRenew: boolean; subscriptionEndsAt: Date; nextRenewalAt: Date | null; status: string; createdAt: Date }>;
  } | null;
}) {
  return user;
}

const activeSchema = z.object({ isActive: z.boolean() });
const workspaceRoleSchema = z.object({ role: z.enum(["admin", "manager", "editor", "viewer", "client_viewer"]) });
const membershipStatusSchema = z.object({ status: z.enum(["active", "suspended", "deactivated"]) });
const primaryOwnerSchema = z.object({ membershipId: z.string().min(1) });
const approvalPolicySchema = z.object({ allowManagerSelfApproval: z.boolean() });
const planSchema = z.object({ plan: z.string().min(1).max(40) });
const passwordSchema = z.object({ password: z.string().min(8).max(128) });
const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(180),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  workspaceName: z.string().trim().min(1).max(180),
  plan: z.enum(["entrepreneur", "business", "agency"]),
  trialDays: z.number().int().min(0).max(365).default(30),
});
const billingAccessSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("extend_trial"), days: z.number().int().min(1).max(365) }),
  z.object({ action: z.literal("offline_until"), expiresAt: z.string().datetime(), autoRenew: z.boolean().optional() }),
  z.object({ action: z.literal("clear_manual") }),
  z.object({ action: z.literal("mark_active") }),
]);

const offlinePaymentSchema = z.object({
  amountCents: z.number().int().min(0),
  method: z.string().trim().min(1).max(80),
  duration: z.enum(["monthly", "yearly"]),
  reference: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(2000).optional(),
  autoRenew: z.boolean().default(false),
});

const clientUserSelect = {
  id: true,
  name: true,
  contactEmail: true,
  plan: true,
  isActive: true,
  createdAt: true,
  aiSubscriptionStatus: true,
  trialStartedAt: true,
  trialEndsAt: true,
  manualAccessEndsAt: true,
  graceEndsAt: true,
  subscriptionSource: true,
  offlineAutoRenew: true,
  offlineNextRenewalAt: true,
  offlinePayments: {
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, amountCents: true, method: true, duration: true, reference: true, notes: true, autoRenew: true, subscriptionEndsAt: true, nextRenewalAt: true, status: true, createdAt: true },
  },
} as const;

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: clientUserSelect },
      workspaceMemberships: {
        orderBy: { createdAt: "asc" },
        include: {
          workspace: { select: { id: true, name: true, workspaceType: true, ownerUserId: true, status: true, autoApprovalPolicyJson: true } },
          roles: { select: { role: true } },
          _count: { select: { clientAssignments: true, projectAssignments: true, assignedTasks: true, managedTasks: true, approvalTasks: true } },
        },
      },
    },
  });
  res.json({ users: users.map((user) => ({ ...publicUser(user), memberships: user.workspaceMemberships })) });
});

usersRouter.post("/", async (req, res) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const existing = await prisma.user.findFirst({ where: { email: { equals: data.email, mode: "insensitive" } }, select: { id: true } });
  if (existing) return res.status(409).json({ error: "An account already exists for this email address." });

  await ensureCommercialDefaults();
  const workspaceType = workspaceTypeForCommercialPlan(data.plan);
  const planVersion = await prisma.commercialPlanVersion.findFirst({
    where: { billingPlan: { code: data.plan }, status: "active" },
    orderBy: { version: "desc" },
    include: { billingPlan: true },
  });
  if (!planVersion) return res.status(409).json({ error: `The active ${data.plan} plan is unavailable.` });
  const price = await prisma.commercialPrice.findFirst({
    where: { planVersionId: planVersion.id, billingInterval: "monthly", priceClass: "standard", status: "active" },
    orderBy: { effectiveFrom: "desc" },
  });
  const now = new Date();
  const trialEndsAt = data.trialDays > 0 ? trialEndsFrom(now, data.trialDays) : null;
  const commercialState = trialEndsAt ? "trialing" : "payment_required";
  const accessMode = trialEndsAt ? "full" : "read_only";
  const temporaryPasswordHash = await hashPassword(randomBytes(48).toString("base64url"));

  const result = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        name: data.workspaceName,
        contactEmail: data.email,
        plan: data.plan,
        aiSubscriptionStatus: commercialState,
        subscriptionSource: "manual",
        trialStartedAt: trialEndsAt ? now : null,
        trialEndsAt,
      },
    });
    const user = await tx.user.create({
      data: {
        email: data.email,
        passwordHash: temporaryPasswordHash,
        name: data.name,
        role: "client_admin",
        clientId: client.id,
        emailVerifiedAt: null,
      },
    });
    const workspace = await tx.workspace.create({
      data: {
        legacyClientId: client.id,
        name: data.workspaceName,
        workspaceType,
        ownerUserId: user.id,
        commercialState,
        accessMode,
      },
    });
    const membership = await tx.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: user.id, status: "active", joinedAt: now },
    });
    const roles = workspaceType === "personal" ? ["owner"] : ["owner", "admin"];
    await tx.workspaceMemberRole.createMany({ data: roles.map((role) => ({ membershipId: membership.id, role, grantedById: req.user!.userId })) });
    const subscription = await tx.workspaceSubscription.create({
      data: {
        workspaceId: workspace.id,
        planVersionId: planVersion.id,
        priceId: price?.id ?? null,
        policyVersionId: planVersion.policyVersionId,
        provider: "manual",
        status: commercialState,
        billingInterval: "monthly",
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt,
      },
    });
    await tx.commercialSeatEntitlement.create({ data: { workspaceId: workspace.id, source: "included_owner", quantity: 1, capacityGrant: 0 } });
    await ensureWorkspaceCapacityAccount(workspace.id, tx);
    await tx.workspaceActivity.create({
      data: { workspaceId: workspace.id, actorUserId: req.user!.userId, action: "workspace.account_created_by_admin", entityType: "user", entityId: user.id, nextJson: { plan: data.plan, workspaceType, trialDays: data.trialDays } },
    });
    await tx.commercialAuditEvent.create({
      data: { workspaceId: workspace.id, actorType: "admin", actorId: req.user!.userId, action: "commercial.admin_account_created", reasonCode: "admin_account_creation", source: "admin", afterJson: { userId: user.id, subscriptionId: subscription.id, planCode: data.plan, workspaceType, commercialState, trialEndsAt } },
    });
    return { user, workspace, client };
  });

  let setupEmailSent = true;
  try {
    await sendPasswordResetEmail(result.user, "setup");
  } catch (error) {
    setupEmailSent = false;
    console.error("Admin-created account setup email failed", { userId: result.user.id, errorType: error instanceof Error ? error.name : "unknown" });
  }

  res.status(201).json({
    account: { userId: result.user.id, workspaceId: result.workspace.id, clientId: result.client.id, email: result.user.email },
    setupEmailSent,
    message: setupEmailSent
      ? "Account created. A secure set-password email was sent to the user."
      : "Account created, but the set-password email could not be sent. Use Change Password and Verify Email from this user's actions.",
  });
});

usersRouter.patch("/memberships/:membershipId/role", async (req, res) => {
  const parsed = workspaceRoleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const membership = await prisma.workspaceMembership.findUnique({ where: { id: req.params.membershipId }, include: { workspace: true, roles: true } });
  if (!membership) return res.status(404).json({ error: "workspace membership not found" });
  const role = parsed.data.role;
  if (membership.workspace.workspaceType === "personal" && role !== "admin") return res.status(400).json({ error: "Personal supports only its single Owner/Admin." });
  if (role === "client_viewer" && membership.workspace.workspaceType !== "agency") return res.status(400).json({ error: "Client Viewer is available only in Agency workspaces." });
  if (membership.workspace.ownerUserId === membership.userId && role !== "admin") return res.status(409).json({ error: "The Primary Owner must retain Owner/Admin authority." });
  const oldRoles = membership.roles.map((item) => item.role);
  if (rolesConsumeSeat([role]) && !rolesConsumeSeat(oldRoles)) {
    const usage = await workspaceSeatUsage(membership.workspace.id, membership.workspace.settingsJson);
    if (usage.limit != null && usage.total >= usage.limit) return res.status(409).json({ error: "No paid workspace seat is available for this role change." });
  }
  const storedRoles = membership.workspace.ownerUserId === membership.userId ? ["owner", "admin"] : [role];
  await prisma.$transaction(async (tx) => {
    await tx.workspaceMemberRole.deleteMany({ where: { membershipId: membership.id } });
    await tx.workspaceMemberRole.createMany({ data: storedRoles.map((item) => ({ membershipId: membership.id, role: item, grantedById: req.user!.userId })) });
    await tx.workspaceActivity.create({ data: { workspaceId: membership.workspaceId, actorUserId: req.user!.userId, action: "super_admin.membership_role_changed", entityType: "workspace_membership", entityId: membership.id, previousJson: { roles: membership.roles.map((item) => item.role) }, nextJson: { roles: storedRoles } } });
  });
  res.json({ membershipId: membership.id, roles: storedRoles });
});

usersRouter.patch("/memberships/:membershipId/status", async (req, res) => {
  const parsed = membershipStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const membership = await prisma.workspaceMembership.findUnique({ where: { id: req.params.membershipId }, include: { workspace: true, roles: true } });
  if (!membership) return res.status(404).json({ error: "workspace membership not found" });
  if (membership.workspace.ownerUserId === membership.userId && parsed.data.status !== "active") return res.status(409).json({ error: "The Primary Owner cannot be suspended or deactivated." });
  if (parsed.data.status === "active" && membership.status !== "active" && rolesConsumeSeat(membership.roles.map((item) => item.role))) {
    const usage = await workspaceSeatUsage(membership.workspace.id, membership.workspace.settingsJson);
    if (usage.limit != null && usage.total >= usage.limit) return res.status(409).json({ error: "No paid workspace seat is available to restore this user." });
  }
  await prisma.$transaction(async (tx) => {
    await tx.workspaceMembership.update({ where: { id: membership.id }, data: { status: parsed.data.status, suspendedAt: parsed.data.status === "suspended" ? new Date() : null, deactivatedAt: parsed.data.status === "deactivated" ? new Date() : null } });
    await tx.workspaceActivity.create({ data: { workspaceId: membership.workspaceId, actorUserId: req.user!.userId, action: "super_admin.membership_status_changed", entityType: "workspace_membership", entityId: membership.id, previousJson: { status: membership.status }, nextJson: { status: parsed.data.status } } });
  });
  res.json({ membershipId: membership.id, status: parsed.data.status });
});

usersRouter.patch("/workspaces/:workspaceId/primary-owner", async (req, res) => {
  const parsed = primaryOwnerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const workspace = await prisma.workspace.findUnique({ where: { id: req.params.workspaceId } });
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const membership = await prisma.workspaceMembership.findFirst({ where: { id: parsed.data.membershipId, workspaceId: workspace.id, status: "active" } });
  if (!membership) return res.status(400).json({ error: "The new Primary Owner must be an active member of this workspace." });
  await prisma.$transaction(async (tx) => {
    const previousOwner = await tx.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: workspace.ownerUserId } } });
    await tx.workspace.update({ where: { id: workspace.id }, data: { ownerUserId: membership.userId } });
    await tx.workspaceMemberRole.upsert({ where: { membershipId_role: { membershipId: membership.id, role: "owner" } }, create: { membershipId: membership.id, role: "owner", grantedById: req.user!.userId }, update: {} });
    await tx.workspaceMemberRole.upsert({ where: { membershipId_role: { membershipId: membership.id, role: "admin" } }, create: { membershipId: membership.id, role: "admin", grantedById: req.user!.userId }, update: {} });
    if (previousOwner && previousOwner.id !== membership.id) await tx.workspaceMemberRole.deleteMany({ where: { membershipId: previousOwner.id, role: "owner" } });
    await tx.workspaceActivity.create({ data: { workspaceId: workspace.id, actorUserId: req.user!.userId, action: "super_admin.primary_owner_changed", entityType: "workspace", entityId: workspace.id, previousJson: { ownerUserId: workspace.ownerUserId }, nextJson: { ownerUserId: membership.userId } } });
  });
  res.json({ workspaceId: workspace.id, ownerUserId: membership.userId });
});

usersRouter.patch("/workspaces/:workspaceId/approval-policy", async (req, res) => {
  const parsed = approvalPolicySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const workspace = await prisma.workspace.findUnique({ where: { id: req.params.workspaceId } });
  if (!workspace) return res.status(404).json({ error: "workspace not found" });
  const previous = workspace.autoApprovalPolicyJson && typeof workspace.autoApprovalPolicyJson === "object" ? workspace.autoApprovalPolicyJson as Record<string, unknown> : {};
  const next = { ...previous, allowManagerSelfApproval: parsed.data.allowManagerSelfApproval };
  await prisma.$transaction(async (tx) => {
    await tx.workspace.update({ where: { id: workspace.id }, data: { autoApprovalPolicyJson: next } });
    await tx.workspaceActivity.create({ data: { workspaceId: workspace.id, actorUserId: req.user!.userId, action: "super_admin.approval_policy_changed", entityType: "workspace", entityId: workspace.id, previousJson: previous, nextJson: next } });
  });
  res.json({ workspaceId: workspace.id, approvalPolicy: next });
});

usersRouter.patch("/:id/verify-email", async (req, res) => {
  const now = new Date();
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: req.params.id },
      data: { emailVerifiedAt: now, isActive: true },
      include: { client: { select: clientUserSelect } },
    });
    await tx.emailVerificationToken.updateMany({
      where: { userId: req.params.id, usedAt: null },
      data: { usedAt: now },
    });
    return updated;
  });

  res.json({ user: publicUser(user) });
});

usersRouter.post("/:id/resend-setup-email", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, email: true, name: true, isActive: true },
  });
  if (!user) return res.status(404).json({ error: "user not found" });
  if (!user.isActive) return res.status(409).json({ error: "Enable this account before sending a setup email." });

  await sendPasswordResetEmail(user, "setup");
  res.json({ message: `A new secure setup link was sent to ${user.email}.` });
});


usersRouter.patch("/:id/active", async (req, res) => {
  const parsed = activeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive: parsed.data.isActive },
    include: { client: { select: clientUserSelect } },
  });
  res.json({ user: publicUser(user) });
});

usersRouter.patch("/:id/plan", async (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { client: true } });
  if (!user) return res.status(404).json({ error: "user not found" });
  if (!user.clientId) return res.status(400).json({ error: "super admin users do not have a client plan" });

  const code = normalizePlanCode(parsed.data.plan);
  const plan = await prisma.billingPlan.findUnique({ where: { code } });
  if (!plan) return res.status(404).json({ error: "plan not found" });

  const workspace = await prisma.workspace.findUnique({ where: { legacyClientId: user.clientId }, select: { id: true } });
  if (!workspace) return res.status(409).json({ error: "The user's workspace has not been migrated to commercial licensing. Open Commercial Admin and repair workspace types first." });

  try {
    await changeWorkspaceCommercialPlan({
      workspaceId: workspace.id,
      targetPlanCode: code,
      actorId: req.user!.userId,
      justification: "Changed by super admin from Users account management.",
    });
  } catch (error) {
    const typed = error as { statusCode?: number; code?: string; message?: string; blockers?: string[] };
    return res.status(typed.statusCode ?? 500).json({ error: typed.message ?? "The plan could not be changed.", code: typed.code, blockers: typed.blockers ?? [] });
  }

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { client: { select: clientUserSelect } },
  });
  res.json({ user: publicUser(updated) });
});

usersRouter.patch("/:id/password", async (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { passwordHash: await hashPassword(parsed.data.password), sessionVersion: { increment: 1 } },
    include: { client: { select: clientUserSelect } },
  });
  res.json({ user: publicUser(user) });
});


usersRouter.patch("/:id/billing-access", async (req, res) => {
  const parsed = billingAccessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { clientId: true } });
  if (!user) return res.status(404).json({ error: "user not found" });
  if (!user.clientId) return res.status(400).json({ error: "super admin users do not have billing access controls" });

  const now = new Date();
  const action = parsed.data;
  if (action.action === "extend_trial") {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: user.clientId }, select: { trialEndsAt: true } });
    const base = client.trialEndsAt && client.trialEndsAt > now ? client.trialEndsAt : now;
    await prisma.client.update({
      where: { id: user.clientId },
      data: {
        aiSubscriptionStatus: "trialing",
        subscriptionSource: "trial",
        trialStartedAt: now,
        trialEndsAt: new Date(base.getTime() + action.days * 24 * 60 * 60 * 1000),
        manualAccessEndsAt: null,
        graceEndsAt: null,
      },
    });
  }

  if (action.action === "offline_until") {
    const expiresAt = new Date(action.expiresAt);
    if (expiresAt <= now) return res.status(400).json({ error: "expiry date must be in the future" });
    await prisma.client.update({
      where: { id: user.clientId },
      data: { aiSubscriptionStatus: "offline", subscriptionSource: "offline", manualAccessEndsAt: expiresAt, offlineAutoRenew: Boolean(action.autoRenew), offlineNextRenewalAt: action.autoRenew ? expiresAt : null },
    });
  }

  if (action.action === "clear_manual") {
    await prisma.client.update({
      where: { id: user.clientId },
      data: { aiSubscriptionStatus: "incomplete", subscriptionSource: "blocked", manualAccessEndsAt: null, graceEndsAt: null, offlineAutoRenew: false, offlineNextRenewalAt: null },
    });
  }

  if (action.action === "mark_active") {
    await prisma.client.update({
      where: { id: user.clientId },
      data: { aiSubscriptionStatus: "active", subscriptionSource: "manual", manualAccessEndsAt: null, graceEndsAt: null, offlineAutoRenew: false, offlineNextRenewalAt: null },
    });
  }

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { client: { select: clientUserSelect } },
  });
  res.json({ user: publicUser(updated) });
});


usersRouter.post("/:id/offline-payment", async (req, res) => {
  const parsed = offlinePaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { clientId: true } });
  if (!user) return res.status(404).json({ error: "user not found" });
  if (!user.clientId) return res.status(400).json({ error: "super admin users do not have billing access controls" });

  const data = parsed.data;
  const now = new Date();
  const client = await prisma.client.findUniqueOrThrow({ where: { id: user.clientId }, select: { manualAccessEndsAt: true } });
  const base = client.manualAccessEndsAt && client.manualAccessEndsAt > now ? client.manualAccessEndsAt : now;
  const subscriptionEndsAt = addMonths(base, data.duration === "yearly" ? 12 : 1);
  const nextRenewalAt = data.autoRenew ? subscriptionEndsAt : null;

  await prisma.$transaction(async (tx) => {
    await tx.offlinePayment.create({
      data: {
        clientId: user.clientId!,
        amountCents: data.amountCents,
        method: data.method,
        duration: data.duration,
        reference: data.reference || null,
        notes: data.notes || null,
        autoRenew: data.autoRenew,
        subscriptionEndsAt,
        nextRenewalAt,
      },
    });
    await tx.client.update({
      where: { id: user.clientId! },
      data: {
        aiSubscriptionStatus: "offline",
        subscriptionSource: "offline",
        manualAccessEndsAt: subscriptionEndsAt,
        offlineAutoRenew: data.autoRenew,
        offlineNextRenewalAt: nextRenewalAt,
      },
    });
  });

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { client: { select: clientUserSelect } },
  });
  res.json({ user: publicUser(updated) });
});
