import { Router, type Request } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { canAccessProject, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";
import { startTaskPublishing, verifyTaskPublishing } from "../publishing-workflow.js";
import { submitTaskApproval } from "../approval-workflow.js";
import { buildCampaignExecutionTasks } from "../campaign-intelligence.js";
import { clusterKeywordDirections, keywordTopicSimilarity, planSeoPages, stripNonGeographicAudienceQualifier, type SeoPagePlan, type SeoPlannerInput } from "@webtummy/core";
import { centralAiJson } from "../central-ai-service.js";
import { cleanGeographicTargetMarkets } from "../project-location.js";
import { normalizeKeywordsWithAi } from "../ai-keyword-normalization.js";

export const executionTasksRouter = Router();
executionTasksRouter.use(requireAuth);

const terminalStatuses = new Set(["completed", "skipped"]);
const CONTENT_PLAN_WORKFLOW_VERSION = "seo_page_map_v4" as const;

const querySchema = z.object({
  websiteId: z.string().optional(),
  projectId: z.string().optional(),
  status: z.string().optional(),
  moduleName: z.string().optional(),
  priority: z.string().optional(),
  search: z.string().trim().max(200).optional(),
});

const patchSchema = z.object({
  status: z.string().min(2).max(60).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  manualInstructions: z.string().max(5000).optional().nullable(),
});
const publishSchema = z.object({
  target: z.enum(["wordpress", "html", "shopify", "social"]).optional(),
  targetReference: z.string().trim().min(1).max(1000).optional().nullable(),
  previousVersionReference: z.string().trim().max(2000).optional().nullable(),
  metadata: z.record(z.unknown()).default({}),
});
const publishVerificationSchema = z.object({
  attemptId: z.string().uuid(),
  status: z.enum(["verified", "pending", "failed"]),
  externalId: z.string().trim().max(500).optional().nullable(),
  liveUrl: z.string().url().optional().nullable(),
  checksum: z.string().trim().max(255).optional().nullable(),
  error: z.string().trim().max(5000).optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.status === "verified" && !data.externalId && !data.liveUrl && !data.checksum) ctx.addIssue({ code: "custom", path: ["status"], message: "Verified publishing requires an external ID, live URL, or checksum." });
  if (data.status === "failed" && !data.error) ctx.addIssue({ code: "custom", path: ["error"], message: "A publishing failure must include the provider error." });
});

const rankingPlanSchema = z.object({
  keyword: z.string().trim().min(2).max(255),
  intent: z.string().trim().min(2).max(120),
  targetMode: z.enum(["optimize_existing", "create_new"]),
  targetUrl: z.string().trim().max(512).nullable(),
  pageTitle: z.string().trim().min(2).max(220),
  recommendedKeywordVariants: z.array(z.string().trim().min(2).max(255)).max(12),
  contentSections: z.array(z.string().trim().min(2).max(220)).min(1).max(20),
  internalLinkActions: z.array(z.string().trim().min(2).max(500)).max(12),
  authorityActions: z.array(z.string().trim().min(2).max(500)).max(12),
  successMetrics: z.array(z.string().trim().min(2).max(500)).min(1).max(12),
  evidence: z.object({ searchVolume: z.number().nullable(), currentRank: z.number().nullable(), location: z.string(), competitors: z.array(z.string()).max(10), targetMarkets: z.array(z.string()).max(50) }),
});

type RankingPlan = z.infer<typeof rankingPlanSchema>;

const pageOptimizationSchema = z.object({
  keyword: z.string().trim().min(2).max(255),
  targetUrl: z.string().trim().max(512).nullable(),
  current: z.object({ title: z.string().nullable(), metaDescription: z.string().nullable(), h1: z.string().nullable(), wordCount: z.number().nullable() }),
  proposed: z.object({ title: z.string().trim().min(2).max(220), metaDescription: z.string().trim().min(20).max(320), h1: z.string().trim().min(2).max(220), callToAction: z.string().trim().min(2).max(300) }),
  keywordVariants: z.array(z.string().trim().min(2).max(255)).max(12),
  sections: z.array(z.object({ heading: z.string().trim().min(2).max(220), guidance: z.string().trim().min(2).max(1000) })).min(1).max(20),
  internalLinkActions: z.array(z.string().trim().min(2).max(500)).max(12),
  implementationChecklist: z.array(z.string().trim().min(2).max(500)).min(1).max(20),
});
type PageOptimization = z.infer<typeof pageOptimizationSchema>;

const seoPlanSchema = z.object({
  summary: z.string().trim().min(10).max(3000),
  objectives: z.array(z.string().trim().min(2).max(500)).min(1).max(12),
  keywordPriorities: z.array(z.string().trim().min(2).max(255)).min(1).max(30),
  technicalPriorities: z.array(z.string().trim().min(2).max(800)).max(30),
  contentRoadmap: z.array(z.string().trim().min(2).max(800)).max(30),
  localSeoActions: z.array(z.string().trim().min(2).max(800)).max(20),
  authorityActions: z.array(z.string().trim().min(2).max(800)).max(20),
  kpis: z.array(z.string().trim().min(2).max(500)).min(1).max(20),
  phases: z.object({
    now: z.array(z.string().trim().min(2).max(800)).min(1).max(20),
    next: z.array(z.string().trim().min(2).max(800)).max(20),
    later: z.array(z.string().trim().min(2).max(800)).max(20),
  }),
});
type SeoPlan = z.infer<typeof seoPlanSchema>;

const aiBusinessContextSchema = z.object({
  version: z.literal("ai_business_context_v1"),
  sourceFingerprint: z.string().trim().min(8).max(128),
  businessName: z.string().trim().min(2).max(180).nullable(),
  industry: z.string().trim().min(2).max(180),
  coreBusinessValue: z.string().trim().min(20).max(500),
  primaryServices: z.array(z.string().trim().min(2).max(180)).min(1).max(20),
  audienceSummary: z.string().trim().min(10).max(500),
  homepagePrimaryTopic: z.string().trim().min(2).max(180),
  brandDescription: z.string().trim().min(20).max(500),
  interpretationNotes: z.array(z.string().trim().min(5).max(300)).min(1).max(8),
  evidenceSources: z.array(z.string().trim().min(2).max(120)).min(1).max(10),
  requiresBusinessNameConfirmation: z.boolean(),
});
type AiBusinessContext = z.infer<typeof aiBusinessContextSchema>;
const rawAiBusinessContextSchema = z.object({
  businessName: z.string().nullable().optional(),
  industry: z.string(),
  coreBusinessValue: z.string(),
  primaryServices: z.array(z.string()),
  audienceSummary: z.string(),
  homepagePrimaryTopic: z.string(),
  brandDescription: z.string(),
  interpretationNotes: z.array(z.string()).optional().default([]),
  evidenceSources: z.array(z.string()).optional().default([]),
  requiresBusinessNameConfirmation: z.boolean().optional(),
}).passthrough();

const contentPlanSchema = z.object({
  workflowVersion: z.literal(CONTENT_PLAN_WORKFLOW_VERSION).optional(),
  summary: z.string().trim().min(10).max(3000),
  aiBusinessContext: aiBusinessContextSchema.optional(),
  keywordNormalization: z.object({
    version: z.literal("ai_keyword_semantics_v1"),
    mode: z.literal("ai_assisted"),
    reviewedCount: z.number().int().min(0),
    acceptedCount: z.number().int().min(0),
    deterministicProtectedCount: z.number().int().min(0),
  }).optional(),
  localSeo: z.object({ enabled: z.boolean(), targetLocations: z.array(z.string().trim().min(2).max(160)).max(20) }).default({ enabled: false, targetLocations: [] }),
  pageUpdates: z.array(z.string().trim().min(2).max(800)).min(1).max(500),
  keywordMapping: z.array(z.string().trim().min(2).max(1000)).min(1).max(500).default([]),
  pageMap: z.array(z.string().trim().min(2).max(1000)).min(1).max(500).default([]),
  planningChecks: z.array(z.string().trim().min(2).max(2400)).min(1).max(500).default([]),
  pageAssignments: z.array(z.object({
    canonicalKeyword: z.string().min(2).max(255),
    pageName: z.string().min(2).max(255),
    targetUrl: z.string().min(1).max(512),
    source: z.enum(["existing_crawl", "suggested"]),
    secondaryKeywords: z.array(z.string().max(255)).max(30),
    searchIntent: z.enum(["commercial", "transactional", "informational", "local", "navigational"]),
    pagePurpose: z.string().trim().min(2).max(800),
    gapAnalysis: z.string().trim().min(2).max(1200),
    recommendedAction: z.enum(["update_existing", "create_new", "consolidate", "support_only"]),
    pageKey: z.string().trim().min(1).max(180).optional(),
    parentPageId: z.string().trim().min(1).max(512).optional(),
    location: z.string().trim().min(2).max(160).optional(),
    clusterKey: z.string().trim().min(1).max(180).optional(),
    clusterRole: z.enum(["global", "location_hub", "service", "supporting", "resource", "neighbourhood"]).optional(),
    authorityScore: z.number().int().min(0).max(100).optional(),
    primaryIntent: z.string().trim().min(2).max(120).optional(),
    intentClusterId: z.string().trim().min(1).max(220).optional(),
    intentOwner: z.string().trim().min(1).max(500).optional(),
    locationLevel: z.enum(["country", "state_province", "region", "city", "neighbourhood"]).optional(),
    candidateScore: z.number().int().min(0).max(100).optional(),
    decisionReason: z.string().trim().min(2).max(1200).optional(),
    serviceAvailabilityVerified: z.boolean().optional(),
    localEvidenceIds: z.array(z.string().trim().min(1).max(220)).max(100).optional(),
    requiredInternalLinks: z.array(z.string().trim().min(1).max(512)).max(100).optional(),
    prohibitedCompetingKeywords: z.array(z.string().trim().min(1).max(255)).max(100).optional(),
    faqTopics: z.array(z.string().trim().min(2).max(500)).max(20).optional(),
    faqStrategyVersion: z.enum(["seo_plan_v1", "ai_seo_plan_v1", "ai_seo_plan_v2"]).optional(),
    seoTitle: z.string().trim().min(10).max(180).optional(),
    metaDescription: z.string().trim().min(40).max(320).optional(),
    contentOutline: z.array(z.string().trim().min(2).max(180)).min(3).max(12).optional(),
    contentBrief: z.string().trim().min(20).max(1500).optional(),
    supportingContentIdeas: z.array(z.string().trim().min(5).max(300)).min(2).max(6).optional(),
    proofRequirements: z.array(z.string().trim().min(5).max(300)).min(1).max(6).optional(),
    ctaSuggestion: z.string().trim().min(2).max(160).optional(),
  })).max(500).default([]),
  pagePlanningIntelligence: z.object({
    version: z.literal("v1"),
    normalizedKeywords: z.array(z.object({
      original: z.string(),
      normalized: z.string(),
      intent: z.string(),
      location: z.string().nullable(),
      normalizationSource: z.enum(["ai_assisted", "deterministic"]).optional(),
      semanticReason: z.string().nullable().optional(),
    })).max(1000),
    keywordClusters: z.array(z.object({ clusterId: z.string(), primaryKeyword: z.string(), secondaryKeywords: z.array(z.string()), searchIntent: z.string(), recommendedPageType: z.string(), parentClusterId: z.string().nullable(), targetAudience: z.string(), conversionGoal: z.string(), normalizedTopic: z.string() })).max(500),
    locationHierarchy: z.array(z.object({ locationId: z.string(), name: z.string(), level: z.enum(["country", "state_province", "region", "city", "neighbourhood"]), parentId: z.string().nullable(), physical: z.boolean(), serviceArea: z.boolean() })).max(500),
    approvedCandidates: z.array(z.record(z.unknown())).max(1000),
    rejectedCandidates: z.array(z.record(z.unknown())).max(1000),
    humanReviewCandidates: z.array(z.record(z.unknown())).max(1000),
    mergedCandidates: z.array(z.record(z.unknown())).max(1000),
    ownerMap: z.array(z.object({ ownerKey: z.string(), candidateId: z.string(), primaryKeyword: z.string(), location: z.string().nullable() })).max(1000),
    conflicts: z.array(z.record(z.unknown())).max(2000),
    navigation: z.array(z.record(z.unknown())).max(1000),
    internalLinks: z.array(z.record(z.unknown())).max(5000),
    rolloutPhases: z.array(z.object({ phase: z.number().int(), label: z.string(), candidateIds: z.array(z.string()) })).max(20),
    missingInputs: z.array(z.string()).max(100),
    maximumCombinations: z.number().int().min(0),
    recommendedTotalPages: z.number().int().min(0),
  }).default({
    version: "v1",
    normalizedKeywords: [],
    keywordClusters: [],
    locationHierarchy: [],
    approvedCandidates: [],
    rejectedCandidates: [],
    humanReviewCandidates: [],
    mergedCandidates: [],
    ownerMap: [],
    conflicts: [],
    navigation: [],
    internalLinks: [],
    rolloutPhases: [],
    missingInputs: [],
    maximumCombinations: 0,
    recommendedTotalPages: 0,
  }),
  locationAuthorityClusters: z.array(z.object({
    location: z.string().trim().min(2).max(160),
    clusterKey: z.string().trim().min(1).max(180),
    authorityScore: z.number().int().min(0).max(100),
    competitionLevel: z.enum(["low", "medium", "high"]),
    demandLevel: z.enum(["unknown", "low", "medium", "high"]),
    evidenceConfidence: z.enum(["limited", "moderate", "strong"]),
    requiredPageCount: z.number().int().min(2).max(40),
    hubPageKey: z.string().trim().min(1).max(180),
    servicePageKeys: z.array(z.string().trim().min(1).max(180)).min(1).max(20),
    supportingPageKeys: z.array(z.string().trim().min(1).max(180)).max(12),
    neighbourhoodPageKeys: z.array(z.string().trim().min(1).max(180)).max(20).default([]),
    rationale: z.string().trim().min(10).max(1200),
    schemaTypes: z.array(z.string().trim().min(2).max(80)).min(1).max(10),
    internalLinkRules: z.array(z.string().trim().min(5).max(500)).min(1).max(12),
  })).max(20).default([]),
  advancedSeoIntelligence: z.object({
    version: z.literal("v1"),
    engines: z.array(z.object({
      key: z.enum(["global_topical_authority", "local_authority", "entity_knowledge_graph", "search_intent", "competitive_gap", "semantic_coverage", "internal_link", "ai_citation_readiness", "brand_authority", "serp_features", "content_decay", "next_best_action"]),
      label: z.string().trim().min(2).max(120),
      status: z.enum(["ready", "limited", "awaiting_content", "awaiting_performance", "not_applicable"]),
      confidence: z.number().int().min(0).max(100),
      evidenceCount: z.number().int().min(0).max(100000),
      summary: z.string().trim().min(5).max(800),
      nextAction: z.string().trim().min(5).max(500),
    })).max(20),
  }).default({ version: "v1", engines: [] }),
  supportingContent: z.array(z.string().trim().min(2).max(800)).min(1).max(500),
  faqTopics: z.array(z.string().trim().min(2).max(500)).max(500),
  proofBlocks: z.array(z.string().trim().min(2).max(500)).max(20),
  contentBriefs: z.array(z.string().trim().min(2).max(1000)).min(1).max(500),
  publishingSequence: z.array(z.string().trim().min(2).max(800)).min(1).max(40),
  kpis: z.array(z.string().trim().min(2).max(500)).min(1).max(20),
  localSeoActions: z.array(z.string().trim().min(2).max(800)).max(500).default([]),
  workflowStages: z.array(z.string().trim().min(2).max(500)).min(1).max(12).default([]),
});
type ContentPlan = z.infer<typeof contentPlanSchema>;
const contentPlanSaveSchema = z.object({ plan: contentPlanSchema, reviewComment: z.string().trim().max(3000).optional().default("") });

function businessEvidenceFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function interpretApprovedBusinessEvidence(input: {
  confirmedBusinessName: string | null;
  projectName: string;
  niche: string | null;
  businessSummary: string | null;
  offerSummary: string | null;
  targetAudience: string | null;
  primaryGoal: string | null;
  targetLocations: string[];
  approvedKeywords: string[];
  verifiedServices: string[];
}) {
  const evidence = {
    confirmedBusinessName: input.confirmedBusinessName,
    internalProjectName: input.projectName,
    industryDirection: input.niche,
    rawBusinessSummary: input.businessSummary,
    rawOfferAnswer: input.offerSummary,
    rawAudienceAnswer: input.targetAudience,
    primaryGoal: input.primaryGoal,
    targetLocations: input.targetLocations,
    approvedKeywords: input.approvedKeywords,
    verifiedServices: input.verifiedServices,
  };
  const sourceFingerprint = businessEvidenceFingerprint(evidence);
  try {
    const generated = await centralAiJson({
      system: `You are the SENuke AI business-context interpreter. Convert approved project evidence into precise, customer-facing business context before SEO planning.

Raw intake wording is evidence, not publishable copy. Interpret the user's meaning, repair obvious speech-to-text or punctuation errors only when corroborated by other approved evidence, and organize service lists into clear service names. Never invent a business name, service, licence, credential, result, price, guarantee, or service area. The internal project name is never the business name unless it exactly matches a separately confirmed business/client name.`,
      prompt: `Return:
{
  "businessName": "confirmed public business name or null",
  "industry": "clear industry/category",
  "coreBusinessValue": "one polished sentence explaining what the business helps customers obtain or accomplish",
  "primaryServices": ["distinct approved service or product"],
  "audienceSummary": "clear customer-facing audience description",
  "homepagePrimaryTopic": "umbrella service/entity topic for the Home page; never the word Home and never the internal project name",
  "brandDescription": "concise description suitable as website-planning context",
  "interpretationNotes": ["important normalization or ambiguity decision"],
  "evidenceSources": ["short source label"],
  "requiresBusinessNameConfirmation": false
}

Approved evidence:
${JSON.stringify(evidence)}

Rules:
- If confirmedBusinessName is present, return it exactly as businessName and set requiresBusinessNameConfirmation to false.
- If it is absent, return businessName as null and set requiresBusinessNameConfirmation to true. Do not guess from internalProjectName.
- Do not repeat raw list fragments such as "and others" or turn them into keywords, headings, titles, descriptions, or services.
- Resolve ambiguous transcription only when another approved signal supports the correction. For example, do not retain "Vista" as a service when approved evidence clearly identifies Visitor Insurance, Travel Insurance, or Super Visa Insurance.
- primaryServices must contain clean, distinct service or product names, not sentences, locations, modifiers, or agency marketing services.
- coreBusinessValue must express customer value, not merely repeat a list of services.
- homepagePrimaryTopic must be the clearest umbrella commercial topic supported by the evidence.
- Keep evidenceSources as labels only; do not copy raw responses into them.`,
      temperature: 0.15,
      timeoutMs: 90_000,
    });
    const raw = rawAiBusinessContextSchema.parse(generated.result);
    const clean = (value: string, maximum: number) => value.replace(/\s+/g, " ").trim().slice(0, maximum);
    const primaryServices = [...new Set(raw.primaryServices
      .map((value) => clean(value, 180))
      .filter((value) => value.length >= 2 && !/^(?:and\s+)?others?\.?$/i.test(value)))]
      .slice(0, 20);
    const evidenceSources = [...new Set(raw.evidenceSources.map((value) => clean(value, 120)).filter((value) => value.length >= 2))];
    if (!evidenceSources.length) {
      if (input.niche) evidenceSources.push("Approved industry");
      if (input.offerSummary) evidenceSources.push("Approved offer");
      if (input.approvedKeywords.length) evidenceSources.push("Approved keywords");
      if (input.verifiedServices.length) evidenceSources.push("Verified services");
    }
    const interpretationNotes = raw.interpretationNotes
      .map((value) => clean(value, 300))
      .filter((value) => value.length >= 5)
      .slice(0, 8);
    if (!interpretationNotes.length) interpretationNotes.push("AI normalized the approved intake evidence for SEO planning.");
    return aiBusinessContextSchema.parse({
      version: "ai_business_context_v1",
      sourceFingerprint,
      businessName: input.confirmedBusinessName || null,
      industry: clean(raw.industry, 180),
      coreBusinessValue: clean(raw.coreBusinessValue, 500),
      primaryServices,
      audienceSummary: clean(raw.audienceSummary, 500),
      homepagePrimaryTopic: clean(raw.homepagePrimaryTopic, 180),
      brandDescription: clean(raw.brandDescription, 500),
      interpretationNotes,
      evidenceSources,
      requiresBusinessNameConfirmation: !input.confirmedBusinessName,
    });
  } catch (error) {
    if (error && typeof error === "object" && "publicMessage" in error) throw error;
    throw Object.assign(new Error("SEnuke AI could not interpret the approved business evidence. No raw intake wording was copied into the SEO plan. Retry after confirming the AI provider is available."), {
      statusCode: 502,
      code: "ai_business_context_invalid",
      publicMessage: true,
    });
  }
}

