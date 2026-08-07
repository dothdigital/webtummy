import { Router } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { requireAuth, requireRole } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import {
  commitUsage,
  ensureCreditAccount,
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
    error.name === "usage_insufficient_credits" ? 402 :
    error.name === "usage_limit_reached" || error.name === "usage_budget_cap_reached" || error.name === "usage_plan_blocked" ? 409 :
    error.name === "usage_feature_disabled" ? 404 :
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
  await ensureCreditAccount(clientId);
  res.json(await usageSummaryForClient(clientId));
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

usageRouter.get("/admin/usage/overview", requireRole("super_admin"), async (_req, res) => {
  await ensureUsageControlDefaults();
  const periodStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [eventsByFeature, providerCosts, recentAlerts, creditAccounts] = await Promise.all([
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
    prisma.creditAccount.findMany({ orderBy: { updatedAt: "desc" }, take: 25, include: { client: { select: { id: true, name: true, plan: true } } } }),
  ]);
  res.json({ eventsByFeature, providerCosts, recentAlerts, creditAccounts });
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
  const feature = await prisma.featureCostCatalog.update({
    where: { featureKey: req.params.featureKey },
    data: parsed.data,
  });
  res.json({ feature });
});

usageRouter.patch("/admin/usage/plan-limits/:planCode/:featureKey", requireRole("super_admin"), async (req, res) => {
  const parsed = planLimitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await ensureUsageControlDefaults();
  const limit = await prisma.planFeatureLimit.upsert({
    where: { planCode_featureKey: { planCode: req.params.planCode, featureKey: req.params.featureKey } },
    update: parsed.data,
    create: {
      planCode: req.params.planCode,
      featureKey: req.params.featureKey,
      monthlyLimit: parsed.data.monthlyLimit ?? null,
      dailyLimit: parsed.data.dailyLimit ?? null,
      creditCost: parsed.data.creditCost ?? null,
      hardBlocked: parsed.data.hardBlocked ?? false,
      overageAllowed: parsed.data.overageAllowed ?? false,
      configJson: parsed.data.configJson ?? {},
    },
  });
  res.json({ limit });
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
