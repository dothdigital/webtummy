import { Router } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { requireAuth, requireRole } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import {
  commitUsage,
  ensureUsageControlDefaults,
  preflightUsage,
  refundUsage,
  usageSummaryForClient,
} from "../usage-engine.js";
import { aiModelTierForFeature, defaultAiModelForFeature } from "../ai-model-policy.js";

export const usageRouter = Router();
usageRouter.use(requireAuth);

const preflightSchema = z.object({
  clientId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  websiteId: z.string().optional().nullable(),
  featureKey: z.string().min(2).max(120),
  actionKey: z.string().max(160).optional().nullable(),
  idempotencyKey: z.string().max(255).optional().nullable(),
  inputUnits: z.coerce.number().int().min(1).max(1000).default(1),
  metadata: z.record(z.unknown()).default({}),
});

const commitSchema = z.object({
  usageEventId: z.string().optional().nullable(),
  approvalToken: z.string().optional().nullable(),
  provider: z.string().max(80).optional().nullable(),
  model: z.string().max(120).optional().nullable(),
  inputTokens: z.coerce.number().int().min(0).default(0),
  outputTokens: z.coerce.number().int().min(0).default(0),
  providerCostUsd: z.coerce.number().min(0).default(0),
  metadata: z.record(z.unknown()).default({}),
});

const refundSchema = z.object({
  usageEventId: z.string(),
  reason: z.string().max(500).optional().nullable(),
});

const usageAuditQuerySchema = z.object({
  search: z.string().trim().max(160).optional(),
  status: z.enum(["all", "reserved", "committed", "refunded", "failed", "reversed"]).default("all"),
  take: z.coerce.number().int().min(1).max(250).default(100),
});

const reverseUsageSchema = z.object({
  reason: z.string().trim().min(8).max(500),
});

const featureSchema = z.object({
  moduleName: z.string().min(2).max(80),
  label: z.string().min(2).max(180),
  description: z.string().min(2).max(5000),
  defaultCreditCost: z.coerce.number().int().min(0).max(100000),
  estimatedProviderCost: z.coerce.number().min(0).max(100000),
  unitLabel: z.string().max(40).default("run"),
  requiresApproval: z.boolean().default(false),
  requiresIntegration: z.boolean().default(false),
  cacheTtlMinutes: z.coerce.number().int().min(0).max(525600).default(0),
  isActive: z.boolean().default(true),
  configJson: z.record(z.unknown()).default({}),
});

const planLimitSchema = z.object({
  monthlyLimit: z.coerce.number().int().min(0).nullable().optional(),
  dailyLimit: z.coerce.number().int().min(0).nullable().optional(),
  creditCost: z.coerce.number().int().min(0).nullable().optional(),
  hardBlocked: z.boolean().optional(),
  overageAllowed: z.boolean().optional(),
  configJson: z.record(z.unknown()).optional(),
});

const budgetCapSchema = z.object({
  clientId: z.string().optional().nullable(),
  scope: z.enum(["workspace", "project", "feature", "provider"]),
  scopeKey: z.string().min(1).max(191),
  monthlyCredits: z.coerce.number().int().min(0).nullable().optional(),
  monthlyCostUsd: z.coerce.number().min(0).nullable().optional(),
  isActive: z.boolean().default(true),
  alertAtPercent: z.coerce.number().int().min(1).max(100).default(80),
});

const modelRouteSchema = z.object({
  featureKey: z.string().min(2).max(120),
  planCode: z.string().max(40).nullable().optional(),
  taskComplexity: z.string().max(40).default("standard"),
  provider: z.string().max(80).default("openai"),
  model: z.string().min(2).max(120),
  maxInputTokens: z.coerce.number().int().min(1).nullable().optional(),
  maxOutputTokens: z.coerce.number().int().min(1).nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  configJson: z.record(z.unknown()).default({}),
});

function errorResponse(res: import("express").Response, error: unknown) {
  if (!(error instanceof Error)) return res.status(500).json({ error: "usage engine failed" });
  const status =
    error.name === "usage_insufficient_credits" || error.name === "usage_insufficient_capacity" ? 402 :
    error.name === "usage_limit_reached" || error.name === "usage_budget_cap_reached" || error.name === "usage_plan_blocked" ? 409 :
    error.name === "usage_feature_disabled" ? 404 :
    error.name === "usage_role_blocked" ? 403 :
    400;
  return res.status(status).json({ error: error.message, code: error.name });
}

usageRouter.post("/usage/bootstrap", requireRole("super_admin"), async (_req, res) => {
  await ensureUsageControlDefaults();
  res.json({ ok: true });
});

