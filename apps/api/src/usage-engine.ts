import crypto from "node:crypto";
import { prisma, type Prisma } from "@webtummy/db";
import { normalizePlanCode } from "./billing.js";
import { assertWorkspaceFeature, effectiveCommercialEntitlements } from "./commercial-service.js";
import { currentCommercialRequestContext } from "./commercial-request-context.js";
import { aiModelTierForFeature, defaultAiModelForFeature } from "./ai-model-policy.js";

export const USAGE_APPROVAL_HEADER = "x-senuke-usage-token";
const CREDIT_TRANSACTION_REASON_MAX_LENGTH = 255;

export function creditTransactionReason(value: string | null | undefined, fallback = "usage refunded") {
  const reason = value?.trim() || fallback;
  return Array.from(reason).slice(0, CREDIT_TRANSACTION_REASON_MAX_LENGTH).join("");
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

const planDefaults: Record<string, { monthlyCredits: number; limits: Record<string, number | null> }> = {
  mini: { monthlyCredits: 100, limits: { site_crawl_small: 2, backlink_snapshot: 2, growth_report: 1 } },
  starter: { monthlyCredits: 250, limits: { site_crawl_small: 4, backlink_snapshot: 4, growth_report: 2 } },
  basic: { monthlyCredits: 600, limits: { site_crawl_small: 8, backlink_snapshot: 8, growth_report: 4 } },
  growth: { monthlyCredits: 1200, limits: { site_crawl_small: 16, backlink_snapshot: 16, growth_report: 8 } },
  pro: { monthlyCredits: 2500, limits: { site_crawl_small: 30, backlink_snapshot: 30, growth_report: 15 } },
  internal: { monthlyCredits: 10000, limits: {} },
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
  const code = normalizePlanCode(planCode);
  return planDefaults[code] ?? planDefaults.mini;
}

export async function ensureUsageControlDefaults(db: Db = prisma) {
  for (const feature of featureSeeds) {
    await db.featureCostCatalog.upsert({
      where: { featureKey: feature.featureKey },
      update: {},
      create: {
        ...feature,
        unitLabel: feature.unitLabel ?? "run",
        requiresApproval: feature.requiresApproval ?? false,
        requiresIntegration: feature.requiresIntegration ?? false,
        cacheTtlMinutes: feature.cacheTtlMinutes ?? 0,
      },
    });
  }

  for (const [planCode, config] of Object.entries(planDefaults)) {
    for (const feature of featureSeeds) {
      await db.planFeatureLimit.upsert({
        where: { planCode_featureKey: { planCode, featureKey: feature.featureKey } },
        update: {},
        create: {
          planCode,
          featureKey: feature.featureKey,
          monthlyLimit: config.limits[feature.featureKey] ?? null,
          creditCost: feature.defaultCreditCost,
        },
      });
    }
  }
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
  const account = await ensureCreditAccount(clientId);
  const { periodStart } = monthWindow();
  const [events, credits, providerCost, alerts, caps] = await Promise.all([
    prisma.usageEvent.groupBy({
      by: ["featureKey", "status"],
      where: { clientId, createdAt: { gte: periodStart } },
      _count: { _all: true },
      _sum: { creditsCommitted: true, providerCostUsd: true },
    }),
    prisma.creditTransaction.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.providerCostEvent.aggregate({ where: { clientId, createdAt: { gte: periodStart } }, _sum: { costUsd: true } }),
    prisma.usageAlert.findMany({ where: { clientId, resolvedAt: null }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.budgetCap.findMany({ where: { clientId, isActive: true }, orderBy: { createdAt: "desc" } }),
  ]);

  return {
    account,
    events,
    recentTransactions: credits,
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
  await ensureUsageControlDefaults();
  const units = Math.max(1, Math.floor(input.inputUnits ?? 1));
  const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true, plan: true, aiSubscriptionStatus: true } });
  if (!client) throw new Error("client not found");

  const feature = await prisma.featureCostCatalog.findUnique({ where: { featureKey: input.featureKey } });
  if (!feature || !feature.isActive) {
    throw usageFailure("usage_feature_disabled", "This AI feature is currently disabled.", 404);
  }

  const workspace = await prisma.workspace.findUnique({ where: { legacyClientId: input.clientId }, select: { id: true } });
  if (workspace) await assertWorkspaceFeature(workspace.id, feature.moduleName);

  const planCode = normalizePlanCode(client.plan);
  const limit = await prisma.planFeatureLimit.findUnique({ where: { planCode_featureKey: { planCode, featureKey: input.featureKey } } });
  if (limit?.hardBlocked) {
    throw usageFailure("usage_plan_blocked", "This AI feature is not available on the workspace plan.", 409);
  }

  if (limit?.monthlyLimit != null) {
    const used = await monthlyFeatureCount(input.clientId, input.featureKey, ["reserved", "committed"]);
    if (used + units > limit.monthlyLimit && !limit.overageAllowed) {
      throw usageFailure("usage_limit_reached", "This workspace has reached the monthly limit for this AI feature.", 409);
    }
  }

  const account = await ensureCreditAccount(input.clientId);
  const creditCost = Math.max(0, (limit?.creditCost ?? feature.defaultCreditCost) * units);
  if (account.balance < creditCost) {
    throw usageFailure("usage_insufficient_credits", "This workspace does not have enough AI credits for this action. Add credits or ask an administrator to increase the monthly AI allowance.", 402);
  }
  await checkBudgetCaps(input, creditCost);

  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const actionKey = input.actionKey?.trim() || input.featureKey;

  const event = await prisma.$transaction(async (tx) => {
    const debited = await tx.creditAccount.updateMany({
      where: { id: account.id, balance: { gte: creditCost } },
      data: { balance: { decrement: creditCost } },
    });
    if (!debited.count) {
      throw usageFailure("usage_insufficient_credits", "This workspace does not have enough AI credits for this action. Add credits or ask an administrator to increase the monthly AI allowance.", 402);
    }
    const updated = await tx.creditAccount.findUniqueOrThrow({ where: { id: account.id } });
    const usageEvent = await tx.usageEvent.create({
      data: {
        clientId: input.clientId,
        userId: input.userId ?? null,
        projectId: input.projectId ?? null,
        websiteId: input.websiteId ?? null,
        featureKey: input.featureKey,
        actionKey,
        idempotencyKey: input.idempotencyKey ?? null,
        creditsReserved: creditCost,
        inputUnits: units,
        approvalTokenHash: hashToken(token),
        approvalTokenExpiresAt: expiresAt,
        metadataJson: { ...(input.metadata ?? {}), creditAccountId: account.id } as Prisma.InputJsonValue,
      },
    });
    if (creditCost > 0) {
      await tx.creditTransaction.create({
        data: {
          clientId: input.clientId,
          usageEventId: usageEvent.id,
          type: "debit",
          amount: -creditCost,
          balanceAfter: updated.balance,
          reason: actionKey,
          metadataJson: { featureKey: input.featureKey },
        },
      });
    }
    return usageEvent;
  });

  const requestContext = currentCommercialRequestContext();
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
    estimatedProviderCostUsd: roundCost(feature.estimatedProviderCost * units),
  };
}

