import crypto from "node:crypto";
import { prisma, type Prisma } from "@webtummy/db";
import { normalizePlanCode } from "./billing.js";
import { assertWorkspaceFeature, effectiveCommercialEntitlements } from "./commercial-service.js";
import { currentCommercialRequestContext } from "./commercial-request-context.js";
import { aiModelTierForFeature, defaultAiModelForFeature } from "./ai-model-policy.js";
import {
  calculateWorkflowUnits,
  canonicalCommercialPlanCode,
  ensureWorkspaceCapacityAccount,
  workspaceCapacitySummary,
} from "./commercial-capacity.js";

export const USAGE_APPROVAL_HEADER = "x-senuke-usage-token";
const CREDIT_TRANSACTION_REASON_MAX_LENGTH = 255;
const USAGE_IDEMPOTENCY_KEY_MAX_LENGTH = 255;
const USAGE_CORRELATION_ID_MAX_LENGTH = 191;

export function creditTransactionReason(value: string | null | undefined, fallback = "usage refunded") {
  const reason = value?.trim() || fallback;
  return Array.from(reason).slice(0, CREDIT_TRANSACTION_REASON_MAX_LENGTH).join("");
}

function boundedStableKey(value: string | null | undefined, maxLength: number) {
  const key = value?.trim();
  if (!key) return null;
  if (Array.from(key).length <= maxLength) return key;
  const digest = crypto.createHash("sha256").update(key).digest("hex");
  const readableLength = maxLength - digest.length - 1;
  return `${Array.from(key).slice(0, readableLength).join("")}:${digest}`;
}

export function usageIdempotencyKey(value: string | null | undefined) {
  return boundedStableKey(value, USAGE_IDEMPOTENCY_KEY_MAX_LENGTH);
}

export function usageCorrelationId(value: string | null | undefined) {
  return boundedStableKey(value, USAGE_CORRELATION_ID_MAX_LENGTH);
}

export function usageWorkFingerprint(input: Pick<UsagePreflightInput, "clientId" | "projectId" | "websiteId" | "featureKey" | "actionKey" | "idempotencyKey">, requestId?: string | null) {
  const source = requestId?.trim() || input.idempotencyKey?.trim();
  if (!source) return null;
  const normalized = source
    .replace(/:(?:retry|refresh):\d+$/i, "")
    .replace(/:\d{13}(?=:|$)/g, ":request")
    .replace(/\b(?:retry|refresh)\b/gi, "work");
  const digest = crypto.createHash("sha256").update(JSON.stringify({
    clientId: input.clientId,
    projectId: input.projectId ?? null,
    websiteId: input.websiteId ?? null,
    featureKey: input.featureKey,
    actionKey: input.actionKey?.replace(/\b(?:retry|refresh)\b/gi, "work") ?? input.featureKey,
    source: normalized,
  })).digest("hex");
  return usageIdempotencyKey(`work:${input.featureKey}:${digest}`);
}

type Db = typeof prisma | Prisma.TransactionClient;

export type UsagePreflightInput = {
  clientId: string;
  userId?: string | null;
  projectId?: string | null;
  websiteId?: string | null;
  featureKey: string;
  actionKey?: string | null;
  idempotencyKey?: string | null;
  inputUnits?: number;
  metadata?: Record<string, unknown>;
};

export type CommitUsageInput = {
  usageEventId?: string | null;
  approvalToken?: string | null;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  providerCostUsd?: number;
  actualUnits?: number;
  metadata?: Record<string, unknown>;
};

type FeatureSeed = {
  featureKey: string;
  moduleName: string;
  label: string;
  description: string;
  defaultCreditCost: number;
  estimatedProviderCost: number;
  unitLabel?: string;
  requiresApproval?: boolean;
  requiresIntegration?: boolean;
  cacheTtlMinutes?: number;
};