function reconcileContentPlanConflicts(plan: ContentPlan): ContentPlan {
  const assignmentsByKey = new Map(plan.pageAssignments.flatMap((assignment) => assignment.pageKey ? [[assignment.pageKey, assignment] as const] : []));
  const normalizeTarget = (value: string) => value.trim().toLocaleLowerCase().replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "") || "/";
  const seen = new Set<string>();
  const conflicts = plan.pagePlanningIntelligence.conflicts.filter((value) => {
    const ids = Array.isArray(value.conflictingPageIds) ? value.conflictingPageIds.filter((item): item is string => typeof item === "string") : [];
    const dedupeKey = [...ids].sort().join("::");
    if (!ids.length || seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    if (value.conflictType === "existing_page_overlap") {
      const assignment = assignmentsByKey.get(ids[0]);
      return Boolean(assignment && ids[1] && normalizeTarget(assignment.targetUrl) !== normalizeTarget(ids[1]));
    }
    const assignments = ids.flatMap((id) => {
      const assignment = assignmentsByKey.get(id);
      return assignment ? [assignment] : [];
    });
    if (assignments.length < 2) return false;
    const [left, right] = assignments;
    const sameScope = (left.location || "global").trim().toLocaleLowerCase() === (right.location || "global").trim().toLocaleLowerCase();
    const sameIntent = (left.primaryIntent || left.searchIntent).trim().toLocaleLowerCase() === (right.primaryIntent || right.searchIntent).trim().toLocaleLowerCase();
    return sameScope && sameIntent && keywordTopicSimilarity(left.canonicalKeyword, right.canonicalKeyword) >= 90;
  });
  return {
    ...plan,
    pagePlanningIntelligence: {
      ...plan.pagePlanningIntelligence,
      conflicts,
      recommendedTotalPages: plan.pageAssignments.length,
    },
  };
}

export function repairContentPlanPageIdentities(plan: ContentPlan): ContentPlan {
  const usedKeys = new Set<string>();
  const usedOwners = new Set<string>();
  const previousKeyByNewKey = new Map<string, string>();
  const pageAssignments = plan.pageAssignments.map((assignment, index) => {
    const previousKey = assignment.pageKey?.trim() || "";
    const baseSlug = assignment.targetUrl.replace(/^https?:\/\/[^/]+/i, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLocaleLowerCase()
      || assignment.canonicalKeyword.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLocaleLowerCase()
      || `page-${index + 1}`;
    let pageKey = previousKey || `page-${baseSlug}`;
    let suffix = 2;
    while (usedKeys.has(pageKey)) {
      pageKey = `page-${baseSlug}-${assignment.clusterRole || "owner"}`;
      if (usedKeys.has(pageKey)) pageKey = `page-${baseSlug}-${assignment.clusterRole || "owner"}-${suffix++}`;
    }
    usedKeys.add(pageKey);
    previousKeyByNewKey.set(pageKey, previousKey || pageKey);
    let intentOwner = assignment.intentOwner?.trim()
      || `${assignment.canonicalKeyword.toLocaleLowerCase()}::${assignment.primaryIntent || assignment.searchIntent}::${assignment.location?.toLocaleLowerCase() || "global"}`;
    if (usedOwners.has(intentOwner)) {
      intentOwner = `${assignment.canonicalKeyword.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}::${assignment.primaryIntent || assignment.searchIntent}::${assignment.location?.toLocaleLowerCase() || "global"}::${pageKey}`;
    }
    usedOwners.add(intentOwner);
    return { ...assignment, pageKey, intentOwner };
  });
  const targetKey = new Map(pageAssignments.map((assignment) => [
    assignment.targetUrl.trim().toLocaleLowerCase().replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "") || "/",
    assignment.pageKey!,
  ]));
  const candidateById = new Map(plan.pagePlanningIntelligence.approvedCandidates.map((candidate) => [String(candidate.candidateId || ""), candidate]));
  const approvedCandidates = pageAssignments.map((assignment) => {
    const previousKey = previousKeyByNewKey.get(assignment.pageKey!) || assignment.pageKey!;
    const template = candidateById.get(previousKey) ?? {};
    return {
      ...template,
      candidateId: assignment.pageKey,
      primaryKeyword: assignment.canonicalKeyword,
      secondaryKeywords: assignment.secondaryKeywords,
      primaryIntent: assignment.primaryIntent || assignment.searchIntent,
      intentClusterId: assignment.intentClusterId || assignment.clusterKey || assignment.pageKey,
      intentOwner: assignment.intentOwner,
      targetLocation: assignment.location || null,
      locationLevel: assignment.locationLevel || null,
      pagePurpose: assignment.pagePurpose,
      parentCandidateId: assignment.parentPageId
        ? targetKey.get(assignment.parentPageId.trim().toLocaleLowerCase().replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "") || "/") || null
        : null,
      slug: assignment.targetUrl,
      decision: "approved",
      decisionReason: assignment.decisionReason || assignment.gapAnalysis,
    };
  });
  const locationAuthorityClusters = plan.locationAuthorityClusters.map((cluster) => {
    const clusterPages = pageAssignments.filter((assignment) => assignment.clusterKey === cluster.clusterKey);
    const hubPageKey = clusterPages.find((assignment) => assignment.clusterRole === "location_hub")?.pageKey || cluster.hubPageKey;
    const servicePageKeys = clusterPages.filter((assignment) => assignment.clusterRole === "service").map((assignment) => assignment.pageKey!);
    const supportingPageKeys = clusterPages.filter((assignment) => assignment.clusterRole === "supporting" || assignment.clusterRole === "resource").map((assignment) => assignment.pageKey!);
    const neighbourhoodPageKeys = clusterPages.filter((assignment) => assignment.clusterRole === "neighbourhood").map((assignment) => assignment.pageKey!);
    return {
      ...cluster,
      hubPageKey,
      servicePageKeys,
      supportingPageKeys,
      neighbourhoodPageKeys,
      requiredPageCount: Math.max(2, new Set([hubPageKey, ...servicePageKeys, ...supportingPageKeys, ...neighbourhoodPageKeys]).size),
    };
  });
  const validKeys = new Set(pageAssignments.map((assignment) => assignment.pageKey!));
  const navigation = pageAssignments.map((assignment) => ({
    label: assignment.pageName,
    candidateId: assignment.pageKey,
    parentCandidateId: assignment.parentPageId
      ? targetKey.get(assignment.parentPageId.trim().toLocaleLowerCase().replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "") || "/") || null
      : null,
    mainMenu: ["global", "location_hub"].includes(assignment.clusterRole || "") || ["/", "/services/", "/about/", "/contact/"].includes(assignment.targetUrl),
  }));
  const internalLinks = plan.pagePlanningIntelligence.internalLinks.filter((link) => (
    validKeys.has(String(link.sourceCandidateId || ""))
    && validKeys.has(String(link.targetCandidateId || ""))
  ));
  return {
    ...plan,
    pageAssignments,
    locationAuthorityClusters,
    pagePlanningIntelligence: {
      ...plan.pagePlanningIntelligence,
      approvedCandidates,
      ownerMap: pageAssignments.map((assignment) => ({
        ownerKey: assignment.intentOwner!,
        candidateId: assignment.pageKey!,
        primaryKeyword: assignment.canonicalKeyword,
        location: assignment.location || null,
      })),
      navigation,
      internalLinks,
      rolloutPhases: plan.pagePlanningIntelligence.rolloutPhases.map((phase) => ({
        ...phase,
        candidateIds: phase.candidateIds.filter((candidateId) => validKeys.has(candidateId)),
      })),
      recommendedTotalPages: pageAssignments.length,
    },
  };
}

type ContentPlanHomeContext = {
  projectName: string;
  businessName?: string | null;
  offer?: string | null;
  websiteUrl?: string | null;
  websitePages?: Array<{ url: string; title: string | null }>;
};

function isHomePageAssignment(assignment: ContentPlan["pageAssignments"][number]) {
  const name = assignment.pageName.trim().toLocaleLowerCase();
  let target = assignment.targetUrl.trim();
  try { target = new URL(target, "https://senuke.local").pathname; } catch { /* use the saved target */ }
  return target.replace(/\/+$/, "") === "" || name === "home" || name === "homepage";
}

function defaultPageFaqTopics(assignment: ContentPlan["pageAssignments"][number]) {
  const topic = assignment.canonicalKeyword.trim() || assignment.pageName.trim();
  const location = assignment.location?.trim();
  const topicIncludesLocation = Boolean(location && topic.toLocaleLowerCase().includes(location.toLocaleLowerCase()));
  const localSuffix = location && !topicIncludesLocation ? ` in ${location}` : "";
  const secondaryKeyword = assignment.secondaryKeywords.find((keyword) => {
    const normalized = keyword.trim().toLocaleLowerCase();
    return normalized && normalized !== topic.toLocaleLowerCase() && normalized !== location?.toLocaleLowerCase();
  });
  const purpose = assignment.pagePurpose.toLocaleLowerCase();
  const decisionQuestion = /cost|price|budget|afford/i.test(purpose)
    ? `What factors affect the cost of ${topic}${localSuffix}?`
    : /compare|choose|evaluate|decision/i.test(purpose)
      ? `How should someone compare options for ${topic}${localSuffix}?`
      : /process|deliver|implement|apply|application/i.test(purpose)
        ? `What process should someone expect for ${topic}${localSuffix}?`
        : secondaryKeyword
          ? `What should buyers know about ${secondaryKeyword} when evaluating ${topic}?`
          : `What should someone consider before choosing ${topic}${localSuffix}?`;
  if (assignment.searchIntent === "navigational") return [
    "What services does the business provide?",
    secondaryKeyword ? `Who may benefit from ${secondaryKeyword}?` : "Who are the business's services designed to help?",
    location ? `Which services are available to customers in ${location}?` : "Which service should a visitor explore first?",
    "How can someone ask a question, request guidance, or get started?",
  ];
  if (assignment.searchIntent === "informational") return [
    `What is ${topic}${localSuffix}?`,
    secondaryKeyword ? `How does ${secondaryKeyword} relate to ${topic}?` : `Who should learn about ${topic}?`,
    `How does ${topic} work?`,
    decisionQuestion,
  ];
  if (assignment.searchIntent === "local" || location) return [
    `What does ${topic}${localSuffix} include?`,
    `Who is ${topic}${localSuffix} best suited for?`,
    `What local eligibility, availability, or service-area details should buyers confirm${location ? ` in ${location}` : ""}?`,
    decisionQuestion,
  ];
  return [
    `What does ${topic}${localSuffix} include?`,
    `Who is ${topic}${localSuffix} best suited for?`,
    decisionQuestion,
    assignment.searchIntent === "transactional"
      ? `How can someone get started with ${topic}${localSuffix}?`
      : `How should someone evaluate a ${topic} provider${localSuffix}?`,
  ];
}

const aiPageFaqPlanSchema = z.object({
  pages: z.array(z.object({
    targetUrl: z.string().trim().min(1).max(512),
    faqTopics: z.array(z.string().trim().min(8).max(300)).min(3).max(4),
    seoTitle: z.string().trim().min(10).max(180),
    metaDescription: z.string().trim().min(40).max(320),
    contentOutline: z.array(z.string().trim().min(2).max(180)).min(3).max(12),
    contentBrief: z.string().trim().min(20).max(1500),
    supportingContentIdeas: z.array(z.string().trim().min(8).max(240)).min(2).max(4),
    proofRequirements: z.array(z.string().trim().min(8).max(240)).min(1).max(4),
    ctaSuggestion: z.string().trim().min(3).max(120),
  })).max(100),
});

