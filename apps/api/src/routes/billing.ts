import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { requireAuth, requireRole } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { hasWorkspacePermission, isWorkspaceOwner, workspaceContext } from "../workspace-access.js";
import { config } from "../config.js";
import {
  checkoutUrlForPrice,
  commercialCatalog,
  commercialRegistrationPolicy,
  COMMERCIAL_PLAN_VERSION,
  COMMERCIAL_REGISTRATION_POLICY_ID,
  ensureCommercialDefaults,
  processJvZooIpn,
  workspaceCommercialSummary,
} from "../commercial-service.js";
import { adjustWorkspacePurchasedCapacity } from "../commercial-capacity.js";
import { ensureUsageControlDefaults } from "../usage-engine.js";
import {
  billingBlockReason,
  billingPlanForClient,
  createCheckoutSession,
  createPortalSession,
  ensureDefaultBillingPlans,
  hasBillingAccess,
  listCustomerInvoices,
  normalizePlanCode,
  planView,
  requireRawBody,
  stripeTimestamp,
  syncSubscriptionFromStripe,
  verifyStripeSignature,
} from "../billing.js";
import { issueJvZooActivationEmail } from "../jvzoo-activation.js";
import { acceptJvZooWebhook } from "../jvzoo-intake.js";

export const billingRouter = Router();

async function requireBillingOwner(req: Request, res: import("express").Response, next: import("express").NextFunction) {
  if (req.user?.role === "super_admin") return next();
  try {
    const context = await workspaceContext(req);
    if (!isWorkspaceOwner(context)) return res.status(403).json({ error: "Only the Workspace Owner can manage billing." });
    next();
  } catch {
    res.status(403).json({ error: "Workspace Owner access is required." });
  }
}

async function requireWorkspaceSettings(req: Request, res: import("express").Response, next: import("express").NextFunction) {
  if (req.user?.role === "super_admin") return next();
  try {
    const context = await workspaceContext(req);
    if (!hasWorkspacePermission(context, "manage_settings")) return res.status(403).json({ error: "Workspace settings permission is required." });
    next();
  } catch {
    res.status(403).json({ error: "Workspace settings permission is required." });
  }
}

const planCodeSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/, "Use 2-40 lowercase letters, numbers, hyphens, or underscores");

const planFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(10000),
  priceMonthlyCents: z.number().int().min(0),
  articleLimit: z.number().int().min(0),
  helperMonthlyLimit: z.number().int().min(0),
  features: z.array(z.string().trim().min(1).max(160)).max(30),
  stripeProductId: z.string().trim().min(1).max(255).nullable().optional(),
  stripePriceId: z.string().trim().min(1).max(255).nullable().optional(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});

const createPlanSchema = planFieldsSchema.extend({
  code: planCodeSchema,
});

const updatePlanSchema = planFieldsSchema.partial();

const reportEmailPreferencesSchema = z.object({
  reportEmailEnabled: z.boolean(),
  weeklyReportEmailEnabled: z.boolean(),
  monthlyReportEmailEnabled: z.boolean(),
  rankingChangeEmailEnabled: z.boolean(),
});

const commercialCheckoutSchema = z.object({
  priceId: z.string().trim().min(1).optional(),
  planCode: z.string().trim().min(1).optional(),
  billingInterval: z.enum(["monthly", "annual"]).default("monthly"),
  priceClass: z.enum(["founding", "standard", "interim", "legacy"]).default("standard"),
}).refine((value) => value.priceId || value.planCode, "Choose a commercial price.");

const commercialAddonCheckoutSchema = z.object({ addonId: z.string().trim().min(1) });