const featureSeeds: FeatureSeed[] = [
  { featureKey: "opportunity_refresh", moduleName: "opportunities", label: "Refresh opportunities", description: "Generate scored opportunity recommendations from intake and project intelligence.", defaultCreditCost: 6, estimatedProviderCost: 0.08, cacheTtlMinutes: 1440 },
  { featureKey: "strategy_generate", moduleName: "strategy", label: "Generate strategy", description: "Create or regenerate the AI strategy and execution roadmap.", defaultCreditCost: 10, estimatedProviderCost: 0.12, requiresApproval: true, cacheTtlMinutes: 720 },
  { featureKey: "keyword_research_batch", moduleName: "keywords", label: "Keyword research batch", description: "Fetch keyword demand, SERP competitors, and ranking visibility.", defaultCreditCost: 8, estimatedProviderCost: 0.1, requiresIntegration: true, cacheTtlMinutes: 1440 },
  { featureKey: "site_crawl_small", moduleName: "site_analysis", label: "Site crawl", description: "Crawl a connected site and create health, SEO issue, page, link, and readiness data.", defaultCreditCost: 12, estimatedProviderCost: 0.18, cacheTtlMinutes: 4320 },
  { featureKey: "backlink_snapshot", moduleName: "backlinks", label: "Backlink snapshot", description: "Refresh authority, backlink, and outreach opportunity data.", defaultCreditCost: 8, estimatedProviderCost: 0.1, requiresIntegration: true, cacheTtlMinutes: 10080 },
  { featureKey: "ai_citation_scan", moduleName: "ai_citations", label: "AI citation scan", description: "Analyze AI search readiness, schema, NAP, entity, and citation opportunities.", defaultCreditCost: 8, estimatedProviderCost: 0.1, cacheTtlMinutes: 1440 },
  { featureKey: "site_architect_generate", moduleName: "site_architect", label: "Generate site architecture", description: "Generate sitemap, page plans, metadata, internal links, and sections.", defaultCreditCost: 10, estimatedProviderCost: 0.12, requiresApproval: true, cacheTtlMinutes: 1440 },
  { featureKey: "lead_magnet_research", moduleName: "lead_magnets", label: "Research lead magnet opportunities", description: "Analyze the intended outcome, business intake, keyword evidence, geography, and website gaps before recommending a lead magnet.", defaultCreditCost: 5, estimatedProviderCost: 0.07, cacheTtlMinutes: 720 },
  { featureKey: "lead_magnet_generate", moduleName: "lead_magnets", label: "Generate lead magnet", description: "Generate a lead magnet package, landing page copy, delivery email, and CTA flow.", defaultCreditCost: 10, estimatedProviderCost: 0.14, requiresApproval: true, cacheTtlMinutes: 720 },
  { featureKey: "ai_assisted_intake", moduleName: "intake", label: "AI-assisted intake", description: "Analyze a limited public website or guided business answers and prepare reviewable intake suggestions.", defaultCreditCost: 4, estimatedProviderCost: 0.05, cacheTtlMinutes: 1440 },
  { featureKey: "growth_diagnosis", moduleName: "growth", label: "Growth diagnosis", description: "Diagnose growth bottlenecks, funnel gaps, and recommended experiments.", defaultCreditCost: 10, estimatedProviderCost: 0.13, cacheTtlMinutes: 720 },
  { featureKey: "growth_report", moduleName: "growth", label: "Growth report", description: "Generate client-ready growth diagnosis, roadmap, KPI plan, and recommendations.", defaultCreditCost: 14, estimatedProviderCost: 0.2, requiresApproval: true, cacheTtlMinutes: 1440 },
  { featureKey: "social_calendar_generate", moduleName: "social", label: "Generate social calendar", description: "Generate social posts, schedule suggestions, and channel recommendations.", defaultCreditCost: 8, estimatedProviderCost: 0.1, requiresApproval: true, cacheTtlMinutes: 720 },
  { featureKey: "agency_report_generate", moduleName: "reports", label: "Generate agency report", description: "Generate export-ready project, SEO, growth, or client report output.", defaultCreditCost: 12, estimatedProviderCost: 0.16, requiresApproval: true, cacheTtlMinutes: 1440 },
  { featureKey: "revenue_keyword_score", moduleName: "competitive_intelligence", label: "Revenue keyword score", description: "Score keywords by business value, intent, authority gap, AI citation potential, and offer fit.", defaultCreditCost: 2, estimatedProviderCost: 0.02, cacheTtlMinutes: 1440 },
  { featureKey: "improve_page_stack", moduleName: "competitive_intelligence", label: "Improve this page", description: "Run keyword value, proof gap, CTA strength, monetization fit, refresh, internal link, and AI citation checks for one page.", defaultCreditCost: 5, estimatedProviderCost: 0.04, requiresApproval: true, cacheTtlMinutes: 1440 },
  { featureKey: "authority_asset_builder", moduleName: "competitive_intelligence", label: "Authority asset builder", description: "Generate safe link-worthy asset recommendations such as guides, templates, tools, calculators, and comparison pages.", defaultCreditCost: 10, estimatedProviderCost: 0.12, requiresApproval: true, cacheTtlMinutes: 1440 },
  { featureKey: "ai_citation_gap", moduleName: "competitive_intelligence", label: "AI citation competitor gap", description: "Compare competitors and identify missing proof, schema, entity clarity, and citation-ready page formats.", defaultCreditCost: 15, estimatedProviderCost: 0.18, requiresApproval: true, cacheTtlMinutes: 1440 },
  { featureKey: "community_intelligence", moduleName: "competitive_intelligence", label: "Community intelligence", description: "Analyze allowed community sources for pain points, objections, FAQs, content angles, and approved reply drafts.", defaultCreditCost: 8, estimatedProviderCost: 0.1, requiresApproval: true, cacheTtlMinutes: 1440 },
  { featureKey: "moat_tracker", moduleName: "competitive_intelligence", label: "Competitive moat tracker", description: "Track durable competitive advantage across topical coverage, authority assets, citations, proof, leads, and community signals.", defaultCreditCost: 3, estimatedProviderCost: 0.03, cacheTtlMinutes: 1440 },
  { featureKey: "seo_fix_queue", moduleName: "gap_analysis", label: "SEO fix queue", description: "Convert site analysis findings into approval-based SEO fixes and execution tasks.", defaultCreditCost: 6, estimatedProviderCost: 0.04, requiresApproval: true, cacheTtlMinutes: 1440 },
  { featureKey: "pre_website_launch_strategy", moduleName: "gap_analysis", label: "Pre-website launch strategy", description: "Create website architecture, keyword seed, GBP/local, proof, and launch execution tasks before a website exists.", defaultCreditCost: 8, estimatedProviderCost: 0.08, requiresApproval: true, cacheTtlMinutes: 1440 },
  { featureKey: "wordpress_publish", moduleName: "gap_analysis", label: "WordPress publish or update", description: "Queue approved WordPress draft, publish, update, or manual export workflows.", defaultCreditCost: 8, estimatedProviderCost: 0.04, requiresApproval: true, requiresIntegration: true, cacheTtlMinutes: 0 },
  { featureKey: "local_seo_launch_plan", moduleName: "gap_analysis", label: "Local SEO launch plan", description: "Generate local SEO tasks, GBP checklist, citation work, review prompts, and local page recommendations.", defaultCreditCost: 10, estimatedProviderCost: 0.08, cacheTtlMinutes: 1440 },
  { featureKey: "ai_visibility_scan", moduleName: "gap_analysis", label: "AI visibility scan", description: "Run limited AI visibility and citation-gap checks for priority questions.", defaultCreditCost: 5, estimatedProviderCost: 0.06, cacheTtlMinutes: 10080 },
  { featureKey: "safe_authority_builder", moduleName: "gap_analysis", label: "Safe authority builder", description: "Generate safe authority, citation, digital PR, and outreach opportunities with risk labels.", defaultCreditCost: 8, estimatedProviderCost: 0.07, requiresApproval: true, cacheTtlMinutes: 1440 },
  { featureKey: "white_label_report", moduleName: "gap_analysis", label: "White-label report", description: "Generate agency-branded audit, proposal, local SEO, AI visibility, growth, or execution reports.", defaultCreditCost: 12, estimatedProviderCost: 0.12, requiresApproval: true, cacheTtlMinutes: 1440 },
  { featureKey: "demo_proof_project", moduleName: "gap_analysis", label: "Demo proof project", description: "Create clearly marked demo projects with sample audit, strategy, execution, and report assets.", defaultCreditCost: 0, estimatedProviderCost: 0, cacheTtlMinutes: 0 },
  { featureKey: "ad_landing_suggestions", moduleName: "gap_analysis", label: "Ad and landing suggestions", description: "Generate ad copy, CTA, offer, landing page, and experiment suggestions without ad-account automation.", defaultCreditCost: 6, estimatedProviderCost: 0.06, requiresApproval: true, cacheTtlMinutes: 1440 },
  { featureKey: "ecommerce_export_guidance", moduleName: "gap_analysis", label: "Ecommerce export guidance", description: "Generate manual Shopify or ecommerce SEO publishing guidance without deep launch integration.", defaultCreditCost: 6, estimatedProviderCost: 0.05, cacheTtlMinutes: 1440 },
  { featureKey: "ai_content_generate", moduleName: "content", label: "Generate AI content", description: "Generate or revise a content asset through the central AI service.", defaultCreditCost: 6, estimatedProviderCost: 0.08, requiresApproval: true, cacheTtlMinutes: 720 },
  { featureKey: "website_page_generate", moduleName: "website_development", label: "Generate website page", description: "Generate or revise website page structure and content through the central AI service.", defaultCreditCost: 10, estimatedProviderCost: 0.14, requiresApproval: true, cacheTtlMinutes: 720 },
  { featureKey: "website_image_generate", moduleName: "website_development", label: "Generate website image", description: "Generate an approved website image asset.", defaultCreditCost: 12, estimatedProviderCost: 0.18, requiresApproval: true, cacheTtlMinutes: 0 },
  { featureKey: "execution_content_generate", moduleName: "execution", label: "Generate execution content", description: "Generate reviewable execution-task content.", defaultCreditCost: 6, estimatedProviderCost: 0.08, requiresApproval: true, cacheTtlMinutes: 720 },
  { featureKey: "project_agent_chat", moduleName: "project_agent", label: "Project Agent response", description: "Generate one evidence-grounded Project Agent response.", defaultCreditCost: 2, estimatedProviderCost: 0.03, cacheTtlMinutes: 0 },
];

