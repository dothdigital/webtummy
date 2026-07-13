import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { requireAuth, requireRole } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { hasWorkspacePermission, isWorkspaceOwner, workspaceContext } from "../workspace-access.js";
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
  const now = new Date();
  const trialEndsAt = client.trialEndsAt?.toISOString() ?? null;
  const manualAccessEndsAt = client.manualAccessEndsAt?.toISOString() ?? null;
  const trialDaysRemaining = client.trialEndsAt ? Math.max(0, Math.ceil((client.trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))) : 0;
  const manualAccessDaysRemaining = client.manualAccessEndsAt ? Math.max(0, Math.ceil((client.manualAccessEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))) : 0;
  return {
    plan: view,
    status: client.aiSubscriptionStatus,
    hasAccess: hasBillingAccess(client),
    blockReason: hasBillingAccess(client) ? null : billingBlockReason(client),
    trialStartedAt: client.trialStartedAt?.toISOString() ?? null,
    trialEndsAt,
    trialDaysRemaining,
    manualAccessEndsAt,
    manualAccessDaysRemaining,
    stripeCustomerId: client.stripeCustomerId,
    stripeSubscriptionId: client.stripeSubscriptionId,
    subscriptionCurrentPeriodEnd: client.subscriptionCurrentPeriodEnd?.toISOString() ?? null,
    reportEmailEnabled: client.reportEmailEnabled,
    weeklyReportEmailEnabled: client.weeklyReportEmailEnabled,
    monthlyReportEmailEnabled: client.monthlyReportEmailEnabled,
    rankingChangeEmailEnabled: client.rankingChangeEmailEnabled,
  };
}

billingRouter.get("/pricing", async (_req, res) => {
  await ensureDefaultBillingPlans();
  const plans = await prisma.billingPlan.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { priceMonthlyCents: "asc" }] });
  res.json({ plans: plans.map(planView) });
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
  const parsed = z.object({ planCode: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const client = await clientForBillingRequest(req);
    const plan = await prisma.billingPlan.findUnique({ where: { code: normalizePlanCode(parsed.data.planCode) } });
    if (!plan || !plan.isActive) return res.status(404).json({ error: "plan not available" });
    if (!plan.stripePriceId) return res.status(400).json({ error: "plan is missing a Stripe price ID" });

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { email: true } });
    const session = await createCheckoutSession({
      client,
      userEmail: user?.email ?? client.contactEmail ?? "",
      planCode: plan.code,
      stripePriceId: plan.stripePriceId,
    });
    res.json({ url: session.url });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "could not start checkout" });
  }
});

billingRouter.post("/portal-session", requireAuth, requireBillingOwner, async (req, res) => {
  try {
    const client = await clientForBillingRequest(req);
    if (!client.stripeCustomerId) return res.status(400).json({ error: "No Stripe customer exists for this account yet" });
    const session = await createPortalSession(client.stripeCustomerId);
    res.json({ url: session.url });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "could not open billing portal" });
  }
});

billingRouter.get("/invoices", requireAuth, requireBillingOwner, async (req, res) => {
  try {
    const client = await clientForBillingRequest(req);
    if (!client.stripeCustomerId) return res.json({ invoices: [] });
    const invoices = await listCustomerInvoices(client.stripeCustomerId);
    res.json({ invoices });
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