const commercialPriceSchema = z.object({
  providerProductRef: z.string().trim().max(191).nullable().optional(),
  checkoutUrl: z.string().trim().url().max(1000).refine((value) => {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && (hostname === "jvzoo.com" || hostname.endsWith(".jvzoo.com"));
  }, "Use an official HTTPS JVZoo checkout URL.").nullable().optional(),
  amountCents: z.number().int().min(0).max(100_000_000).optional(),
  effectiveFrom: z.string().datetime().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const capacityAdjustmentSchema = z.object({
  units: z.number().int().refine((value) => value !== 0, "Enter a non-zero unit adjustment."),
  reasonCode: z.string().trim().min(2).max(80),
  justification: z.string().trim().min(5).max(2000),
});

const commercialAddonSchema = z.object({
  amountCents: z.number().int().min(0).max(100_000_000).optional(),
  capacityUnits: z.number().int().min(0).max(10_000_000).optional(),
  providerProductRef: z.string().trim().max(191).nullable().optional(),
  checkoutUrl: commercialPriceSchema.shape.checkoutUrl,
  status: z.enum(["active", "inactive"]).optional(),
});

const workflowPricingSchema = z.object({
  defaultCreditCost: z.number().int().min(0).max(1_000_000),
  pricingModel: z.enum(["fixed", "keyword_market", "website", "per_image", "per_domain", "ai_or_zero"]),
  pricingConfig: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  minimumUnitCost: z.number().int().min(0).max(1_000_000).nullable(),
  maximumUnitCost: z.number().int().min(0).max(10_000_000).nullable(),
  estimatedProviderCost: z.number().min(0).max(1_000_000),
});

const registrationPolicySchema = z.object({
  trialEnabled: z.boolean(),
  trialDays: z.number().int().min(1).max(90),
});

const allowedDescriptionTags = new Set(["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li"]);

function sanitizePlanDescription(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (tag, rawName) => {
      const name = String(rawName).toLowerCase();
      if (!allowedDescriptionTags.has(name)) return "";
      const closing = tag.startsWith("</") ? "/" : "";
      return name === "br" ? "<br>" : `<${closing}${name}>`;
    });
}

async function plansWithMemberCounts(plans: Awaited<ReturnType<typeof prisma.billingPlan.findMany>>) {
  const counts = await prisma.client.groupBy({ by: ["plan"], _count: { _all: true } });
  const countByPlan = new Map(counts.map((entry) => [entry.plan, entry._count._all]));
  return plans.map((plan) => ({ ...planView(plan), memberCount: countByPlan.get(plan.code) ?? 0 }));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : null;
}

function metadataValue(object: Record<string, unknown>, key: string) {
  const metadata = object.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  return stringValue((metadata as Record<string, unknown>)[key]);
}

function firstPriceId(object: Record<string, unknown>) {
  const items = object.items;
  if (!items || typeof items !== "object") return null;
  const data = (items as Record<string, unknown>).data;
  if (!Array.isArray(data)) return null;
  const first = data[0];
  if (!first || typeof first !== "object") return null;
  const price = (first as Record<string, unknown>).price;
  if (!price || typeof price !== "object") return null;
  return stringValue((price as Record<string, unknown>).id);
}

async function clientForBillingRequest(req: Request) {
  if (!req.user) throw new Error("missing user");
  const clientId = await projectClientIdForRequest(req);
  if (!clientId) throw new Error("project context required");
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client || !client.isActive) throw new Error("project space inactive");
  return client;
}

async function billingStatusForClient(client: Awaited<ReturnType<typeof clientForBillingRequest>>) {
  const plan = await billingPlanForClient(client.plan);
  const view = plan ? planView(plan) : null;
  const workspace = await prisma.workspace.findUnique({ where: { legacyClientId: client.id } });
  const commercial = workspace ? await workspaceCommercialSummary(workspace.id) : null;
  const now = new Date();
  const trialEndsAt = client.trialEndsAt?.toISOString() ?? null;
  const manualAccessEndsAt = client.manualAccessEndsAt?.toISOString() ?? null;
  const trialDaysRemaining = client.trialEndsAt ? Math.max(0, Math.ceil((client.trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))) : 0;
  const trialDurationDays = client.trialStartedAt && client.trialEndsAt
    ? Math.max(1, Math.round((client.trialEndsAt.getTime() - client.trialStartedAt.getTime()) / (24 * 60 * 60 * 1000)))
    : 0;
  const manualAccessDaysRemaining = client.manualAccessEndsAt ? Math.max(0, Math.ceil((client.manualAccessEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))) : 0;
  return {
    plan: commercial?.subscription ? {
      ...(view ?? {}),
      code: commercial.subscription.plan.code,
      name: commercial.subscription.plan.name,
      priceMonthly: commercial.subscription.price?.amountCents ? commercial.subscription.price.amountCents / 100 : view?.priceMonthly ?? 0,
      priceMonthlyCents: commercial.subscription.price?.amountCents ?? view?.priceMonthlyCents ?? 0,
    } : view,
    status: commercial?.workspace.commercialState ?? client.aiSubscriptionStatus,
    hasAccess: commercial ? ["full", "grace"].includes(commercial.workspace.accessMode) : hasBillingAccess(client),
    blockReason: commercial && !["full", "grace"].includes(commercial.workspace.accessMode)
      ? `Workspace access is ${commercial.workspace.accessMode.replace(/_/g, " ")}.`
      : hasBillingAccess(client) ? null : billingBlockReason(client),
    trialStartedAt: client.trialStartedAt?.toISOString() ?? null,
    trialEndsAt,
    trialDaysRemaining,
    trialDurationDays,
    manualAccessEndsAt,
    manualAccessDaysRemaining,
    stripeCustomerId: client.stripeCustomerId,
    stripeSubscriptionId: client.stripeSubscriptionId,
    billingProvider: commercial?.subscription?.provider ?? client.subscriptionSource,
    commercial,
    subscriptionCurrentPeriodEnd: client.subscriptionCurrentPeriodEnd?.toISOString() ?? null,
    reportEmailEnabled: client.reportEmailEnabled,
    weeklyReportEmailEnabled: client.weeklyReportEmailEnabled,
    monthlyReportEmailEnabled: client.monthlyReportEmailEnabled,
    rankingChangeEmailEnabled: client.rankingChangeEmailEnabled,
  };
}