async function applyAiPageFaqSuggestions(plan: ContentPlan, context: {
  business: AiBusinessContext;
  goal: string;
  locations: string[];
}) {
  const assignments = plan.pageAssignments.filter((assignment) => (
    assignment.faqStrategyVersion !== "ai_seo_plan_v2"
    || (assignment.faqTopics?.length ?? 0) < 3
    || !assignment.seoTitle
    || !assignment.metaDescription
    || !assignment.contentOutline?.length
    || !assignment.contentBrief
    || !assignment.ctaSuggestion
  )).slice(0, 100);
  if (!assignments.length) return plan;
  try {
    const generatedPages: z.infer<typeof aiPageFaqPlanSchema>["pages"] = [];
    for (let start = 0; start < assignments.length; start += 8) {
      const assignmentBatch = assignments.slice(start, start + 8);
      const generated = await centralAiJson({
        system: "You are the SENuke AI SEO content planner. Create useful, natural FAQ topic suggestions from the approved keyword-to-page map. Never invent business facts, prices, credentials, guarantees, reviews, statistics, eligibility rules, or service availability.",
        prompt: `Return {"pages":[{"targetUrl":"exact supplied target URL","seoTitle":"unique SEO title","metaDescription":"unique search description","contentOutline":["4 to 8 page sections"],"contentBrief":"complete page-specific writing direction","supportingContentIdeas":["2 to 4 useful supporting assets"],"proofRequirements":["1 to 4 evidence requirements"],"ctaSuggestion":"page-specific conversion action","faqTopics":["3 or 4 question topics"]}]}.

Approved business evidence:
Confirmed business name: ${context.business.businessName || "Not confirmed; do not invent or use the internal project name"}
Industry: ${context.business.industry}
Core customer value: ${context.business.coreBusinessValue}
Approved primary services: ${context.business.primaryServices.join(", ")}
Audience: ${context.business.audienceSummary}
Home-page umbrella topic: ${context.business.homepagePrimaryTopic}
Brand context: ${context.business.brandDescription}
Primary goal: ${context.goal}
Approved target locations: ${context.locations.join(", ") || "none"}

Approved page assignments:
${JSON.stringify(assignmentBatch.map((assignment) => ({
  targetUrl: assignment.targetUrl,
  pageName: assignment.pageName,
  pageType: assignment.clusterRole || "page",
  primaryKeyword: assignment.canonicalKeyword,
  secondaryKeywords: assignment.secondaryKeywords,
  dominantIntent: assignment.primaryIntent || assignment.searchIntent,
  location: assignment.location || null,
  pagePurpose: assignment.pagePurpose,
  prohibitedCompetingKeywords: assignment.prohibitedCompetingKeywords || [],
})))}

Rules:
- Return 3 or 4 concise FAQ questions for every supplied page.
- Return one unique SEO title, one useful meta description, and a 4–8 section content outline for every page.
- Return a substantive page-specific content brief, useful supporting-content ideas, verified-evidence requirements, and an intent-matched CTA suggestion for every page.
- Questions must serve the exact page purpose, primary keyword, secondary cluster, dominant intent, audience, and approved location.
- Home at "/" is the primary brand and website-routing page. "Home" is never its keyword and must not become "Home in [city]". Use the approved business/brand as its primary entity, the umbrella service keyword as supporting direction, and make its title, description, outline, and FAQs introduce the offer, audience, service areas, trust, priority service routes, and main conversion step.
- Do not append a city when the primary keyword already contains that city.
- Do not repeat the same FAQ set across pages.
- Do not use "near me" as customer-facing wording.
- Do not copy rough intake fragments, internal project names, "and others", or ambiguous transcription into customer-facing copy.
- Treat the interpreted business context above as the customer-facing source; the page's approved keyword map still controls its search intent.
- Ask questions the page can answer from verified project evidence; do not assume unverified facts.
- Return topics only, without answers or explanations.`,
        temperature: 0.25,
        timeoutMs: 90_000,
      });
      const parsedBatch = aiPageFaqPlanSchema.parse(generated.result);
      const normalizedReturnedUrls = new Set(parsedBatch.pages.map((page) => page.targetUrl.trim().toLocaleLowerCase()));
      generatedPages.push(...parsedBatch.pages);
      const missingAssignments = assignmentBatch.filter((assignment) => !normalizedReturnedUrls.has(assignment.targetUrl.trim().toLocaleLowerCase()));
      if (missingAssignments.length) {
        const retry = await centralAiJson({
          system: "You are the SENuke AI SEO content planner completing pages omitted from a prior structured response. Return every supplied page exactly once. Never invent business facts, claims, prices, credentials, guarantees, reviews, statistics, eligibility rules, or service availability.",
          prompt: `Return {"pages":[{"targetUrl":"exact supplied target URL","seoTitle":"unique SEO title","metaDescription":"unique search description","contentOutline":["3 to 8 page sections"],"contentBrief":"complete page-specific writing direction","supportingContentIdeas":["2 to 4 useful supporting assets"],"proofRequirements":["1 to 4 evidence requirements"],"ctaSuggestion":"page-specific conversion action","faqTopics":["3 or 4 question topics"]}]}.

Business: ${context.business.businessName || "Business name not confirmed"}
Industry: ${context.business.industry}
Core customer value: ${context.business.coreBusinessValue}
Approved services: ${context.business.primaryServices.join(", ")}
Audience: ${context.business.audienceSummary}
Primary goal: ${context.goal}

You omitted these required pages. Return all ${missingAssignments.length} pages, using each targetUrl exactly:
${JSON.stringify(missingAssignments.map((assignment) => ({
  targetUrl: assignment.targetUrl,
  pageName: assignment.pageName,
  primaryKeyword: assignment.canonicalKeyword,
  secondaryKeywords: assignment.secondaryKeywords,
  dominantIntent: assignment.primaryIntent || assignment.searchIntent,
  location: assignment.location || null,
  pagePurpose: assignment.pagePurpose,
  prohibitedCompetingKeywords: assignment.prohibitedCompetingKeywords || [],
})))}`,
          temperature: 0.2,
          timeoutMs: 90_000,
        });
        const retryPages = aiPageFaqPlanSchema.parse(retry.result).pages;
        const retriedUrls = new Set(retryPages.map((page) => page.targetUrl.trim().toLocaleLowerCase()));
        const stillMissing = missingAssignments.filter((assignment) => !retriedUrls.has(assignment.targetUrl.trim().toLocaleLowerCase()));
        if (stillMissing.length) throw new Error(`AI omitted ${stillMissing.length} required page suggestion${stillMissing.length === 1 ? "" : "s"} after a focused retry.`);
        generatedPages.push(...retryPages);
      }
    }
    const parsed = aiPageFaqPlanSchema.parse({ pages: generatedPages });
    return {
      ...plan,
      pageAssignments: plan.pageAssignments.map((assignment) => {
        const suggestion = parsed.pages.find((page) => page.targetUrl.trim().toLocaleLowerCase() === assignment.targetUrl.trim().toLocaleLowerCase());
        return suggestion ? {
          ...assignment,
          faqTopics: suggestion.faqTopics,
          faqStrategyVersion: "ai_seo_plan_v2" as const,
          seoTitle: suggestion.seoTitle,
          metaDescription: suggestion.metaDescription,
          contentOutline: suggestion.contentOutline,
          contentBrief: suggestion.contentBrief,
          supportingContentIdeas: suggestion.supportingContentIdeas,
          proofRequirements: suggestion.proofRequirements,
          ctaSuggestion: suggestion.ctaSuggestion,
        } : assignment;
      }),
      contentBriefs: parsed.pages.flatMap((suggestion) => {
        const assignment = plan.pageAssignments.find((page) => page.targetUrl.trim().toLocaleLowerCase() === suggestion.targetUrl.trim().toLocaleLowerCase());
        return assignment ? [`AI brief for “${assignment.canonicalKeyword}” · ${suggestion.contentBrief}`] : [];
      }).slice(0, 500),
      supportingContent: parsed.pages.flatMap((suggestion) => {
        const assignment = plan.pageAssignments.find((page) => page.targetUrl.trim().toLocaleLowerCase() === suggestion.targetUrl.trim().toLocaleLowerCase());
        return assignment ? suggestion.supportingContentIdeas.map((idea) => `“${assignment.canonicalKeyword}” → ${idea}`) : [];
      }).slice(0, 500),
    };
  } catch (error) {
    if (error && typeof error === "object" && "publicMessage" in error) throw error;
    const diagnostic = error instanceof z.ZodError
      ? error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`).join("; ")
      : error instanceof Error ? error.message : "Unknown AI response error";
    console.error("[content-plan] AI page suggestion validation failed:", diagnostic);
    throw Object.assign(new Error(`SEnuke AI could not create the page content suggestions. No generic fallback was applied. ${diagnostic}`), {
      statusCode: 502,
      code: "ai_content_plan_invalid",
      publicMessage: true,
    });
  }
}

function ensureContentPlanHome(plan: ContentPlan, context: ContentPlanHomeContext): ContentPlan {
  const currentHome = plan.pageAssignments.find(isHomePageAssignment);
  const otherPages = plan.pageAssignments.filter((assignment) => !isHomePageAssignment(assignment));
  // projectName is an internal workspace label. It must never become public
  // website copy when a business identity has not been confirmed.
  const businessName = context.businessName?.trim() || context.offer?.trim() || "Business services";
  const homePrimaryKeyword = currentHome?.canonicalKeyword?.trim()
    || context.offer?.trim()
    || businessName;
  const mainService = otherPages.find((assignment) => ["commercial", "transactional", "local"].includes(assignment.searchIntent))?.canonicalKeyword
    || context.offer?.trim()
    || "";
  const rootPageExists = currentHome?.source === "existing_crawl" || (context.websitePages ?? []).some((page) => {
    try { return new URL(page.url, context.websiteUrl || "https://senuke.local").pathname.replace(/\/+$/, "") === ""; } catch { return page.url.trim() === "/"; }
  });
  const secondaryKeywords = [...new Set([
    ...(currentHome?.secondaryKeywords ?? []),
    mainService,
  ].map((value) => value.trim()).filter((value) => value && value.toLocaleLowerCase() !== homePrimaryKeyword.toLocaleLowerCase()))];
  const homeNeedsFaqRefresh = Boolean(
    !currentHome
    || currentHome.pageName.trim() !== "Home"
    || currentHome.canonicalKeyword.trim() !== homePrimaryKeyword
    || currentHome.location,
  );
  const generatedHomeTitle = businessName.toLocaleLowerCase() !== homePrimaryKeyword.toLocaleLowerCase()
    ? `${homePrimaryKeyword} | ${businessName}`
    : `${businessName} | Official Website`;
  const {
    location: _discardedHomeLocation,
    locationLevel: _discardedHomeLocationLevel,
    clusterKey: _discardedHomeClusterKey,
    parentPageId: _discardedHomeParent,
    ...currentHomeBase
  } = currentHome ?? {};
  const home: ContentPlan["pageAssignments"][number] = {
    ...currentHomeBase,
    canonicalKeyword: homePrimaryKeyword,
    pageName: "Home",
    targetUrl: "/",
    source: currentHome?.source === "existing_crawl" || rootPageExists ? "existing_crawl" : "suggested",
    secondaryKeywords,
    searchIntent: "commercial",
    pagePurpose: "Introduce the business and its primary value, summarize approved services, establish trust, and route visitors to the most important service, location, proof, and conversion pages.",
    gapAnalysis: rootPageExists
      ? "The website root is the required Home page. Review its positioning, service routes, proof, metadata, schema, internal links, and primary conversion action."
      : "Every website requires one Home page at the root URL. It must summarize the approved offer without competing with dedicated service or location pages.",
    recommendedAction: rootPageExists ? "update_existing" : "create_new",
    clusterRole: "global",
    seoTitle: currentHome?.seoTitle?.trim() || generatedHomeTitle.slice(0, 70),
    metaDescription: currentHome?.metaDescription?.trim() || `${businessName} helps its approved audience understand ${homePrimaryKeyword}, compare the right next step, and request guidance.`.slice(0, 180),
    contentOutline: currentHome?.contentOutline?.length ? currentHome.contentOutline : ["Primary value and audience", "Core services", "Why choose the business", "Service areas", "Verified proof and trust", "Frequently asked questions", "Primary conversion action"],
    ...(homeNeedsFaqRefresh ? { faqTopics: undefined, faqStrategyVersion: undefined } : {}),
  };
  const pageAssignments = [home, ...otherPages].slice(0, 500).map((assignment) => ({
    ...assignment,
    faqTopics: assignment.faqStrategyVersion === "ai_seo_plan_v2" && assignment.faqTopics?.length ? assignment.faqTopics : defaultPageFaqTopics(assignment),
    faqStrategyVersion: assignment.faqStrategyVersion === "ai_seo_plan_v2" ? "ai_seo_plan_v2" as const : "seo_plan_v1" as const,
  }));
  const homeUpdate = `${rootPageExists ? "Update" : "Create"} Home page: target “${homePrimaryKeyword}”, introduce ${businessName}, establish trust, and route visitors to priority pages.`;
  const pageUpdates = [homeUpdate, ...plan.pageUpdates.filter((item) => !/^((create|update|optimize).*)?\bhome\s*page\b/i.test(item))].slice(0, 500);
  const homeMapping = `Home → / · Primary umbrella intent: “${home.canonicalKeyword}” · Brand: “${businessName}”${secondaryKeywords.length ? ` · Supporting direction: ${secondaryKeywords.map((keyword) => `“${keyword}”`).join(", ")}` : ""}`;
  const keywordMapping = [homeMapping, ...plan.keywordMapping.filter((item) => !/^\s*home\s*(?:→|:|\|)/i.test(item))].slice(0, 500);
  const pageMap = pageAssignments.map((assignment) => `${assignment.pageName} → ${assignment.targetUrl} · ${assignment.recommendedAction.replaceAll("_", " ")} · ${assignment.searchIntent} intent`);
  const homeCheck = "Home · / · Confirm the brand proposition, primary service routes, proof, conversion action, metadata, Organization schema, and internal links.";
  const planningChecks = [homeCheck, ...plan.planningChecks.filter((item) => !/^\s*home\s*(?:·|→|:|\|)/i.test(item))].slice(0, 500);
  return { ...plan, pageAssignments, pageUpdates, keywordMapping, pageMap, planningChecks };
}

function contentPlanHasUnnormalizedOwners(plan: ContentPlan, markets: string[]) {
  const systemTarget = (assignment: ContentPlan["pageAssignments"][number]) => {
    const target = assignment.targetUrl.trim().toLocaleLowerCase().replace(/\/+$/, "") || "/";
    return target === "/"
      || /^\/(?:about(?:-us)?|contact(?:-us)?|privacy-policy|terms|services|locations)$/.test(target)
      || ["home", "location_hub"].includes(assignment.clusterRole ?? "");
  };
  const groups = new Map<string, ContentPlan["pageAssignments"]>();
  for (const assignment of plan.pageAssignments) {
    if (systemTarget(assignment)) continue;
    const keyword = assignment.canonicalKeyword.trim();
    if (stripNonGeographicAudienceQualifier(keyword).toLocaleLowerCase() !== keyword.toLocaleLowerCase()) return true;
    const intentFamily = assignment.searchIntent === "informational"
      ? "informational"
      : /\b(vs\.?|versus|compare|comparison|alternative)\b/i.test(keyword)
        ? "comparison"
        : "commercial";
    const scope = assignment.location?.trim().toLocaleLowerCase() || "global";
    const key = `${scope}::${intentFamily}`;
    groups.set(key, [...(groups.get(key) ?? []), assignment]);
  }
  return [...groups.values()].some((assignments) => {
    if (assignments.length < 2) return false;
    const clusters = clusterKeywordDirections(assignments.map((assignment) => assignment.canonicalKeyword), markets);
    return clusters.length < assignments.length;
  });
}

function firstJsonString(value: unknown) {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === "string") ?? null : typeof value === "string" ? value : null;
}

function recordJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function jsonStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function seoPlanFor(input: {
  projectName: string;
  primaryGoal: string | null;
  secondaryGoals: string[];
  targetMarkets: string[];
  keywords: string[];
  niche: string | null;
  offer: string | null;
  seoStrategy: string | null;
  localSeoStrategy: string | null;
  contentStrategy: string | null;
  authorityStrategy: string | null;
  crawlIssues: string[];
  hasWebsite: boolean;
}): SeoPlan {
  const shorten = (value: string, max: number) => value.trim().slice(0, max);
  const keywords = [...new Set(input.keywords)].slice(0, 20);
  const markets = input.targetMarkets.slice(0, 8);
  const focus = input.offer || input.niche || input.projectName;
  const objectives = [...new Set([input.primaryGoal, ...input.secondaryGoals].filter((item): item is string => Boolean(item)))];
  const technical = input.hasWebsite
    ? [...new Set([...input.crawlIssues.map((item) => shorten(item, 800)), "Validate indexability, canonical tags, sitemap, robots directives, schema, Core Web Vitals, and internal links."])].slice(0, 15)
    : ["Validate the planned URL structure, metadata templates, schema, internal linking, sitemap, and indexability before launch."];
  const contentRoadmap = [
    `${input.hasWebsite ? "Review and optimize" : "Create"} the required Home page at / for the business's brand and umbrella offer, with clear routes to priority service, location, proof, and conversion pages.`,
    ...keywords.slice(0, 8).map((keyword) => `Map “${keyword}” to one primary target page and supporting content; avoid cannibalization.`),
  ];
  if (input.contentStrategy) contentRoadmap.unshift(shorten(input.contentStrategy, 800));
  const localActions = markets.length
    ? [`Create or improve location relevance for ${markets.join(", ")}.`, "Align service-area pages, Google Business Profile, citations, reviews, and local schema without duplicating pages.", ...(input.localSeoStrategy ? [shorten(input.localSeoStrategy, 800)] : [])]
    : [];
  return {
    summary: shorten(input.seoStrategy || `Prioritize search visibility and qualified conversions for ${focus}, using approved keywords, project goals, target markets, and available website evidence.`, 3000),
    objectives: objectives.length ? objectives : ["Increase qualified organic visibility and conversions"],
    keywordPriorities: keywords.length ? keywords : [`${focus} services`],
    technicalPriorities: technical,
    contentRoadmap: contentRoadmap.length ? contentRoadmap : [`Create a primary service page for ${focus}`, "Create supporting educational content for the audience's highest-value questions"],
    localSeoActions: localActions,
    authorityActions: [shorten(input.authorityStrategy || "Build relevant authority with original proof, expert content, citations, partnerships, and earned backlinks.", 800), "Strengthen entity and AI-citation signals with clear authorship, organization data, sources, and structured answers."],
    kpis: ["Qualified organic traffic", "Priority keyword visibility", "Organic leads or conversions", "Indexed target pages", "Critical technical issues resolved"],
    phases: {
      now: [input.hasWebsite ? "Resolve critical and high-impact crawl issues" : "Approve the SEO-ready site architecture", "Map approved keywords to target pages", "Confirm measurement and conversion tracking"],
      next: ["Create or optimize priority commercial pages", "Publish supporting content and improve internal links", ...(markets.length ? ["Complete local SEO foundation for priority markets"] : [])],
      later: ["Build authority and citations", "Refresh decaying content and resolve cannibalization", "Review performance and reprioritize the plan"],
    },
  };
}