usageRouter.get("/usage/me", async (req, res) => {
  const clientId = await projectClientIdForRequest(req);
  if (!clientId) return res.status(400).json({ error: "client context required" });
  await ensureUsageControlDefaults();
  res.json(await usageSummaryForClient(clientId));
});

usageRouter.get("/usage/history", async (req, res) => {
  const clientId = await projectClientIdForRequest(req);
  if (!clientId) return res.status(400).json({ error: "client context required" });
  const workspace = await prisma.workspace.findUnique({ where: { legacyClientId: clientId }, select: { id: true } });
  if (!workspace) return res.json({ transactions: [], charged: 0, refunded: 0 });
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const transactions = await prisma.workspaceCapacityTransaction.findMany({
    where: { workspaceId: workspace.id, createdAt: { gte: periodStart }, amount: { not: 0 } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const usageIds = transactions.map((item) => item.usageEventId).filter((id): id is string => Boolean(id));
  const usageEvents = usageIds.length ? await prisma.usageEvent.findMany({
    where: { id: { in: usageIds }, workspaceId: workspace.id },
    select: { id: true, actionKey: true, featureKey: true, projectId: true, status: true, feature: { select: { label: true } } },
  }) : [];
  const projectIds = [...new Set(usageEvents.map((item) => item.projectId).filter((id): id is string => Boolean(id)))];
  const projects = projectIds.length ? await prisma.project.findMany({ where: { id: { in: projectIds }, clientId }, select: { id: true, name: true, businessName: true } }) : [];
  const usageById = new Map(usageEvents.map((item) => [item.id, item]));
  const projectById = new Map(projects.map((item) => [item.id, item.businessName || item.name]));
  const rows = transactions.map((item) => {
    const usage = item.usageEventId ? usageById.get(item.usageEventId) : null;
    return {
      id: item.id,
      type: item.type,
      bucket: item.bucket,
      units: Math.abs(item.amount),
      effect: item.amount < 0 ? "charged" : "restored",
      balanceAfter: item.balanceAfter,
      reason: item.reason,
      action: usage?.actionKey || usage?.feature.label || item.reason,
      feature: usage?.feature.label || usage?.featureKey || null,
      projectId: usage?.projectId || null,
      projectName: usage?.projectId ? projectById.get(usage.projectId) || "Project" : null,
      status: usage?.status || item.type,
      createdAt: item.createdAt,
    };
  });
  res.json({
    transactions: rows,
    charged: rows.filter((item) => item.effect === "charged").reduce((sum, item) => sum + item.units, 0),
    refunded: rows.filter((item) => item.effect === "restored").reduce((sum, item) => sum + item.units, 0),
  });
});

usageRouter.get("/usage/feature-costs", async (_req, res) => {
  await ensureUsageControlDefaults();
  const features = await prisma.featureCostCatalog.findMany({
    where: { isActive: true },
    orderBy: [{ moduleName: "asc" }, { featureKey: "asc" }],
  });
  res.json({ features });
});

usageRouter.post("/usage/preflight", async (req, res) => {
  const parsed = preflightSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await projectClientIdForRequest(req, parsed.data.clientId);
  if (!clientId) return res.status(400).json({ error: "client context required" });
  try {
    const result = await preflightUsage({
      ...parsed.data,
      clientId,
      userId: req.user?.userId,
    });
    res.json(result);
  } catch (error) {
    errorResponse(res, error);
  }
});

usageRouter.post("/usage/commit", async (req, res) => {
  const parsed = commitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const usageEvent = await commitUsage(parsed.data);
    res.json({ usageEvent });
  } catch (error) {
    errorResponse(res, error);
  }
});

usageRouter.post("/usage/refund", async (req, res) => {
  const parsed = refundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const usageEvent = await refundUsage({ usageEventId: parsed.data.usageEventId, reason: parsed.data.reason ?? undefined });
    res.json({ usageEvent });
  } catch (error) {
    errorResponse(res, error);
  }
});

usageRouter.get("/admin/usage/events", requireRole("super_admin"), async (req, res) => {
  const parsed = usageAuditQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const search = parsed.data.search;
  const users = search ? await prisma.user.findMany({
    where: { OR: [{ email: { contains: search, mode: "insensitive" } }, { name: { contains: search, mode: "insensitive" } }] },
    select: { id: true },
    take: 100,
  }) : [];
  const events = await prisma.usageEvent.findMany({
    where: {
      ...(parsed.data.status === "all" ? {} : { status: parsed.data.status }),
      ...(search ? { OR: [
        { userId: { in: users.map((user) => user.id) } },
        { featureKey: { contains: search, mode: "insensitive" } },
        { actionKey: { contains: search, mode: "insensitive" } },
        { projectId: { contains: search, mode: "insensitive" } },
      ] } : {}),
    },
    include: { capacityWorkspace: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: parsed.data.take,
  });
  const [eventUsers, projects] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: events.flatMap((event) => event.userId ? [event.userId] : []) } }, select: { id: true, email: true, name: true } }),
    prisma.project.findMany({ where: { id: { in: events.flatMap((event) => event.projectId ? [event.projectId] : []) } }, select: { id: true, name: true } }),
  ]);
  const userById = new Map(eventUsers.map((user) => [user.id, user]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  res.json({ events: events.map((event) => ({
    ...event,
    user: event.userId ? userById.get(event.userId) ?? null : null,
    project: event.projectId ? projectById.get(event.projectId) ?? null : null,
    reversible: event.status === "committed" && event.creditsCommitted > 0 && Boolean(event.workspaceId),
  })) });
});