async function commercialPricingPayload(workspaceType?: string | null) {
  const catalog = await commercialCatalog({ workspaceType });
  return {
    plans: catalog.map((plan) => {
      const monthly = plan.prices.find((price) => price.billingInterval === "monthly" && price.priceClass === "standard")
        ?? plan.prices.find((price) => price.billingInterval === "monthly");
      const legacyFeatures = plan.featureEntitlements && typeof plan.featureEntitlements === "object"
        ? Object.entries(plan.featureEntitlements as Record<string, unknown>).filter(([key, value]) => key !== "*" && value === true).map(([key]) => key.replace(/_/g, " "))
        : [];
      return {
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceMonthly: (monthly?.amountCents ?? 0) / 100,
        priceMonthlyCents: monthly?.amountCents ?? 0,
        articleLimit: 0,
        articles: 0,
        helperMonthlyLimit: Number((plan.numericLimits as Record<string, unknown>)?.monthlyAiCapacity ?? 0),
        helperDailyLimit: Number((plan.numericLimits as Record<string, unknown>)?.monthlyAiCapacity ?? 0),
        features: legacyFeatures,
        stripeProductId: null,
        stripePriceId: null,
        isActive: plan.isActive,
        sortOrder: plan.sortOrder,
        commercialVersion: plan.version,
        workspaceTypeEligibility: plan.workspaceTypeEligibility,
        prices: plan.prices,
      };
    }),
  };
}

billingRouter.get("/pricing", async (_req, res) => {
  res.json(await commercialPricingPayload());
});

billingRouter.get("/pricing/workspace", requireAuth, async (req, res) => {
  const context = await workspaceContext(req);
  res.json(await commercialPricingPayload(context.workspace.workspaceType));
});

billingRouter.get("/commercial-addons", requireAuth, async (req, res) => {
  const context = await workspaceContext(req);
  await ensureCommercialDefaults();
  const addons = await prisma.commercialAddonSku.findMany({ where: { status: "active" }, orderBy: [{ kind: "asc" }, { amountCents: "asc" }] });
  res.json({ addons: addons.filter((addon) => !Array.isArray(addon.workspaceTypes) || addon.workspaceTypes.map(String).includes(context.workspace.workspaceType)) });
});

billingRouter.post("/commercial-addons/checkout", requireAuth, requireBillingOwner, async (req, res) => {
  const parsed = commercialAddonCheckoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const context = await workspaceContext(req);
  const addon = await prisma.commercialAddonSku.findFirst({ where: { id: parsed.data.addonId, status: "active" } });
  if (!addon) return res.status(404).json({ error: "Commercial add-on not found." });
  const eligible = !Array.isArray(addon.workspaceTypes) || addon.workspaceTypes.map(String).includes(context.workspace.workspaceType);
  if (!eligible) return res.status(409).json({ error: "This add-on is not available for the current workspace plan." });
  if (!addon.providerProductRef || !addon.checkoutUrl) return res.status(409).json({ error: "This add-on is not connected to a JVZoo product yet." });
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { email: true } });
  res.json({ url: checkoutUrlForPrice({ checkoutUrl: addon.checkoutUrl }, context.workspace.id, user?.email ?? null), addon });
});

billingRouter.get("/status", requireAuth, async (req, res) => {
  try {
    const client = await clientForBillingRequest(req);
    res.json(await billingStatusForClient(client));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "could not load billing status" });
  }
});

billingRouter.post("/checkout-session", requireAuth, requireBillingOwner, async (req, res) => {
  const parsed = commercialCheckoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    await ensureCommercialDefaults();
    const context = await workspaceContext(req);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId }, select: { email: true } });
    const price = await prisma.commercialPrice.findFirst({
      where: parsed.data.priceId
        ? { id: parsed.data.priceId, provider: "jvzoo", status: "active" }
        : {
            provider: "jvzoo",
            status: "active",
            billingInterval: parsed.data.billingInterval,
            priceClass: parsed.data.priceClass,
            planVersion: { billingPlan: { code: normalizePlanCode(parsed.data.planCode) }, status: "active" },
          },
      include: { planVersion: { include: { billingPlan: true } } },
    });
    if (!price) return res.status(404).json({ error: "JVZoo price is not available." });
    const eligibleWorkspaceTypes = Array.isArray(price.planVersion.workspaceTypeEligibility)
      ? price.planVersion.workspaceTypeEligibility.map(String)
      : [];
    if (eligibleWorkspaceTypes.length && !eligibleWorkspaceTypes.includes(context.workspace.workspaceType)) {
      return res.status(409).json({ error: `This product is not available for a ${context.workspace.workspaceType} workspace.` });
    }
    const url = checkoutUrlForPrice(price, context.workspace.id, user.email);
    res.json({ url, provider: "jvzoo", priceId: price.id, planCode: price.planVersion.billingPlan.code });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "could not start checkout" });
  }
});