export async function commitUsage(input: CommitUsageInput) {
  const usageEvent = input.usageEventId
    ? await prisma.usageEvent.findUnique({ where: { id: input.usageEventId } })
    : input.approvalToken
      ? await prisma.usageEvent.findUnique({ where: { approvalTokenHash: hashToken(input.approvalToken) } })
      : null;
  if (!usageEvent) throw new Error("usage event not found");
  if (usageEvent.status === "committed") return usageEvent;
  if (usageEvent.status !== "reserved") throw new Error(`usage event cannot be committed from ${usageEvent.status}`);
  if (usageEvent.approvalTokenExpiresAt && usageEvent.approvalTokenExpiresAt < new Date()) {
    await refundUsage({ usageEventId: usageEvent.id, reason: "approval token expired" });
    const error = new Error("usage approval token expired");
    error.name = "usage_token_expired";
    throw error;
  }

  const providerCostUsd = roundCost(input.providerCostUsd ?? 0);
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.usageEvent.updateMany({
      where: { id: usageEvent.id, status: "reserved" },
      data: {
        status: "committed",
        creditsCommitted: usageEvent.creditsReserved,
        providerCostUsd,
        committedAt: new Date(),
        metadataJson: { ...(usageEvent.metadataJson as object), ...(input.metadata ?? {}) } as Prisma.InputJsonValue,
      },
    });
    if (!claimed.count) return tx.usageEvent.findUniqueOrThrow({ where: { id: usageEvent.id } });
    const updated = await tx.usageEvent.findUniqueOrThrow({ where: { id: usageEvent.id } });
    const creditAccountId = usageEvent.metadataJson && typeof usageEvent.metadataJson === "object" && !Array.isArray(usageEvent.metadataJson)
      ? String((usageEvent.metadataJson as Record<string, unknown>).creditAccountId ?? "")
      : "";
    if (creditAccountId && usageEvent.creditsReserved > 0) {
      await tx.creditAccount.updateMany({
        where: { id: creditAccountId, clientId: usageEvent.clientId },
        data: { monthlyUsed: { increment: usageEvent.creditsReserved } },
      });
    }
    if (providerCostUsd > 0 || input.inputTokens || input.outputTokens || input.provider) {
      await tx.providerCostEvent.create({
        data: {
          clientId: usageEvent.clientId,
          usageEventId: usageEvent.id,
          featureKey: usageEvent.featureKey,
          provider: input.provider ?? "unknown",
          model: input.model ?? null,
          inputTokens: input.inputTokens ?? 0,
          outputTokens: input.outputTokens ?? 0,
          costUsd: providerCostUsd,
          metadataJson: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    }
    return updated;
  });
}

export async function refundUsage(input: { usageEventId: string; reason?: string }) {
  const usageEvent = await prisma.usageEvent.findUnique({ where: { id: input.usageEventId } });
  if (!usageEvent) throw new Error("usage event not found");
  if (usageEvent.status === "refunded") return usageEvent;
  const fullReason = input.reason?.trim() || "usage refunded";
  if (usageEvent.creditsReserved <= 0 || usageEvent.status === "committed") {
    return prisma.usageEvent.update({ where: { id: usageEvent.id }, data: { status: "failed", error: input.reason?.trim() || "failed after commit check" } });
  }
  const creditAccountId = usageEvent.metadataJson && typeof usageEvent.metadataJson === "object" && !Array.isArray(usageEvent.metadataJson)
    ? String((usageEvent.metadataJson as Record<string, unknown>).creditAccountId ?? "")
    : "";
  const account = creditAccountId
    ? await prisma.creditAccount.findFirst({ where: { id: creditAccountId, clientId: usageEvent.clientId } })
    : await ensureCreditAccount(usageEvent.clientId);
  if (!account) throw new Error("usage credit account not found");
  return prisma.$transaction(async (tx) => {
    const released = await tx.usageEvent.updateMany({
      where: { id: usageEvent.id, status: "reserved" },
      data: { status: "refunded", refundedAt: new Date(), error: fullReason },
    });
    if (!released.count) return tx.usageEvent.findUniqueOrThrow({ where: { id: usageEvent.id } });
    const updatedAccount = await tx.creditAccount.update({
      where: { id: account.id },
      data: { balance: { increment: usageEvent.creditsReserved } },
    });
    await tx.creditTransaction.create({
      data: {
        clientId: usageEvent.clientId,
        usageEventId: usageEvent.id,
        type: "refund",
        amount: usageEvent.creditsReserved,
        balanceAfter: updatedAccount.balance,
        // The full diagnostic remains on UsageEvent.error (Text). The ledger's
        // reason column is VarChar(255), so bound it without rolling back the
        // otherwise valid credit refund transaction.
        reason: creditTransactionReason(fullReason),
      },
    });
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
