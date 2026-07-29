import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { prisma, type Client } from "@webtummy/db";
import { config } from "./config.js";

export const TRIAL_DAYS = 14;

export const DEFAULT_BILLING_PLANS = [
  { code: "internal", name: "Internal", description: "Internal product development and platform testing.", priceMonthlyCents: 0, articleLimit: 10_000, helperMonthlyLimit: 100_000, sortOrder: -100, isActive: false },
  { code: "mini", name: "Mini", description: "Dip your toes into SEO content.", priceMonthlyCents: 900, articleLimit: 5, helperMonthlyLimit: 100, sortOrder: 10 },
  { code: "starter", name: "Starter", description: "For solo marketers getting going.", priceMonthlyCents: 1900, articleLimit: 10, helperMonthlyLimit: 250, sortOrder: 20 },
  { code: "basic", name: "Basic", description: "For steady, consistent publishing.", priceMonthlyCents: 3900, articleLimit: 25, helperMonthlyLimit: 500, sortOrder: 30 },
  { code: "growth", name: "Growth", description: "For teams scaling content fast.", priceMonthlyCents: 7900, articleLimit: 50, helperMonthlyLimit: 1000, sortOrder: 40 },
  { code: "pro", name: "Pro", description: "For agencies & high-volume teams.", priceMonthlyCents: 12900, articleLimit: 100, helperMonthlyLimit: 2000, sortOrder: 50 },
] as const;

export const PLAN_FEATURES = [
  "Unlimited keyword ideas",
  "Unlimited title & meta",
  "Unlimited FAQ & schema",
];

export function trialEndsFrom(start = new Date()) {
  return new Date(start.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

export async function ensureDefaultBillingPlans() {
  for (const plan of DEFAULT_BILLING_PLANS) {
    const existing = await prisma.billingPlan.findUnique({ where: { code: plan.code } });
    if (!existing) {
      await prisma.billingPlan.create({ data: { ...plan, features: PLAN_FEATURES } });
    }
  }
}

export function normalizePlanCode(planCode: string | null | undefined) {
  const code = (planCode ?? "mini").trim().toLowerCase();
  return code === "standard" ? "basic" : code;
}

export function planView(plan: {
  code: string;
  name: string;
  description: string;
  priceMonthlyCents: number;
  articleLimit: number;
  helperMonthlyLimit: number;
  features: unknown;
  stripeProductId: string | null;
  stripePriceId: string | null;
  isActive: boolean;
  sortOrder: number;
}) {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    priceMonthly: plan.priceMonthlyCents / 100,
    priceMonthlyCents: plan.priceMonthlyCents,
    articleLimit: plan.articleLimit,
    articles: plan.articleLimit,
    helperMonthlyLimit: plan.helperMonthlyLimit,
    helperDailyLimit: plan.helperMonthlyLimit,
    features: Array.isArray(plan.features) ? plan.features.map(String) : PLAN_FEATURES,
    stripeProductId: plan.stripeProductId,
    stripePriceId: plan.stripePriceId,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
  };
}

export async function billingPlanForClient(planCode: string | null | undefined) {
  await ensureDefaultBillingPlans();
  return prisma.billingPlan.findUnique({ where: { code: normalizePlanCode(planCode) } });
}

export function hasBillingAccess(client: Pick<Client, "aiSubscriptionStatus" | "trialEndsAt" | "manualAccessEndsAt" | "graceEndsAt">) {
  const now = new Date();
  if (client.aiSubscriptionStatus === "active") return true;
  if (["past_due", "incomplete", "incomplete_expired", "unpaid", "canceled"].includes(client.aiSubscriptionStatus)) return false;
  if (client.aiSubscriptionStatus === "trialing" && client.trialEndsAt && client.trialEndsAt > now) return true;
  if (client.aiSubscriptionStatus === "offline" && client.manualAccessEndsAt && client.manualAccessEndsAt > now) return true;
  if (client.graceEndsAt && client.graceEndsAt > now) return true;
  return false;
}

export function billingBlockReason(client: Pick<Client, "aiSubscriptionStatus" | "trialEndsAt" | "manualAccessEndsAt" | "graceEndsAt">) {
  const now = new Date();
  if (["past_due", "incomplete", "incomplete_expired", "unpaid"].includes(client.aiSubscriptionStatus)) return "payment unsuccessful";
  if (client.aiSubscriptionStatus === "canceled") return "subscription canceled";
  if (client.aiSubscriptionStatus === "trialing" && client.trialEndsAt && client.trialEndsAt <= now) return "trial expired";
  if (client.aiSubscriptionStatus === "offline" && client.manualAccessEndsAt && client.manualAccessEndsAt <= now) return "manual access expired";
  if (client.graceEndsAt && client.graceEndsAt <= now) return "grace period expired";
  return "subscription inactive";
}

export function requireBillingAccess(client: Pick<Client, "aiSubscriptionStatus" | "trialEndsAt" | "manualAccessEndsAt" | "graceEndsAt">) {
  if (hasBillingAccess(client)) return;
  const error = new Error(billingBlockReason(client));
  error.name = "billing_required";
  throw error;
}

async function stripeRequest<T>(path: string, body: URLSearchParams): Promise<T> {
  if (!config.stripeSecretKey) throw new Error("stripe_not_configured");
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const message = typeof data?.error?.message === "string" ? data.error.message : "Stripe request failed";
    throw new Error(message);
  }
  return data as T;
}