usageRouter.post("/admin/usage/events/:eventId/reverse", requireRole("super_admin"), async (req, res) => {
  const parsed = reverseUsageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const restored = await prisma.$transaction(async (tx) => {
      const event = await tx.usageEvent.findUnique({ where: { id: req.params.eventId } });
      if (!event) throw Object.assign(new Error("Usage event not found."), { statusCode: 404 });
      if (event.status === "reversed") throw Object.assign(new Error("This charge was already reversed."), { statusCode: 409 });
      if (event.status !== "committed" || event.creditsCommitted <= 0 || !event.workspaceId) throw Object.assign(new Error("Only a committed workspace charge can be reversed."), { statusCode: 409 });
      const metadata = event.metadataJson && typeof event.metadataJson === "object" && !Array.isArray(event.metadataJson) ? event.metadataJson as Record<string, unknown> : {};
      const accountId = String(metadata.capacityAccountId ?? "");
      if (!accountId) throw Object.assign(new Error("The capacity account for this charge could not be identified."), { statusCode: 409 });
      const includedUnits = Math.min(event.creditsCommitted, event.includedUnitsReserved);
      const purchasedUnits = Math.max(0, event.creditsCommitted - includedUnits);
      const claimed = await tx.usageEvent.updateMany({
        where: { id: event.id, status: "committed" },
        data: { status: "reversed", refundedAt: new Date(), error: parsed.data.reason, metadataJson: { ...metadata, adminReversal: { actorId: req.user?.userId, reason: parsed.data.reason, reversedAt: new Date().toISOString() } } },
      });
      if (!claimed.count) throw Object.assign(new Error("This charge changed while it was being reversed. Refresh and try again."), { statusCode: 409 });
      const account = await tx.workspaceCapacityAccount.update({ where: { id: accountId }, data: {
        includedBalance: { increment: includedUnits }, includedUsed: { decrement: includedUnits },
        purchasedBalance: { increment: purchasedUnits }, purchasedUsed: { decrement: purchasedUnits },
      } });
      for (const row of [
        includedUnits ? { bucket: "included", units: includedUnits, balanceAfter: account.includedBalance } : null,
        purchasedUnits ? { bucket: "purchased", units: purchasedUnits, balanceAfter: account.purchasedBalance } : null,
      ].filter((row): row is { bucket: string; units: number; balanceAfter: number } => Boolean(row))) await tx.workspaceCapacityTransaction.create({ data: {
        workspaceId: event.workspaceId!, accountId, usageEventId: event.id, bucket: row.bucket, type: "admin_reversal", amount: row.units,
        balanceAfter: row.balanceAfter, reason: parsed.data.reason.slice(0, 255), actorId: req.user?.userId,
        correlationId: `admin-reversal:${event.id}`.slice(0, 191), metadataJson: { featureKey: event.featureKey, originalStatus: event.status },
      } });
      await tx.commercialAuditEvent.create({ data: {
        workspaceId: event.workspaceId, actorType: "user", actorId: req.user?.userId, action: "commercial.usage_charge_reversed",
        reasonCode: "admin_usage_correction", source: "admin", correlationId: `admin-reversal:${event.id}`.slice(0, 191),
        beforeJson: { usageEventId: event.id, status: event.status, creditsCommitted: event.creditsCommitted },
        afterJson: { status: "reversed", restoredIncludedUnits: includedUnits, restoredPurchasedUnits: purchasedUnits },
        metadataJson: { reason: parsed.data.reason, affectedUserId: event.userId, projectId: event.projectId, featureKey: event.featureKey },
      } });
      return { includedUnits, purchasedUnits, totalUnits: includedUnits + purchasedUnits };
    });
    res.json({ ok: true, restored });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 400;
    res.status(status).json({ error: error instanceof Error ? error.message : "Could not reverse this usage charge." });
  }
});