const commercialWorkflowPricing: Record<string, { units: number; model?: string; minimum?: number; maximum?: number | null; config?: Record<string, unknown> }> = {
  opportunity_refresh: { units: 150, model: "fixed", minimum: 100, maximum: 200 },
  strategy_generate: { units: 450, model: "fixed", minimum: 250, maximum: 600 },
  keyword_research_batch: { units: 1, model: "keyword_market", minimum: 50, maximum: null, config: { baseUnits: 50, countryCheckUnits: 5, localCheckUnits: 15 } },
  site_crawl_small: { units: 300, model: "fixed", minimum: 150, maximum: 500 },
  backlink_snapshot: { units: 1, model: "per_domain", minimum: 25, maximum: null, config: { perDomainUnits: 25 } },
  ai_citation_scan: { units: 250, model: "fixed", minimum: 150, maximum: 400 },
  site_architect_generate: { units: 150, model: "fixed", minimum: 75, maximum: 250 },
  lead_magnet_research: { units: 75, model: "fixed", minimum: 50, maximum: 150 },
  lead_magnet_generate: { units: 125, model: "fixed", minimum: 75, maximum: 175 },
  ai_assisted_intake: { units: 125, model: "fixed", minimum: 75, maximum: 150 },
  growth_diagnosis: { units: 125, model: "ai_or_zero", minimum: 0, maximum: 200, config: { deterministicUnits: 0 } },
  growth_report: { units: 100, model: "fixed", minimum: 50, maximum: 150 },
  social_calendar_generate: { units: 100, model: "fixed", minimum: 50, maximum: 150 },
  agency_report_generate: { units: 100, model: "fixed", minimum: 50, maximum: 150 },
  revenue_keyword_score: { units: 10, model: "fixed", minimum: 5, maximum: 25 },
  improve_page_stack: { units: 40, model: "fixed", minimum: 25, maximum: 75 },
  authority_asset_builder: { units: 100, model: "fixed", minimum: 75, maximum: 200 },
  ai_citation_gap: { units: 250, model: "fixed", minimum: 150, maximum: 400 },
  community_intelligence: { units: 100, model: "fixed", minimum: 75, maximum: 200 },
  moat_tracker: { units: 25, model: "fixed", minimum: 10, maximum: 50 },
  seo_fix_queue: { units: 40, model: "fixed", minimum: 25, maximum: 75 },
  pre_website_launch_strategy: { units: 150, model: "fixed", minimum: 100, maximum: 250 },
  wordpress_publish: { units: 10, model: "fixed", minimum: 5, maximum: 25 },
  local_seo_launch_plan: { units: 150, model: "fixed", minimum: 75, maximum: 250 },
  ai_visibility_scan: { units: 75, model: "fixed", minimum: 50, maximum: 150 },
  safe_authority_builder: { units: 100, model: "fixed", minimum: 75, maximum: 200 },
  white_label_report: { units: 100, model: "fixed", minimum: 50, maximum: 150 },
  demo_proof_project: { units: 0, model: "fixed", minimum: 0, maximum: 0 },
  ad_landing_suggestions: { units: 75, model: "fixed", minimum: 50, maximum: 125 },
  ecommerce_export_guidance: { units: 40, model: "fixed", minimum: 25, maximum: 75 },
  ai_content_generate: { units: 80, model: "fixed", minimum: 50, maximum: 120 },
  website_page_generate: { units: 1, model: "website", minimum: 25, maximum: null, config: { baseUnits: 250, perPageUnits: 25, perImageUnits: 25 } },
  website_image_generate: { units: 1, model: "per_image", minimum: 25, maximum: null, config: { perImageUnits: 25 } },
  execution_content_generate: { units: 10, model: "fixed", minimum: 5, maximum: 40 },
  project_agent_chat: { units: 10, model: "fixed", minimum: 5, maximum: 15 },
};