async function stripeGet<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!config.stripeSecretKey) throw new Error("stripe_not_configured");
  const query = new URLSearchParams(params);
  const response = await fetch(`https://api.stripe.com/v1${path}?${query.toString()}`, {
    headers: { Authorization: `Bearer ${config.stripeSecretKey}` },
  });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const message = typeof data?.error?.message === "string" ? data.error.message : "Stripe request failed";
    throw new Error(message);
  }
  return data as T;
}

export async function listCustomerInvoices(customerId: string) {
  const result = await stripeGet<{ data?: Array<Record<string, unknown>> }>("/invoices", { customer: customerId, limit: "12" });
  return (result.data ?? []).map((invoice) => ({
    id: String(invoice.id ?? ""),
    number: typeof invoice.number === "string" ? invoice.number : null,
    status: typeof invoice.status === "string" ? invoice.status : null,
    currency: typeof invoice.currency === "string" ? invoice.currency.toUpperCase() : "USD",
    amountDue: typeof invoice.amount_due === "number" ? invoice.amount_due : 0,
    amountPaid: typeof invoice.amount_paid === "number" ? invoice.amount_paid : 0,
    createdAt: typeof invoice.created === "number" ? new Date(invoice.created * 1000).toISOString() : null,
    hostedInvoiceUrl: typeof invoice.hosted_invoice_url === "string" ? invoice.hosted_invoice_url : null,
    invoicePdf: typeof invoice.invoice_pdf === "string" ? invoice.invoice_pdf : null,
  })).filter((invoice) => invoice.id);
}

export async function createCheckoutSession(input: {
  client: Pick<Client, "id" | "contactEmail" | "stripeCustomerId">;
  userEmail: string;
  planCode: string;
  stripePriceId: string;
}) {
  const appUrl = config.webAppUrl.replace(/\/$/, "");
  const body = new URLSearchParams({
    mode: "subscription",
    client_reference_id: input.client.id,
    success_url: `${appUrl}/billing?checkout=success`,
    cancel_url: `${appUrl}/pricing?payment=unsuccessful`,
    "line_items[0][price]": input.stripePriceId,
    "line_items[0][quantity]": "1",
    "metadata[clientId]": input.client.id,
    "metadata[planCode]": input.planCode,
    "subscription_data[metadata][clientId]": input.client.id,
    "subscription_data[metadata][planCode]": input.planCode,
  });
  if (input.client.stripeCustomerId) body.set("customer", input.client.stripeCustomerId);
  else body.set("customer_email", input.client.contactEmail ?? input.userEmail);

  return stripeRequest<{ id: string; url: string }>("/checkout/sessions", body);
}

export async function createPortalSession(customerId: string) {
  const body = new URLSearchParams({
    customer: customerId,
    return_url: `${config.webAppUrl.replace(/\/$/, "")}/billing`,
  });
  return stripeRequest<{ url: string }>("/billing_portal/sessions", body);
}

export function verifyStripeSignature(rawBody: Buffer, signature: string | undefined) {
  if (!config.stripeWebhookSecret) throw new Error("stripe_webhook_not_configured");
  if (!signature) throw new Error("missing stripe signature");

  const parsed: Record<string, string> = {};
  for (const part of signature.split(",")) {
    const [key, value] = part.split("=");
    if (key && value) parsed[key] = value;
  }
  const timestamp = parsed.t;
  const expected = parsed.v1;
  if (!timestamp || !expected) throw new Error("invalid stripe signature");

  const digest = crypto.createHmac("sha256", config.stripeWebhookSecret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const digestBuffer = Buffer.from(digest, "hex");
  if (expectedBuffer.length !== digestBuffer.length || !crypto.timingSafeEqual(expectedBuffer, digestBuffer)) {
    throw new Error("invalid stripe signature");
  }
}

export function rawBodySaver(req: Request, _res: Response, buf: Buffer) {
  if (req.originalUrl === "/api/billing/webhook") {
    (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
  }
}

export function requireRawBody(req: Request) {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) throw new Error("missing raw webhook body");
  return rawBody;
}

export function stripeTimestamp(value: unknown) {
  return typeof value === "number" ? new Date(value * 1000) : null;
}

export async function syncSubscriptionFromStripe(input: {
  subscriptionId: string | null;
  customerId: string | null;
  status: string | null;
  planCode: string | null;
  currentPeriodEnd: Date | null;
  clientId: string | null;
  stripePriceId: string | null;
}) {
  let planCode = input.planCode ? normalizePlanCode(input.planCode) : null;
  if (!planCode && input.stripePriceId) {
    const plan = await prisma.billingPlan.findFirst({ where: { stripePriceId: input.stripePriceId } });
    planCode = plan?.code ?? null;
  }

  const where = input.clientId
    ? { id: input.clientId }
    : input.customerId
      ? { stripeCustomerId: input.customerId }
      : input.subscriptionId
        ? { stripeSubscriptionId: input.subscriptionId }
        : null;
  if (!where) return;

  const data: Record<string, unknown> = { aiSubscriptionStatus: input.status ?? "incomplete" };
  if (input.customerId) data.stripeCustomerId = input.customerId;
  if (input.subscriptionId) data.stripeSubscriptionId = input.subscriptionId;
  if (input.currentPeriodEnd) data.subscriptionCurrentPeriodEnd = input.currentPeriodEnd;
  if (planCode) data.plan = planCode;

  await prisma.client.updateMany({ where, data });
}

export function paymentRequiredHandler(error: unknown, _req: Request, res: Response, next: NextFunction) {
  if (error instanceof Error && error.name === "billing_required") {
    return res.status(402).json({ error: error.message, billingRequired: true });
  }
  next(error);
}
