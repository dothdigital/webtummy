import { Router } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { hashPassword } from "../auth.js";
import { normalizePlanCode } from "../billing.js";
import { requireAuth, requireRole } from "../middleware.js";

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

usersRouter.patch("/memberships/:membershipId/role", async (req, res) => {
  const parsed = workspaceRoleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const membership = await prisma.workspaceMembership.findUnique({ where: { id: req.params.membershipId }, include: { workspace: true, roles: true } });
  if (!membership) return res.status(404).json({ error: "workspace membership not found" });
  const role = parsed.data.role;
  if (role === "client_viewer" && membership.workspace.workspaceType !== "agency") return res.status(400).json({ error: "Client Viewer is available only in Agency workspaces." });
  if (membership.workspace.ownerUserId === membership.userId && role !== "admin") return res.status(409).json({ error: "The Primary Owner must retain Owner/Admin authority." });
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
  const membership = await prisma.workspaceMembership.findUnique({ where: { id: req.params.membershipId }, include: { workspace: true } });
  if (!membership) return res.status(404).json({ error: "workspace membership not found" });
  if (membership.workspace.ownerUserId === membership.userId && parsed.data.status !== "active") return res.status(409).json({ error: "The Primary Owner cannot be suspended or deactivated." });
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

  await prisma.client.update({
    where: { id: user.clientId },
    data: { plan: code, aiSubscriptionStatus: "active" },
  });

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
    data: { passwordHash: await hashPassword(parsed.data.password) },
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