const planDefaults: Record<string, { monthlyCredits: number; limits: Record<string, number | null> }> = {
  entrepreneur: { monthlyCredits: 4_000, limits: {} },
  business: { monthlyCredits: 10_000, limits: {} },
  agency: { monthlyCredits: 36_000, limits: {} },
  internal: { monthlyCredits: 1_000_000, limits: {} },
};

function monthWindow(now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { periodStart, periodEnd };
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function roundCost(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function usageFailure(name: string, message: string, statusCode: number) {
  return Object.assign(new Error(message), { name, code: name, statusCode, publicMessage: true });
}

function defaultPlanConfig(planCode: string | null | undefined) {
  const code = canonicalCommercialPlanCode(planCode);
  return planDefaults[code] ?? planDefaults.entrepreneur;
}

export async function ensureUsageControlDefaults(db: Db = prisma) {
  for (const feature of featureSeeds) {
    const pricing = commercialWorkflowPricing[feature.featureKey] ?? { units: feature.defaultCreditCost, model: "fixed", minimum: feature.defaultCreditCost, maximum: feature.defaultCreditCost };
    const existing = await db.featureCostCatalog.findUnique({ where: { featureKey: feature.featureKey } });
    if (!existing) {
      await db.featureCostCatalog.create({ data: {
        ...feature,
        defaultCreditCost: pricing.units,
        unitLabel: feature.unitLabel ?? "run",
        requiresApproval: feature.requiresApproval ?? false,
        requiresIntegration: feature.requiresIntegration ?? false,
        cacheTtlMinutes: feature.cacheTtlMinutes ?? 0,
        pricingVersion: 1,
        pricingModel: pricing.model ?? "fixed",
        pricingConfigJson: pricing.config ?? {},
        minimumUnitCost: pricing.minimum ?? null,
        maximumUnitCost: pricing.maximum ?? null,
        configJson: { commercialPricingInitialized: 1 },
      } });
      continue;
    }
    const existingConfig = existing.configJson && typeof existing.configJson === "object" && !Array.isArray(existing.configJson)
      ? existing.configJson as Record<string, unknown>
      : {};
    await db.featureCostCatalog.update({
      where: { featureKey: feature.featureKey },
      data: {
        moduleName: feature.moduleName,
        label: feature.label,
        description: feature.description,
        estimatedProviderCost: existingConfig.commercialPricingInitialized === 1 ? existing.estimatedProviderCost : feature.estimatedProviderCost,
        unitLabel: feature.unitLabel ?? "run",
        requiresApproval: feature.requiresApproval ?? false,
        requiresIntegration: feature.requiresIntegration ?? false,
        cacheTtlMinutes: feature.cacheTtlMinutes ?? 0,
        ...(existingConfig.commercialPricingInitialized === 1 ? {} : {
          defaultCreditCost: pricing.units,
          pricingVersion: 1,
          pricingModel: pricing.model ?? "fixed",
          pricingConfigJson: pricing.config ?? {},
          minimumUnitCost: pricing.minimum ?? null,
          maximumUnitCost: pricing.maximum ?? null,
          configJson: { ...existingConfig, commercialPricingInitialized: 1 },
        }),
      },
    });
  }
  // DEV-059 gives every commercial plan the complete capability set. Retire
  // the earlier per-plan feature/count matrix so it cannot remain a second
  // commercial authority.
  await db.planFeatureLimit.deleteMany({ where: { planCode: { not: "internal" } } });
}

export async function ensureCreditAccount(clientId: string, db: Db = prisma) {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { plan: true } });
  if (!client) throw new Error("client not found");
  const { periodStart, periodEnd } = monthWindow();
  const workspace = await db.workspace.findUnique({ where: { legacyClientId: clientId }, select: { id: true } });
  const commercialAllowance = workspace
    ? Number((await effectiveCommercialEntitlements(workspace.id)).limits.monthlyAiCapacity)
    : NaN;
  const planCode = normalizePlanCode(client.plan);
  const planAllowance = defaultPlanConfig(planCode).monthlyCredits;
  // Internal workspaces use the internal allowance even when a compatibility
  // subscription has not yet been assigned an AI-capacity entitlement.
  const allowance = planCode === "internal"
    ? planAllowance
    : Number.isFinite(commercialAllowance) ? Math.max(0, commercialAllowance) : planAllowance;
  const key = { clientId_periodStart: { clientId, periodStart } };
  const existing = await db.creditAccount.findUnique({ where: key });
  if (!existing) {
    return db.creditAccount.upsert({
      where: key,
      update: { monthlyAllowance: allowance, periodEnd },
      create: { clientId, periodStart, periodEnd, monthlyAllowance: allowance, balance: allowance },
    });
  }
  const allowanceDelta = allowance - existing.monthlyAllowance;
  return db.creditAccount.update({
    where: { id: existing.id },
    data: {
      monthlyAllowance: allowance,
      periodEnd,
      // Preserve used credits and manual top-ups when the plan allowance is
      // corrected, while never allowing a negative available balance.
      balance: Math.max(0, existing.balance + allowanceDelta),
    },
  });
}

export async function usageSummaryForClient(clientId: string) {
  await ensureUsageControlDefaults();
  const workspace = await prisma.workspace.findUnique({ where: { legacyClientId: clientId }, select: { id: true } });
  const capacity = workspace ? await workspaceCapacitySummary(workspace.id) : null;
  const legacyAccount = capacity ? null : await ensureCreditAccount(clientId);
  const { periodStart } = monthWindow();
  const [events, legacyCredits, capacityTransactions, providerCost, alerts, caps] = await Promise.all([
    prisma.usageEvent.groupBy({
      by: ["featureKey", "status"],
      where: { clientId, createdAt: { gte: periodStart } },
      _count: { _all: true },
      _sum: { creditsCommitted: true, providerCostUsd: true },
    }),
    capacity ? Promise.resolve([]) : prisma.creditTransaction.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 20 }),
    workspace ? prisma.workspaceCapacityTransaction.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" }, take: 20 }) : Promise.resolve([]),
    prisma.providerCostEvent.aggregate({ where: { clientId, createdAt: { gte: periodStart } }, _sum: { costUsd: true } }),
    prisma.usageAlert.findMany({ where: { clientId, resolvedAt: null }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.budgetCap.findMany({ where: { clientId, isActive: true }, orderBy: { createdAt: "desc" } }),
  ]);

  return {
    account: capacity ? {
      ...capacity.account,
      balance: capacity.totalAvailable,
      monthlyAllowance: capacity.included.allowance,
      monthlyUsed: capacity.included.used,
    } : legacyAccount,
    capacity,
    events,
    recentTransactions: capacityTransactions.length ? capacityTransactions : legacyCredits,
    providerCostUsd: providerCost._sum.costUsd ?? 0,
    alerts,
    budgetCaps: caps,
  };
}