export function contentPlanFor(input: {
  projectName: string;
  businessName: string | null;
  goal: string | null;
  markets: string[];
  keywords: string[];
  offer: string | null;
  audience: string | null;
  contentStrategy: string | null;
  websiteUrl: string | null;
  localSeoEnabled: boolean;
  websitePages: Array<{ url: string; title: string | null }>;
  keywordSignals?: Array<{ keyword: string; location: string; searchVolume: number | null; competitionIndex: number | null; competitorCount: number }>;
  businessType?: string | null;
  services?: string[];
  products?: string[];
  targetCountry?: string | null;
  targetStateProvince?: string | null;
  locationInputs?: SeoPlannerInput["locations"];
  physicalLocations?: string[];
  serviceAvailability?: SeoPlannerInput["serviceAvailability"];
  competitors?: string[];
  localEvidence?: SeoPlannerInput["localEvidence"];
  semanticKeywords?: SeoPlannerInput["semanticKeywords"];
}) : ContentPlan {
  const focus = input.offer || input.projectName;
  const keywords = input.keywords.filter((keyword, index, all) => all.findIndex((candidate) => candidate.trim().toLocaleLowerCase() === keyword.trim().toLocaleLowerCase()) === index).slice(0, 12);
  const market = input.markets.slice(0, 5).join(", ");
  const audience = input.audience || "the project's priority audience";
  const pageAction = input.websiteUrl ? "Update best-matched page" : "Create primary page";
  const marketTokens = new Set(input.markets.flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/)).filter((value) => value.length > 2));
  const weakModifiers = new Set(["best", "top", "leading", "affordable", "cheap", "cheapest", "budget", "economical", "trusted", "reputable", "recommended", "rated", "local", "near", "nearby", "closest", "around", "me", "my", "area", "service", "services", "solution", "solutions", "review", "reviews", "rating", "ratings", ...marketTokens]);
  const providerRoleAliases: Record<string, string> = { agent: "provider", agents: "provider", broker: "provider", brokers: "provider", advisor: "provider", advisors: "provider", adviser: "provider", advisers: "provider", professional: "provider", professionals: "provider", specialist: "provider", specialists: "provider", company: "provider", companies: "provider", agency: "provider", agencies: "provider", provider: "provider", providers: "provider" };
  const meaningfulTokens = (keyword: string) => keyword.toLowerCase().split(/[^a-z0-9]+/).map((token) => providerRoleAliases[token] ?? token).filter((token) => token.length > 1 && !weakModifiers.has(token));
  const intentClass = (keyword: string) => /\b(vs\.?|versus|compare|comparison|alternative|alternatives)\b/i.test(keyword)
    ? "comparison"
    : /^(what|why|when|where|who|how|can|does|do|is|are|should)\b|\b(cost|price|pricing|guide|benefits|process|timeline|checklist)\b/i.test(keyword)
      ? "informational"
      : "commercial";
  const stripPageQueryModifiers = (value: string) => value
    .replace(/\b(near\s+me|around\s+me|close\s+to\s+me|in\s+my\s+area)\b/gi, "")
    .replace(/^\s*(best|top(?:[-\s]+rated)?|leading|affordable|cheap(?:est)?|budget|economical|trusted|reputable|recommended|local|closest|nearby)\s+/i, "")
    .replace(/\s+(reviews?|ratings?)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const stripApprovedMarket = (value: string) => input.markets.reduce((current, location) => {
    const escaped = location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return current
      .replace(new RegExp(`\\b(?:in|near|for|serving)?\\s*${escaped}\\b`, "gi"), "")
      .replace(/\s+/g, " ")
      .trim();
  }, stripPageQueryModifiers(value));
  const clusters: string[][] = [];
  for (const keyword of keywords) {
    const tokens = new Set(meaningfulTokens(keyword));
    const match = clusters.find((cluster) => {
      if (intentClass(keyword) !== intentClass(cluster[0])) return false;
      const representative = new Set(meaningfulTokens(cluster[0]));
      const overlap = [...tokens].filter((token) => representative.has(token)).length;
      return overlap >= 1 && overlap / Math.max(1, Math.max(tokens.size, representative.size)) >= 0.66;
    });
    if (match) match.push(keyword); else clusters.push([keyword]);
  }
  const canonicalKeyword = (cluster: string[]) => {
    const selected = [...cluster].sort((a, b) => {
    const penalty = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => weakModifiers.has(token)).length * 20;
    return (penalty(a) - meaningfulTokens(a).length) - (penalty(b) - meaningfulTokens(b).length) || a.length - b.length;
    })[0];
    // “Near me” is a valuable local query modifier, but never a literal page
    // name or URL. Keep the original phrase as a secondary variant and use a
    // real service/location topic as the canonical page target.
    return stripPageQueryModifiers(selected) || selected;
  };
  const pageUpdates = clusters.slice(0, 12).map((cluster) => {
    const primary = canonicalKeyword(cluster);
    const variants = cluster.filter((keyword) => keyword !== primary);
    return `${pageAction}: “${primary}”${variants.length ? ` · Also target: ${variants.map((keyword) => `“${keyword}”`).join(", ")}` : ""}`;
  });
  const keywordMapping = clusters.map((cluster, index) => {
    const primary = canonicalKeyword(cluster);
    const variants = cluster.filter((keyword) => keyword !== primary);
    return `Cluster ${index + 1}: “${primary}” → one target page${variants.length ? ` · Variants: ${variants.map((keyword) => `“${keyword}”`).join(", ")}` : ""}`;
  });
  const rootUrl = input.websiteUrl?.replace(/\/$/, "") ?? "[website URL]";
  const titleCase = (value: string) => value.replace(/\b\w/g, (letter) => letter.toUpperCase());
  const globalPageAssignments = clusters.map((cluster) => {
    const primary = canonicalKeyword(cluster);
    const slug = primary.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const variants = cluster.filter((keyword) => keyword !== primary);
    const tokens = meaningfulTokens(primary);
    const location = input.markets.find((item) => primary.toLowerCase().includes(item.toLowerCase())) ?? null;
    const localIntent = Boolean(location) || cluster.some((keyword) => /\b(near\s+me|around\s+me|close\s+to\s+me|in\s+my\s+area|nearby|closest|local)\b/i.test(keyword));
    const informationalIntent = /\b(how|what|why|guide|cost|compare|versus|vs)\b/i.test(primary);
    const searchIntent = localIntent ? "local" as const : informationalIntent ? "informational" as const : "commercial" as const;
    const keywordLocations = input.markets.filter((item) => primary.toLowerCase().includes(item.toLowerCase()));
    const existing = [...input.websitePages].map((page) => {
      const pageText = `${page.url} ${page.title ?? ""}`.toLowerCase();
      const isBlogPage = /\/blog(?:\/|$)/i.test(page.url);
      const locationMatches = !localIntent || keywordLocations.some((item) => pageText.includes(item.toLowerCase()));
      const pageTypeMatches = informationalIntent || !isBlogPage;
      const score = tokens.filter((token) => pageText.includes(token)).length;
      return { page, score, eligible: locationMatches && pageTypeMatches };
    }).filter((candidate) => candidate.eligible).sort((a, b) => b.score - a.score)[0];
    const useExisting = Boolean(tokens.length > 0 && existing && existing.score >= Math.min(2, tokens.length));
    const recommendedAction = useExisting ? (variants.length ? "consolidate" as const : "update_existing" as const) : "create_new" as const;
    return {
      canonicalKeyword: primary,
      pageName: useExisting ? existing!.page.title || titleCase(primary) : `${titleCase(primary)}${location ? ` in ${location}` : ""}`,
      targetUrl: useExisting ? existing!.page.url : input.websiteUrl ? `${rootUrl}/${slug}` : `/${slug}${location ? `-${location.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : ""}`,
      source: useExisting ? "existing_crawl" as const : "suggested" as const,
      secondaryKeywords: variants,
      searchIntent,
      pagePurpose: searchIntent === "informational" ? `Answer the buyer question behind “${primary}” and route qualified visitors to the primary commercial page.` : `Convert visitors searching for “${primary}” with clear service fit, proof, FAQs, and a relevant next action.`,
      gapAnalysis: useExisting ? `The crawl found a likely target page. Review its intent alignment, metadata, topical depth, proof, FAQs, internal links, schema, and conversion path before AI drafting.` : `No sufficiently matched crawled page was found. Validate the proposed URL, uniqueness, local evidence where applicable, internal-link role, and cannibalization risk before creating it.`,
      recommendedAction,
      pageKey: `global-${slug}`,
      clusterKey: "global",
      clusterRole: "global" as const,
    };
  }).filter((assignment) => assignment.searchIntent !== "local");
  const slugFor = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";
  const coreServices = clusters
    .filter((cluster) => intentClass(canonicalKeyword(cluster)) === "commercial")
    .map((cluster) => stripApprovedMarket(canonicalKeyword(cluster)))
    .filter((keyword) => keyword.length >= 2)
    .filter((keyword, index, all) => all.findIndex((candidate) => candidate.toLocaleLowerCase() === keyword.toLocaleLowerCase()) === index);
  if (!coreServices.length) coreServices.push(stripApprovedMarket(focus) || focus);
  const pagePlanningIntelligence: SeoPagePlan = planSeoPages({
    businessName: input.businessName?.trim() || input.businessType?.trim() || focus,
    businessType: input.businessType ?? null,
    homepagePrimaryTopic: input.offer,
    services: input.services?.length ? input.services : coreServices,
    products: input.products ?? [],
    keywords,
    locations: input.locationInputs?.length
      ? input.locationInputs
      : input.markets.map((name) => ({ name, level: "city" as const, serviceArea: true })),
    targetCountry: input.targetCountry ?? null,
    targetStateProvince: input.targetStateProvince ?? null,
    physicalLocations: input.physicalLocations ?? [],
    serviceAvailability: input.serviceAvailability ?? [],
    conversionGoal: input.goal,
    competitors: input.competitors ?? [],
    keywordSignals: input.keywordSignals,
    semanticKeywords: input.semanticKeywords,
    existingPages: input.websitePages.map((page) => ({ url: page.url, title: page.title })),
    localEvidence: input.localEvidence ?? [],
  });
  const approvedPlannerCandidates = pagePlanningIntelligence.approvedCandidates;
  const plannerTopicMatchScore = (candidateKeyword: string, service: string) => {
    const candidateTokens = new Set(meaningfulTokens(stripApprovedMarket(candidateKeyword)));
    const serviceTokens = new Set(meaningfulTokens(stripApprovedMarket(service)));
    if (!candidateTokens.size || !serviceTokens.size) return 0;
    const overlap = [...candidateTokens].filter((token) => serviceTokens.has(token)).length;
    const tokenScore = overlap / Math.max(candidateTokens.size, serviceTokens.size);
    const candidateTopic = [...candidateTokens].sort().join(" ");
    const serviceTopic = [...serviceTokens].sort().join(" ");
    return candidateTopic === serviceTopic ? 2 : tokenScore;
  };
  const approvedGlobalPlannerCandidates = approvedPlannerCandidates.filter((candidate) => !candidate.targetLocation);
  const candidateTargetById = new Map(approvedPlannerCandidates.map((candidate) => [candidate.candidateId, candidate.slug]));
  const governedGlobalPageAssignments: ContentPlan["pageAssignments"] = approvedGlobalPlannerCandidates.map((candidate) => {
    const legacyMatch = globalPageAssignments
      .map((assignment) => {
        const left = new Set(meaningfulTokens(assignment.canonicalKeyword));
        const right = new Set(meaningfulTokens(candidate.primaryKeyword));
        const overlap = [...left].filter((token) => right.has(token)).length;
        return { assignment, score: overlap / Math.max(1, left.size, right.size) };
      })
      .sort((left, right) => right.score - left.score)[0];
    const exactExisting = input.websitePages.find((page) => {
      try {
        const candidatePath = new URL(candidate.slug, input.websiteUrl || "https://senuke.local").pathname.replace(/\/+$/, "") || "/";
        const pagePath = new URL(page.url, input.websiteUrl || "https://senuke.local").pathname.replace(/\/+$/, "") || "/";
        return candidatePath === pagePath;
      } catch {
        return page.url === candidate.slug;
      }
    });
    const useLegacy = Boolean(legacyMatch && legacyMatch.score >= 0.66);
    const targetUrl = exactExisting?.url ?? (useLegacy ? legacyMatch!.assignment.targetUrl : candidate.slug);
    const source = exactExisting || (useLegacy && legacyMatch!.assignment.source === "existing_crawl")
      ? "existing_crawl" as const
      : "suggested" as const;
    const label = candidate.pageType === "home" ? "Home"
      : candidate.pageType === "category_hub" ? "Services"
        : candidate.pageType === "trust" ? "About Us"
          : candidate.pageType === "conversion" ? "Contact Us"
            : candidate.pageType === "legal" && candidate.slug.includes("privacy") ? "Privacy Policy"
              : titleCase(candidate.primaryKeyword);
    const searchIntent = candidate.primaryIntent === "informational" || candidate.primaryIntent === "support_faq"
      ? "informational" as const
      : candidate.primaryIntent === "transactional"
        ? "transactional" as const
        : candidate.primaryIntent === "brand" || candidate.primaryIntent === "navigational"
          ? "navigational" as const
          : "commercial" as const;
    return {
      canonicalKeyword: candidate.primaryKeyword,
      pageName: label,
      targetUrl,
      source,
      secondaryKeywords: candidate.secondaryKeywords,
      searchIntent,
      pagePurpose: candidate.pagePurpose,
      gapAnalysis: source === "existing_crawl"
        ? "An existing URL matches this approved intent owner. Improve that page instead of creating a competing URL."
        : candidate.decisionReason,
      recommendedAction: source === "existing_crawl" ? "update_existing" as const : "create_new" as const,
      pageKey: candidate.candidateId,
      parentPageId: candidate.parentCandidateId ? candidateTargetById.get(candidate.parentCandidateId) : undefined,
      clusterKey: candidate.intentClusterId,
      clusterRole: "global" as const,
      authorityScore: candidate.score.total,
      primaryIntent: candidate.primaryIntent,
      intentClusterId: candidate.intentClusterId,
      intentOwner: candidate.intentOwner,
      candidateScore: candidate.score.total,
      decisionReason: candidate.decisionReason,
      serviceAvailabilityVerified: candidate.serviceAvailabilityVerified,
      localEvidenceIds: candidate.localEvidenceIds,
      requiredInternalLinks: candidate.requiredInternalLinks,
      prohibitedCompetingKeywords: candidate.prohibitedCompetingKeywords,
    };
  });
  const findExistingLocalPage = (keyword: string, location: string, informational = false) => {
    const serviceTokens = meaningfulTokens(keyword);
    const locationToken = location.toLocaleLowerCase();
    return input.websitePages
      .map((page) => {
        const text = `${page.url} ${page.title ?? ""}`.toLocaleLowerCase();
        const serviceScore = serviceTokens.filter((token) => text.includes(token)).length;
        const score = serviceScore + (text.includes(locationToken) ? 3 : 0);
        const eligible = text.includes(locationToken) && (informational || !/\/blog(?:\/|$)/i.test(page.url));
        return { page, score, serviceScore, eligible };
      })
      .filter((candidate) => candidate.eligible)
      .sort((left, right) => right.score - left.score)[0];
  };
  const findExistingLocationHub = (location: string) => {
    const locationToken = location.toLocaleLowerCase();
    return input.websitePages
      .map((page) => {
        const text = `${page.url} ${page.title ?? ""}`.toLocaleLowerCase();
        const path = (() => {
          try { return new URL(page.url, "https://senuke.local").pathname.toLocaleLowerCase(); }
          catch { return page.url.toLocaleLowerCase(); }
        })();
        const explicitHub = /(?:service[-\s]?area|areas?[-\s]?we[-\s]?serve|locations?|coverage[-\s]?area)/i.test(text)
          || path.replace(/\/+$/, "").endsWith(`/${slugFor(location)}`);
        return { page, score: (text.includes(locationToken) ? 3 : 0) + (explicitHub ? 4 : 0), eligible: text.includes(locationToken) && explicitHub };
      })
      .filter((candidate) => candidate.eligible)
      .sort((left, right) => right.score - left.score)[0];
  };
  const signalFor = (location: string) => (input.keywordSignals ?? []).filter((signal) => !signal.location || signal.location.toLocaleLowerCase().includes(location.toLocaleLowerCase()));
  const locationAuthorityClusters: ContentPlan["locationAuthorityClusters"] = [];
  const locationAssignments: ContentPlan["pageAssignments"] = [];
  const locationSupportingContent: string[] = [];
  const locationBriefs: string[] = [];
  const locationFaqs: string[] = [];
  const locationActions: string[] = [];
  for (const location of input.localSeoEnabled ? input.markets : []) {
    const locationSlug = slugFor(location);
    const clusterKey = `location-${locationSlug}`;
    const signals = signalFor(location);
    const volumes = signals.map((signal) => signal.searchVolume).filter((value): value is number => typeof value === "number");
    const competitions = signals.map((signal) => signal.competitionIndex).filter((value): value is number => typeof value === "number");
    const averageVolume = volumes.length ? volumes.reduce((total, value) => total + value, 0) / volumes.length : null;
    const averageCompetition = competitions.length ? competitions.reduce((total, value) => total + value, 0) / competitions.length : null;
    const competitorCount = Math.max(0, ...signals.map((signal) => signal.competitorCount));
    const demandLevel = averageVolume == null ? "unknown" as const : averageVolume >= 1000 ? "high" as const : averageVolume >= 150 ? "medium" as const : "low" as const;
    const competitionLevel = averageCompetition != null
      ? averageCompetition >= 65 ? "high" as const : averageCompetition >= 35 ? "medium" as const : "low" as const
      : competitorCount >= 10 ? "high" as const : competitorCount >= 5 ? "medium" as const : "low" as const;
    const evidenceConfidence = signals.length >= 8 ? "strong" as const : signals.length >= 3 ? "moderate" as const : "limited" as const;
    const authorityScore = Math.min(100,
      30
      + (demandLevel === "high" ? 25 : demandLevel === "medium" ? 16 : demandLevel === "low" ? 8 : 10)
      + (competitionLevel === "high" ? 25 : competitionLevel === "medium" ? 15 : 8)
      + Math.min(20, coreServices.length * 3),
    );
    const supportingCount = approvedPlannerCandidates.filter((candidate) =>
      candidate.targetLocation?.toLocaleLowerCase() === location.toLocaleLowerCase()
      && ["resource", "faq", "comparison"].includes(candidate.pageType),
    ).length;
    const hubUrl = `/locations/${locationSlug}`;
    const hubExisting = findExistingLocationHub(location);
    const hubTarget = input.websiteUrl && hubExisting?.score && hubExisting.score >= 3 ? hubExisting.page.url : hubUrl;
    const approvedHubCandidate = approvedPlannerCandidates.find((candidate) => candidate.pageType === "location_hub" && candidate.targetLocation?.toLocaleLowerCase() === location.toLocaleLowerCase());
    if (!approvedHubCandidate) {
      locationActions.push(`${location} · No location hub or service-city pages approved. Verify service availability, local demand, and unique local evidence; otherwise use the broader service page.`);
      continue;
    }
    locationAssignments.push({
      canonicalKeyword: approvedHubCandidate.primaryKeyword,
      pageName: titleCase(approvedHubCandidate.primaryKeyword),
      targetUrl: hubTarget,
      source: input.websiteUrl && hubExisting?.score && hubExisting.score >= 3 ? "existing_crawl" : "suggested",
      secondaryKeywords: approvedHubCandidate.secondaryKeywords,
      searchIntent: "local",
      pagePurpose: `Act as the ${location} authority hub: explain service availability, local relevance, approved proof, FAQs, and route visitors to every service and supporting page in this market.`,
      gapAnalysis: hubExisting?.score && hubExisting.score >= 3 ? `A crawled ${location} page may serve as the authority hub. Validate local proof, service coverage, uniqueness, child-page links, schema, and conversion path.` : `No complete ${location} authority hub was found. Create a unique market page rather than a city-name variation of another location.`,
      recommendedAction: hubExisting?.score && hubExisting.score >= 3 ? "update_existing" : "create_new",
      pageKey: approvedHubCandidate.candidateId,
      parentPageId: "/",
      location,
      clusterKey,
      clusterRole: "location_hub",
      authorityScore: approvedHubCandidate.score.total,
      primaryIntent: approvedHubCandidate.primaryIntent,
      intentClusterId: approvedHubCandidate.intentClusterId,
      intentOwner: approvedHubCandidate.intentOwner,
      locationLevel: approvedHubCandidate.locationLevel ?? undefined,
      candidateScore: approvedHubCandidate.score.total,
      decisionReason: approvedHubCandidate.decisionReason,
      serviceAvailabilityVerified: approvedHubCandidate.serviceAvailabilityVerified,
      localEvidenceIds: approvedHubCandidate.localEvidenceIds,
      requiredInternalLinks: approvedHubCandidate.requiredInternalLinks,
      prohibitedCompetingKeywords: approvedHubCandidate.prohibitedCompetingKeywords,
    });
    const servicePageKeys: string[] = [];
    const serviceTargets: Array<{ keyword: string; key: string; url: string }> = [];
    const usedServiceCandidateIds = new Set<string>();
    for (const service of coreServices) {
      const approvedServiceCandidate = approvedPlannerCandidates
        .filter((candidate) => candidate.pageType === "local_service"
          && candidate.targetLocation?.toLocaleLowerCase() === location.toLocaleLowerCase()
          && !usedServiceCandidateIds.has(candidate.candidateId))
        .map((candidate) => ({ candidate, score: plannerTopicMatchScore(candidate.primaryKeyword, service) }))
        .filter((match) => match.score >= 0.5)
        .sort((left, right) => right.score - left.score)[0]?.candidate;
      if (!approvedServiceCandidate) continue;
      usedServiceCandidateIds.add(approvedServiceCandidate.candidateId);
      const serviceSlug = slugFor(service);
      const pageKey = approvedServiceCandidate.candidateId;
      const proposedUrl = `/locations/${locationSlug}/${serviceSlug}`;
      const existing = findExistingLocalPage(service, location);
      const serviceTokenCount = meaningfulTokens(service).length;
      const useExisting = Boolean(input.websiteUrl && existing?.score && existing.serviceScore >= Math.min(2, serviceTokenCount) && existing.score >= Math.min(3, serviceTokenCount + 2));
      const targetUrl = useExisting ? existing!.page.url : proposedUrl;
      servicePageKeys.push(pageKey);
      serviceTargets.push({ keyword: service, key: pageKey, url: targetUrl });
      locationAssignments.push({
        canonicalKeyword: `${service} ${location}`,
        pageName: `${titleCase(service)} in ${location}`,
        targetUrl,
        source: useExisting ? "existing_crawl" : "suggested",
        secondaryKeywords: [`${service} in ${location}`, `${service} provider ${location}`],
        searchIntent: "local",
        pagePurpose: `Satisfy commercial local intent for “${service} ${location}” with unique service detail, market-specific proof, FAQs, schema, internal links, and a clear conversion action.`,
        gapAnalysis: useExisting ? `A crawled page appears relevant to this service and location. Confirm that it uniquely satisfies the intent and does not compete with the ${location} hub or another service page.` : `No suitable crawled service-and-location page was found. Create original ${location} content with substantive local evidence; city-name swaps are blocked.`,
        recommendedAction: useExisting ? "update_existing" : "create_new",
        pageKey,
        parentPageId: hubTarget,
        location,
        clusterKey,
        clusterRole: "service",
        authorityScore: approvedServiceCandidate.score.total,
        primaryIntent: approvedServiceCandidate.primaryIntent,
        intentClusterId: approvedServiceCandidate.intentClusterId,
        intentOwner: approvedServiceCandidate.intentOwner,
        locationLevel: approvedServiceCandidate.locationLevel ?? undefined,
        candidateScore: approvedServiceCandidate.score.total,
        decisionReason: approvedServiceCandidate.decisionReason,
        serviceAvailabilityVerified: approvedServiceCandidate.serviceAvailabilityVerified,
        localEvidenceIds: approvedServiceCandidate.localEvidenceIds,
        requiredInternalLinks: approvedServiceCandidate.requiredInternalLinks,
        prohibitedCompetingKeywords: approvedServiceCandidate.prohibitedCompetingKeywords,
      });
    }
    if (!servicePageKeys.length) {
      // Keep the approved geographic intent owner in the sitemap. It acts as
      // the market hub and links to the shared core service owners. Dedicated
      // service-city children remain held until their own evidence threshold
      // is met, preventing automatic keyword × location multiplication.
      locationFaqs.push(
        `Which approved services are available to customers in ${location}?`,
        `How does the business serve customers in ${location}?`,
        `What should a buyer in ${location} review before requesting a quote?`,
      );
      locationActions.push(`${location} geographic owner · Hub ${hubTarget} · Links to the approved core service pages. Dedicated service-city children remain held until distinct local demand and evidence justify them.`);
      continue;
    }
    const supportingPageKeys: string[] = [];
    const supportAngles = [
      { suffix: "cost-guide", title: "Cost and planning guide", intent: "cost, timing, eligibility, and decision factors" },
      { suffix: "choosing-provider", title: "How to choose a provider", intent: "provider comparison, questions, proof, and selection criteria" },
      { suffix: "faq-guide", title: "Buyer questions and local guide", intent: "high-value questions, local delivery, options, and next steps" },
    ].slice(0, serviceTargets.length ? supportingCount : 0);
    const primaryService = serviceTargets[0];
    for (const angle of primaryService ? supportAngles : []) {
      const pageKey = `${clusterKey}-support-${angle.suffix}`;
      const targetUrl = `/locations/${locationSlug}/${slugFor(primaryService.keyword)}-${angle.suffix}`;
      supportingPageKeys.push(pageKey);
      locationAssignments.push({
        canonicalKeyword: `${primaryService.keyword} ${angle.title.toLocaleLowerCase()} ${location}`,
        pageName: `${titleCase(primaryService.keyword)} ${angle.title} for ${location}`,
        targetUrl,
        source: "suggested",
        secondaryKeywords: [`${primaryService.keyword} questions ${location}`, `${primaryService.keyword} guide ${location}`],
        searchIntent: "informational",
        pagePurpose: `Build topical authority for ${location} by answering ${angle.intent}, then route qualified visitors to the approved ${primaryService.keyword} service page and location hub.`,
        gapAnalysis: `Supporting authority content is required for the ${location} cluster. It must contain unique examples, FAQs, CTA wording, and internal links rather than repeating another market's article.`,
        recommendedAction: "support_only",
        pageKey,
        parentPageId: primaryService.url,
        location,
        clusterKey,
        clusterRole: "supporting",
        authorityScore,
      });
      locationSupportingContent.push(`“${primaryService.keyword}” · ${location} → ${angle.title} · Links to ${primaryService.url} and ${hubTarget}`);
      locationBriefs.push(`Authority brief for “${primaryService.keyword}” in ${location} · Cover ${angle.intent} with unique local examples, FAQs, evidence requirements, CTA wording, image direction, and approved hub-and-spoke links.`);
    }
    locationFaqs.push(`What ${stripPageQueryModifiers(focus) || focus} options are available in ${location}?`, `How are services delivered to customers in ${location}?`, `What should a buyer in ${location} compare before choosing a provider?`);
    locationActions.push(`${location} authority cluster · ${1 + servicePageKeys.length + supportingPageKeys.length} required pages · Hub ${hubTarget} · ${servicePageKeys.length} service pages · ${supportingPageKeys.length} supporting pages · Unique proof, FAQs, CTA, images, metadata, schema, and internal links required.`);
    locationAuthorityClusters.push({
      location,
      clusterKey,
      authorityScore,
      competitionLevel,
      demandLevel,
      evidenceConfidence,
      requiredPageCount: 1 + servicePageKeys.length + supportingPageKeys.length,
      hubPageKey: approvedHubCandidate.candidateId,
      servicePageKeys,
      supportingPageKeys,
      neighbourhoodPageKeys: [],
      rationale: `The planner evaluated ${coreServices.length} possible service-location combination${coreServices.length === 1 ? "" : "s"} and approved ${servicePageKeys.length}. Approval requires distinct intent, verified availability, local evidence, conversion value, SERP differentiation, and a valid hub-and-spoke role. Neighbourhood pages remain excluded without separate demand and proof.`,
      schemaTypes: ["Organization", "Service", "BreadcrumbList", "FAQPage", "LocalBusiness when verified"],
      internalLinkRules: ["Location hub links to every service page.", "Every service page links back to its location hub.", "Supporting pages link to their owning service page and location hub.", "Service pages link to relevant supporting pages and the approved conversion page.", "Cross-location links are limited to genuinely useful nearby-market navigation."],
    });
  }
  const pageAssignments: ContentPlan["pageAssignments"] = [...governedGlobalPageAssignments, ...locationAssignments].slice(0, 500);
  // The planner can approve a candidate that later fails a build-readiness
  // requirement (for example, a location hub without an approved child
  // service page). Such a candidate is not part of the final sitemap and must
  // not be counted or presented as a canonical owner.
  const representedCandidateIds = new Set(pageAssignments.map((assignment) => assignment.pageKey).filter((value): value is string => Boolean(value)));
  const unmaterializedCandidates = pagePlanningIntelligence.approvedCandidates.filter((candidate) => !representedCandidateIds.has(candidate.candidateId));
  pagePlanningIntelligence.approvedCandidates = pagePlanningIntelligence.approvedCandidates.filter((candidate) => representedCandidateIds.has(candidate.candidateId));
  pagePlanningIntelligence.humanReviewCandidates = [
    ...pagePlanningIntelligence.humanReviewCandidates,
    ...unmaterializedCandidates.map((candidate) => ({
      ...candidate,
      decision: "human_review" as const,
      indexingDirective: "noindex" as const,
      decisionReason: candidate.pageType === "location_hub"
        ? "This market hub cannot enter the sitemap until at least one evidence-approved child service page creates a complete local authority cluster."
        : "This approved candidate did not produce a build-ready page assignment and requires review before it can enter the sitemap.",
    })),
  ];
  pagePlanningIntelligence.ownerMap = pagePlanningIntelligence.ownerMap.filter((owner) => representedCandidateIds.has(owner.candidateId));
  pagePlanningIntelligence.navigation = pagePlanningIntelligence.navigation.filter((item) => representedCandidateIds.has(item.candidateId));
  pagePlanningIntelligence.internalLinks = pagePlanningIntelligence.internalLinks.filter((link) =>
    representedCandidateIds.has(link.sourceCandidateId) && representedCandidateIds.has(link.targetCandidateId),
  );
  pagePlanningIntelligence.rolloutPhases = pagePlanningIntelligence.rolloutPhases.map((phase) => ({
    ...phase,
    candidateIds: phase.candidateIds.filter((candidateId) => representedCandidateIds.has(candidateId)),
  }));
  pagePlanningIntelligence.recommendedTotalPages = new Set(pageAssignments.map((assignment) => assignment.targetUrl.trim().toLocaleLowerCase())).size;
  const keywordEvidenceCount = input.keywordSignals?.length ?? 0;
  const competitorEvidenceCount = (input.keywordSignals ?? []).filter((signal) => signal.competitorCount > 0 || signal.competitionIndex != null).length;
  const advancedSeoIntelligence: ContentPlan["advancedSeoIntelligence"] = {
    version: "v1",
    engines: [
      { key: "global_topical_authority", label: "Global Topical Authority", status: clusters.length ? "ready" : "limited", confidence: clusters.length ? 78 : 35, evidenceCount: keywords.length + keywordEvidenceCount, summary: `${clusters.length} distinct intent cluster${clusters.length === 1 ? "" : "s"} define global keyword ownership and supporting coverage.`, nextAction: clusters.length ? "Approve canonical page ownership and supporting-topic boundaries." : "Approve additional service and buyer-question keywords." },
      { key: "local_authority", label: "Local Authority Clusters", status: input.localSeoEnabled ? "ready" : "not_applicable", confidence: input.localSeoEnabled ? Math.round(locationAuthorityClusters.reduce((total, cluster) => total + cluster.authorityScore, 0) / Math.max(1, locationAuthorityClusters.length)) : 100, evidenceCount: locationAssignments.length, summary: input.localSeoEnabled ? `${locationAuthorityClusters.length} independently scored market cluster${locationAuthorityClusters.length === 1 ? "" : "s"} contain complete hub, service, and supporting-page blueprints.` : "Local authority planning is not enabled for this plan.", nextAction: input.localSeoEnabled ? "Review each market's evidence-sized cluster and local proof requirements." : "No Local SEO action is required unless target markets are added." },
      { key: "entity_knowledge_graph", label: "Entity & Knowledge Graph", status: input.businessName && input.offer ? "ready" : "limited", confidence: input.businessName && input.offer ? 76 : 45, evidenceCount: [input.businessName, input.offer, input.audience, ...input.markets].filter(Boolean).length, summary: "Business, service, audience, and location entities are attached to page and schema requirements using approved project facts.", nextAction: "Verify organization identity, address, service entities, and approved claims before release." },
      { key: "search_intent", label: "Search Intent", status: pageAssignments.length ? "ready" : "limited", confidence: pageAssignments.length ? 84 : 30, evidenceCount: pageAssignments.length, summary: "Every planned page owns one dominant intent and one canonical keyword, with overlapping variants consolidated.", nextAction: "Review pages where the selected target URL or dominant intent is uncertain." },
      { key: "competitive_gap", label: "Competitive Gap Intelligence", status: competitorEvidenceCount ? "ready" : "limited", confidence: competitorEvidenceCount ? 74 : 30, evidenceCount: competitorEvidenceCount, summary: competitorEvidenceCount ? "Competition and competitor counts contribute to market authority scores and supporting-page depth." : "No completed competitor evidence was available; the plan uses conservative minimum clusters.", nextAction: competitorEvidenceCount ? "Prioritize high-opportunity gaps with strong business fit." : "Run Keyword Intelligence or competitor analysis to refine cluster size." },
      { key: "semantic_coverage", label: "Semantic Coverage", status: "awaiting_content", confidence: 68, evidenceCount: pageAssignments.length + clusters.length + locationSupportingContent.length, summary: "Page blueprints define service, supporting, FAQ, proof, metadata, schema, and conversion coverage; final coverage is measured against generated content.", nextAction: "Generate structured page content and run semantic coverage validation." },
      { key: "internal_link", label: "Internal Link Intelligence", status: "ready", confidence: 88, evidenceCount: locationAuthorityClusters.reduce((total, cluster) => total + cluster.internalLinkRules.length, 0), summary: "Parent-child, hub-service, support-commercial, breadcrumb, CTA, and orphan-prevention rules are part of the approved graph.", nextAction: "Resolve all page references to governed Website Model page IDs." },
      { key: "ai_citation_readiness", label: "AI Citation Readiness", status: "awaiting_content", confidence: 60, evidenceCount: locationFaqs.length + 3, summary: "Answer-first content, useful FAQs, verified entities, source clarity, and schema are required before AEO/GEO approval.", nextAction: "Validate generated answers, evidence clarity, schema, and unsupported claims." },
      { key: "brand_authority", label: "Brand Authority", status: "limited", confidence: input.businessName ? 55 : 25, evidenceCount: input.businessName ? 1 : 0, summary: "Brand identity is connected, but authority depends on verified credentials, reviews, citations, case studies, and consistent entity signals.", nextAction: "Add and verify business-specific trust evidence instead of generating claims." },
      { key: "serp_features", label: "SERP Feature Intelligence", status: "limited", confidence: 25, evidenceCount: 0, summary: "FAQ, answer, local, and rich-result opportunities are planned conservatively because SERP feature observations are not present in this evidence set.", nextAction: "Collect live SERP features and competitor result types during Keyword Intelligence." },
      { key: "content_decay", label: "Content Decay", status: "awaiting_performance", confidence: 0, evidenceCount: 0, summary: "Decay cannot be measured until versioned content has been published and historical performance exists.", nextAction: "Begin decay monitoring after publication and baseline collection." },
      { key: "next_best_action", label: "Next Best Action", status: "awaiting_performance", confidence: 0, evidenceCount: 0, summary: "The Growth Engine will rank the next improvement or expansion after publication and performance evidence.", nextAction: "Complete approval, publishing, and measurement before recommending expansion." },
    ],
  };
  const pageMap = pageAssignments.map((assignment) => `${assignment.pageName} → ${assignment.targetUrl} · ${assignment.recommendedAction.replaceAll("_", " ")} · ${assignment.searchIntent} intent${assignment.location ? ` · ${assignment.location} ${assignment.clusterRole?.replaceAll("_", " ")}` : ""}`);
  const planningChecks = pageAssignments.map((assignment) => {
    const action = assignment.recommendedAction === "create_new"
      ? `Create ${assignment.targetUrl}`
      : assignment.recommendedAction === "consolidate"
        ? `Use ${assignment.targetUrl} and combine overlapping variants`
        : `Improve ${assignment.targetUrl}`;
    const gap = assignment.source === "existing_crawl"
      ? "Closest relevant page found; verify its content fully satisfies this intent"
      : "No suitable existing page found";
    return `“${assignment.canonicalKeyword}” · ${assignment.searchIntent} intent · ${action} · Gap: ${gap}`;
  });
  const supporting = [...clusters.slice(0, 12).map((cluster) => {
    const primary = canonicalKeyword(cluster);
    return `“${primary}” → Cost & timeline · Choosing a provider · Alternatives · Delivery process`;
  }), ...locationSupportingContent].slice(0, 500);
  const briefs = [...clusters.slice(0, 12).map((cluster) => `Supporting brief for “${canonicalKeyword(cluster)}” · Cover cost, provider selection, alternatives, and delivery · For: ${audience}`), ...locationBriefs].slice(0, 500);
  const localSeoActions = input.localSeoEnabled ? locationActions.slice(0, 500) : [];
  return ensureContentPlanHome({
    summary: (input.contentStrategy || `Build a conversion-focused SEO content system for ${focus}${market ? ` across ${market}` : ""}, aligned with ${input.goal || "the primary project goal"} and the approved keyword direction.`).slice(0, 3000),
    pageUpdates: [...(pageUpdates.length ? pageUpdates : [`Create or improve the main ${focus} service page with clear positioning, proof, FAQs, and a conversion call to action.`]), ...locationAssignments.map((assignment) => `${assignment.recommendedAction === "update_existing" ? "Update" : "Create"} ${assignment.clusterRole?.replaceAll("_", " ") || "local page"}: “${assignment.pageName}” · ${assignment.targetUrl}`)].slice(0, 500),
    keywordMapping: [...(keywordMapping.length ? keywordMapping : [`Canonical target: “${focus}” | Map all approved variants to one page unless intent evidence requires separation.`]), ...locationAssignments.map((assignment) => `${assignment.location} authority cluster · “${assignment.canonicalKeyword}” → ${assignment.targetUrl} · Parent: ${assignment.parentPageId || "Home"}`)].slice(0, 500),
    pageMap: pageMap.length ? pageMap : [`Target URL: ${rootUrl} | Canonical intent: “${focus}” | Asset: primary commercial page.`],
    planningChecks: planningChecks.length ? planningChecks : [`Confirm intent, URL, purpose, gap analysis, and recommended action for “${focus}” before drafting.`],
    pageAssignments,
    pagePlanningIntelligence,
    locationAuthorityClusters,
    advancedSeoIntelligence,
    supportingContent: supporting.length ? supporting : [`Publish an educational guide that helps ${audience} understand the problem, options, and next step.`],
    faqTopics: [`What does ${focus} include?`, `Who is ${focus} best suited for?`, `How much time and effort does implementation require?`, `What results should a buyer expect?`, ...locationFaqs].slice(0, 500),
    proofBlocks: ["Add a measurable case-study result with the starting problem, work completed, and outcome.", "Add relevant testimonials or review evidence near the conversion action.", "Show process, experience, credentials, guarantees, or trust signals supporting the key claims."],
    contentBriefs: briefs.length ? briefs : [`Brief: ${focus} | Audience: ${audience} | Cover the buyer problem, approach, proof, FAQs, and next action.`],
    publishingSequence: ["Approve keyword-to-page mapping and prevent cannibalization.", "Update the highest-value commercial page first.", "Publish supporting content in priority order and add contextual internal links.", "Validate metadata, schema, mobile presentation, CTAs, and tracking before publishing.", "Review rankings, qualified traffic, engagement, and conversions after release."],
    kpis: ["Approved pages and briefs completed", "Priority keywords mapped without duplication", "Organic impressions and qualified clicks", "Content-assisted leads or conversions", "Internal links and indexed pages"],
    localSeo: { enabled: input.localSeoEnabled, targetLocations: input.localSeoEnabled ? input.markets : [] },
    localSeoActions,
    workflowStages: ["Keyword intent identified and overlapping variants combined", "Canonical target URL assigned and checked against existing pages", "Content brief created from the approved plan", "AI creates or updates the content asset", "SEO reviewer checks intent, on-page optimization, evidence, links, and duplication", "Company approver approves or requests changes", "Authorized publisher schedules or publishes and verifies the live result", "Performance is monitored against the plan KPIs"],
  }, input);
}