billingRouter.post("/portal-session", requireAuth, requireBillingOwner, async (req, res) => {
  res.json({ url: config.jvzooCustomerPortalUrl, provider: "jvzoo" });
});

billingRouter.get("/invoices", requireAuth, requireBillingOwner, async (req, res) => {
  try {
    const context = await workspaceContext(req);
    const events = await prisma.commercialBillingEvent.findMany({
      where: { workspaceId: context.workspace.id, provider: "jvzoo", verified: true, eventType: { in: ["SALE", "BILL", "REBILL", "RFND", "REFUND"] } },
      orderBy: { occurredAt: "desc" },
      take: 24,
    });
    res.json({
      invoices: events.map((event) => {
        const normalized = event.normalizedPayload && typeof event.normalizedPayload === "object" ? event.normalizedPayload as Record<string, unknown> : {};
        const v2Amount = Number(normalized.amount ?? 0);
        const amount = Number.isFinite(v2Amount) ? (Number(normalized.version) === 1 ? Math.round(v2Amount) : Math.round(v2Amount * 100)) : 0;
        return {
          id: event.providerEventId,
          number: event.providerEventId,
          status: ["RFND", "REFUND"].includes(event.eventType) ? "refunded" : "paid",
          currency: String(normalized.currency ?? "USD"),
          amountDue: amount,
          amountPaid: ["RFND", "REFUND"].includes(event.eventType) ? 0 : amount,
          createdAt: (event.occurredAt ?? event.createdAt).toISOString(),
          hostedInvoiceUrl: config.jvzooCustomerPortalUrl,
          invoicePdf: null,
          provider: "jvzoo",
        };
      }),
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "could not load invoices" });
  }
});

billingRouter.patch("/report-email-preferences", requireAuth, requireWorkspaceSettings, async (req, res) => {
  const parsed = reportEmailPreferencesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const client = await clientForBillingRequest(req);
    const updated = await prisma.client.update({ where: { id: client.id }, data: parsed.data });
    res.json({
      reportEmailEnabled: updated.reportEmailEnabled,
      weeklyReportEmailEnabled: updated.weeklyReportEmailEnabled,
      monthlyReportEmailEnabled: updated.monthlyReportEmailEnabled,
      rankingChangeEmailEnabled: updated.rankingChangeEmailEnabled,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "could not update report email preferences" });
  }
});

billingRouter.get("/commercial-summary", requireAuth, async (req, res) => {
  try {
    const context = await workspaceContext(req);
    res.json(await workspaceCommercialSummary(context.workspace.id));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not load the workspace commercial state." });
  }
});

billingRouter.get("/admin/commercial", requireAuth, requireRole("super_admin"), async (_req, res) => {
  await ensureCommercialDefaults();
  await ensureUsageControlDefaults();
  const [catalog, policies, events, audits, workspaces, registrationPolicy, externalSubscriptions, addonSkus, workflowPricing] = await Promise.all([
    commercialCatalog({ includeInactive: true }),
    prisma.commercialPolicyVersion.findMany({ orderBy: [{ code: "asc" }, { version: "desc" }] }),
    prisma.commercialBillingEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.commercialAuditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.workspace.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        name: true,
        workspaceType: true,
        commercialState: true,
        accessMode: true,
        retentionEndsAt: true,
        commercialSubscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            provider: true,
            currentPeriodEnd: true,
            planVersion: { select: { version: true, billingPlan: { select: { code: true, name: true } } } },
          },
        },
        capacityAccounts: { orderBy: { periodStart: "desc" }, take: 1 },
        _count: { select: { memberships: true, agencyClients: true } },
      },
    }),
    commercialRegistrationPolicy(),
    prisma.externalSubscription.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.commercialAddonSku.findMany({ orderBy: [{ kind: "asc" }, { amountCents: "asc" }] }),
    prisma.featureCostCatalog.findMany({ orderBy: [{ moduleName: "asc" }, { label: "asc" }] }),
  ]);
  res.json({ catalog, policies, events, audits, workspaces, registrationPolicy, externalSubscriptions, addonSkus, workflowPricing });
});