async function monthlyFeatureCount(clientId: string, featureKey: string, status?: string[]) {
  const { periodStart } = monthWindow();
  return prisma.usageEvent.count({
    where: {
      clientId,
      featureKey,
      createdAt: { gte: periodStart },
      ...(status?.length ? { status: { in: status } } : {}),
    },
  });
}

async function checkBudgetCaps(input: UsagePreflightInput, creditCost: number) {
  const caps = await prisma.budgetCap.findMany({ where: { clientId: input.clientId, isActive: true } });
  if (!caps.length) return;
  const { periodStart } = monthWindow();
  for (const cap of caps) {
    const applies =
      cap.scope === "workspace" ||
      (cap.scope === "feature" && cap.scopeKey === input.featureKey) ||
      (cap.scope === "project" && input.projectId && cap.scopeKey === input.projectId);
    if (!applies) continue;

    if (cap.monthlyCredits != null) {
      const spent = await prisma.usageEvent.aggregate({
        where: { clientId: input.clientId, createdAt: { gte: periodStart }, status: "committed", ...(cap.scope === "feature" ? { featureKey: cap.scopeKey } : {}), ...(cap.scope === "project" ? { projectId: cap.scopeKey } : {}) },
        _sum: { creditsCommitted: true },
      });
      if ((spent._sum.creditsCommitted ?? 0) + creditCost > cap.monthlyCredits) {
        throw usageFailure("usage_budget_cap_reached", "This workspace has reached its monthly AI budget cap. Ask an administrator to increase the budget before continuing.", 409);
      }
    }
  }
}