function rankingKeywordFromTitle(title: string) {
  return title.match(/["“](.+?)["”]/)?.[1]?.trim() || title.replace(/^create ranking plan for\s*/i, "").trim();
}

function rankingPlanFor(input: {
  keyword: string;
  location: string;
  targetUrl: string | null;
  domain: string | null;
  searchVolume: number | null;
  currentRank: number | null;
  competitors: string[];
  targetMarkets: string[];
  offer: string | null;
}): RankingPlan {
  const keyword = input.keyword.trim();
  const offer = input.offer?.split(/[,;\n]/).map((item) => item.trim()).find(Boolean) || keyword;
  const market = input.targetMarkets[0] || input.location;
  const naturalBase = /\b(company|companies|services?|agency|developer|developers|consultant|consulting|software)\b/i.test(keyword) ? keyword : `${keyword} services`;
  const variants = [...new Set([
    naturalBase,
    market ? `${naturalBase} ${market}` : "",
    `best ${offer}`,
    `${offer} company`,
    `${offer} services`,
  ].map((value) => value.trim()).filter(Boolean))].slice(0, 8);
  const intent = /\b(best|company|companies|services?|hire|pricing|cost|near me)\b/i.test(keyword) ? "Commercial investigation" : "Informational research";
  return {
    keyword,
    intent,
    targetMode: input.targetUrl ? "optimize_existing" : "create_new",
    targetUrl: input.targetUrl,
    pageTitle: `${naturalBase}${market ? ` in ${market}` : ""}`.slice(0, 220),
    recommendedKeywordVariants: variants,
    contentSections: ["Buyer problem and desired outcome", `How ${offer} solves the problem`, "Services and capabilities", "Proof, case studies, and trust signals", "Process and expected timeline", "Frequently asked questions", "Clear conversion call to action"],
    internalLinkActions: ["Link from the most relevant service and industry pages", "Add contextual links from supporting articles", "Link back to the strongest conversion or contact page"],
    authorityActions: ["Compare the page with the leading SERP competitors", "Add original proof, experience, examples, and measurable outcomes", "Plan relevant citations or backlinks after the page is approved"],
    successMetrics: ["Target page is indexed", "Keyword enters the tracked ranking range", "Organic impressions and qualified clicks improve", "The target page generates a measurable conversion action"],
    evidence: { searchVolume: input.searchVolume, currentRank: input.currentRank, location: input.location, competitors: input.competitors, targetMarkets: input.targetMarkets },
  };
}

function publishingAction(res: import("express").Response, action: () => Promise<unknown>) {
  action().then((value) => res.json(value)).catch((error: unknown) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.flatten() });
    const typed = error as { statusCode?: number; message?: string };
    return res.status(typed.statusCode ?? 500).json({ error: typed.message ?? "Publishing request failed." });
  });
}

type TaskInput = {
  clientId: string;
  websiteId: string;
  projectId?: string | null;
  moduleName: string;
  sourceType: string;
  sourceId?: string | null;
  dedupeKey: string;
  title: string;
  description: string;
  expectedOutcome?: string | null;
  priority: "critical" | "high" | "medium" | "low";
  automationLevel: string;
  status?: string;
  requiresApproval?: boolean;
  requiresIntegration?: boolean;
  manualRequired?: boolean;
  actionButtonLabel?: string | null;
  relatedUrl?: string | null;
  relatedAssetId?: string | null;
  manualInstructions?: string | null;
  impact?: string | null;
};

async function executionClientScope(req: Request) {
  if (req.user?.role === "super_admin" && !req.header("x-senuke-ai-client-id") && !req.header("x-webtummy-client-id")) {
    return null;
  }
  return projectClientIdForRequest(req);
}

async function scopedWebsite(req: Request, websiteId: string) {
  const clientId = await executionClientScope(req);
  return prisma.website.findFirst({
    where: { id: websiteId, ...(clientId ? { clientId } : {}) },
    select: { id: true, clientId: true, domain: true, rootUrl: true },
  });
}

function severityPriority(severity: string): "high" | "medium" | "low" {
  return severity === "high" ? "high" : severity === "low" ? "low" : "medium";
}

function taskPath(moduleName: string, websiteId: string, sourceId?: string | null) {
  if (moduleName === "crawl" && sourceId) return `/crawls/${sourceId}`;
  if (moduleName === "keyword_research" && sourceId) return `/keyword-insights/${sourceId}`;
  if (moduleName === "local_seo") return `/local-seo?project=${websiteId}`;
  if (moduleName === "social_strategy") return `/social-strategy?project=${websiteId}`;
  if (moduleName === "ai_content") return `/ai-content`;
  return `/projects/${websiteId}`;
}

async function upsertTask(tx: Prisma.TransactionClient, input: TaskInput) {
  const existing = await tx.executionTask.findUnique({ where: { dedupeKey: input.dedupeKey } });
  const data = {
    clientId: input.clientId,
    websiteId: input.websiteId,
    projectId: input.projectId ?? null,
    moduleName: input.moduleName,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    title: input.title,
    description: input.description,
    expectedOutcome: input.expectedOutcome ?? input.impact ?? input.description,
    priority: input.priority,
    automationLevel: input.automationLevel,
    status: input.status ?? "ready",
    requiresApproval: input.requiresApproval ?? false,
    requiresIntegration: input.requiresIntegration ?? false,
    manualRequired: input.manualRequired ?? true,
    actionButtonLabel: input.actionButtonLabel ?? null,
    relatedUrl: input.relatedUrl ?? taskPath(input.moduleName, input.websiteId, input.sourceId),
    relatedAssetId: input.relatedAssetId ?? null,
    manualInstructions: input.manualInstructions ?? null,
    impact: input.impact ?? null,
  };

  if (!existing) {
    try {
      await tx.executionTask.create({ data: { ...data, dedupeKey: input.dedupeKey } });
      return "created";
    } catch (error) {
      // Automatic crawl-detail refreshes can overlap. If another request
      // created the same deduplicated task between findUnique and create,
      // continue from that row instead of turning a harmless race into a 500.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const raced = await tx.executionTask.findUnique({ where: { dedupeKey: input.dedupeKey } });
      if (!raced || terminalStatuses.has(raced.status)) return "unchanged";
      await tx.executionTask.update({ where: { id: raced.id }, data });
      return "updated";
    }
  }

  if (terminalStatuses.has(existing.status)) return "unchanged";
  await tx.executionTask.update({ where: { id: existing.id }, data });
  return "updated";
}

async function withTransactionRetry<T>(action: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
  throw lastError;
}