billingRouter.patch("/admin/commercial/addons/:addonId", requireAuth, requireRole("super_admin"), async (req, res) => {
  const parsed = commercialAddonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const previous = await prisma.commercialAddonSku.findUnique({ where: { id: req.params.addonId } });
  if (!previous) return res.status(404).json({ error: "Commercial add-on not found." });
  const nextProductRef = parsed.data.providerProductRef !== undefined ? parsed.data.providerProductRef || null : previous.providerProductRef;
  if (nextProductRef) {
    const [priceConflict, addonConflict] = await Promise.all([
      prisma.commercialPrice.findFirst({ where: { provider: previous.provider, providerProductRef: nextProductRef, status: "active" }, select: { code: true } }),
      prisma.commercialAddonSku.findFirst({ where: { id: { not: previous.id }, provider: previous.provider, providerProductRef: nextProductRef, status: "active" }, select: { code: true } }),
    ]);
    if (priceConflict || addonConflict) return res.status(409).json({ error: `JVZoo product ${nextProductRef} is already mapped to ${priceConflict?.code ?? addonConflict?.code}.` });
  }
  const addon = await prisma.$transaction(async (tx) => {
    const updated = await tx.commercialAddonSku.update({
      where: { id: previous.id },
      data: {
        ...(parsed.data.amountCents !== undefined ? { amountCents: parsed.data.amountCents } : {}),
        ...(parsed.data.capacityUnits !== undefined ? { capacityUnits: parsed.data.capacityUnits } : {}),
        ...(parsed.data.providerProductRef !== undefined ? { providerProductRef: parsed.data.providerProductRef || null } : {}),
        ...(parsed.data.checkoutUrl !== undefined ? { checkoutUrl: parsed.data.checkoutUrl || null } : {}),
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      },
    });
    await tx.commercialAuditEvent.create({ data: {
      actorType: "admin", actorId: req.user!.userId, action: "commercial.addon_updated", reasonCode: "catalogue_configuration", source: "admin",
      beforeJson: previous, afterJson: updated, correlationId: updated.id,
    } });
    return updated;
  });
  res.json({ addon });
});

billingRouter.patch("/admin/commercial/workflow-pricing/:featureKey", requireAuth, requireRole("super_admin"), async (req, res) => {
  const parsed = workflowPricingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.maximumUnitCost != null && parsed.data.minimumUnitCost != null && parsed.data.maximumUnitCost < parsed.data.minimumUnitCost) {
    return res.status(400).json({ error: "Maximum units cannot be lower than minimum units." });
  }
  const previous = await prisma.featureCostCatalog.findUnique({ where: { featureKey: req.params.featureKey } });
  if (!previous) return res.status(404).json({ error: "Workflow pricing record not found." });
  const workflow = await prisma.$transaction(async (tx) => {
    const updated = await tx.featureCostCatalog.update({ where: { featureKey: previous.featureKey }, data: {
      defaultCreditCost: parsed.data.defaultCreditCost,
      pricingModel: parsed.data.pricingModel,
      pricingConfigJson: parsed.data.pricingConfig,
      minimumUnitCost: parsed.data.minimumUnitCost,
      maximumUnitCost: parsed.data.maximumUnitCost,
      estimatedProviderCost: parsed.data.estimatedProviderCost,
      pricingVersion: { increment: 1 },
    } });
    await tx.commercialAuditEvent.create({ data: {
      actorType: "admin", actorId: req.user!.userId, action: "commercial.workflow_pricing_updated", reasonCode: "unit_pricing_configuration", source: "admin",
      beforeJson: previous, afterJson: updated, correlationId: updated.featureKey,
    } });
    return updated;
  });
  res.json({ workflow });
});

billingRouter.post("/admin/commercial/external-subscriptions/:subscriptionId/resend-activation", requireAuth, requireRole("super_admin"), async (req, res) => {
  const subscription = await prisma.externalSubscription.findUnique({ where: { id: req.params.subscriptionId } });
  if (!subscription || subscription.provider !== "jvzoo") return res.status(404).json({ error: "JVZoo purchase not found." });
  if (subscription.activationStatus === "activated") return res.status(409).json({ error: "This purchase is already activated." });
  const result = await issueJvZooActivationEmail(subscription.id);
  await prisma.commercialAuditEvent.create({
    data: {
      actorType: "admin",
      actorId: req.user!.userId,
      action: "commercial.activation_resent",
      reasonCode: "purchase_recovery",
      source: "admin",
      correlationId: subscription.id,
      afterJson: { providerCustomerEmail: subscription.providerCustomerEmail, result },
    },
  });
  res.json(result);
});

billingRouter.patch("/admin/commercial/registration-policy", requireAuth, requireRole("super_admin"), async (req, res) => {
  const parsed = registrationPolicySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const previous = await commercialRegistrationPolicy();
  const policy = await prisma.$transaction(async (tx) => {
    const updated = await tx.commercialRegistrationPolicy.update({
      where: { id: COMMERCIAL_REGISTRATION_POLICY_ID },
      data: { trialEnabled: parsed.data.trialEnabled, trialDays: parsed.data.trialDays, updatedById: req.user!.userId },
    });
    await tx.commercialAuditEvent.create({
      data: {
        actorType: "admin",
        actorId: req.user!.userId,
        action: "commercial.registration_policy_updated",
        reasonCode: "launch_configuration",
        source: "admin",
        beforeJson: { trialEnabled: previous.trialEnabled, trialDays: previous.trialDays },
        afterJson: { trialEnabled: updated.trialEnabled, trialDays: updated.trialDays },
      },
    });
    return updated;
  });
  res.json({ registrationPolicy: policy });
});