export async function preflightUsage(input: UsagePreflightInput) {
  const requestContext = currentCommercialRequestContext();
  if (requestContext?.clientId) input = { ...input, clientId: requestContext.clientId };
  await ensureUsageControlDefaults();
  const units = Math.max(1, Math.floor(input.inputUnits ?? 1));
  // Workflow keys identify the underlying work across retry/refresh endpoints.
  // The request fingerprint is the platform fallback for callers that do not
  // yet provide one, so reload protection does not depend on every module.
  let idempotencyKey = usageWorkFingerprint(input, input.idempotencyKey ? null : requestContext?.requestId);
  const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true, plan: true, aiSubscriptionStatus: true } });
  if (!client) throw new Error("client not found");

  const feature = await prisma.featureCostCatalog.findUnique({ where: { featureKey: input.featureKey } });
  if (!feature || !feature.isActive) {
    throw usageFailure("usage_feature_disabled", "This AI feature is currently disabled.", 404);
  }

  const workspace = await prisma.workspace.findUnique({ where: { legacyClientId: input.clientId }, select: { id: true } });
  if (workspace) await assertWorkspaceFeature(workspace.id, feature.moduleName);

  if (!workspace) throw usageFailure("usage_workspace_required", "This action requires a workspace before AI Capacity can be reserved.", 409);
  if (input.userId) {
    const membership = await prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: input.userId } },
      select: { status: true, roles: { select: { role: true } } },
    });
    const roles = membership?.roles.map((item) => item.role) ?? [];
    if (membership?.status !== "active" || (roles.length === 1 && roles[0] === "client_viewer")) {
      throw usageFailure("usage_role_blocked", "Client Viewers cannot initiate AI work or consume workspace AI Capacity.", 403);
    }
  }

  if (idempotencyKey) {
    const existing = await prisma.usageEvent.findUnique({ where: { clientId_idempotencyKey: { clientId: input.clientId, idempotencyKey } }, include: { feature: true } });
    if (existing && ["reserved", "committed"].includes(existing.status)) return {
      usageEventId: existing.id,
      approvalToken: "",
      expiresAt: existing.approvalTokenExpiresAt ?? new Date(),
      feature: existing.feature,
      creditsReserved: existing.creditsReserved,
      estimatedProviderCostUsd: roundCost(existing.feature.estimatedProviderCost * Math.max(1, units)),
      duplicate: true,
    };
    if (existing) {
      const retryCount = await prisma.usageEvent.count({ where: { clientId: input.clientId, idempotencyKey: { startsWith: `${idempotencyKey}:free-retry:` } } });
      const retryKey = usageIdempotencyKey(`${idempotencyKey}:free-retry:${retryCount + 1}`);
      const retryToken = crypto.randomBytes(24).toString("base64url");
      const retry = await prisma.usageEvent.create({ data: {
        clientId: input.clientId,
        workspaceId: existing.workspaceId,
        userId: input.userId ?? existing.userId,
        projectId: input.projectId ?? existing.projectId,
        websiteId: input.websiteId ?? existing.websiteId,
        featureKey: input.featureKey,
        actionKey: Array.from(input.actionKey?.trim() || input.featureKey).slice(0, 160).join(""),
        idempotencyKey: retryKey,
        status: "reserved",
        creditsReserved: 0,
        inputUnits: units,
        approvalTokenHash: hashToken(retryToken),
        approvalTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        metadataJson: { ...(input.metadata ?? {}), freeRetryOfUsageEventId: existing.id, billingReason: "retry_or_recovery" } as Prisma.InputJsonValue,
      } }).catch(async (error) => {
        if ((error as { code?: string })?.code !== "P2002" || !retryKey) throw error;
        return prisma.usageEvent.findUniqueOrThrow({ where: { clientId_idempotencyKey: { clientId: input.clientId, idempotencyKey: retryKey } } });
      });
      return { usageEventId: retry.id, approvalToken: retryToken, expiresAt: retry.approvalTokenExpiresAt!, feature: existing.feature, creditsReserved: 0, estimatedProviderCostUsd: 0, duplicate: true };
    }
  }

  const account = await ensureWorkspaceCapacityAccount(workspace.id);
  const creditCost = calculateWorkflowUnits(input.featureKey, feature.defaultCreditCost, {
    inputUnits: units,
    metadata: input.metadata,
    pricingModel: feature.pricingModel,
    pricingConfig: feature.pricingConfigJson,
    minimumUnitCost: feature.minimumUnitCost,
    maximumUnitCost: feature.maximumUnitCost,
  });
  if (account.includedBalance + account.purchasedBalance < creditCost) {
    throw usageFailure("usage_insufficient_capacity", "This workspace does not have enough AI Capacity for this action. Add a Capacity Pack or ask an administrator to adjust the workspace balance.", 402);
  }
  await checkBudgetCaps(input, creditCost);

  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const actionKey = Array.from(input.actionKey?.trim() || input.featureKey).slice(0, 160).join("");

  const event = await prisma.$transaction(async (tx) => {
    const current = await tx.workspaceCapacityAccount.findUniqueOrThrow({ where: { id: account.id } });
    const includedUnits = Math.min(creditCost, current.includedBalance);
    const purchasedUnits = creditCost - includedUnits;
    if (current.purchasedBalance < purchasedUnits) {
      throw usageFailure("usage_insufficient_capacity", "This workspace does not have enough AI Capacity for this action. Add a Capacity Pack or ask an administrator to adjust the workspace balance.", 402);
    }
    const updated = await tx.workspaceCapacityAccount.update({
      where: { id: account.id },
      data: {
        includedBalance: { decrement: includedUnits },
        includedReserved: { increment: includedUnits },
        purchasedBalance: { decrement: purchasedUnits },
        purchasedReserved: { increment: purchasedUnits },
      },
    });
    const usageEvent = await tx.usageEvent.create({
      data: {
        clientId: input.clientId,
        workspaceId: workspace.id,
        userId: input.userId ?? null,
        projectId: input.projectId ?? null,
        websiteId: input.websiteId ?? null,
        featureKey: input.featureKey,
        actionKey,
        idempotencyKey,
        creditsReserved: creditCost,
        includedUnitsReserved: includedUnits,
        purchasedUnitsReserved: purchasedUnits,
        inputUnits: units,
        approvalTokenHash: hashToken(token),
        approvalTokenExpiresAt: expiresAt,
        metadataJson: {
          ...(input.metadata ?? {}),
          capacityAccountId: account.id,
          pricingVersion: feature.pricingVersion,
          pricingModel: feature.pricingModel,
          pricingConfig: feature.pricingConfigJson,
          minimumUnitCost: feature.minimumUnitCost,
          maximumUnitCost: feature.maximumUnitCost,
          baseUnitCost: feature.defaultCreditCost,
        } as Prisma.InputJsonValue,
      },
    });
    const ledgerRows = [
      includedUnits > 0 ? { bucket: "included", amount: -includedUnits, balanceAfter: updated.includedBalance } : null,
      purchasedUnits > 0 ? { bucket: "purchased", amount: -purchasedUnits, balanceAfter: updated.purchasedBalance } : null,
    ].filter((row): row is { bucket: string; amount: number; balanceAfter: number } => Boolean(row));
    for (const row of ledgerRows) await tx.workspaceCapacityTransaction.create({ data: {
      workspaceId: workspace.id,
      accountId: account.id,
      usageEventId: usageEvent.id,
      bucket: row.bucket,
      type: "reserve",
      amount: row.amount,
      balanceAfter: row.balanceAfter,
      reason: actionKey.slice(0, 255),
      correlationId: usageCorrelationId(idempotencyKey) ?? usageEvent.id,
      metadataJson: { featureKey: input.featureKey, pricingVersion: feature.pricingVersion },
    } });
    return usageEvent;
  }).catch(async (error) => {
    if ((error as { code?: string })?.code === "P2002" && idempotencyKey) {
      const existing = await prisma.usageEvent.findUnique({ where: { clientId_idempotencyKey: { clientId: input.clientId, idempotencyKey } } });
      if (existing) return existing;
    }
    throw error;
  });

  if (requestContext && requestContext.clientId === input.clientId) {
    requestContext.usageEventId = event.id;
    requestContext.manualUsageReservation = true;
  }

  return {
    usageEventId: event.id,
    approvalToken: token,
    expiresAt,
    feature,
    creditsReserved: creditCost,
    estimatedProviderCostUsd: roundCost(feature.estimatedProviderCost * Math.max(1, units)),
  };
}