async function buildTasksForWebsite(website: { id: string; clientId: string; domain: string; rootUrl: string }, issueIds?: string[]): Promise<TaskInput[]> {
  const tasks: TaskInput[] = [];
  const project = await prisma.project.findFirst({ where: { websiteId: website.id, status: { not: "deleted" } }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  const latestCrawl = await prisma.crawlJob.findFirst({
    where: { websiteId: website.id, status: "completed" },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    include: {
      issues: {
        where: { status: "open", severity: { in: ["high", "medium", "low"] }, ...(issueIds?.length ? { id: { in: issueIds } } : {}) },
        orderBy: [{ severity: "asc" }, { weightImpact: "desc" }],
        take: 80,
        include: { page: { select: { url: true } } },
      },
    },
  });

  if (latestCrawl) {
    for (const issue of latestCrawl.issues) {
      tasks.push({
        clientId: website.clientId,
        websiteId: website.id,
        projectId: project?.id,
        moduleName: "crawl",
        sourceType: "crawl_issue",
        sourceId: latestCrawl.id,
        dedupeKey: `crawl:${issue.id}`,
        title: issue.message || issue.issueType.replace(/_/g, " "),
        description: issue.recommendation || `Resolve ${issue.category} issue on ${issue.page?.url ?? website.domain}.`,
        priority: severityPriority(issue.severity),
        automationLevel: "manual_guided",
        actionButtonLabel: "Open Crawl Issue",
        relatedUrl: `/crawls/${latestCrawl.id}`,
        manualInstructions: issue.page?.url ? `Open the crawl report, review ${issue.page.url}, then apply the recommended fix in the website or CMS.` : "Open the crawl report and apply the recommended fix.",
        impact: `Improves ${issue.category} health and the project score.`,
      });
    }
  }

  const keywordRuns = await prisma.keywordResearchRun.findMany({
    where: { websiteId: website.id, status: "completed" },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 3 } },
  });
  for (const run of keywordRuns) {
    const rank = run.manualRank ?? run.targetRank;
    const priority = !rank || rank > 20 ? "high" : rank > 10 ? "medium" : "low";
    tasks.push({
      clientId: website.clientId,
      websiteId: website.id,
      moduleName: "keyword_research",
      sourceType: "keyword_research_run",
      sourceId: run.id,
      dedupeKey: `keyword:${run.id}:growth`,
      title: rank ? `Improve "${run.seedKeyword}" from rank #${rank}` : `Create ranking plan for "${run.seedKeyword}"`,
      description: run.targetUrl ? `Use the keyword report to improve ${run.targetUrl}.` : "Map this keyword to the best existing page or create a dedicated page if no good target exists.",
      priority,
      automationLevel: "prepare",
      actionButtonLabel: "Open Keyword Report",
      relatedUrl: `/keyword-insights/${run.id}`,
      manualInstructions: "Open the keyword report, review SERP competitors and ideas, then improve or create the target page.",
      impact: "Connects keyword demand to a concrete page improvement path.",
    });

    if (run.ideas.length) {
      tasks.push({
        clientId: website.clientId,
        websiteId: website.id,
        moduleName: "keyword_research",
        sourceType: "keyword_ideas",
        sourceId: run.id,
        dedupeKey: `keyword:${run.id}:ideas`,
        title: `Review keyword ideas for "${run.seedKeyword}"`,
        description: `Top ideas include ${run.ideas.map((idea) => idea.keyword).join(", ")}.`,
        priority: "medium",
        automationLevel: "recommend",
        actionButtonLabel: "Review Ideas",
        relatedUrl: `/keyword-insights/${run.id}`,
        manualInstructions: "Choose the strongest keywords and decide whether each should improve an existing page or become a new page.",
        impact: "Expands the project roadmap using real keyword demand.",
      });
    }
  }

  const localProfiles = await prisma.localBusinessProfile.findMany({
    where: { websiteId: website.id },
    include: { recommendations: { where: { status: "open" }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }], take: 20 } },
  });
  for (const profile of localProfiles) {
    for (const recommendation of profile.recommendations) {
      tasks.push({
        clientId: website.clientId,
        websiteId: website.id,
        moduleName: "local_seo",
        sourceType: "local_recommendation",
        sourceId: recommendation.id,
        dedupeKey: `local:${recommendation.id}`,
        title: recommendation.recommendation.slice(0, 240),
        description: recommendation.expectedImpact || `Improve ${profile.businessName}'s local SEO profile.`,
        priority: recommendation.priority === "high" || recommendation.priority === "low" ? recommendation.priority : "medium",
        automationLevel: "manual_guided",
        actionButtonLabel: "Open Local SEO",
        relatedUrl: `/local-seo?project=${website.id}`,
        manualInstructions: "Open Local SEO, review the recommendation evidence, then update the listing, citation, profile, or website content.",
        impact: recommendation.expectedImpact || "Improves local visibility, trust, or listing consistency.",
      });
    }
  }

  const socialStrategies = await prisma.socialStrategy.findMany({
    where: { websiteId: website.id },
    orderBy: { createdAt: "desc" },
    take: 2,
    include: { posts: { where: { status: "planned" }, orderBy: { publishDate: "asc" }, take: 12 } },
  });
  for (const strategy of socialStrategies) {
    for (const post of strategy.posts) {
      tasks.push({
        clientId: website.clientId,
        websiteId: website.id,
        moduleName: "social_strategy",
        sourceType: "social_calendar_post",
        sourceId: post.id,
        dedupeKey: `social-post:${post.id}`,
        title: `Review ${post.platform} post: ${post.topic}`,
        description: post.caption,
        priority: "medium",
        automationLevel: "execute_with_approval",
        status: "needs_review",
        requiresApproval: true,
        manualRequired: true,
        actionButtonLabel: "Open Social Calendar",
        relatedUrl: `/social-strategy?project=${website.id}`,
        manualInstructions: "Review the caption and creative direction, then manually schedule or publish it on the selected channel.",
        impact: "Turns the social strategy calendar into an approval-based execution step.",
      });
    }
  }

  const aiGenerations = await prisma.aiContentGeneration.findMany({
    where: { websiteId: website.id, status: "completed" },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  for (const generation of aiGenerations) {
    tasks.push({
      clientId: website.clientId,
      websiteId: website.id,
      moduleName: "ai_content",
      sourceType: "ai_content_generation",
      sourceId: generation.id,
      dedupeKey: `ai-content:${generation.id}`,
      title: `Review generated ${generation.type.replace(/_/g, " ")}: ${generation.topic}`,
      description: generation.targetUrl ? `Review and apply the generated output for ${generation.targetUrl}.` : "Review the generated output and decide where it should be applied.",
      priority: generation.type === "article" ? "high" : "medium",
      automationLevel: "prepare",
      status: "needs_review",
      requiresApproval: true,
      manualRequired: true,
      actionButtonLabel: "Open AI Content",
      relatedUrl: "/ai-content",
      relatedAssetId: generation.id,
      manualInstructions: "Open AI Content Studio, review the saved output, edit if needed, then apply it manually to the website or content plan.",
      impact: "Moves generated content from draft output into reviewed project execution.",
    });
  }

  return tasks.map((task) => ({ ...task, projectId: task.projectId ?? project?.id ?? null }));
}

executionTasksRouter.get("/execution-tasks", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await executionClientScope(req);
  let projectScope: { id: string; websiteId: string | null; clientId: string } | null = null;
  if (parsed.data.projectId) {
    projectScope = await prisma.project.findFirst({ where: { id: parsed.data.projectId, ...(clientId ? { clientId } : {}) }, select: { id: true, websiteId: true, clientId: true } });
    const context = await workspaceContext(req);
    if (!projectScope || !await canAccessProject(context, projectScope.id)) return res.status(404).json({ error: "project not found" });
  }
  const where: Prisma.ExecutionTaskWhereInput = {
    ...(clientId ? { clientId } : {}),
    ...(projectScope ? { OR: [{ projectId: projectScope.id }, ...(projectScope.websiteId ? [{ websiteId: projectScope.websiteId }] : [])] } : parsed.data.websiteId ? { websiteId: parsed.data.websiteId } : {}),
    ...(parsed.data.status ? { status: parsed.data.status } : {}),
    ...(parsed.data.moduleName ? { moduleName: parsed.data.moduleName } : {}),
    ...(parsed.data.priority ? { priority: parsed.data.priority } : {}),
  };
  const tasks = await prisma.executionTask.findMany({
    where,
    orderBy: [{ status: "asc" }, { priority: "asc" }, { updatedAt: "desc" }],
    take: projectScope ? 500 : 200,
    include: { dependencies: { include: { requiredTask: { select: { title: true, status: true } } } } },
  });
  const existingDedupeKeys = new Set(tasks.map((task) => task.dedupeKey));
  const crawlFindingTasks = projectScope?.websiteId ? await prisma.crawlJob.findFirst({
    where: { websiteId: projectScope.websiteId, status: "completed" },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      createdAt: true,
      issues: { take: 1000, orderBy: [{ severity: "asc" }, { weightImpact: "desc" }], include: { page: { select: { url: true } } } },
    },
  }) : null;
  const unsyncedCrawlFindings = crawlFindingTasks?.issues.filter((issue) => !existingDedupeKeys.has(`crawl:${issue.id}`)).map((issue) => ({
    id: `crawl-issue:${issue.id}`,
    clientId: projectScope!.clientId,
    websiteId: projectScope!.websiteId,
    projectId: projectScope!.id,
    moduleName: "crawl",
    sourceType: "crawl_issue",
    sourceId: issue.id,
    dedupeKey: `crawl:${issue.id}`,
    title: issue.message,
    description: issue.recommendation || `Review the ${issue.category} finding${issue.page?.url ? ` on ${issue.page.url}` : ""}.`,
    expectedOutcome: `Improves ${issue.category} health and the project score.`,
    priority: issue.severity === "high" && issue.weightImpact >= 8 ? "critical" : issue.severity,
    automationLevel: "manual_guided",
    status: issue.status === "fixed" ? "completed" : issue.status === "ignored" ? "skipped" : "ready",
    requiresApproval: false,
    requiresIntegration: false,
    manualRequired: true,
    actionButtonLabel: "Review & Fix",
    relatedUrl: `/crawls/${crawlFindingTasks.id}`,
    relatedModule: crawlFindingTasks.id,
    manualInstructions: issue.recommendation,
    impact: `Improves ${issue.category} health and the project score.`,
    approvedAt: null,
    completedAt: issue.status === "fixed" ? crawlFindingTasks.createdAt : null,
    skippedAt: issue.status === "ignored" ? crawlFindingTasks.createdAt : null,
    createdAt: crawlFindingTasks.createdAt,
    updatedAt: crawlFindingTasks.createdAt,
    dependencies: [],
  })) ?? [];
  const context = await workspaceContext(req);
  const visible = [];
  const actionableTasks = crawlFindingTasks?.issues.length ? tasks.filter((task) => task.moduleName !== "site_analysis") : tasks;
  for (const task of [...actionableTasks, ...unsyncedCrawlFindings]) if (projectScope || !task.projectId || await canAccessProject(context, task.projectId)) visible.push(task);
  const searched = parsed.data.search ? visible.filter((task) => [task.title, task.actionButtonLabel, task.description, task.moduleName].some((value) => value?.toLowerCase().includes(parsed.data.search!.toLowerCase()))) : visible;
  res.json({ tasks: searched.map((task) => /(?:seo\s*plan|content\s*plan)/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`) && task.projectId
    ? { ...task, relatedUrl: `/guided-projects/${task.projectId}?tab=execution&actionTask=${task.id}#execution-tasks` }
    : task) });
});

executionTasksRouter.get("/websites/:websiteId/execution-tasks", async (req, res) => {
  const website = await scopedWebsite(req, req.params.websiteId);
  if (!website) return res.status(404).json({ error: "website not found" });
  const tasks = await prisma.executionTask.findMany({
    where: { websiteId: website.id, clientId: website.clientId },
    orderBy: [{ status: "asc" }, { priority: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });
  res.json({ website, tasks });
});

executionTasksRouter.post("/websites/:websiteId/execution-tasks/sync", async (req, res) => {
  const website = await scopedWebsite(req, req.params.websiteId);
  if (!website) return res.status(404).json({ error: "website not found" });

  const parsed = z.object({ issueIds: z.array(z.string().min(1)).max(200).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const inputs = await buildTasksForWebsite(website, parsed.data.issueIds);
  const result = await withTransactionRetry(() => prisma.$transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const input of inputs) {
      const status = await upsertTask(tx, input);
      if (status === "created") created += 1;
      else if (status === "updated") updated += 1;
      else unchanged += 1;
    }
    return { created, updated, unchanged };
  }));

  const tasks = await prisma.executionTask.findMany({
    where: { websiteId: website.id, clientId: website.clientId },
    orderBy: [{ status: "asc" }, { priority: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });
  res.json({ ...result, tasks });
});

executionTasksRouter.patch("/execution-tasks/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await executionClientScope(req);
  const existing = await prisma.executionTask.findFirst({
    where: { id: req.params.id, ...(clientId ? { clientId } : {}) },
    include: { project: { select: { id: true, agencyClientId: true } }, dependencies: { include: { requiredTask: { select: { title: true, status: true } } } } },
  });
  if (!existing) return res.status(404).json({ error: "task not found" });
  const context = await workspaceContext(req);
  const status = parsed.data.status ?? existing.status;
  if (existing.projectId && !await canAccessProject(await workspaceContext(req), existing.projectId)) return res.status(404).json({ error: "task not found" });
  if (status === "completed") {
    const blocked = existing.dependencies.filter((dependency) => !["completed", "published", "approved"].includes(dependency.requiredTask.status));
    if (blocked.length) return res.status(409).json({ error: `Complete dependencies first: ${blocked.map((item) => item.requiredTask.title).join(", ")}` });
    if (context.workspace.workspaceType !== "personal" && existing.requiresApproval && !existing.approvedAt) return res.status(409).json({ error: "This task requires approval before it can be completed." });
  }
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.executionTask.update({ where: { id: existing.id }, data: { ...parsed.data, completedAt: status === "completed" ? new Date() : existing.completedAt, skippedAt: status === "skipped" ? new Date() : existing.skippedAt } });
    await recordWorkspaceActivity(tx, { context, action: status !== existing.status ? "task.status_changed" : "task.edited", entityType: "execution_task", entityId: existing.id, agencyClientId: existing.project?.agencyClientId, projectId: existing.projectId, previousJson: { status: existing.status, priority: existing.priority, manualInstructions: existing.manualInstructions }, nextJson: { status: updated.status, priority: updated.priority, manualInstructions: updated.manualInstructions } });
    return updated;
  });
  res.json({ task });
});

executionTasksRouter.post("/execution-tasks/:id/complete", async (req, res) => {
  const clientId = await executionClientScope(req);
  const existing = await prisma.executionTask.findFirst({
    where: { id: req.params.id, ...(clientId ? { clientId } : {}) },
    include: { project: { select: { id: true, agencyClientId: true } }, dependencies: { include: { requiredTask: { select: { title: true, status: true } } } } },
  });
  if (!existing) return res.status(404).json({ error: "task not found" });
  const context = await workspaceContext(req);
  if (existing.projectId && !await canAccessProject(context, existing.projectId)) return res.status(404).json({ error: "task not found" });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const blocked = existing.dependencies.filter((dependency) => !["completed", "published", "approved"].includes(dependency.requiredTask.status));
  if (blocked.length) return res.status(409).json({ error: `Complete dependencies first: ${blocked.map((item) => item.requiredTask.title).join(", ")}` });
  if (context.workspace.workspaceType !== "personal" && existing.requiresApproval && !existing.approvedAt) return res.status(409).json({ error: "This task requires approval before it can be completed." });
  const task = await prisma.$transaction(async (tx) => { const updated = await tx.executionTask.update({ where: { id: existing.id }, data: { status: "completed", completedAt: new Date() } }); await recordWorkspaceActivity(tx, { context, action: "task.completed", entityType: "execution_task", entityId: existing.id, agencyClientId: existing.project?.agencyClientId, projectId: existing.projectId, previousJson: { status: existing.status }, nextJson: { status: "completed", expectedOutcome: existing.expectedOutcome } }); return updated; });
  res.json({ task });
});