usageRouter.get("/admin/usage/overview", requireRole("super_admin"), async (_req, res) => {
  await ensureUsageControlDefaults();
  const periodStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [eventsByFeature, providerCosts, recentAlerts, capacityAccounts] = await Promise.all([
    prisma.usageEvent.groupBy({
      by: ["featureKey", "status"],
      where: { createdAt: { gte: periodStart } },
      _count: { _all: true },
      _sum: { creditsCommitted: true, providerCostUsd: true },
    }),
    prisma.providerCostEvent.groupBy({
      by: ["featureKey", "provider"],
      where: { createdAt: { gte: periodStart } },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
    }),
    prisma.usageAlert.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.workspaceCapacityAccount.findMany({ orderBy: { updatedAt: "desc" }, take: 25, include: { workspace: { select: { id: true, name: true, workspaceType: true } } } }),
  ]);
  res.json({ eventsByFeature, providerCosts, recentAlerts, capacityAccounts, creditAccounts: [] });
});

usageRouter.get("/admin/usage/feature-costs", requireRole("super_admin"), async (_req, res) => {
  await ensureUsageControlDefaults();
  const features = await prisma.featureCostCatalog.findMany({
    orderBy: [{ moduleName: "asc" }, { featureKey: "asc" }],
    include: { planLimits: { orderBy: { planCode: "asc" } }, modelRoutingRules: { orderBy: [{ planCode: "asc" }, { sortOrder: "asc" }] } },
  });
  res.json({
    features: features.map((feature) => ({
      ...feature,
      modelTier: aiModelTierForFeature(feature.featureKey),
      defaultModel: defaultAiModelForFeature(feature.featureKey),
    })),
  });
});

usageRouter.patch("/admin/usage/feature-costs/:featureKey", requireRole("super_admin"), async (req, res) => {
  const parsed = featureSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.defaultCreditCost !== undefined || parsed.data.estimatedProviderCost !== undefined) {
    return res.status(409).json({ error: "Workflow units and provider-cost estimates are managed in Commercial Admin." });
  }
  const feature = await prisma.featureCostCatalog.update({
    where: { featureKey: req.params.featureKey },
    data: parsed.data,
  });
  res.json({ feature });
});

usageRouter.patch("/admin/usage/plan-limits/:planCode/:featureKey", requireRole("super_admin"), async (req, res) => {
  void req;
  res.status(410).json({ error: "Per-plan activity limits were retired by DEV-059. All plans include all core capabilities; use workspace AI Capacity and budget caps instead." });
});

usageRouter.get("/admin/usage/budget-caps", requireRole("super_admin"), async (_req, res) => {
  const budgetCaps = await prisma.budgetCap.findMany({ orderBy: { createdAt: "desc" }, include: { client: { select: { id: true, name: true, plan: true } } } });
  res.json({ budgetCaps });
});

usageRouter.post("/admin/usage/budget-caps", requireRole("super_admin"), async (req, res) => {
  const parsed = budgetCapSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await projectClientIdForRequest(req, parsed.data.clientId);
  if (!clientId) return res.status(400).json({ error: "client context required" });
  const budgetCap = await prisma.budgetCap.upsert({
    where: { clientId_scope_scopeKey: { clientId, scope: parsed.data.scope, scopeKey: parsed.data.scopeKey } },
    update: { ...parsed.data, clientId },
    create: { ...parsed.data, clientId },
  });
  res.json({ budgetCap });
});

usageRouter.get("/admin/usage/model-routes", requireRole("super_admin"), async (_req, res) => {
  await ensureUsageControlDefaults();
  const modelRoutes = await prisma.modelRoutingRule.findMany({ orderBy: [{ featureKey: "asc" }, { sortOrder: "asc" }] });
  res.json({ modelRoutes });
});

usageRouter.post("/admin/usage/model-routes", requireRole("super_admin"), async (req, res) => {
  const parsed = modelRouteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const modelRoute = await prisma.modelRoutingRule.create({ data: parsed.data });
  res.json({ modelRoute });
});

usageRouter.patch("/admin/usage/model-routes/:id", requireRole("super_admin"), async (req, res) => {
  const parsed = modelRouteSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const modelRoute = await prisma.modelRoutingRule.update({ where: { id: req.params.id }, data: parsed.data });
  res.json({ modelRoute });
});