billingRouter.post("/admin/commercial/founding-pricing/close", requireAuth, requireRole("super_admin"), async (req, res) => {
  const effectiveTo = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const standardPrices = await tx.commercialPrice.findMany({
      where: {
        provider: "jvzoo",
        priceClass: "standard",
        status: "active",
        planVersion: { version: COMMERCIAL_PLAN_VERSION, status: "active", billingPlan: { code: { in: ["entrepreneur", "business", "agency"] } } },
      },
      select: { code: true, providerProductRef: true, checkoutUrl: true },
    });
    const incompleteStandardPrices = standardPrices.filter((price) => !price.providerProductRef || !price.checkoutUrl);
    if (standardPrices.length !== 6 || incompleteStandardPrices.length) {
      throw Object.assign(new Error("Configure all six active standard monthly and annual JVZoo product IDs and checkout URLs before closing founding pricing."), { statusCode: 409, code: "standard_pricing_not_ready" });
    }
    const prices = await tx.commercialPrice.findMany({
      where: {
        provider: "jvzoo",
        priceClass: "founding",
        status: "active",
        planVersion: { version: COMMERCIAL_PLAN_VERSION, status: "active", billingPlan: { code: { in: ["entrepreneur", "business", "agency"] } } },
      },
      select: { id: true, code: true, amountCents: true, billingInterval: true, providerProductRef: true },
    });
    if (prices.length) {
      await tx.commercialPrice.updateMany({
        where: { id: { in: prices.map((price) => price.id) }, status: "active" },
        data: { status: "inactive", effectiveTo },
      });
    }
    await tx.commercialAuditEvent.create({
      data: {
        actorType: "admin",
        actorId: req.user!.userId,
        action: "commercial.founding_pricing_closed",
        reasonCode: "launch_pricing_ended",
        source: "admin",
        afterJson: { effectiveTo, closedPrices: prices },
      },
    });
    return prices;
  });
  res.json({ closed: result.length, effectiveTo });
});

billingRouter.patch("/admin/commercial/prices/:priceId", requireAuth, requireRole("super_admin"), async (req, res) => {
  const parsed = commercialPriceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const previous = await prisma.commercialPrice.findUnique({ where: { id: req.params.priceId } });
  if (!previous) return res.status(404).json({ error: "Commercial price not found." });
  const amountChanged = parsed.data.amountCents !== undefined && parsed.data.amountCents !== previous.amountCents;
  const price = await prisma.$transaction(async (tx) => {
    const nextProviderProductRef = parsed.data.providerProductRef !== undefined ? parsed.data.providerProductRef || null : previous.providerProductRef;
    const nextStatus = parsed.data.status ?? previous.status;
    if (nextProviderProductRef && nextStatus === "active") {
      const conflict = await tx.commercialPrice.findFirst({
        where: {
          id: { not: previous.id },
          provider: previous.provider,
          providerProductRef: nextProviderProductRef,
          status: "active",
        },
        select: { id: true, code: true },
      });
      if (conflict) {
        throw Object.assign(new Error(`JVZoo product ${nextProviderProductRef} is already mapped to active price ${conflict.code}. Deactivate that mapping before reusing the product ID.`), { statusCode: 409, code: "jvzoo_product_mapping_conflict" });
      }
      const addonConflict = await tx.commercialAddonSku.findFirst({
        where: { provider: previous.provider, providerProductRef: nextProviderProductRef, status: "active" },
        select: { code: true },
      });
      if (addonConflict) throw Object.assign(new Error(`JVZoo product ${nextProviderProductRef} is already mapped to add-on ${addonConflict.code}.`), { statusCode: 409, code: "jvzoo_product_mapping_conflict" });
    }
    if (amountChanged) {
      const effectiveFrom = parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : new Date();
      const codeRoot = previous.code.replace(/-r\d+$/i, "").slice(0, 98);
      await tx.commercialPrice.update({
        where: { id: previous.id },
        data: { status: "inactive", effectiveTo: effectiveFrom },
      });
      const revised = await tx.commercialPrice.create({
        data: {
          code: `${codeRoot}-r${effectiveFrom.getTime()}`,
          planVersionId: previous.planVersionId,
          billingInterval: previous.billingInterval,
          currency: previous.currency,
          amountCents: parsed.data.amountCents!,
          priceClass: previous.priceClass,
          market: previous.market,
          provider: previous.provider,
          providerProductRef: parsed.data.providerProductRef !== undefined ? parsed.data.providerProductRef || null : previous.providerProductRef,
          providerPriceRef: previous.providerPriceRef,
          checkoutUrl: parsed.data.checkoutUrl !== undefined ? parsed.data.checkoutUrl || null : previous.checkoutUrl,
          effectiveFrom,
          status: parsed.data.status ?? "active",
        },
      });
      await tx.commercialAuditEvent.create({
        data: {
          actorType: "admin",
          actorId: req.user!.userId,
          action: "commercial.price_revised",
          reasonCode: "rate_change",
          source: "admin",
          beforeJson: { id: previous.id, code: previous.code, amountCents: previous.amountCents, providerProductRef: previous.providerProductRef, checkoutUrl: previous.checkoutUrl, status: previous.status },
          afterJson: { id: revised.id, code: revised.code, amountCents: revised.amountCents, providerProductRef: revised.providerProductRef, checkoutUrl: revised.checkoutUrl, status: revised.status, effectiveFrom },
          metadataJson: { previousPriceId: previous.id, sameProviderProductRetained: previous.providerProductRef === revised.providerProductRef },
        },
      });
      return revised;
    }
    const updated = await tx.commercialPrice.update({
      where: { id: previous.id },
      data: {
        ...(parsed.data.providerProductRef !== undefined ? { providerProductRef: parsed.data.providerProductRef || null } : {}),
        ...(parsed.data.checkoutUrl !== undefined ? { checkoutUrl: parsed.data.checkoutUrl || null } : {}),
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      },
    });
    await tx.commercialAuditEvent.create({
      data: {
        actorType: "admin",
        actorId: req.user!.userId,
        action: "commercial.price_provider_mapping_updated",
        reasonCode: "provider_configuration",
        source: "admin",
        beforeJson: { id: previous.id, providerProductRef: previous.providerProductRef, checkoutUrl: previous.checkoutUrl, status: previous.status },
        afterJson: { id: updated.id, providerProductRef: updated.providerProductRef, checkoutUrl: updated.checkoutUrl, status: updated.status },
      },
    });
    return updated;
  });
  res.json({ price, revised: amountChanged, previousPriceId: amountChanged ? previous.id : null });
});