executionTasksRouter.post("/projects/:projectId/seo-plan/task", async (req, res) => {
  const clientId = await executionClientScope(req);
  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, ...(clientId ? { clientId } : {}), status: { not: "deleted" } },
    include: {
      businessProfile: true,
      website: { select: { id: true, rootUrl: true } },
      strategyPlans: { where: { status: "approved" }, select: { id: true }, take: 1 },
    },
  });
  if (!project) return res.status(404).json({ error: "project not found" });
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, project.id)) return res.status(404).json({ error: "project not found" });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  if (!project.strategyPlans.length) return res.status(409).json({ error: "Approve the Strategy before creating the SEO Page Plan." });
  const plan = await prisma.executionPlan.findFirst({ where: { projectId: project.id, status: "active" }, orderBy: { createdAt: "asc" } })
    ?? await prisma.executionPlan.create({ data: { projectId: project.id, title: "Guided execution plan", summary: "Project-wide tasks generated from approved discovery and Strategy.", status: "active" } });
  const task = await prisma.$transaction(async (tx) => {
    const campaignTasks = buildCampaignExecutionTasks(project);
    const pageMapInput = campaignTasks.find((input) => /seo page map/i.test(input.title));
    let legacyPageMap = await tx.executionTask.findFirst({
      where: {
        projectId: project.id,
        OR: [
          { title: { contains: "SEO Page Map", mode: "insensitive" } },
          { actionButtonLabel: { contains: "SEO Page Map", mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    const duplicateContentPlan = await tx.executionTask.findFirst({
      where: {
        projectId: project.id,
        dedupeKey: `project:${project.id}:execution:content-optimization-plan`,
      },
      orderBy: { updatedAt: "desc" },
    });
    if (legacyPageMap && duplicateContentPlan && legacyPageMap.id !== duplicateContentPlan.id) {
      const pageMapSnapshot = recordJson(legacyPageMap.approvalSnapshotJson);
      const contentPlanSnapshot = recordJson(duplicateContentPlan.approvalSnapshotJson);
      const mergedSnapshot = { ...pageMapSnapshot, ...contentPlanSnapshot };
      const detailedPlanExists = Object.keys(recordJson(contentPlanSnapshot.contentPlan)).length > 0;
      legacyPageMap = await tx.executionTask.update({
        where: { id: legacyPageMap.id },
        data: {
          moduleName: "content",
          title: "SEO Page Map & Content Plan",
          description: "Group approved keywords by intent, assign one owner page, prepare URLs and SEO briefs, then review FAQs, proof, Local SEO, internal links, and publishing requirements in one governed workflow.",
          status: detailedPlanExists ? duplicateContentPlan.status : legacyPageMap.status,
          approvedAt: detailedPlanExists ? duplicateContentPlan.approvedAt : legacyPageMap.approvedAt,
          completedAt: detailedPlanExists ? duplicateContentPlan.completedAt : legacyPageMap.completedAt,
          requiresApproval: true,
          actionButtonLabel: detailedPlanExists ? duplicateContentPlan.actionButtonLabel : "Create SEO Plan",
          approvalSnapshotJson: mergedSnapshot as Prisma.InputJsonValue,
        },
      });
      await tx.executionTask.update({
        where: { id: duplicateContentPlan.id },
        data: {
          title: "Legacy SEO planning task (merged)",
          description: "Merged into the project’s SEO Page Map & Content Plan.",
          status: "canceled",
          actionButtonLabel: null,
          relatedUrl: null,
          blockedReason: "Superseded by the unified SEO Page Map & Content Plan.",
        },
      });
    }
    if (legacyPageMap && Object.keys(recordJson(recordJson(legacyPageMap.approvalSnapshotJson).contentPlan)).length === 0 && ["completed", "approved"].includes(legacyPageMap.status)) {
      legacyPageMap = await tx.executionTask.update({
        where: { id: legacyPageMap.id },
        data: {
          moduleName: "content",
          title: "SEO Page Map & Content Plan",
          status: "ready",
          completedAt: null,
          approvedAt: null,
          requiresApproval: true,
          actionButtonLabel: "Create SEO Plan",
          blockedReason: null,
        },
      });
    }

    let pageMapTask = legacyPageMap;
    for (const input of campaignTasks) {
      const dedupeKey = `project:${project.id}:execution:${input.key}`;
      const isPageMap = input === pageMapInput;
      let existing = isPageMap && pageMapTask
        ? pageMapTask
        : await tx.executionTask.findUnique({ where: { dedupeKey } });
      if (isPageMap && existing && existing.dedupeKey !== dedupeKey) {
        const deduped = await tx.executionTask.findUnique({ where: { dedupeKey } });
        if (!deduped) existing = await tx.executionTask.update({ where: { id: existing.id }, data: { dedupeKey } });
        else existing = deduped;
      }
      const taskData = {
        clientId: project.clientId,
        websiteId: project.websiteId,
        projectId: project.id,
        executionPlanId: plan.id,
        moduleName: input.moduleName,
        sourceType: isPageMap ? "seo_plan" : "project",
        sourceId: project.id,
        title: input.title,
        description: input.description,
        expectedOutcome: input.description,
        priority: input.priority,
        automationLevel: input.automationLevel ?? "manual_guided",
        requiresApproval: input.requiresApproval ?? false,
        requiresIntegration: input.requiresIntegration ?? false,
        manualRequired: true,
        actionButtonLabel: input.actionButtonLabel,
        relatedUrl: isPageMap ? `/guided-projects/${project.id}?tab=execution#execution-tasks` : input.relatedUrl,
        approvalRisk: input.requiresApproval ? "high" : "low",
        safetyCategory: input.requiresApproval ? "protected_change" : "safe",
      };
      const row = existing
        ? ["completed", "cancelled", "canceled"].includes(existing.status)
          ? existing
          : await tx.executionTask.update({ where: { id: existing.id }, data: taskData })
        : await tx.executionTask.create({ data: { ...taskData, dedupeKey, status: "ready" } });
      if (isPageMap) pageMapTask = row;
    }
    if (!pageMapTask) throw new Error("SEO Page Map task could not be created.");
    await tx.executionPlan.update({
      where: { id: plan.id },
      data: {
        title: "Adaptive SEO/Growth execution plan",
        summary: "Prioritized project-wide tasks generated from the approved Strategy. Website, Local SEO, citations, authority, content, publishing, growth, and reporting remain visible in one execution workflow.",
      },
    });
    await recordWorkspaceActivity(tx, { context, action: "execution_plan.synced_from_site_architect", entityType: "execution_plan", entityId: plan.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { taskCount: campaignTasks.length, pageMapTaskId: pageMapTask.id } });
    return pageMapTask;
  });
  res.status(201).json({ task, created: !task.createdAt || task.createdAt.getTime() === task.updatedAt.getTime() });
});

executionTasksRouter.post("/execution-tasks/:id/content-plan/prepare", (req, res, next) => {
  void (async () => {
  const clientId = await executionClientScope(req);
  const task = await prisma.executionTask.findFirst({
    where: { id: req.params.id, ...(clientId ? { clientId } : {}) },
    include: {
      project: {
        include: {
          agencyClient: { select: { name: true } },
          businessProfile: true,
          intakeAnswers: true,
          gapLocalSeoProfiles: true,
          keywordGroups: { where: { status: "approved" } },
          keywordResearchRuns: {
            where: { status: "completed" },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: {
              seedKeyword: true,
              locationName: true,
              averageVolume: true,
              competitorCount: true,
              ideas: { take: 100, select: { keyword: true, avgMonthlySearches: true, competitionIndex: true } },
            },
          },
          strategyPlans: { orderBy: [{ version: "desc" }, { updatedAt: "desc" }], take: 1 },
          website: { include: { crawlJobs: { where: { status: "completed" }, orderBy: { createdAt: "desc" }, take: 1, include: { pages: { take: 250, select: { url: true, seo: { select: { title: true } } } } } } } },
        },
      },
    },
  });
  if (!task?.project || !/(?:content\s*plan|seo\s*page\s*map)/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`)) return res.status(404).json({ error: "Content-plan task not found" });
  const context = await workspaceContext(req);
  if (!task.projectId || !await canAccessProject(context, task.projectId)) return res.status(404).json({ error: "task not found" });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const snapshot = recordJson(task.approvalSnapshotJson);
  const projectBusinessName = task.project.businessName?.trim() || null;
  const agencyBusinessName = task.project.agencyClient?.name?.trim() || null;
  const projectNameLooksInternal = Boolean(
    projectBusinessName
    && (
      projectBusinessName.toLocaleLowerCase() === task.project.name.trim().toLocaleLowerCase()
      || /\bwebsite(?:\s+project)?$/i.test(projectBusinessName)
    ),
  );
  const confirmedBusinessName = agencyBusinessName && projectNameLooksInternal
    ? agencyBusinessName
    : projectBusinessName || agencyBusinessName;
  const approvedKeywords = task.project.keywordGroups.flatMap((group) => jsonStrings(group.keywords));
  const intakeTargetLocations = cleanGeographicTargetMarkets(jsonStrings(task.project.targetLocations));
  const verifiedServices = task.project.gapLocalSeoProfiles[0] ? jsonStrings(task.project.gapLocalSeoProfiles[0].services) : [];
  const businessEvidenceInput = {
    confirmedBusinessName,
    projectName: task.project.name,
    niche: task.project.niche,
    businessSummary: task.project.businessProfile?.businessSummary ?? null,
    offerSummary: task.project.businessProfile?.offerSummary ?? null,
    targetAudience: task.project.businessProfile?.targetAudience ?? null,
    primaryGoal: task.project.primaryGoal,
    targetLocations: intakeTargetLocations,
    approvedKeywords,
    verifiedServices,
  };
  const expectedBusinessFingerprint = businessEvidenceFingerprint({
    confirmedBusinessName,
    internalProjectName: task.project.name,
    industryDirection: task.project.niche,
    rawBusinessSummary: task.project.businessProfile?.businessSummary ?? null,
    rawOfferAnswer: task.project.businessProfile?.offerSummary ?? null,
    rawAudienceAnswer: task.project.businessProfile?.targetAudience ?? null,
    primaryGoal: task.project.primaryGoal,
    targetLocations: intakeTargetLocations,
    approvedKeywords,
    verifiedServices,
  });
  const saved = contentPlanSchema.safeParse(snapshot.contentPlan);
  const savedBusinessContext = saved.success ? aiBusinessContextSchema.safeParse(saved.data.aiBusinessContext) : null;
  const businessContext = savedBusinessContext?.success
    && savedBusinessContext.data.sourceFingerprint === expectedBusinessFingerprint
    && req.body?.regenerate !== true
    ? savedBusinessContext.data
    : await interpretApprovedBusinessEvidence(businessEvidenceInput);
  const pageCandidates = task.project.website?.crawlJobs[0]?.pages.map((page) => ({ url: page.url, title: page.seo?.title ?? null })) ?? [];
  const savedPlanningText = saved.success
    ? JSON.stringify({
      assignments: saved.data.pageAssignments,
      owners: saved.data.pagePlanningIntelligence.ownerMap,
      locations: saved.data.pagePlanningIntelligence.locationHierarchy,
    }).toLocaleLowerCase()
    : "";
  const savedUsesInternalProjectName = Boolean(
    saved.success
    && confirmedBusinessName
    && task.project.name.trim().toLocaleLowerCase() !== confirmedBusinessName.toLocaleLowerCase()
    && savedPlanningText.includes(task.project.name.trim().toLocaleLowerCase()),
  );
  const savedUsesBrandLedLocationHub = Boolean(
    saved.success
    && confirmedBusinessName
    && saved.data.pageAssignments.some((assignment) =>
      assignment.clusterRole === "location_hub"
      && assignment.canonicalKeyword.toLocaleLowerCase().startsWith(`${confirmedBusinessName.toLocaleLowerCase()} services in `),
    ),
  );
  const savedHasDuplicateStateAlias = Boolean(
    saved.success
    && task.project.businessLocationJson
    && typeof recordJson(task.project.businessLocationJson).stateProvince === "string"
    && saved.data.pagePlanningIntelligence.locationHierarchy.some((location) => location.name.toLocaleLowerCase() === String(recordJson(task.project.businessLocationJson).stateProvince).trim().toLocaleLowerCase())
    && saved.data.pagePlanningIntelligence.locationHierarchy.some((location) => intakeTargetLocations.some((target) => target.toLocaleLowerCase() === location.name.toLocaleLowerCase() && target.length > 3)),
  );
  const savedHasDuplicatePageKeys = Boolean(saved.success && (() => {
    const keys = saved.data.pageAssignments.map((assignment) => assignment.pageKey).filter((value): value is string => Boolean(value));
    return new Set(keys).size !== keys.length;
  })());
  const savedEvidenceChanged = !savedBusinessContext?.success
    || savedBusinessContext.data.sourceFingerprint !== expectedBusinessFingerprint;
  const savedHasCurrentArchitecture = saved.success
    && Boolean(saved.data.keywordNormalization)
    && saved.data.advancedSeoIntelligence.engines.length > 0
    && saved.data.pagePlanningIntelligence.keywordClusters.length > 0
    && (
      !saved.data.localSeo.enabled
      || !saved.data.localSeo.targetLocations.length
      || saved.data.locationAuthorityClusters.length > 0
    );
  const savedRequiresPlanUpgrade = saved.success && (
    savedEvidenceChanged
    || savedHasDuplicatePageKeys
    || (
      saved.data.workflowVersion !== CONTENT_PLAN_WORKFLOW_VERSION
      && !savedHasCurrentArchitecture
      && (
        (saved.data.localSeo.enabled && saved.data.localSeo.targetLocations.length > 0 && saved.data.locationAuthorityClusters.length === 0)
        || saved.data.advancedSeoIntelligence.engines.length === 0
        || saved.data.pagePlanningIntelligence.keywordClusters.length === 0
        || !saved.data.keywordNormalization
        || savedUsesInternalProjectName
        || savedUsesBrandLedLocationHub
        || savedHasDuplicateStateAlias
        || contentPlanHasUnnormalizedOwners(saved.data, intakeTargetLocations)
      )
    )
  );
  if (saved.success && req.body?.regenerate !== true && !savedRequiresPlanUpgrade) {
    const normalizedSavedPlan = ensureContentPlanHome({ ...saved.data, workflowVersion: CONTENT_PLAN_WORKFLOW_VERSION, aiBusinessContext: businessContext }, {
      projectName: task.project.name,
      businessName: businessContext.businessName,
      offer: businessContext.homepagePrimaryTopic,
      websiteUrl: task.project.websiteUrl,
      websitePages: pageCandidates,
    });
    const needsAiFaqRefresh = normalizedSavedPlan.pageAssignments.some((assignment) => (
      assignment.faqStrategyVersion !== "ai_seo_plan_v2"
      || (assignment.faqTopics?.length ?? 0) < 3
      || !assignment.seoTitle
      || !assignment.metaDescription
      || !assignment.contentOutline?.length
      || !assignment.contentBrief
      || !assignment.ctaSuggestion
    ));
    const plan = needsAiFaqRefresh ? await applyAiPageFaqSuggestions(normalizedSavedPlan, {
      business: businessContext,
      goal: task.project.primaryGoal?.trim() || "help qualified visitors take the next step",
      locations: normalizedSavedPlan.localSeo.targetLocations,
    }) : normalizedSavedPlan;
    const workflowVersionUpgraded = saved.data.workflowVersion !== CONTENT_PLAN_WORKFLOW_VERSION;
    if (workflowVersionUpgraded || (needsAiFaqRefresh && plan.pageAssignments.some((assignment) => assignment.faqStrategyVersion === "ai_seo_plan_v2"))) {
      await prisma.executionTask.update({
        where: { id: task.id },
        data: { approvalSnapshotJson: { ...snapshot, contentPlan: plan, businessContextPreparedAt: new Date().toISOString(), ...(needsAiFaqRefresh ? { faqPlanPreparedAt: new Date().toISOString() } : {}), ...(workflowVersionUpgraded ? { contentPlanWorkflowUpgradedAt: new Date().toISOString() } : {}) } as Prisma.InputJsonValue },
      });
    }
    return res.json({ task, plan, existing: true, pageCandidates });
  }
  const strategy = task.project.strategyPlans[0];
  const requestedLocalSeo = z.object({ localSeoEnabled: z.boolean().optional(), targetLocations: z.array(z.string().trim().min(2).max(160)).max(20).optional() }).parse(req.body ?? {});
  const localSeoEnabled = requestedLocalSeo.localSeoEnabled ?? intakeTargetLocations.length > 0;
  const targetLocations = localSeoEnabled
    ? cleanGeographicTargetMarkets(requestedLocalSeo.targetLocations?.length ? requestedLocalSeo.targetLocations : intakeTargetLocations)
    : [];
  if (localSeoEnabled && !targetLocations.length) return res.status(400).json({ error: "Local SEO requires at least one geographic target city, region, province/state, or country." });
  const businessLocation = recordJson(task.project.businessLocationJson);
  const targetCountry = typeof businessLocation.country === "string" ? businessLocation.country.trim() : task.project.website?.targetCountry ?? null;
  const targetStateProvince = typeof businessLocation.stateProvince === "string" ? businessLocation.stateProvince.trim() : null;
  const physicalCity = typeof businessLocation.city === "string" ? businessLocation.city.trim() : null;
  const localProfile = task.project.gapLocalSeoProfiles[0] ?? null;
  const confirmedLocalServices = localProfile ? jsonStrings(localProfile.services) : [];
  const confirmedServiceCities = localProfile ? jsonStrings(localProfile.citiesServed) : [];
  const locationInputs: SeoPlannerInput["locations"] = targetLocations.map((name) => ({
    name,
    level: targetCountry && name.toLocaleLowerCase() === targetCountry.toLocaleLowerCase()
      ? "country"
      : targetStateProvince && name.toLocaleLowerCase() === targetStateProvince.toLocaleLowerCase()
        ? "state_province"
        : "city",
    physical: Boolean(physicalCity && name.toLocaleLowerCase() === physicalCity.toLocaleLowerCase()),
    serviceArea: confirmedServiceCities.length
      ? confirmedServiceCities.some((city) => city.toLocaleLowerCase() === name.toLocaleLowerCase())
      : true,
  }));
  const approvedServices = confirmedLocalServices.length ? confirmedLocalServices : businessContext.primaryServices;
  const approvedBusinessGeographies = [
    ...(physicalCity ? [{ level: "city", location: physicalCity }] : []),
    ...(targetStateProvince ? [{ level: "state_province", location: targetStateProvince }] : []),
    ...(targetCountry ? [{ level: "country", location: targetCountry }] : []),
  ].filter((entry, index, all) => all.findIndex((candidate) => candidate.location.toLocaleLowerCase() === entry.location.toLocaleLowerCase()) === index);
  const serviceAvailability: NonNullable<SeoPlannerInput["serviceAvailability"]> = approvedServices.flatMap((service) => [
    ...approvedBusinessGeographies.map((entry) => ({ service, location: entry.location, available: true, verified: true })),
    ...confirmedServiceCities.map((location) => ({ service, location, available: true, verified: true })),
  ]);
  const localEvidence: NonNullable<SeoPlannerInput["localEvidence"]> = [
    ...approvedBusinessGeographies.map((entry) => ({
      id: `project-business-location-${entry.level}-${entry.location.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      location: entry.location,
      type: entry.level === "city"
        ? "approved physical business location inherited from project or client intake"
        : "approved geographic context of the single physical business address",
      verified: true,
    })),
    ...(localProfile ? confirmedServiceCities.map((location) => ({ id: `local-profile-${localProfile.id}-${location.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`, location, type: "approved Local SEO service-area profile", verified: true })) : []),
  ];
  const keywordSignals = task.project.keywordResearchRuns.flatMap((run) => [
    { keyword: run.seedKeyword, location: run.locationName, searchVolume: run.averageVolume, competitionIndex: null, competitorCount: run.competitorCount },
    ...run.ideas.map((idea) => ({ keyword: idea.keyword, location: run.locationName, searchVolume: idea.avgMonthlySearches, competitionIndex: idea.competitionIndex, competitorCount: run.competitorCount })),
  ]);
  const keywordNormalization = await normalizeKeywordsWithAi({
    keywords: approvedKeywords,
    locations: targetLocations,
    services: confirmedLocalServices.length ? confirmedLocalServices : businessContext.primaryServices,
    businessName: businessContext.businessName,
    industry: businessContext.industry,
    audience: businessContext.audienceSummary,
    offer: businessContext.coreBusinessValue,
  });
  const generatedPlanBase = {
    workflowVersion: CONTENT_PLAN_WORKFLOW_VERSION,
    ...contentPlanFor({
    projectName: task.project.name,
    businessName: businessContext.businessName,
    goal: task.project.primaryGoal,
    markets: targetLocations,
    keywords: approvedKeywords,
    offer: businessContext.homepagePrimaryTopic,
    audience: businessContext.audienceSummary,
    contentStrategy: strategy?.contentStrategy ?? null,
    websiteUrl: task.project.websiteUrl,
    localSeoEnabled,
    websitePages: task.project.website?.crawlJobs[0]?.pages.map((page) => ({ url: page.url, title: page.seo?.title ?? null })) ?? [],
    keywordSignals,
    businessType: businessContext.industry,
    services: confirmedLocalServices.length ? confirmedLocalServices : businessContext.primaryServices,
    targetCountry,
    targetStateProvince,
    locationInputs,
    // A business has one approved physical address. Broader states, countries,
    // and other target markets are service areas—not additional offices.
    physicalLocations: [physicalCity].filter((value): value is string => Boolean(value)),
    serviceAvailability,
    competitors: jsonStrings(task.project.competitors),
    localEvidence,
    semanticKeywords: keywordNormalization.semanticKeywords,
    }),
    keywordNormalization: {
      version: keywordNormalization.version,
      mode: keywordNormalization.mode,
      reviewedCount: keywordNormalization.reviewedCount,
      acceptedCount: keywordNormalization.acceptedCount,
      deterministicProtectedCount: keywordNormalization.deterministicProtectedCount,
    },
  };
  const generatedPlan = await applyAiPageFaqSuggestions({ ...generatedPlanBase, aiBusinessContext: businessContext }, {
    business: businessContext,
    goal: task.project.primaryGoal?.trim() || "help qualified visitors take the next step",
    locations: targetLocations,
  });
  const plan = contentPlanSchema.parse(savedRequiresPlanUpgrade && saved.success ? (() => {
    const assignmentTargets = new Set(generatedPlan.pageAssignments.map((assignment) => assignment.targetUrl.trim().toLocaleLowerCase()));
    const preservedAssignments = saved.data.pageAssignments.filter((assignment) => (
      !assignmentTargets.has(assignment.targetUrl.trim().toLocaleLowerCase())
      && (!assignment.pageKey || /added manually|custom page/i.test(assignment.gapAnalysis))
    ));
    const customPageUpdates = preservedAssignments.map((assignment) =>
      `${assignment.recommendedAction === "update_existing" ? "Update" : "Create"} custom page: “${assignment.pageName}” · ${assignment.targetUrl}`,
    );
    const customKeywordMappings = preservedAssignments.map((assignment) =>
      `Custom page: “${assignment.canonicalKeyword}” → ${assignment.targetUrl}`,
    );
    const customPageMap = preservedAssignments.map((assignment) =>
      `${assignment.pageName} → ${assignment.targetUrl} · ${assignment.recommendedAction.replaceAll("_", " ")} · ${assignment.searchIntent} intent`,
    );
    const customPlanningChecks = preservedAssignments.map((assignment) =>
      `“${assignment.canonicalKeyword}” · ${assignment.searchIntent} intent · Confirm custom URL ${assignment.targetUrl} before drafting.`,
    );
    return {
      ...generatedPlan,
      pageAssignments: [...generatedPlan.pageAssignments, ...preservedAssignments].slice(0, 500),
      pageUpdates: [...generatedPlan.pageUpdates, ...customPageUpdates].slice(0, 500),
      keywordMapping: [...generatedPlan.keywordMapping, ...customKeywordMappings].slice(0, 500),
      pageMap: [...generatedPlan.pageMap, ...customPageMap].slice(0, 500),
      planningChecks: [...generatedPlan.planningChecks, ...customPlanningChecks].slice(0, 500),
    };
  })() : generatedPlan);
  const updated = await prisma.executionTask.update({ where: { id: task.id }, data: { status: "in_progress", actionButtonLabel: "Review Content Plan", relatedUrl: `/guided-projects/${task.projectId}?tab=execution&actionTask=${task.id}#execution-tasks`, approvalSnapshotJson: { ...snapshot, contentPlan: plan, contentPlanStatus: "draft", preparedAt: new Date().toISOString() } as Prisma.InputJsonValue } });
  await prisma.$transaction((tx) => recordWorkspaceActivity(tx, { context, action: "content_plan.prepared", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, nextJson: { pages: plan.pageUpdates.length, supportingContent: plan.supportingContent.length, briefs: plan.contentBriefs.length } }));
    res.json({ task: updated, plan, existing: false, pageCandidates });
  })().catch(next);
});

executionTasksRouter.post("/execution-tasks/:id/content-plan/save", (req, res, next) => {
  void (async () => {
  const parsed = contentPlanSaveSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await executionClientScope(req);
  const task = await prisma.executionTask.findFirst({ where: { id: req.params.id, ...(clientId ? { clientId } : {}) }, include: { project: { select: { id: true, name: true, businessName: true, niche: true, websiteUrl: true, agencyClientId: true, agencyClient: { select: { name: true } }, businessProfile: { select: { offerSummary: true } } } } } });
  if (!task?.project || !task.projectId || !/(?:content\s*plan|seo\s*page\s*map)/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`)) return res.status(404).json({ error: "Content-plan task not found" });
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, task.projectId)) return res.status(404).json({ error: "task not found" });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const snapshot = recordJson(task.approvalSnapshotJson);
  const normalizedPlan = reconcileContentPlanConflicts(repairContentPlanPageIdentities(ensureContentPlanHome(parsed.data.plan, {
    projectName: task.project.name,
    businessName: parsed.data.plan.aiBusinessContext?.businessName
      || task.project.businessName?.trim()
      || task.project.agencyClient?.name?.trim()
      || null,
    offer: parsed.data.plan.aiBusinessContext?.homepagePrimaryTopic || task.project.niche,
    websiteUrl: task.project.websiteUrl,
  })));
  const normalizedTarget = (value: string) => value.trim().toLocaleLowerCase().replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "") || "/";
  const targetOwners = new Map<string, string>();
  const intentOwners = new Map<string, string>();
  for (const assignment of normalizedPlan.pageAssignments) {
    const target = normalizedTarget(assignment.targetUrl);
    if (targetOwners.has(target)) return res.status(409).json({ error: `Two planned pages use ${assignment.targetUrl}. Merge them or assign a unique target URL before saving.` });
    targetOwners.set(target, assignment.pageName);
    const fallbackOwner = `${assignment.canonicalKeyword.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}::${assignment.primaryIntent || assignment.searchIntent}::${assignment.location?.toLocaleLowerCase() || "global"}`;
    const owner = assignment.intentOwner?.trim().toLocaleLowerCase() || fallbackOwner;
    if (intentOwners.has(owner)) return res.status(409).json({ error: `${assignment.pageName} competes with ${intentOwners.get(owner)} for the same intent and geographic scope. Merge the pages or change the intent owner before saving.` });
    intentOwners.set(owner, assignment.pageName);
  }
  const savedPlan = { ...normalizedPlan, pageMap: normalizedPlan.pageAssignments.map((assignment, index) => `Page ${index + 1} | Name: ${assignment.pageName} | Target URL: ${assignment.targetUrl} | Search intent: ${assignment.searchIntent} | Action: ${assignment.recommendedAction.replaceAll("_", " ")} | Canonical intent: “${assignment.canonicalKeyword}” | Secondary keywords: ${assignment.secondaryKeywords.length ? assignment.secondaryKeywords.join(", ") : "none"} | Source: ${assignment.source === "existing_crawl" ? "selected from website crawl" : "suggested and confirmed"}.`) };
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.executionTask.update({
      where: { id: task.id },
      data: {
        status: "in_progress",
        actionButtonLabel: "Review Content Plan",
        relatedUrl: `/guided-projects/${task.projectId}?tab=execution&actionTask=${task.id}#execution-tasks`,
        approvalSnapshotJson: { ...snapshot, contentPlan: savedPlan, contentPlanReviewComment: parsed.data.reviewComment, contentPlanStatus: "saved", savedAt: new Date().toISOString() } as Prisma.InputJsonValue,
        approvedAt: null,
        submittedAt: null,
        completedAt: null,
        approvalDecision: null,
        blockedReason: null,
      },
    });
    await recordWorkspaceActivity(tx, { context, action: "content_plan.saved", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, nextJson: { pages: savedPlan.pageUpdates.length, pageAssignments: savedPlan.pageAssignments.length, supportingContent: savedPlan.supportingContent.length, briefs: savedPlan.contentBriefs.length, reviewComment: parsed.data.reviewComment || null } });
    return row;
  });
    res.json({ task: updated, plan: savedPlan, reviewComment: parsed.data.reviewComment });
  })().catch(next);
});

executionTasksRouter.post("/execution-tasks/:id/submit-for-approval", async (req, res) => {
  try {
    const context = await workspaceContext(req);
    const input = z.object({ notes: z.string().trim().max(3000).optional(), confirmed: z.boolean().optional(), approvalRoute: z.enum(["self_approve", "send_to_team"]).optional(), seoReview: z.object({ intent: z.boolean(), metadata: z.boolean(), evidence: z.boolean(), internalLinks: z.boolean(), duplication: z.boolean(), aeoGeo: z.boolean() }).optional() }).parse(req.body ?? {});
    res.json(await submitTaskApproval(context, req.params.id, input));
  } catch (error) {
    const typed = error as { statusCode?: number; message?: string };
    res.status(typed.statusCode ?? 400).json({ error: typed.message ?? "Could not submit this task for approval." });
  }
});