export async function commitUsage(input: CommitUsageInput) {
  const usageEvent = input.usageEventId
    ? await prisma.usageEvent.findUnique({ where: { id: input.usageEventId } })
    : input.approvalToken
      ? await prisma.usageEvent.findUnique({ where: { approvalTokenHash: hashToken(input.approvalToken) } })
      : null;
  if (!usageEvent) throw new Error("usage event not found");
  if (usageEvent.status === "committed") {
    await recordProviderCostForUsage(usageEvent, input);
    return prisma.usageEvent.findUniqueOrThrow({ where: { id: usageEvent.id } });
  }
  if (usageEvent.status !== "reserved") throw new Error(`usage event cannot be committed from ${usageEvent.status}`);
  if (usageEvent.approvalTokenExpiresAt && usageEvent.approvalTokenExpiresAt < new Date()) {
    await refundUsage({ usageEventId: usageEvent.id, reason: "approval token expired" });
    const error = new Error("usage approval token expired");
    error.name = "usage_token_expired";
    throw error;
  }

  const actualUnits = input.actualUnits == null
    ? usageEvent.creditsReserved
    : Math.max(0, Math.min(usageEvent.creditsReserved, Math.floor(input.actualUnits)));
  const includedCommitted = Math.min(actualUnits, usageEvent.includedUnitsReserved);
  const purchasedCommitted = Math.max(0, actualUnits - includedCommitted);
  const includedRefunded = usageEvent.includedUnitsReserved - includedCommitted;
  const purchasedRefunded = usageEvent.purchasedUnitsReserved - purchasedCommitted;
  const settled = await prisma.$transaction(async (tx) => {
    const claimed = await tx.usageEvent.updateMany({
      where: { id: usageEvent.id, status: "reserved" },
      data: {
        status: "committed",
        creditsCommitted: actualUnits,
        providerCostUsd: 0,
        committedAt: new Date(),
        metadataJson: { ...(usageEvent.metadataJson as object), ...(input.metadata ?? {}) } as Prisma.InputJsonValue,
      },
    });
    if (!claimed.count) return tx.usageEvent.findUniqueOrThrow({ where: { id: usageEvent.id } });
    const updated = await tx.usageEvent.findUniqueOrThrow({ where: { id: usageEvent.id } });
    const metadata = usageEvent.metadataJson && typeof usageEvent.metadataJson === "object" && !Array.isArray(usageEvent.metadataJson)
      ? usageEvent.metadataJson as Record<string, unknown>
      : {};
    const capacityAccountId = String(metadata.capacityAccountId ?? "");
    if (capacityAccountId && usageEvent.workspaceId) {
      const capacityAccount = await tx.workspaceCapacityAccount.update({
        where: { id: capacityAccountId },
        data: {
          includedReserved: { decrement: usageEvent.includedUnitsReserved },
          includedUsed: { increment: includedCommitted },
          includedBalance: { increment: includedRefunded },
          purchasedReserved: { decrement: usageEvent.purchasedUnitsReserved },
          purchasedUsed: { increment: purchasedCommitted },
          purchasedBalance: { increment: purchasedRefunded },
        },
      });
      for (const row of [
        usageEvent.includedUnitsReserved > 0 ? { bucket: "included", committed: includedCommitted, refunded: includedRefunded, balanceAfter: capacityAccount.includedBalance } : null,
        usageEvent.purchasedUnitsReserved > 0 ? { bucket: "purchased", committed: purchasedCommitted, refunded: purchasedRefunded, balanceAfter: capacityAccount.purchasedBalance } : null,
      ].filter((row): row is { bucket: string; committed: number; refunded: number; balanceAfter: number } => Boolean(row))) {
        await tx.workspaceCapacityTransaction.create({ data: {
          workspaceId: usageEvent.workspaceId,
          accountId: capacityAccountId,
          usageEventId: usageEvent.id,
          bucket: row.bucket,
          type: "commit",
          amount: 0,
          balanceAfter: row.balanceAfter,
          reason: creditTransactionReason(`Committed ${row.committed} units for ${usageEvent.actionKey}`),
          correlationId: usageEvent.id,
          metadataJson: { committedUnits: row.committed, refundedUnits: row.refunded, featureKey: usageEvent.featureKey },
        } });
        if (row.refunded > 0) await tx.workspaceCapacityTransaction.create({ data: {
          workspaceId: usageEvent.workspaceId,
          accountId: capacityAccountId,
          usageEventId: usageEvent.id,
          bucket: row.bucket,
          type: "refund",
          amount: row.refunded,
          balanceAfter: row.balanceAfter,
          reason: creditTransactionReason(`Unused reservation returned for ${usageEvent.actionKey}`),
          correlationId: usageEvent.id,
          metadataJson: { featureKey: usageEvent.featureKey, partialSettlement: true },
        } });
      }
    }
    return updated;
  });
  await recordProviderCostForUsage(settled, input);
  return prisma.usageEvent.findUniqueOrThrow({ where: { id: settled.id } });
}

async function recordProviderCostForUsage(usageEvent: Awaited<ReturnType<typeof prisma.usageEvent.findUniqueOrThrow>>, input: CommitUsageInput) {
  const providerCostUsd = roundCost(input.providerCostUsd ?? 0);
  if (!(providerCostUsd > 0 || input.inputTokens || input.outputTokens || input.provider)) return;
  const requestKey = typeof input.metadata?.providerRequestKey === "string" ? input.metadata.providerRequestKey : "primary";
  const idempotencyKey = `usage-provider:${usageEvent.id}:${crypto.createHash("sha256").update(requestKey).digest("hex").slice(0, 24)}`;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.providerCostEvent.create({ data: {
        clientId: usageEvent.clientId,
        usageEventId: usageEvent.id,
        featureKey: usageEvent.featureKey,
        provider: input.provider ?? "unknown",
        workspaceId: usageEvent.workspaceId,
        projectId: usageEvent.projectId,
        websiteId: usageEvent.websiteId,
        idempotencyKey,
        model: input.model ?? null,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        costUsd: providerCostUsd,
        metadataJson: (input.metadata ?? {}) as Prisma.InputJsonValue,
      } });
      if (providerCostUsd > 0) await tx.usageEvent.update({ where: { id: usageEvent.id }, data: { providerCostUsd: { increment: providerCostUsd } } });
    });
  } catch (error) {
    if ((error as { code?: string })?.code !== "P2002") throw error;
  }
}