billingRouter.post("/admin/commercial/workspaces/:workspaceId/adjustments", requireAuth, requireRole("super_admin"), async (req, res) => {
  const parsed = capacityAdjustmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const workspace = await prisma.workspace.findUnique({ where: { id: req.params.workspaceId }, select: { id: true } });
  if (!workspace) return res.status(404).json({ error: "Workspace not found." });
  const adjustment = await adjustWorkspacePurchasedCapacity({
    workspaceId: workspace.id,
    units: parsed.data.units,
    reason: `${parsed.data.reasonCode}: ${parsed.data.justification}`,
    actorId: req.user!.userId,
    metadata: { justification: parsed.data.justification, source: "commercial_admin" },
  });
  await prisma.commercialAuditEvent.create({ data: {
    workspaceId: workspace.id, actorType: "admin", actorId: req.user!.userId, action: "commercial.capacity_adjusted",
    reasonCode: parsed.data.reasonCode, source: "admin", afterJson: { units: parsed.data.units, transactionId: adjustment.transaction.id },
    metadataJson: { justification: parsed.data.justification },
  } });
  res.status(201).json({ adjustment, summary: await workspaceCommercialSummary(workspace.id) });
});

billingRouter.post("/admin/commercial/events/:eventId/replay", requireAuth, requireRole("super_admin"), async (req, res) => {
  const event = await prisma.commercialBillingEvent.findUnique({ where: { id: req.params.eventId } });
  if (!event || event.provider !== "jvzoo") return res.status(404).json({ error: "JVZoo event not found." });
  const payload = event.rawPayload && typeof event.rawPayload === "object" && !Array.isArray(event.rawPayload)
    ? event.rawPayload as Record<string, unknown>
    : null;
  if (!payload) return res.status(409).json({ error: "The event has no replayable payload." });
  try {
    res.json(await processJvZooIpn(payload));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not replay JVZoo event." });
  }
});

billingRouter.post("/webhooks/jvzoo", async (req, res) => {
  res.setHeader("Deprecation", "true");
  res.setHeader("Link", "</api/integrations/jvzoo/ipn>; rel=\"successor-version\"");
  const payload = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  try {
    const result = await acceptJvZooWebhook(payload);
    res.status(200).json({ received: true, duplicate: result.duplicate, status: result.event.status });
  } catch (error) {
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
    res.status(statusCode).json({ received: false, error: error instanceof Error ? error.message : "JVZoo notification failed." });
  }
});

billingRouter.get("/plans", requireAuth, requireRole("super_admin"), async (_req, res) => {
  await ensureDefaultBillingPlans();
  const plans = await prisma.billingPlan.findMany({ orderBy: [{ sortOrder: "asc" }, { priceMonthlyCents: "asc" }] });
  res.json({ plans: await plansWithMemberCounts(plans) });
});