executionTasksRouter.post("/execution-tasks/:id/seo-plan/prepare", async (req, res) => {
  const clientId = await executionClientScope(req);
  const task = await prisma.executionTask.findFirst({
    where: { id: req.params.id, ...(clientId ? { clientId } : {}) },
    include: {
      project: {
        include: {
          businessProfile: true,
          keywordGroups: { where: { status: "approved" } },
          strategyPlans: { orderBy: [{ version: "desc" }, { updatedAt: "desc" }], take: 1 },
          website: { include: { crawlJobs: { where: { status: "completed" }, orderBy: { createdAt: "desc" }, take: 1, include: { issues: { where: { status: "open" }, orderBy: { weightImpact: "desc" }, take: 12 } } } } },
        },
      },
    },
  });
  if (!task || !task.project || !/(create seo (plan|page map)|map (seo|local) keyword opportunities)/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`)) return res.status(404).json({ error: "SEO page-map task not found" });
  const context = await workspaceContext(req);
  if (!task.projectId || !await canAccessProject(context, task.projectId)) return res.status(404).json({ error: "task not found" });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const snapshot = recordJson(task.approvalSnapshotJson);
  const existingPlan = seoPlanSchema.safeParse(snapshot.seoPlan);
  if (existingPlan.success) return res.json({ task, plan: existingPlan.data, existing: true });
  const strategy = task.project.strategyPlans[0];
  const keywords = task.project.keywordGroups.flatMap((group) => jsonStrings(group.keywords));
  const targetMarkets = jsonStrings(task.project.targetLocations);
  const crawlIssues = task.project.website?.crawlJobs[0]?.issues.map((issue) => issue.recommendation || issue.message) ?? [];
  const plan = seoPlanSchema.parse(seoPlanFor({
    projectName: task.project.name,
    primaryGoal: task.project.primaryGoal,
    secondaryGoals: jsonStrings(task.project.secondaryGoals),
    targetMarkets,
    keywords,
    niche: task.project.niche,
    offer: task.project.businessProfile?.offerSummary ?? null,
    seoStrategy: strategy?.seoStrategy ?? null,
    localSeoStrategy: strategy?.localSeoStrategy ?? null,
    contentStrategy: strategy?.contentStrategy ?? null,
    authorityStrategy: strategy?.authorityStrategy ?? null,
    crawlIssues,
    hasWebsite: Boolean(task.project.websiteId || task.project.websiteUrl),
  }));
  const updated = await prisma.executionTask.update({ where: { id: task.id }, data: { title: "Create SEO Page Map", description: "Convert approved keywords into intent clusters, target pages, metadata, schema, FAQs, and content briefs for review.", status: "in_progress", actionButtonLabel: "Review SEO Page Map", relatedUrl: `/guided-projects/${task.projectId}?tab=execution`, approvalSnapshotJson: { ...snapshot, seoPlan: plan, seoPlanStatus: "draft", preparedAt: new Date().toISOString() } as Prisma.InputJsonValue } });
  await prisma.$transaction((tx) => recordWorkspaceActivity(tx, { context, action: "seo_plan.prepared", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, nextJson: { objectives: plan.objectives.length, keywords: plan.keywordPriorities.length } }));
  res.json({ task: updated, plan, existing: false });
});

executionTasksRouter.post("/execution-tasks/:id/seo-plan/confirm", async (req, res) => {
  const parsed = seoPlanSchema.safeParse(req.body?.plan);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await executionClientScope(req);
  const task = await prisma.executionTask.findFirst({ where: { id: req.params.id, ...(clientId ? { clientId } : {}) }, include: { project: { select: { id: true, agencyClientId: true } } } });
  if (!task || !task.project || !task.projectId || !/(create seo (plan|page map)|map (seo|local) keyword opportunities)/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`)) return res.status(404).json({ error: "SEO page-map task not found" });
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, task.projectId)) return res.status(404).json({ error: "task not found" });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const plan = parsed.data;
  const childDefinitions = [
    { key: "technical", moduleName: "site_analysis", title: "Implement SEO technical priorities", description: plan.technicalPriorities.join("; "), priority: "high", relatedUrl: `/site-analysis?projectId=${task.projectId}` },
    { key: "content", moduleName: "content", title: "Execute the SEO content roadmap", description: plan.contentRoadmap.join("; "), priority: "medium", relatedUrl: `/guided-projects/${task.projectId}?tab=execution` },
    { key: "authority", moduleName: "backlinks", title: "Build SEO authority and local signals", description: [...plan.localSeoActions, ...plan.authorityActions].join("; "), priority: "medium", relatedUrl: `/backlinks?projectId=${task.projectId}` },
    { key: "measurement", moduleName: "reports", title: "Measure SEO plan performance", description: plan.kpis.join("; "), priority: "low", relatedUrl: `/reports?projectId=${task.projectId}` },
  ] as const;
  const updated = await withTransactionRetry(() => prisma.$transaction(async (tx) => {
    // Keyword-to-page mapping is completed by the approved SEO Page Map itself.
    // Remove the older duplicate manual task instead of asking the user to map it again.
    await tx.executionTask.deleteMany({ where: { projectId: task.projectId!, dedupeKey: `seo-plan:${task.projectId}:keywords`, sourceType: "seo_plan_action" } });
    for (const child of childDefinitions) {
      const dedupeKey = `seo-plan:${task.projectId}:${child.key}`;
      const data = { clientId: task.clientId, websiteId: task.websiteId, projectId: task.projectId, executionPlanId: task.executionPlanId, moduleName: child.moduleName, sourceType: "seo_plan_action", sourceId: task.id, title: child.title, description: child.description || "Review and complete this part of the approved SEO plan.", expectedOutcome: `Completes the ${child.title.toLowerCase()} portion of the project SEO plan.`, priority: child.priority, automationLevel: "manual_guided", status: "ready", requiresApproval: false, manualRequired: true, actionButtonLabel: "Review & Execute", relatedUrl: child.relatedUrl, manualInstructions: child.description || "Follow the approved SEO plan and record completion evidence.", impact: "Moves the approved SEO plan into measurable execution." };
      const existing = await tx.executionTask.findUnique({ where: { dedupeKey } });
      if (!existing) await tx.executionTask.create({ data: { ...data, dedupeKey } });
      else if (!terminalStatuses.has(existing.status)) await tx.executionTask.update({ where: { id: existing.id }, data });
    }
    const snapshot = recordJson(task.approvalSnapshotJson);
    const parent = await tx.executionTask.update({ where: { id: task.id }, data: { title: "Create SEO Page Map", status: "completed", completedAt: new Date(), actionButtonLabel: "View SEO Page Map", relatedUrl: `/guided-projects/${task.projectId}?tab=execution`, approvalSnapshotJson: { ...snapshot, seoPlan: plan, seoPlanStatus: "confirmed", confirmedAt: new Date().toISOString(), childTaskCount: childDefinitions.length } as Prisma.InputJsonValue } });
    await recordWorkspaceActivity(tx, { context, action: "seo_plan.confirmed", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, nextJson: { childTasksCreated: childDefinitions.length, keywordPriorities: plan.keywordPriorities.length } });
    return parent;
  }));
  const tasks = await prisma.executionTask.findMany({ where: { projectId: task.projectId }, orderBy: [{ status: "asc" }, { priority: "asc" }, { updatedAt: "desc" }], take: 500, include: { dependencies: { include: { requiredTask: { select: { id: true, title: true, status: true } } } } } });
  res.json({ task: updated, plan, tasks, childTaskCount: childDefinitions.length });
});

executionTasksRouter.post("/execution-tasks/:id/ranking-plan/prepare", async (req, res) => {
  const clientId = await executionClientScope(req);
  const task = await prisma.executionTask.findFirst({
    where: { id: req.params.id, ...(clientId ? { clientId } : {}) },
    include: { project: { include: { businessProfile: true, keywordGroups: { where: { status: "approved" } } } }, website: { select: { domain: true, rootUrl: true } } },
  });
  if (!task || task.sourceType !== "keyword_research_run" || !/ranking plan/i.test(task.title)) return res.status(404).json({ error: "ranking-plan task not found" });
  const context = await workspaceContext(req);
  if (!task.projectId || !await canAccessProject(context, task.projectId)) return res.status(404).json({ error: "task not found" });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const snapshot = recordJson(task.approvalSnapshotJson);
  const existingPlan = rankingPlanSchema.safeParse(snapshot.rankingPlan);
  if (existingPlan.success) return res.json({ task, plan: existingPlan.data, existing: true });
  const run = task.sourceId ? await prisma.keywordResearchRun.findUnique({ where: { id: task.sourceId }, include: { competitors: { orderBy: { rank: "asc" }, take: 5 } } }) : null;
  const keyword = run?.seedKeyword || rankingKeywordFromTitle(task.title);
  const targetMarkets = Array.isArray(task.project.targetLocations) ? task.project.targetLocations.filter((item): item is string => typeof item === "string") : [];
  const plan = rankingPlanFor({
    keyword,
    location: run?.locationName || targetMarkets[0] || "Not specified",
    targetUrl: run?.targetUrl || run?.rankingUrl || task.website?.rootUrl || task.project.websiteUrl,
    domain: run?.targetDomain || task.website?.domain || null,
    searchVolume: run?.averageVolume ?? null,
    currentRank: run?.manualRank ?? run?.targetRank ?? null,
    competitors: run?.competitors.map((competitor) => competitor.domain) ?? [],
    targetMarkets,
    offer: task.project.businessProfile?.offerSummary ?? task.project.niche,
  });
  const updated = await prisma.executionTask.update({ where: { id: task.id }, data: { status: "in_progress", actionButtonLabel: "Review Ranking Plan", approvalSnapshotJson: { ...snapshot, rankingPlan: plan, rankingPlanStatus: "draft", preparedAt: new Date().toISOString() } as Prisma.InputJsonValue } });
  await prisma.$transaction((tx) => recordWorkspaceActivity(tx, { context, action: "ranking_plan.prepared", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, nextJson: { keyword: plan.keyword, targetMode: plan.targetMode, targetUrl: plan.targetUrl } }));
  res.json({ task: updated, plan, existing: false });
});

executionTasksRouter.post("/execution-tasks/:id/ranking-plan/confirm", async (req, res) => {
  const parsed = rankingPlanSchema.safeParse(req.body?.plan);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await executionClientScope(req);
  const task = await prisma.executionTask.findFirst({ where: { id: req.params.id, ...(clientId ? { clientId } : {}) }, include: { project: { select: { id: true, agencyClientId: true } } } });
  if (!task || task.sourceType !== "keyword_research_run" || !task.projectId || !task.websiteId) return res.status(404).json({ error: "ranking-plan task not found" });
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, task.projectId)) return res.status(404).json({ error: "task not found" });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const plan = parsed.data;
  const rankingKey = plan.keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "keyword";
  const childInputs: TaskInput[] = [
    { clientId: task.clientId, websiteId: task.websiteId, projectId: task.projectId, moduleName: "keyword_research", sourceType: "ranking_plan_page", sourceId: task.id, dedupeKey: `ranking-plan:${task.projectId}:${rankingKey}:page`, title: `${plan.targetMode === "create_new" ? "Create" : "Optimize"} the target page for “${plan.keyword}”`, description: `${plan.pageTitle}. ${plan.contentSections.join("; ")}.`, expectedOutcome: "A focused page matches the keyword intent and provides a clear conversion path.", priority: task.priority === "critical" ? "high" : task.priority as "high" | "medium" | "low", automationLevel: "manual_guided", manualRequired: true, actionButtonLabel: "Open Page Plan", relatedUrl: task.relatedUrl, manualInstructions: `Use the saved ranking plan. Target: ${plan.targetUrl || "create a new page"}.`, impact: "Creates the primary page required to compete for this keyword." },
    { clientId: task.clientId, websiteId: task.websiteId, projectId: task.projectId, moduleName: "content", sourceType: "ranking_plan_content", sourceId: task.id, dedupeKey: `ranking-plan:${task.projectId}:${rankingKey}:content`, title: `Create supporting content for “${plan.keyword}”`, description: `Support the target page with: ${plan.contentSections.slice(0, 4).join("; ")}.`, expectedOutcome: "Supporting content increases topical coverage and routes relevant visitors to the target page.", priority: "medium", automationLevel: "prepare", manualRequired: true, actionButtonLabel: "Create Content", relatedUrl: `/ai-content?projectId=${task.projectId}`, manualInstructions: "Create or update supporting content, then link it to the selected target page.", impact: "Builds topical authority around the ranking target." },
    { clientId: task.clientId, websiteId: task.websiteId, projectId: task.projectId, moduleName: "site_analysis", sourceType: "ranking_plan_internal_links", sourceId: task.id, dedupeKey: `ranking-plan:${task.projectId}:${rankingKey}:links`, title: `Add internal links for “${plan.keyword}”`, description: plan.internalLinkActions.join("; "), expectedOutcome: "The target page receives stronger internal relevance and is easier for users and crawlers to discover.", priority: "medium", automationLevel: "manual_guided", manualRequired: true, actionButtonLabel: "Review Internal Links", relatedUrl: `/site-analysis?projectId=${task.projectId}`, manualInstructions: plan.internalLinkActions.join("; "), impact: "Improves discovery and internal link equity." },
    { clientId: task.clientId, websiteId: task.websiteId, projectId: task.projectId, moduleName: "reports", sourceType: "ranking_plan_measurement", sourceId: task.id, dedupeKey: `ranking-plan:${task.projectId}:${rankingKey}:measure`, title: `Measure ranking progress for “${plan.keyword}”`, description: plan.successMetrics.join("; "), expectedOutcome: "The team can measure whether the ranking plan improves visibility and conversions.", priority: "low", automationLevel: "manual_guided", manualRequired: true, actionButtonLabel: "Open Keyword Report", relatedUrl: task.relatedUrl, manualInstructions: "Review rankings, impressions, clicks, and conversions after implementation.", impact: "Connects execution to measurable search and business outcomes." },
  ];
  const result = await withTransactionRetry(() => prisma.$transaction(async (tx) => {
    for (const input of childInputs) await upsertTask(tx, input);
    const snapshot = recordJson(task.approvalSnapshotJson);
    const parent = await tx.executionTask.update({ where: { id: task.id }, data: { status: "completed", completedAt: new Date(), actionButtonLabel: "View Ranking Plan", approvalSnapshotJson: { ...snapshot, rankingPlan: plan, rankingPlanStatus: "confirmed", confirmedAt: new Date().toISOString(), childTaskCount: childInputs.length } as Prisma.InputJsonValue } });
    await recordWorkspaceActivity(tx, { context, action: "ranking_plan.confirmed", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, nextJson: { keyword: plan.keyword, targetMode: plan.targetMode, childTasksCreated: childInputs.length } });
    return parent;
  }));
  const tasks = await prisma.executionTask.findMany({ where: { OR: [{ projectId: task.projectId }, { websiteId: task.websiteId }] }, orderBy: [{ status: "asc" }, { priority: "asc" }, { updatedAt: "desc" }], take: 500, include: { dependencies: { include: { requiredTask: { select: { id: true, title: true, status: true } } } } } });
  res.json({ task: result, plan, tasks, childTaskCount: childInputs.length });
});

executionTasksRouter.post("/execution-tasks/:id/page-optimization/prepare", async (req, res) => {
  const clientId = await executionClientScope(req);
  const task = await prisma.executionTask.findFirst({ where: { id: req.params.id, ...(clientId ? { clientId } : {}) }, include: { project: { select: { id: true, agencyClientId: true } } } });
  if (!task || task.sourceType !== "ranking_plan_page" || !task.projectId || !task.websiteId || !task.sourceId) return res.status(404).json({ error: "page-optimization task not found" });
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, task.projectId)) return res.status(404).json({ error: "task not found" });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const snapshot = recordJson(task.approvalSnapshotJson);
  const existing = pageOptimizationSchema.safeParse(snapshot.pageOptimization);
  if (existing.success) return res.json({ task, optimization: existing.data, existing: true });
  const parent = await prisma.executionTask.findUnique({ where: { id: task.sourceId }, select: { approvalSnapshotJson: true } });
  const parentSnapshot = recordJson(parent?.approvalSnapshotJson);
  const rankingPlan = rankingPlanSchema.safeParse(parentSnapshot.rankingPlan);
  if (!rankingPlan.success) return res.status(409).json({ error: "Save the ranking plan before preparing page optimization." });
  const plan = rankingPlan.data;
  const currentPage = plan.targetUrl ? await prisma.page.findFirst({ where: { crawlJob: { websiteId: task.websiteId, status: "completed" }, OR: [{ url: plan.targetUrl }, { finalUrl: plan.targetUrl }] }, orderBy: { crawlJob: { createdAt: "desc" } }, select: { wordCount: true, seo: { select: { title: true, metaDescription: true, h1Text: true } } } }) : null;
  const optimization: PageOptimization = {
    keyword: plan.keyword,
    targetUrl: plan.targetUrl,
    current: { title: currentPage?.seo?.title ?? null, metaDescription: currentPage?.seo?.metaDescription ?? null, h1: firstJsonString(currentPage?.seo?.h1Text), wordCount: currentPage?.wordCount ?? null },
    proposed: {
      title: plan.pageTitle,
      metaDescription: `Discover ${plan.pageTitle.toLowerCase()}. Compare the approach, benefits, proof, and next steps for a solution aligned with your business goals.`.slice(0, 300),
      h1: plan.pageTitle,
      callToAction: "Request a consultation to discuss the right solution and next steps.",
    },
    keywordVariants: plan.recommendedKeywordVariants,
    sections: plan.contentSections.map((heading) => ({ heading, guidance: `Explain ${heading.toLowerCase()} in direct language, support the claim with relevant proof, and connect it naturally to ${plan.keyword}.` })),
    internalLinkActions: plan.internalLinkActions,
    implementationChecklist: ["Confirm the keyword and page intent", "Update the title, meta description, and primary heading", "Add or revise the recommended content sections", "Add the internal links using descriptive anchor text", "Verify the call to action on mobile and desktop", "Publish through the approved workflow", "Request indexing and monitor the saved success metrics"],
  };
  const updated = await prisma.executionTask.update({ where: { id: task.id }, data: { status: "in_progress", actionButtonLabel: "Review Page Optimization", approvalSnapshotJson: { ...snapshot, pageOptimization: optimization, pageOptimizationStatus: "draft", preparedAt: new Date().toISOString() } as Prisma.InputJsonValue } });
  await prisma.$transaction((tx) => recordWorkspaceActivity(tx, { context, action: "page_optimization.prepared", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, nextJson: { keyword: optimization.keyword, targetUrl: optimization.targetUrl } }));
  res.json({ task: updated, optimization, existing: false });
});

executionTasksRouter.post("/execution-tasks/:id/page-optimization/save", async (req, res) => {
  const parsed = pageOptimizationSchema.safeParse(req.body?.optimization);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const applied = req.body?.applied === true;
  const evidenceNote = typeof req.body?.evidenceNote === "string" ? req.body.evidenceNote.trim().slice(0, 2000) : "";
  if (applied && evidenceNote.length < 3) return res.status(400).json({ error: "Add a short note confirming where the page changes were applied." });
  const clientId = await executionClientScope(req);
  const task = await prisma.executionTask.findFirst({ where: { id: req.params.id, ...(clientId ? { clientId } : {}) }, include: { project: { select: { id: true, agencyClientId: true } } } });
  if (!task || task.sourceType !== "ranking_plan_page" || !task.projectId) return res.status(404).json({ error: "page-optimization task not found" });
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, task.projectId)) return res.status(404).json({ error: "task not found" });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const snapshot = recordJson(task.approvalSnapshotJson);
  const status = applied ? "completed" : "in_progress";
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.executionTask.update({ where: { id: task.id }, data: { status, completedAt: applied ? new Date() : null, actionButtonLabel: applied ? "View Page Optimization" : "Review & Apply", internalNotes: evidenceNote || task.internalNotes, approvalSnapshotJson: { ...snapshot, pageOptimization: parsed.data, pageOptimizationStatus: applied ? "applied" : "saved", savedAt: new Date().toISOString(), ...(applied ? { appliedAt: new Date().toISOString(), evidenceNote } : {}) } as Prisma.InputJsonValue } });
    await recordWorkspaceActivity(tx, { context, action: applied ? "page_optimization.applied" : "page_optimization.saved", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, nextJson: { keyword: parsed.data.keyword, targetUrl: parsed.data.targetUrl, status, evidenceNote: evidenceNote || null } });
    return row;
  });
  res.json({ task: updated, optimization: parsed.data, applied });
});

executionTasksRouter.post("/execution-tasks/:id/publish", (req, res) => publishingAction(res, async () => {
  const context = await workspaceContext(req);
  return startTaskPublishing(context, req.params.id, publishSchema.parse(req.body ?? {}));
}));

executionTasksRouter.post("/execution-tasks/:id/publish/verify", (req, res) => publishingAction(res, async () => {
  const context = await workspaceContext(req);
  return verifyTaskPublishing(context, req.params.id, publishVerificationSchema.parse(req.body));
}));

executionTasksRouter.post("/execution-tasks/:id/skip", async (req, res) => {
  const clientId = await executionClientScope(req);
  const existing = await prisma.executionTask.findFirst({
    where: { id: req.params.id, ...(clientId ? { clientId } : {}) },
  });
  if (!existing) return res.status(404).json({ error: "task not found" });
  const task = await prisma.executionTask.update({ where: { id: existing.id }, data: { status: "skipped", skippedAt: new Date() } });
  res.json({ task });
});