export async function refundUsage(input: { usageEventId: string; reason?: string }) {
  const usageEvent = await prisma.usageEvent.findUnique({ where: { id: input.usageEventId } });
  if (!usageEvent) throw new Error("usage event not found");
  if (usageEvent.status === "refunded") return usageEvent;
  const fullReason = input.reason?.trim() || "usage refunded";
  if (usageEvent.creditsReserved <= 0 || usageEvent.status === "committed") {
    return prisma.usageEvent.update({ where: { id: usageEvent.id }, data: { status: "failed", error: input.reason?.trim() || "failed after commit check" } });
  }
  const metadata = usageEvent.metadataJson && typeof usageEvent.metadataJson === "object" && !Array.isArray(usageEvent.metadataJson)
    ? usageEvent.metadataJson as Record<string, unknown>
    : {};
  const capacityAccountId = String(metadata.capacityAccountId ?? "");
  if (!capacityAccountId || !usageEvent.workspaceId) throw new Error("usage capacity account not found");
  return prisma.$transaction(async (tx) => {
    const released = await tx.usageEvent.updateMany({
      where: { id: usageEvent.id, status: "reserved" },
      data: { status: "refunded", refundedAt: new Date(), error: fullReason },
    });
    if (!released.count) return tx.usageEvent.findUniqueOrThrow({ where: { id: usageEvent.id } });
    const updatedAccount = await tx.workspaceCapacityAccount.update({
      where: { id: capacityAccountId },
      data: {
        includedBalance: { increment: usageEvent.includedUnitsReserved },
        includedReserved: { decrement: usageEvent.includedUnitsReserved },
        purchasedBalance: { increment: usageEvent.purchasedUnitsReserved },
        purchasedReserved: { decrement: usageEvent.purchasedUnitsReserved },
      },
    });
    for (const row of [
      usageEvent.includedUnitsReserved > 0 ? { bucket: "included", amount: usageEvent.includedUnitsReserved, balanceAfter: updatedAccount.includedBalance } : null,
      usageEvent.purchasedUnitsReserved > 0 ? { bucket: "purchased", amount: usageEvent.purchasedUnitsReserved, balanceAfter: updatedAccount.purchasedBalance } : null,
    ].filter((row): row is { bucket: string; amount: number; balanceAfter: number } => Boolean(row))) await tx.workspaceCapacityTransaction.create({ data: {
      workspaceId: usageEvent.workspaceId,
      accountId: capacityAccountId,
      usageEventId: usageEvent.id,
      bucket: row.bucket,
      type: "refund",
      amount: row.amount,
      balanceAfter: row.balanceAfter,
      reason: creditTransactionReason(fullReason),
      correlationId: usageEvent.id,
      metadataJson: { featureKey: usageEvent.featureKey },
    } });
    return tx.usageEvent.findUniqueOrThrow({ where: { id: usageEvent.id } });
  });
}

export async function guardedUsage<T>(input: UsagePreflightInput, fn: (usage: { usageEventId: string; approvalToken: string }) => Promise<T>, commit: Omit<CommitUsageInput, "usageEventId" | "approvalToken"> = {}) {
  const preflight = await preflightUsage(input);
  try {
    const result = await fn({ usageEventId: preflight.usageEventId, approvalToken: preflight.approvalToken });
    await commitUsage({ usageEventId: preflight.usageEventId, ...commit });
    return { result, preflight };
  } catch (error) {
    await refundUsage({ usageEventId: preflight.usageEventId, reason: error instanceof Error ? error.message : "execution failed" });
    throw error;
  }
}

type ModelRouteCandidate = { model: string; planCode: string | null; sortOrder: number; configJson: unknown };

function routingConfig(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function expectedSuccessfulWorkflowCost(value: unknown) {
  const config = routingConfig(value);
  const number = (key: string) => typeof config[key] === "number" && Number.isFinite(config[key]) ? Math.max(0, Number(config[key])) : 0;
  const hasCost = ["initialApiCost", "expectedRetryCost", "validationCost", "correctionCost", "retryCost", "expectedRetryRate"].some((key) => typeof config[key] === "number");
  if (!hasCost) return null;
  const expectedRetryCost = number("expectedRetryCost") || number("retryCost") * number("expectedRetryRate");
  return number("initialApiCost") + expectedRetryCost + number("validationCost") + number("correctionCost");
}

export function selectLowestSuccessfulWorkflowCostRoute<T extends ModelRouteCandidate>(rules: T[], normalizedPlan: string) {
  const eligible = rules.filter((rule) => {
    const config = routingConfig(rule.configJson);
    return config.providerAvailable !== false && config.disabled !== true;
  });
  const planSpecific = eligible.filter((rule) => rule.planCode === normalizedPlan);
  const pool = planSpecific.length ? planSpecific : eligible.filter((rule) => rule.planCode == null);
  return [...pool].sort((left, right) => {
    const leftCost = expectedSuccessfulWorkflowCost(left.configJson);
    const rightCost = expectedSuccessfulWorkflowCost(right.configJson);
    if (leftCost != null || rightCost != null) return (leftCost ?? Number.POSITIVE_INFINITY) - (rightCost ?? Number.POSITIVE_INFINITY) || left.sortOrder - right.sortOrder;
    return left.sortOrder - right.sortOrder;
  })[0] ?? null;
}

export async function modelRouteForFeature(featureKey: string, planCode: string | null | undefined, fallbackModel: string) {
  const normalizedPlan = normalizePlanCode(planCode);
  const rules = await prisma.modelRoutingRule.findMany({
    where: {
      featureKey,
      isActive: true,
      OR: [{ planCode: normalizedPlan }, { planCode: null }],
    },
    orderBy: [{ planCode: "desc" }, { sortOrder: "asc" }],
  });
  // centralAiJson currently has a production adapter for OpenAI. Other
  // providers can be registered without being selected until their adapter
  // is available, preventing a low-cost but non-runnable route.
  const rule = selectLowestSuccessfulWorkflowCostRoute(rules.filter((candidate) => candidate.provider === "openai"), normalizedPlan);
  return {
    provider: rule?.provider ?? "openai",
    model: rule?.model ?? defaultAiModelForFeature(featureKey, fallbackModel),
    modelTier: aiModelTierForFeature(featureKey),
    taskComplexity: rule?.taskComplexity ?? (aiModelTierForFeature(featureKey) === "research" ? "advanced" : "standard"),
    expectedSuccessfulWorkflowCost: rule ? expectedSuccessfulWorkflowCost(rule.configJson) : null,
    routingRuleId: rule?.id ?? null,
  };
}

export async function modelForFeature(featureKey: string, planCode: string | null | undefined, fallbackModel: string) {
  return (await modelRouteForFeature(featureKey, planCode, fallbackModel)).model;
}

export const defaultUsageFeatures = featureSeeds;
export const defaultUsagePlanConfig = planDefaults;