billingRouter.post("/plans", requireAuth, requireRole("super_admin"), async (req, res) => {
  const parsed = createPlanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  try {
    const plan = await prisma.billingPlan.create({
      data: {
        code: normalizePlanCode(data.code),
        name: data.name,
        description: sanitizePlanDescription(data.description),
        priceMonthlyCents: data.priceMonthlyCents,
        articleLimit: data.articleLimit,
        helperMonthlyLimit: data.helperMonthlyLimit,
        features: data.features,
        stripeProductId: data.stripeProductId || null,
        stripePriceId: data.stripePriceId || null,
        isActive: data.isActive,
        sortOrder: data.sortOrder,
      },
    });
    res.status(201).json({ plan: { ...planView(plan), memberCount: 0 } });
  } catch {
    res.status(409).json({ error: "plan code already exists" });
  }
});

billingRouter.patch("/plans/:code", requireAuth, requireRole("super_admin"), async (req, res) => {
  const parsed = updatePlanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = parsed.data;
  const plan = await prisma.billingPlan.update({
    where: { code: normalizePlanCode(req.params.code) },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: sanitizePlanDescription(data.description) } : {}),
      ...(data.priceMonthlyCents !== undefined ? { priceMonthlyCents: data.priceMonthlyCents } : {}),
      ...(data.articleLimit !== undefined ? { articleLimit: data.articleLimit } : {}),
      ...(data.helperMonthlyLimit !== undefined ? { helperMonthlyLimit: data.helperMonthlyLimit } : {}),
      ...(data.features !== undefined ? { features: data.features } : {}),
      ...(data.stripeProductId !== undefined ? { stripeProductId: data.stripeProductId || null } : {}),
      ...(data.stripePriceId !== undefined ? { stripePriceId: data.stripePriceId || null } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
    },
  });
  const memberCount = await prisma.client.count({ where: { plan: plan.code } });
  res.json({ plan: { ...planView(plan), memberCount } });
});

billingRouter.delete("/plans/:code", requireAuth, requireRole("super_admin"), async (req, res) => {
  const code = normalizePlanCode(req.params.code);
  const memberCount = await prisma.client.count({ where: { plan: code } });
  if (memberCount > 0) {
    return res.status(409).json({ error: `Cannot delete this plan because ${memberCount} client account${memberCount === 1 ? " is" : "s are"} using it.` });
  }
  await prisma.billingPlan.delete({ where: { code } });
  res.json({ ok: true });
});

billingRouter.post("/webhook", async (req, res) => {
  let event: { type?: string; data?: { object?: unknown } };
  try {
    const rawBody = requireRawBody(req);
    verifyStripeSignature(rawBody, req.header("stripe-signature") ?? undefined);
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "invalid webhook" });
  }

  try {
    const object = event.data?.object;
    if (!object || typeof object !== "object") return res.json({ received: true });
    const obj = object as Record<string, unknown>;

    if (event.type === "checkout.session.completed") {
      const clientId = stringValue(obj.client_reference_id) ?? metadataValue(obj, "clientId");
      const planCode = metadataValue(obj, "planCode");
      await syncSubscriptionFromStripe({
        clientId,
        planCode,
        customerId: stringValue(obj.customer),
        subscriptionId: stringValue(obj.subscription),
        status: obj.payment_status === "paid" ? "active" : "incomplete",
        currentPeriodEnd: null,
        stripePriceId: null,
      });
    }

    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      await syncSubscriptionFromStripe({
        clientId: metadataValue(obj, "clientId"),
        planCode: metadataValue(obj, "planCode"),
        customerId: stringValue(obj.customer),
        subscriptionId: stringValue(obj.id),
        status: stringValue(obj.status),
        currentPeriodEnd: stripeTimestamp(numberValue(obj.current_period_end)),
        stripePriceId: firstPriceId(obj),
      });
    }

    if (event.type === "invoice.payment_failed") {
      await syncSubscriptionFromStripe({
        clientId: null,
        planCode: null,
        customerId: stringValue(obj.customer),
        subscriptionId: stringValue(obj.subscription),
        status: "past_due",
        currentPeriodEnd: null,
        stripePriceId: null,
      });
    }

    if (event.type === "invoice.payment_succeeded") {
      await syncSubscriptionFromStripe({
        clientId: null,
        planCode: null,
        customerId: stringValue(obj.customer),
        subscriptionId: stringValue(obj.subscription),
        status: "active",
        currentPeriodEnd: null,
        stripePriceId: null,
      });
    }

    res.json({ received: true });
  } catch (error) {
    console.error("[stripe] webhook handling failed", error);
    res.status(500).json({ error: "webhook handling failed" });
  }
});
