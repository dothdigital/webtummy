import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "@webtummy/db";
import { requireAuth, requireRole } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { config } from "../config.js";
import { commitUsage, modelForFeature, preflightUsage, refundUsage } from "../usage-engine.js";
import { buildCampaignExecutionTasks, isExistingWebsiteCampaign, projectTypes, projectWorkflowDefinitions, requiresSiteAnalysisBeforeStrategy } from "../campaign-intelligence.js";
import { canAccessAgencyClient, canAccessProject, createWorkspaceNotification, hasWorkspacePermission, recordWorkspaceActivity, requireWorkspaceRole, workspaceContext } from "../workspace-access.js";
import { clientDefaults } from "../dev002.js";
import { validateProjectCreation, websiteStatuses } from "../dev003.js";
import { cleanGeographicTargetMarkets, formatBusinessLocation, locationIsComplete, type BusinessLocation } from "../project-location.js";
import { locationDefaultsFromSettings, resolveProjectLocations, withLocationDefaults } from "../dev004.js";
import { goalContext, normalizeProjectGoals } from "../dev005.js";
import { opportunityDecisionStatus, opportunityInputSummary, opportunityRunMode, rankedOpportunityRecommendations } from "../dev006.js";
import { buildKeywordGroups, keywordIntakeSufficient, normalizeKeywordList } from "../dev007.js";
import { buildExtendedStrategyAnalysis } from "../dev014.js";
import { buildIntelligentExecutionTasks, type StrategyRecommendation } from "../dev015.js";

export const guidedProjectsRouter = Router();
guidedProjectsRouter.use(requireAuth);

function normalizeIntakeKeywords(values: string[], targetLocations: unknown) {
  const locations = new Set(cleanGeographicTargetMarkets(Array.isArray(targetLocations) ? targetLocations.map(String) : []).map((item) => item.toLocaleLowerCase()));
  return [...new Map(values.flatMap((item) => item.split(/[;\n]/)).map((item) => item.trim()).filter((item) => {
    const normalized = item.toLocaleLowerCase().replace(/[.!]+$/, "").trim();
    if (!normalized || locations.has(normalized)) return false;
    if (/^(?:and|or)\b|^(?:and\s+)?others?\b/.test(normalized)) return false;
    if (/\bincluding\s+\S+$/.test(normalized)) return false;
    if (!normalized.includes(" ") && !/^(?:seo|crm|rrsp|resp|saas)$/i.test(normalized)) return false;
    return normalized.length >= 4;
  }).map((item) => [item.toLocaleLowerCase(), item])).values()];
}

const createProjectSchema = z.object({
  name: z.string().min(2).max(180),
  projectType: z.enum(projectTypes),
  websiteStatus: z.enum(websiteStatuses),
  websiteUrl: z.string().max(512).optional().nullable(),
  businessName: z.string().max(180).optional().nullable(),
  niche: z.string().max(180).optional().nullable(),
  businessLocation: z.string().max(255).optional().nullable(),
  businessLocationDetails: z.object({
    country: z.string().trim().min(1).max(120), stateProvince: z.string().trim().min(1).max(120), city: z.string().trim().min(1).max(120),
    streetAddress: z.string().trim().max(255).optional().default(""), postalCode: z.string().trim().max(40).optional().default(""),
  }).optional().nullable(),
  targetLocations: z.array(z.string().min(1).max(180)).max(50).default([]),
  targetLocation: z.string().max(180).optional().nullable(),
  primaryGoal: z.string().min(1).max(255),
  secondaryGoals: z.array(z.string().min(1).max(255)).max(20).default([]),
  competitors: z.array(z.string().min(1).max(512)).max(50).default([]),
  notes: z.string().max(10000).optional().nullable(),
  brandVoice: z.string().max(5000).optional().nullable(),
  analyticsPlatforms: z.array(z.string().min(1).max(120)).max(20).default([]),
  cmsPlatform: z.string().max(120).optional().nullable(),
  targetLaunchTimeline: z.string().max(80).optional().nullable(),
  preferredOutputs: z.array(z.string().max(80)).default([]),
  preferredPublishingMethod: z.string().max(80).optional().nullable(),
  clientId: z.string().optional(),
  agencyClientId: z.string().optional().nullable(),
  updateClientDefaults: z.boolean().default(false),
  updateWorkspaceDefaults: z.boolean().default(false),
  managerMembershipId: z.string().optional().nullable(),
  assignedMembershipIds: z.array(z.string()).max(100).default([]),
  assignedTeamIds: z.array(z.string()).max(100).default([]),
  aiIntakeSessionId: z.string().optional().nullable(),
  aiConversationSessionId: z.string().optional().nullable(),
  businessDescription: z.string().max(10000).optional().nullable(),
  targetAudience: z.string().max(10000).optional().nullable(),
  productsServices: z.string().max(10000).optional().nullable(),
  primaryKeywords: z.array(z.string().trim().min(2).max(255)).max(50).default([]),
  secondaryKeywords: z.array(z.string().trim().min(2).max(255)).max(100).default([]),
  conversationTranscript: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(5000) })).max(250).default([]),
});

const conversationalDraftSchema = z.object({
  name: z.string().trim().min(2).max(180),
  projectType: z.enum(projectTypes),
  websiteStatus: z.enum(websiteStatuses),
  websiteUrl: z.string().trim().max(512).optional().nullable(),
  businessName: z.string().trim().max(180).optional().nullable(),
  niche: z.string().trim().min(2).max(180),
  agencyClientId: z.string().optional().nullable(),
  businessLocationDetails: z.object({ country: z.string().trim().min(1).max(120), stateProvince: z.string().trim().min(1).max(120), city: z.string().trim().min(1).max(120), streetAddress: z.string().trim().max(255).default(""), postalCode: z.string().trim().max(40).default("") }),
  targetLocations: z.array(z.string().trim().min(1).max(180)).min(1).max(50),
  primaryGoal: z.string().trim().min(1).max(255),
});
const conversationalDraftUpdateSchema = z.object({
  projectName: z.string().trim().min(2).max(180).optional(), businessName: z.string().trim().max(180).optional(), industryNiche: z.string().trim().max(180).optional(),
  websiteStatus: z.enum(websiteStatuses).optional(), websiteUrl: z.string().trim().max(512).optional(), businessDescription: z.string().trim().max(10000).optional(),
  targetAudience: z.string().trim().max(10000).optional(), productsServices: z.string().trim().max(10000).optional(),
  businessLocation: z.object({ country: z.string().trim().max(120), stateProvince: z.string().trim().max(120), city: z.string().trim().max(120), streetAddress: z.string().trim().max(255), postalCode: z.string().trim().max(40) }).optional(),
  targetMarkets: z.array(z.string().trim().min(1).max(180)).max(50).optional(), primaryGoal: z.string().trim().max(255).optional(), secondaryGoals: z.array(z.string().trim().min(1).max(255)).max(20).optional(),
  primaryKeywords: z.array(z.string().trim().min(2).max(255)).max(50).optional(), secondaryKeywords: z.array(z.string().trim().min(2).max(255)).max(100).optional(),
  competitors: z.array(z.string().trim().min(1).max(512)).max(50).optional(), brandVoice: z.string().trim().max(5000).optional(), preferredOutputs: z.array(z.string().trim().max(80)).max(30).optional(), targetLaunchTimeline: z.string().trim().max(80).optional(),
  advancedIntake: z.record(z.union([z.string().trim().max(10000), z.array(z.string().trim().max(1000)).max(50)])).optional(),
  aiConversationSessionId: z.string().trim().optional(),
});

const intakeAnswerSchema = z.object({
  questionKey: z.string().min(1).max(120),
  questionText: z.string().min(1).max(1000),
  answerValue: z.unknown(),
  answerType: z.string().max(40).default("text"),
  moduleContext: z.string().max(80).default("core_intake"),
});

const saveIntakeSchema = z.object({
  answers: z.array(intakeAnswerSchema).min(1),
});
const projectLocationsSchema = z.object({
  businessLocationDetails: z.object({
    country: z.string().trim().min(1).max(120), stateProvince: z.string().trim().min(1).max(120), city: z.string().trim().min(1).max(120),
    streetAddress: z.string().trim().max(255).optional().default(""), postalCode: z.string().trim().max(40).optional().default(""),
  }),
  targetMarkets: z.array(z.string().trim().min(1).max(180)).min(1).max(100),
  updateClient: z.boolean().default(false),
  updateWorkspace: z.boolean().default(false),
});
const projectTargetMarketsSchema = z.object({
  targetMarkets: z.array(z.string().trim().min(1).max(180)).min(1).max(100),
});
const projectGoalsSchema = z.object({
  primaryGoal: z.string().trim().min(1).max(255),
  secondaryGoals: z.array(z.string().trim().min(1).max(255)).max(20).default([]),
  reason: z.string().trim().max(1000).optional().nullable(),
});
const resetAfterStrategySchema = z.object({
  confirmation: z.literal("RESET"),
});
const opportunityActionSchema = z.object({ confirmation: z.boolean().default(false), reason: z.string().trim().max(1000).optional().nullable() });
const opportunityRefineSchema = z.object({ instructions: z.string().trim().min(3).max(2000) });
const keywordGenerateSchema = z.object({ manualSeed: z.string().trim().min(2).max(255).optional().nullable(), expansionInstruction: z.string().trim().min(3).max(1000).optional().nullable(), regenerate: z.boolean().default(false), append: z.boolean().default(false) });
const keywordExpansionPreviewSchema = z.object({
  instruction: z.string().trim().min(3).max(1000),
  topic: z.string().trim().min(2).max(200).optional(),
  geography: z.string().trim().min(2).max(160).optional(),
  geographies: z.array(z.string().trim().min(2).max(160)).max(20).optional(),
  supportingOnly: z.boolean().optional().default(false),
  groupIds: z.array(z.string().trim().min(1)).max(20).optional(),
});
const keywordGroupUpdateSchema = z.object({ keywords: z.array(z.string().trim().min(2).max(255)).min(1).max(100), reason: z.string().trim().max(1000).optional().nullable() });
const keywordManualSchema = z.object({ keywords: z.array(z.string().trim().min(2).max(255)).min(1).max(50), category: z.string().trim().min(2).max(60).default("supporting"), groupId: z.string().trim().min(1).optional().nullable() });
const leadMagnetTypeSchema = z.enum(["Checklist", "Guide", "Comparison", "Buyer's Guide", "eBook", "PDF Report", "Template", "Worksheet", "Cheat Sheet", "Email Course", "Toolkit", "Resource List", "Case Study", "Free Trial", "Coupon or Discount", "Quiz", "Calculator"]);
const leadRecommendationValueSchema = z.object({
  type: leadMagnetTypeSchema,
  title: z.string().trim().min(3).max(240),
  score: z.number().int().min(0).max(100),
  buyerStage: z.enum(["awareness", "consideration", "decision"]),
  signal: z.string().trim().min(3).max(1000),
  why: z.string().trim().min(3).max(1000),
  expectedOutcome: z.string().trim().min(3).max(500),
  estimatedImpact: z.object({ low: z.number().min(0).max(100), high: z.number().min(0).max(100), metric: z.string().trim().max(120), confidence: z.enum(["directional", "medium"]), label: z.string().trim().max(240), disclaimer: z.string().trim().max(500) }),
  evidence: z.array(z.string().trim().min(3).max(1000)).max(10),
});
const leadRecommendationSchema = leadRecommendationValueSchema.optional().nullable();
const leadMagnetResearchSchema = z.object({
  objective: z.string().trim().min(10).max(1000).optional().nullable(),
  desiredAction: z.enum(["grow_email_list", "generate_qualified_leads", "increase_quotes_or_bookings", "promote_an_offer", "educate_prospects", "other"]).default("generate_qualified_leads"),
  preferredFormat: leadMagnetTypeSchema.optional().nullable(),
  successDefinition: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  researchMode: z.enum(["primary", "refined", "refresh"]).default("primary"),
  excludedRecommendationTitles: z.array(z.string().trim().min(3).max(240)).max(5).default([]),
});
const leadMagnetResearchOutputSchema = z.object({
  research: z.object({
    objectiveSummary: z.string().trim().min(3).max(1000),
    audienceNeeds: z.array(z.string().trim().min(3).max(500)).min(1).max(8),
    keywordInsights: z.array(z.string().trim().min(3).max(500)).min(1).max(8),
    geographicInsights: z.array(z.string().trim().min(3).max(500)).min(1).max(8),
    siteInsights: z.array(z.string().trim().min(3).max(500)).min(1).max(8),
    opportunityGaps: z.array(z.string().trim().min(3).max(500)).min(1).max(8),
    recommendedStrategy: z.string().trim().min(3).max(1500),
    researchLimits: z.array(z.string().trim().min(3).max(500)).min(1).max(8),
  }),
  followUpQuestions: z.array(z.object({
    question: z.string().trim().min(3).max(500),
    why: z.string().trim().min(3).max(500),
    suggestedAnswer: z.string().trim().max(500).optional().nullable(),
  })).min(2).max(6),
  recommendations: z.array(leadRecommendationValueSchema.extend({ actionLabel: z.literal("Generate with AI") })).min(2).max(5),
});
const leadMagnetGenerateSchema = z.object({
  researchRunId: z.string().trim().min(1),
  seriesId: z.string().trim().min(1).optional().nullable(),
  selectedIdea: z.string().trim().min(3).max(240).optional().nullable(),
  instructions: z.string().trim().max(2000).optional().nullable(),
  recommendation: leadRecommendationSchema,
});

function workspaceProjectAssignmentFilter(context: Awaited<ReturnType<typeof workspaceContext>>): Prisma.ProjectWhereInput {
  if (context.roles.has("owner") || context.roles.has("admin") || context.workspace.workspaceType === "personal") return {};
  const assignments: Prisma.ProjectWhereInput[] = [
    { memberAssignments: { some: { membershipId: context.membership.id } } },
    { teamAssignments: { some: { team: { members: { some: { membershipId: context.membership.id } } } } } },
    { executionTasks: { some: { OR: [
      { assigneeMembershipId: context.membership.id },
      { managerMembershipId: context.membership.id },
      { approverMembershipId: context.membership.id },
    ] } } },
  ];
  if (context.workspace.workspaceType === "agency") assignments.push(
    { agencyClient: { memberAssignments: { some: { membershipId: context.membership.id } } } },
    { agencyClient: { teamAssignments: { some: { team: { members: { some: { membershipId: context.membership.id } } } } } } },
  );
  return { OR: assignments };
}


const workflowStepPatchSchema = z.object({
  status: z.enum(["pending", "ready", "in_progress", "blocked", "completed", "skipped"]).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  actionLabel: z.string().max(120).optional().nullable(),
  actionUrl: z.string().max(512).optional().nullable(),
  readyReason: z.string().max(5000).optional().nullable(),
  blockedReason: z.string().max(5000).optional().nullable(),
  completionReason: z.string().max(5000).optional().nullable(),
});

const moduleTaskPatchSchema = z.object({
  status: z.enum(["pending", "ready", "queued", "in_progress", "needs_review", "blocked", "completed", "skipped", "cancelled", "canceled"]).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  manualInstructions: z.string().max(5000).optional().nullable(),
});

const executionTaskCreateSchema = z.object({
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().min(2).max(5000),
  expectedOutcome: z.string().trim().min(2).max(5000),
  sourceModule: z.string().trim().min(2).max(80).default("user_task"),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  automationLevel: z.enum(["automatic", "one_click_approval", "manual_guided", "manual_task"]).default("manual_task"),
  assigneeMembershipId: z.string().optional().nullable(),
  dueAt: z.coerce.date().optional().nullable(),
  dependencyTaskIds: z.array(z.string()).max(50).default([]),
  requiresApproval: z.boolean().default(false),
});

const workflowStepCreateSchema = z.object({
  stepKey: z.string().min(2).max(80).regex(/^[a-z0-9_-]+$/),
  title: z.string().min(2).max(180),
  description: z.string().min(2).max(5000),
  status: z.enum(["pending", "ready", "in_progress", "blocked", "completed", "skipped"]).default("pending"),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  actionLabel: z.string().max(120).optional().nullable(),
  actionUrl: z.string().max(512).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(999),
  reason: z.string().max(5000).optional().nullable(),
});

const moduleTaskCreateSchema = z.object({
  projectId: z.string().optional().nullable(),
  websiteId: z.string().optional().nullable(),
  moduleName: z.string().min(2).max(80),
  title: z.string().min(2).max(255),
  description: z.string().min(2).max(5000),
  expectedOutcome: z.string().min(2).max(5000).optional(),
  status: z.enum(["pending", "ready", "queued", "in_progress", "needs_review", "blocked", "completed", "skipped", "cancelled", "canceled"]).default("ready"),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  automationLevel: z.string().max(60).default("manual_guided"),
  actionButtonLabel: z.string().max(120).optional().nullable(),
  relatedUrl: z.string().max(512).optional().nullable(),
  manualInstructions: z.string().max(5000).optional().nullable(),
  requiresApproval: z.boolean().default(false),
  requiresIntegration: z.boolean().default(false),
  manualRequired: z.boolean().default(true),
});

async function openaiJson(prompt: string, model = config.openaiModel) {
  if (!config.openaiApiKey) throw new Error("openai_not_configured");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are SEnuke AI. Return valid JSON only. No markdown fences. Do not invent unavailable metrics or claim live publication." },
        { role: "user", content: prompt },
      ],
    }),
  });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(typeof data?.error?.message === "string" ? data.error.message : "OpenAI request failed");
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenAI returned no content");
  return {
    result: JSON.parse(content) as unknown,
    model: data?.model ?? model,
    inputTokens: Number(data?.usage?.prompt_tokens ?? 0),
    outputTokens: Number(data?.usage?.completion_tokens ?? 0),
  };
}

function clean(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanLocations(values: string[] = [], legacy?: string | null) {
  const source = values.length ? values : (legacy ?? "").split(/[,;\n]/g);
  return [...new Set(source.map((value) => value.trim()).filter(Boolean))].slice(0, 50);
}

function normalizeUrl(input?: string | null) {
  const trimmed = clean(input);
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    return {
      domain: url.hostname.toLowerCase(),
      rootUrl: `${url.protocol}//${url.hostname.toLowerCase()}`,
    };
  } catch {
    return null;
  }
}

async function requireRequestPermission(req: Request, permission: string) {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, permission)) throw Object.assign(new Error("Insufficient workspace permission."), { statusCode: 403 });
  return context;
}

async function scopedProject(req: Request, projectId: string) {
  const clientId = await projectClientIdForRequest(req);
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...(clientId ? { clientId } : {}) },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true, status: true } },
      agencyClient: { select: { id: true, name: true, contactPhone: true, businessLocations: true, defaultSettings: true, brandingJson: true } },
      businessProfile: true,
      workflowSteps: { orderBy: { sortOrder: "asc" } },
      intakeAnswers: { orderBy: { createdAt: "asc" } },
      executionPlans: {
        where: { status: "active" },
        orderBy: { createdAt: "asc" },
        take: 1,
        include: {
          tasks: { orderBy: [{ createdAt: "asc" }], take: 100, include: { dependencies: { include: { requiredTask: { select: { id: true, title: true, status: true } } } }, assignee: { select: { id: true, user: { select: { name: true, email: true } } } } } },
        },
      },
      executionTasks: {
        orderBy: [{ status: "asc" }, { priority: "asc" }, { updatedAt: "desc" }],
        take: 200,
        include: {
          dependencies: { include: { requiredTask: { select: { id: true, title: true, status: true } } } },
          assignee: { select: { id: true, user: { select: { name: true, email: true } } } },
        },
      },
      opportunities: { orderBy: { createdAt: "desc" }, take: 10 },
      keywordGroups: { orderBy: { createdAt: "asc" } },
      strategyPlans: { orderBy: { createdAt: "desc" }, take: 3 },
    },
  });
  if (!project) return null;
  const context = await workspaceContext(req);
  const accessible = context.workspace.workspaceType === "personal" || await canAccessProject(context, project.id);
  if (!accessible) return null;
  const normalizeGuidedPlanTask = <T extends { id: string; title: string; actionButtonLabel?: string | null; relatedUrl?: string | null }>(task: T): T => {
    if (!/(?:seo\s*plan|content\s*plan)/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`)) return task;
    return { ...task, relatedUrl: `/guided-projects/${project.id}?tab=execution&actionTask=${task.id}#execution-tasks` };
  };
  const normalizedProject = {
    ...project,
    executionTasks: project.executionTasks.map(normalizeGuidedPlanTask),
    executionPlans: project.executionPlans.map((plan) => ({ ...plan, tasks: plan.tasks.map(normalizeGuidedPlanTask) })),
  };
  if (normalizedProject.businessLocationJson) return normalizedProject;
  const clientSettings = project.agencyClient?.defaultSettings && typeof project.agencyClient.defaultSettings === "object"
    ? project.agencyClient.defaultSettings as Record<string, unknown> : {};
  const inheritedDetails = clientSettings.businessLocationDetails;
  return inheritedDetails && typeof inheritedDetails === "object" && locationIsComplete(inheritedDetails as Record<string, unknown>)
    ? { ...normalizedProject, businessLocationJson: inheritedDetails }
    : normalizedProject;
}

async function projectSourceActivitySummaries(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>) {
  const taskStatusCounts = (moduleNames: string[]) => {
    const rows = project.executionTasks.filter((task) => moduleNames.includes(task.moduleName));
    return {
      total: rows.length,
      open: rows.filter((task) => !["completed", "skipped", "cancelled", "canceled"].includes(task.status)).length,
      completed: rows.filter((task) => task.status === "completed").length,
      awaitingApproval: rows.filter((task) => ["waiting_for_approval", "pending_approval", "submitted_for_approval", "needs_approval"].includes(task.status)).length,
      blocked: rows.filter((task) => task.status === "blocked").length,
    };
  };

  const summaries: Array<{
    key: string;
    label: string;
    total: number;
    metrics: Array<{ label: string; value: number; tone?: string }>;
    items: Array<{ id: string; title: string; detail?: string | null; status?: string; priority?: string }>;
    actionUrl: string;
  }> = [];

  if (project.websiteId) {
    const latestCrawl = await prisma.crawlJob.findFirst({
      where: { websiteId: project.websiteId, status: "completed" },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        issues: {
          orderBy: [{ severity: "asc" }, { weightImpact: "desc" }],
          select: { id: true, message: true, recommendation: true, severity: true, weightImpact: true, status: true },
        },
      },
    });
    if (latestCrawl) {
      const critical = latestCrawl.issues.filter((issue) => issue.severity === "high" && issue.weightImpact >= 8).length;
      const high = latestCrawl.issues.filter((issue) => issue.severity === "high" && issue.weightImpact < 8).length;
      const open = latestCrawl.issues.filter((issue) => issue.status === "open").length;
      const ignored = latestCrawl.issues.filter((issue) => issue.status === "ignored").length;
      summaries.push({
        key: "site_analysis",
        label: "Site Analysis issues",
        total: latestCrawl.issues.length,
        metrics: [
          { label: "All", value: latestCrawl.issues.length },
          { label: "Critical", value: critical, tone: "critical" },
          { label: "High", value: high, tone: "high" },
          { label: "Medium", value: latestCrawl.issues.filter((issue) => issue.severity === "medium").length, tone: "medium" },
          { label: "Low", value: latestCrawl.issues.filter((issue) => issue.severity === "low").length, tone: "low" },
          { label: "Open", value: open },
          { label: "Ignored", value: ignored },
        ],
        items: latestCrawl.issues.slice(0, 5).map((issue) => ({
          id: issue.id,
          title: issue.message,
          detail: issue.recommendation,
          status: issue.status,
          priority: issue.severity === "high" && issue.weightImpact >= 8 ? "critical" : issue.severity,
        })),
        actionUrl: `/site-analysis?projectId=${project.id}`,
      });
    }

    const keywordRuns = await prisma.keywordResearchRun.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, seedKeyword: true, status: true, keywordCount: true, locationName: true },
    });
    const keywords = project.keywordGroups.reduce((sum, group) => sum + (Array.isArray(group.keywords) ? group.keywords.length : 0), 0);
    if (keywordRuns.length || project.keywordGroups.length) summaries.push({
      key: "keyword_research",
      label: "Keyword Research activity",
      total: keywords || keywordRuns.length,
      metrics: [
        { label: "Groups", value: project.keywordGroups.length },
        { label: "Approved", value: project.keywordGroups.filter((group) => group.status === "approved").length },
        { label: "Keywords", value: keywords },
        { label: "Analysis runs", value: keywordRuns.length },
        { label: "Completed", value: keywordRuns.filter((run) => run.status === "completed").length },
      ],
      items: keywordRuns.slice(0, 5).map((run) => ({ id: run.id, title: run.seedKeyword, detail: run.locationName, status: run.status })),
      actionUrl: `/keywords?projectId=${project.id}`,
    });
  }

  const genericSources = [
    { key: "domain", label: "Domain Research actions", modules: ["domain"], actionUrl: `/guided-projects/${project.id}?tab=profile` },
    { key: "site_architect", label: "Site Architecture actions", modules: ["site_architect"], actionUrl: `/site-architect?projectId=${project.id}` },
    { key: "strategy_intelligence", label: "Strategy Intelligence actions", modules: ["strategy_intelligence"], actionUrl: `/strategy?projectId=${project.id}` },
  ];
  for (const source of genericSources) {
    const rows = project.executionTasks.filter((task) => source.modules.includes(task.moduleName));
    if (!rows.length || summaries.some((summary) => summary.key === source.key)) continue;
    const counts = taskStatusCounts(source.modules);
    summaries.push({
      key: source.key,
      label: source.label,
      total: counts.total,
      metrics: [
        { label: "All", value: counts.total },
        { label: "Open", value: counts.open },
        { label: "Completed", value: counts.completed },
        { label: "Approval", value: counts.awaitingApproval },
        { label: "Blocked", value: counts.blocked },
      ],
      items: rows.slice(0, 5).map((task) => ({ id: task.id, title: task.title, detail: task.expectedOutcome ?? task.impact, status: task.status, priority: task.priority })),
      actionUrl: source.actionUrl,
    });
  }
  return summaries;
}

function answerText(answers: z.infer<typeof intakeAnswerSchema>[], key: string) {
  const value = answers.find((answer) => answer.questionKey === key)?.answerValue;
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.trim()).join(", ");
  if (value && typeof value === "object" && "value" in value && typeof value.value === "string") return clean(value.value);
  return null;
}

type IntakeQuestion = {
  key: string;
  text: string;
  type: "text" | "textarea" | "select" | "multiselect" | "url" | "email";
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
  projectTypes?: string[];
};

const intakeQuestions: IntakeQuestion[] = [
  {
    key: "business_name",
    text: "Business or project name",
    type: "text",
    required: true,
    placeholder: "Beaver Lake Outfitters",
    help: "Used in strategy, website copy, SEO metadata, domain ideas, social posts, reports, and publishing assets.",
  },
  {
    key: "primary_goal",
    text: "Primary goal",
    type: "select",
    required: true,
    options: ["More leads", "More sales", "Better rankings", "New website", "Client proposal", "Ecommerce launch"],
    help: "Used by Strategy Engine, Site Architect, SEO Optimizer, Social Engine, and task priority sorting.",
  },
  {
    key: "target_launch_timeline",
    text: "Target launch timeline",
    type: "select",
    required: false,
    options: ["As soon as possible", "7 days", "14 days", "30 days", "60+ days"],
    help: "Used to adjust execution task priority and recommended scope.",
  },
  {
    key: "preferred_output",
    text: "Project deliverables",
    type: "multiselect",
    required: true,
    options: ["Website", "Landing page", "SEO plan", "Lead magnet", "Domain", "Social posts", "Report", "Proposal"],
    help: "Determines which modules create tasks and which generation actions appear in the dashboard.",
  },
  {
    key: "publishing_preference",
    text: "Publishing destination",
    type: "select",
    required: false,
    options: ["SEnuke-hosted site", "HTML ZIP", "WordPress", "Shopify", "Own hosting", "Developer handoff"],
    help: "Used by Publishing Service to create the right export, integration, DNS, and handoff tasks.",
  },
  {
    key: "website_url",
    text: "Website URL",
    type: "url",
    required: false,
    placeholder: "https://example.com",
    help: "Required for existing-site analysis. Used by site analysis, SEO optimizer, rank tracking, backlinks, and AI citation checks.",
  },
  {
    key: "industry_niche",
    text: "Industries or niches",
    type: "text",
    required: true,
    placeholder: "Software, CRM automation, B2B services",
    help: "You can enter multiple industries or niches separated by commas. Used by opportunity, keyword, authority, social, and domain modules.",
  },
  {
    key: "target_audience",
    text: "Target audience",
    type: "textarea",
    required: true,
    placeholder: "Homeowners who need emergency plumbing repairs in Toronto",
    help: "Used by strategy, site architecture, lead magnet, social, reports, and proposals.",
  },
  {
    key: "business_location",
    text: "Business location",
    type: "text",
    required: false,
    placeholder: "Fredericton, New Brunswick, Canada",
    help: "Where the business is physically based or primarily operated. Used for business identity, reports, NAP, citations, and Google Business Profile context.",
  },
  {
    key: "target_location",
    text: "Target market / locations",
    type: "text",
    required: false,
    placeholder: "Canada, United States, Toronto GTA",
    help: "You can enter multiple countries, cities, or service areas separated by commas. Used for local SEO pages, keyword location, domain ideas, citations, and social context.",
  },
  {
    key: "products_services",
    text: "Products or services offered",
    type: "textarea",
    required: false,
    placeholder: "Custom software development, CRM automation, web applications",
    help: "Used for offer positioning, page plans, social posts, keyword clusters, and report recommendations.",
  },
  {
    key: "current_offer_cta",
    text: "Current offer or call to action",
    type: "textarea",
    required: false,
    placeholder: "Book a consultation, request a demo, get a free audit",
    help: "Used to generate CTA blocks, forms, landing pages, social CTAs, and conversion recommendations.",
  },
  {
    key: "budget_level",
    text: "Budget level",
    type: "select",
    required: false,
    options: ["No budget", "Under $100", "$100-$500", "$500-$2,000", "$2,000+"],
    help: "Used to recommend realistic tools, domain/hosting choices, promotion methods, and execution steps.",
  },
  {
    key: "time_available_weekly",
    text: "Time available each week",
    type: "select",
    required: false,
    options: ["1-3 hours", "4-7 hours", "8-15 hours", "15+ hours"],
    help: "Used to size the execution plan and decide automation versus manual tasks.",
  },
  {
    key: "skill_level",
    text: "Skill level",
    type: "select",
    required: false,
    options: ["Beginner", "Intermediate", "Advanced", "Agency/professional"],
    help: "Used to adjust instruction detail, manual steps, and task guidance.",
  },
  {
    key: "tone_preference",
    text: "Tone and style preference",
    type: "select",
    required: false,
    options: ["Professional", "Direct", "Friendly", "Technical", "Luxury", "Bold", "Plain language"],
    help: "Used by all copy-generating modules.",
  },
  {
    key: "skills_experience",
    text: "Skills and experience",
    type: "textarea",
    required: true,
    projectTypes: ["new_business"],
    placeholder: "SEO, web design, insurance, ecommerce, coaching, writing",
    help: "Used to score user-fit and recommend realistic new-business opportunities.",
  },
  {
    key: "interests_niches",
    text: "Interests or niches to consider",
    type: "textarea",
    required: false,
    projectTypes: ["new_business"],
    placeholder: "Local services, AI tools, side hustles, ecommerce",
  },
  {
    key: "niches_to_avoid",
    text: "Niches to avoid",
    type: "textarea",
    required: false,
    projectTypes: ["new_business"],
    placeholder: "Gambling, adult, crypto, health claims",
  },
  {
    key: "income_goal",
    text: "Income goal",
    type: "text",
    required: false,
    projectTypes: ["new_business"],
    placeholder: "$500/month, $3,000/month, $10,000/month",
  },
  {
    key: "preferred_business_model",
    text: "Preferred business model",
    type: "multiselect",
    required: false,
    projectTypes: ["new_business"],
    options: ["Affiliate", "Lead generation", "Service business", "Digital product", "Ecommerce", "Consulting", "SaaS"],
    help: "Used to filter and score opportunity recommendations.",
  },
  {
    key: "starting_resources",
    text: "Starting resources",
    type: "textarea",
    required: false,
    projectTypes: ["new_business"],
    placeholder: "Domains, websites, email lists, hosting, content, products, contacts",
  },
  {
    key: "risk_tolerance",
    text: "Risk tolerance",
    type: "select",
    required: false,
    projectTypes: ["new_business"],
    options: ["Very conservative", "Balanced", "Aggressive but safe"],
  },
  {
    key: "site_conversion_goal",
    text: "Main conversion goal",
    type: "select",
    required: true,
    projectTypes: ["existing_website", "local_seo"],
    options: ["Phone calls", "Form submissions", "Bookings", "Purchases", "Downloads", "Email signups"],
    help: "Used to judge site improvements, CTA recommendations, page generation, and reports.",
  },
  {
    key: "known_problem_areas",
    text: "Known problem areas",
    type: "multiselect",
    required: false,
    projectTypes: ["existing_website", "local_seo"],
    options: ["Low traffic", "Poor rankings", "Low conversions", "Weak copy", "Slow site", "Poor mobile experience"],
  },
  {
    key: "current_target_keywords",
    text: "Current target keywords",
    type: "textarea",
    required: false,
    projectTypes: ["existing_website", "local_seo"],
    placeholder: "One keyword per line",
  },
  {
    key: "known_competitors",
    text: "Known competitors",
    type: "textarea",
    required: false,
    projectTypes: ["existing_website", "local_seo"],
    placeholder: "https://competitor.com",
  },
  {
    key: "cms_platform",
    text: "CMS or platform",
    type: "select",
    required: false,
    projectTypes: ["existing_website", "local_seo"],
    options: ["WordPress", "Shopify", "Wix", "Squarespace", "Custom HTML", "Other", "Unknown"],
  },
  {
    key: "access_available",
    text: "Access available",
    type: "multiselect",
    required: false,
    projectTypes: ["existing_website", "local_seo"],
    options: ["Google Search Console", "Google Analytics", "WordPress", "Shopify", "Domain registrar", "Social accounts"],
  },
  {
    key: "client_name",
    text: "Client name",
    type: "text",
    required: true,
    projectTypes: ["agency_client"],
    placeholder: "Jane Smith",
  },
  {
    key: "client_company",
    text: "Client company",
    type: "text",
    required: true,
    projectTypes: ["agency_client"],
    placeholder: "Smith Plumbing Ltd.",
  },
  {
    key: "client_email",
    text: "Client email",
    type: "email",
    required: false,
    projectTypes: ["agency_client"],
    placeholder: "client@example.com",
  },
  {
    key: "client_goals",
    text: "Client goals",
    type: "textarea",
    required: true,
    projectTypes: ["agency_client"],
    placeholder: "Increase quote requests from commercial property owners",
  },
  {
    key: "services_to_propose",
    text: "Services to propose",
    type: "multiselect",
    required: false,
    projectTypes: ["agency_client"],
    options: ["SEO", "Website redesign", "Content", "Social media", "Authority building", "Hosting", "Automation"],
  },
  {
    key: "proposal_package_preference",
    text: "Proposal package preference",
    type: "select",
    required: false,
    projectTypes: ["agency_client"],
    options: ["Single package", "Good/better/best", "Phased project", "Monthly retainer", "Custom"],
  },
  {
    key: "store_type",
    text: "Store type",
    type: "select",
    required: true,
    projectTypes: ["ecommerce"],
    options: ["New Shopify store", "Existing Shopify store", "WooCommerce", "Custom ecommerce", "Product landing page"],
  },
  {
    key: "product_category",
    text: "Product category",
    type: "text",
    required: true,
    projectTypes: ["ecommerce"],
    placeholder: "Pet accessories, skincare, outdoor gear",
  },
  {
    key: "product_list",
    text: "Product list",
    type: "textarea",
    required: false,
    projectTypes: ["ecommerce"],
    placeholder: "Product name, price, short description, SKU",
  },
  {
    key: "target_buyer",
    text: "Target buyer",
    type: "textarea",
    required: true,
    projectTypes: ["ecommerce"],
    placeholder: "Dog owners who want durable walking accessories",
  },
  {
    key: "average_order_value",
    text: "Average order value or price range",
    type: "text",
    required: false,
    projectTypes: ["ecommerce"],
    placeholder: "$25-$75",
  },
  {
    key: "fulfillment_model",
    text: "Fulfillment model",
    type: "select",
    required: false,
    projectTypes: ["ecommerce"],
    options: ["Inventory", "Dropshipping", "Print-on-demand", "Digital delivery", "Service/product hybrid", "Unknown"],
  },
  {
    key: "store_platform_access",
    text: "Store platform access",
    type: "select",
    required: false,
    projectTypes: ["ecommerce"],
    options: ["Connect Shopify", "Connect WooCommerce", "Export only", "Not ready yet"],
  },
];

function normalizeBusinessProfile(project: { businessName: string | null; niche: string | null; businessLocation: string | null; targetLocation: string | null; primaryGoal: string | null }, answers: z.infer<typeof intakeAnswerSchema>[]) {
  const businessName = answerText(answers, "business_name") ?? answerText(answers, "client_company") ?? project.businessName;
  const niche = answerText(answers, "industry_niche") ?? answerText(answers, "client_industry") ?? answerText(answers, "product_category") ?? project.niche;
  const audience = answerText(answers, "target_audience") ?? answerText(answers, "ideal_customer");
  const offer = answerText(answers, "products_services") ?? answerText(answers, "main_offer") ?? answerText(answers, "services") ?? answerText(answers, "product_list");
  const constraints = [
    answerText(answers, "constraints"),
    answerText(answers, "automation_limits"),
    answerText(answers, "niches_to_avoid"),
  ].filter(Boolean);
  const strengths = [
    answerText(answers, "differentiators"),
    answerText(answers, "proof_points"),
    answerText(answers, "skills_experience"),
  ].filter(Boolean);

  return {
    businessSummary: [businessName, niche, answerText(answers, "business_location") ?? project.businessLocation].filter(Boolean).join(" | ") || null,
    targetAudience: audience ?? answerText(answers, "target_buyer"),
    offerSummary: offer,
    businessModel: answerText(answers, "business_model") ?? answerText(answers, "preferred_business_model") ?? answerText(answers, "store_type"),
    strengths,
    constraints,
    budgetLevel: answerText(answers, "budget_level"),
    skillLevel: answerText(answers, "skill_level"),
    tonePreference: answerText(answers, "tone_preference"),
  };
}

async function createInitialPlan(tx: Prisma.TransactionClient, project: { id: string; clientId: string; websiteId: string | null }) {
  const plan = await tx.executionPlan.create({
    data: {
      projectId: project.id,
      title: "Guided execution plan",
      summary: "Project intake, strategy, website analysis, keyword research, content, and publishing actions.",
    },
  });

  await syncProjectWorkflow(tx, project.id);

  return plan;
}

async function syncProjectWorkflow(tx: Prisma.TransactionClient, projectId: string) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    include: {
      businessProfile: true,
      intakeAnswers: { select: { id: true }, take: 1 },
      opportunities: { select: { id: true, status: true }, orderBy: { createdAt: "desc" }, take: 10 },
      keywordGroups: { select: { id: true, status: true }, take: 10 },
      keywordResearchRuns: { select: { id: true, status: true, keywordCount: true }, orderBy: { createdAt: "desc" }, take: 3 },
      strategyPlans: { orderBy: { createdAt: "desc" }, take: 3 },
      executionPlans: { where: { status: "active" }, select: { id: true, title: true }, take: 1 },
      executionTasks: { select: { id: true, status: true, moduleName: true }, take: 50 },
      website: {
        select: {
          id: true,
          rootUrl: true,
          crawlJobs: { select: { id: true, status: true, pagesCrawled: true }, orderBy: { createdAt: "desc" }, take: 3 },
        },
      },
    },
  });
  if (!project) return;
  if (project.status === "intake_draft") return;

  const intakeComplete = project.intakeAnswers.length > 0 || Boolean(project.businessProfile);
  const opportunitiesGenerated = project.opportunities.length > 0;
  const selectedOpportunity = project.opportunities.find((opportunity) => opportunityDecisionStatus(opportunity.status)) ?? null;
  const latestStrategy = project.strategyPlans[0];
  const strategyGenerated = Boolean(latestStrategy);
  const strategyApproved = latestStrategy?.status === "approved" || project.currentStep === "execution";
  const hasWebsite = Boolean(project.websiteId || project.websiteUrl || project.website?.rootUrl);
  const readinessComplete = intakeComplete && Boolean(project.name && project.projectType && project.primaryGoal && project.businessLocation && Array.isArray(project.targetLocations) && project.targetLocations.length && (project.websiteStatus !== "existing_website" || hasWebsite));
  const isExistingWebsite = isExistingWebsiteCampaign(project);
  const isNewWebsiteLaunch = !isExistingWebsite || !hasWebsite;
  const keywordGroupApproved = project.keywordGroups.some((group) => group.status === "approved");
  const keywordAnalysisComplete = Boolean(keywordGroupApproved || project.keywordResearchRuns.some((run) => run.status === "completed" || run.keywordCount > 0) || project.executionTasks.some((task) => task.moduleName === "keyword_research" && ["completed", "skipped"].includes(task.status)));
  const siteAnalysisComplete = Boolean(project.website?.crawlJobs.some((crawl) => crawl.status === "completed" && crawl.pagesCrawled > 0) || project.executionTasks.some((task) => task.moduleName === "site_analysis" && ["completed", "skipped"].includes(task.status)));
  const siteAnalysisRequiredBeforeStrategy = requiresSiteAnalysisBeforeStrategy(project);
  const projectWorkflowModuleNames = new Set(["core_intake", "opportunity", "strategy", "strategy_approval"]);
  const moduleTaskCount = project.executionTasks.filter((task) => !["completed", "skipped", "cancelled", "canceled"].includes(task.status) && !projectWorkflowModuleNames.has(task.moduleName)).length;
  // An Execution Plan is project-wide. Its title may be Guided, Adaptive, or Full,
  // so completion must be based on the active plan and its real module tasks.
  const activeExecutionPlan = project.executionPlans[0] ?? null;
  const executionPlanCreated = strategyApproved && Boolean(activeExecutionPlan) && moduleTaskCount > 0;

  const statusByStep: Record<string, { status: string; actionUrl: string; sourceType?: string; sourceId?: string | null; completionReason?: string; readyReason?: string; completedAt?: Date | null }> = {
    intake: intakeComplete
      ? { status: "completed", actionUrl: `/guided-projects/${project.id}/intake`, sourceType: "project_intake", completionReason: "Project intake answers and business profile exist.", completedAt: new Date() }
      : { status: "ready", actionUrl: `/guided-projects/${project.id}/intake`, readyReason: "The project needs intake answers before strategy and module work can start." },
    readiness: readinessComplete
      ? { status: "completed", actionUrl: `/guided-projects/${project.id}`, sourceType: "project", sourceId: project.id, completionReason: "All required project details and intake are complete.", completedAt: new Date() }
      : intakeComplete
        ? { status: "ready", actionUrl: `/guided-projects/${project.id}`, readyReason: "Review missing required project details." }
        : { status: "pending", actionUrl: `/guided-projects/${project.id}/intake`, readyReason: "Waiting for intake completion." },
    opportunities: selectedOpportunity
      ? { status: "completed", actionUrl: "/opportunities", sourceType: "opportunity", sourceId: selectedOpportunity.id, completionReason: selectedOpportunity.status === "confirmed" ? "The existing project direction has been confirmed." : "An opportunity has been selected for strategy context.", completedAt: new Date() }
      : opportunitiesGenerated
        ? { status: "ready", actionUrl: "/opportunities", readyReason: "Review recommendations and select an opportunity or confirm the existing direction." }
      : readinessComplete
        ? { status: "ready", actionUrl: "/opportunities", readyReason: "Intake is complete and opportunities can be generated." }
        : { status: "pending", actionUrl: `/guided-projects/${project.id}`, readyReason: "Waiting for intake completion." },
    keyword_analysis: keywordAnalysisComplete
      ? { status: "completed", actionUrl: "/keywords", sourceType: "keyword_research", completionReason: "Keyword analysis exists for this project or connected website.", completedAt: new Date() }
      : selectedOpportunity
        ? { status: "ready", actionUrl: "/keywords", readyReason: isNewWebsiteLaunch ? "Use the project profile to create seed keywords and page targets before a website exists." : "Use the project profile and opportunity direction to run keyword analysis before full execution planning." }
        : { status: "pending", actionUrl: "/keywords", readyReason: "Waiting for an opportunity selection or confirmed existing direction." },
    site_analysis: siteAnalysisComplete
      ? { status: "completed", actionUrl: "/site-analysis", sourceType: "site_analysis", completionReason: isExistingWebsite ? "A completed site crawl exists for the connected website." : "Site analysis is not required until generated pages or a website exist.", completedAt: new Date() }
      : !isExistingWebsite
        ? { status: "skipped", actionUrl: "/site-architect", completionReason: "Site analysis is only required for an existing website.", completedAt: new Date() }
        : !hasWebsite
        ? { status: "pending", actionUrl: "/site-analysis", readyReason: "Waiting for the existing website URL." }
        : keywordAnalysisComplete
          ? { status: "ready", actionUrl: "/site-analysis", readyReason: "Keyword analysis exists and the connected website can now be crawled." }
          : { status: "pending", actionUrl: "/site-analysis", readyReason: "Waiting for keyword analysis." },
    strategy: strategyGenerated
      ? { status: "completed", actionUrl: "/strategy", sourceType: "strategy_plan", sourceId: latestStrategy?.id, completionReason: "A strategy plan exists.", completedAt: new Date() }
      : selectedOpportunity && keywordGroupApproved && intakeComplete && (!siteAnalysisRequiredBeforeStrategy || siteAnalysisComplete)
        ? { status: "ready", actionUrl: "/strategy", readyReason: isNewWebsiteLaunch ? "Project profile is enough to create the initial website, keyword, GBP/local, content, and publishing strategy." : keywordAnalysisComplete ? "Keyword and required site discovery are ready for strategy." : "Initial strategy can be generated now; keyword data can refine it later." }
        : { status: "pending", actionUrl: "/strategy", readyReason: !selectedOpportunity ? "Select an opportunity or confirm the existing direction first." : !keywordGroupApproved ? "Approve at least one keyword group first." : siteAnalysisRequiredBeforeStrategy ? "Waiting for site analysis on the existing website." : "Waiting for intake completion." },
    strategy_approval: strategyApproved
      ? { status: "completed", actionUrl: "/strategy", sourceType: "strategy_plan", sourceId: latestStrategy?.id, completionReason: "The current strategy is approved.", completedAt: latestStrategy?.approvedAt ?? new Date() }
      : strategyGenerated
        ? { status: "ready", actionUrl: "/strategy", sourceType: "strategy_plan", sourceId: latestStrategy?.id, readyReason: "A draft strategy exists and needs approval." }
        : { status: "pending", actionUrl: "/strategy", readyReason: "Waiting for strategy generation." },
    execution_plan: executionPlanCreated
      ? { status: "completed", actionUrl: `/guided-projects/${project.id}?tab=execution#execution-tasks`, sourceType: "execution_plan", sourceId: activeExecutionPlan?.id, completionReason: "The active project-wide Execution Plan contains module tasks.", completedAt: new Date() }
      : strategyApproved
        ? { status: "ready", actionUrl: `/guided-projects/${project.id}`, readyReason: "Strategy is approved and module execution tasks can be created." }
        : { status: "pending", actionUrl: `/guided-projects/${project.id}`, readyReason: "Waiting for strategy approval." },
  };

  for (const definition of projectWorkflowDefinitions) {
    const state = statusByStep[definition.stepKey];
    await tx.projectWorkflowStep.upsert({
      where: { projectId_stepKey: { projectId: project.id, stepKey: definition.stepKey } },
      update: {
        title: definition.title,
        description: definition.description,
        priority: definition.priority,
        actionLabel: definition.actionLabel,
        actionUrl: state.actionUrl,
        sortOrder: definition.sortOrder,
        status: state.status,
        sourceType: state.sourceType ?? null,
        sourceId: state.sourceId ?? null,
        completionReason: state.status === "completed" ? state.completionReason ?? null : null,
        readyReason: state.status === "ready" ? state.readyReason ?? null : null,
        completedAt: state.status === "completed" ? state.completedAt ?? new Date() : null,
      },
      create: {
        projectId: project.id,
        stepKey: definition.stepKey,
        title: definition.title,
        description: definition.description,
        priority: definition.priority,
        actionLabel: definition.actionLabel,
        actionUrl: state.actionUrl,
        sortOrder: definition.sortOrder,
        status: state.status,
        sourceType: state.sourceType ?? null,
        sourceId: state.sourceId ?? null,
        completionReason: state.status === "completed" ? state.completionReason ?? null : null,
        readyReason: state.status === "ready" ? state.readyReason ?? null : null,
        completedAt: state.status === "completed" ? state.completedAt ?? new Date() : null,
      },
    });
  }
}

async function syncProjectWorkflowsForClient(clientId: string, projectId?: string | null) {
  const projects = await prisma.project.findMany({
    where: { clientId, ...(projectId ? { id: projectId } : {}) },
    select: { id: true },
    take: projectId ? 1 : 25,
  });
  for (const project of projects) {
    await prisma.$transaction((tx) => syncProjectWorkflow(tx, project.id));
  }
}

async function ensureNextTask(tx: Prisma.TransactionClient, input: {
  clientId: string;
  projectId: string;
  websiteId: string | null;
  executionPlanId: string;
  key: string;
  moduleName: string;
  title: string;
  description: string;
  expectedOutcome?: string;
  actionButtonLabel: string;
  relatedUrl: string;
  automationLevel?: string;
  priority?: "critical" | "high" | "medium" | "low";
  requiresApproval?: boolean;
  requiresIntegration?: boolean;
  sourceType?: string;
  sourceId?: string;
  impact?: string;
  manualInstructions?: string;
  approvalRisk?: string;
  safetyCategory?: string;
}) {
  const existing = await tx.executionTask.findUnique({ where: { dedupeKey: input.key } });
  const data = {
      clientId: input.clientId,
      websiteId: input.websiteId,
      projectId: input.projectId,
      executionPlanId: input.executionPlanId,
      moduleName: input.moduleName,
      sourceType: input.sourceType ?? "project",
      sourceId: input.sourceId ?? input.projectId,
      title: input.title,
      description: input.description,
      expectedOutcome: input.expectedOutcome ?? input.description,
      priority: input.priority ?? "medium",
      automationLevel: input.automationLevel ?? "manual_guided",
      requiresApproval: input.requiresApproval ?? false,
      requiresIntegration: input.requiresIntegration ?? false,
      manualRequired: true,
      actionButtonLabel: input.actionButtonLabel,
      relatedUrl: input.relatedUrl,
      impact: input.impact ?? null,
      manualInstructions: input.manualInstructions ?? null,
      approvalRisk: input.approvalRisk ?? (input.requiresApproval ? "high" : "low"),
      safetyCategory: input.safetyCategory ?? (input.requiresApproval ? "protected_change" : "safe"),
  };
  if (existing) {
    if (["completed", "cancelled", "canceled"].includes(existing.status)) return existing;
    return tx.executionTask.update({ where: { id: existing.id }, data });
  }
  return tx.executionTask.create({
    data: {
      ...data,
      dedupeKey: input.key,
      status: "ready",
    },
  });
}

async function syncStrategyIntelligenceTasks(tx: Prisma.TransactionClient, project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>, planId: string, strategy: { id: string; prioritizedRecommendations?: unknown }, context: Awaited<ReturnType<typeof workspaceContext>>) {
  const recommendations = Array.isArray(strategy.prioritizedRecommendations) ? strategy.prioritizedRecommendations as StrategyRecommendation[] : [];
  const inputs = buildIntelligentExecutionTasks(recommendations);
  const created = new Map<string, Awaited<ReturnType<typeof ensureNextTask>>[]>();
  for (const input of inputs) {
    const approvalRequired = context.workspace.workspaceType !== "personal" && input.requiresApproval;
    const task = await ensureNextTask(tx, { clientId: project.clientId, websiteId: project.websiteId, projectId: project.id, executionPlanId: planId, key: `project:${project.id}:${input.key}`, moduleName: "strategy_intelligence", sourceType: "strategy_recommendation", sourceId: strategy.id, title: input.title, description: input.description, expectedOutcome: input.expectedOutcome, actionButtonLabel: approvalRequired ? "Review & Approve" : "Review & Fix", relatedUrl: `/guided-projects/${project.id}?tab=execution#execution-tasks`, priority: input.priority, automationLevel: input.automationLevel, requiresApproval: approvalRequired, impact: input.expectedOutcome, manualInstructions: input.manualInstructions, approvalRisk: input.approvalRisk, safetyCategory: input.safetyCategory });
    created.set(input.analysisKey, [...(created.get(input.analysisKey) ?? []), task]);
    await recordWorkspaceActivity(tx, { context, action: "task.synced_from_strategy_intelligence", entityType: "execution_task", entityId: task.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { title: task.title, analysisKey: input.analysisKey, explanation: input.description, expectedOutcome: input.expectedOutcome, priority: input.priority, approvalRequired, evidence: recommendations.find((item) => item.analysisKey === input.analysisKey)?.evidence ?? [] } });
  }
  for (const input of inputs) {
    const task = await tx.executionTask.findUnique({ where: { dedupeKey: `project:${project.id}:${input.key}` }, select: { id: true, status: true } });
    const requiredTasks = input.dependencyKeys.flatMap((key) => created.get(key) ?? []);
    const requiredIds = requiredTasks.map((item) => item.id);
    if (!task || !requiredIds.length) continue;
    await tx.executionTaskDependency.createMany({ data: requiredIds.map((requiredTaskId) => ({ taskId: task.id, requiredTaskId })), skipDuplicates: true });
    if (!["completed", "cancelled", "canceled", "in_progress", "submitted_for_approval", "awaiting_confirmation"].includes(task.status)) {
      const dependencyReady = requiredTasks.every((item) => ["completed", "skipped", "approved", "published"].includes(item.status));
      await tx.executionTask.update({ where: { id: task.id }, data: { status: dependencyReady ? "ready" : "pending", blockedReason: dependencyReady ? null : "Waiting for prerequisite Strategy Intelligence task." } });
    }
  }
  return inputs.length;
}

function projectContext(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>) {
  const profile = project.businessProfile;
  const targetMarkets = cleanLocations(Array.isArray(project.targetLocations) ? project.targetLocations.filter((item): item is string => typeof item === "string") : [], project.targetLocation);
  const goals = goalContext(project.primaryGoal, project.secondaryGoals);
  return {
    name: project.businessName ?? project.name,
    niche: project.niche ?? profile?.businessSummary ?? "the selected market",
    audience: profile?.targetAudience ?? "the target audience",
    offer: profile?.offerSummary ?? project.primaryGoal ?? "the main offer",
    location: targetMarkets.join(", ") || "the target market",
    targetMarkets,
    businessLocation: project.businessLocation,
    goal: goals.primaryGoal,
    secondaryGoals: goals.secondaryGoals,
    goalSummary: goals.summary,
    outputs: Array.isArray(project.preferredOutputs) ? project.preferredOutputs.filter((item): item is string => typeof item === "string") : [],
    businessIntelligence: profile?.intelligenceJson && typeof profile.intelligenceJson === "object" && !Array.isArray(profile.intelligenceJson) ? profile.intelligenceJson as Record<string, unknown> : {},
  };
}

function clampScore(value: number) {
  return Math.max(45, Math.min(96, Math.round(value)));
}

function hasAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function buildOpportunityOptions(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>, ctx: ReturnType<typeof projectContext>) {
  const text = [ctx.niche, ctx.location, ctx.goalSummary, ctx.offer, ctx.audience, ctx.outputs.join(" "), project.projectType].join(" ").toLowerCase();
  const hasWebsite = Boolean(project.websiteId || project.websiteUrl || project.website);
  const localIntent = hasAny(text, [/local/, /near me/, /maps?/, /city/, /service area/, /booking/, /appointment/, /clinic/, /physio/, /therapy/, /rehab/, /dent/, /medical/, /legal/, /roof/, /plumb/, /hvac/]);
  const healthcare = hasAny(text, [/physio/, /physical therapy/, /rehab/, /clinic/, /health/, /medical/, /dental/, /therapy/, /wellness/]);
  const ecommerce = project.projectType === "ecommerce" || hasAny(text, [/ecommerce/, /shopify/, /store/, /product/, /sales/]);
  const fastTimeline = hasAny(project.targetLaunchTimeline?.toLowerCase() ?? "", [/as soon/, /7/, /14/]);
  const wantsWebsite = ctx.outputs.some((output) => /website|landing|domain|page/i.test(output)) || hasAny(ctx.goal.toLowerCase(), [/website|launch|lead/]);
  const wantsReport = ctx.outputs.some((output) => /report|proposal/i.test(output));
  const locationPhrase = ctx.location && ctx.location !== "the target market" ? ` in ${ctx.location}` : "";
  const serviceNiche = ctx.niche === "the selected market" ? "the service area" : ctx.niche;
  const baseCompetition = localIntent ? 70 : ecommerce ? 76 : 66;

  return [
    {
      name: `${ctx.name} local growth and booking plan`,
      businessModel: healthcare ? "Healthcare appointment growth" : localIntent ? "Local service lead generation" : ecommerce ? "Ecommerce growth" : "Lead generation",
      targetAudience: healthcare ? `Patients${locationPhrase} looking for ${serviceNiche}, pain relief, injury recovery, or mobility support.` : ctx.audience,
      problemSolved: healthcare
        ? `Turns ${serviceNiche}${locationPhrase} demand into appointment, review, GBP, local-page, and conversion tasks.`
        : `Turns ${ctx.goal.toLowerCase()} into a concrete execution path${locationPhrase}.`,
      recommendedOffer: healthcare ? "Assessment, treatment plan, recovery program, and appointment booking path." : ctx.offer,
      seoScore: clampScore(76 + (localIntent ? 8 : 0) + (healthcare ? 4 : 0) + (hasWebsite ? 3 : -1)),
      competitionScore: clampScore(baseCompetition - (healthcare ? 4 : 0) + (hasWebsite ? 0 : 3)),
      monetizationScore: clampScore(72 + (localIntent ? 7 : 0) + (healthcare ? 5 : 0) + (ecommerce ? 6 : 0)),
      executionScore: clampScore(76 + (fastTimeline ? 6 : 0) + (!hasWebsite ? 3 : 0)),
      userFitScore: clampScore(74 + (wantsWebsite ? 4 : 0) + (localIntent ? 5 : 0)),
      summary: healthcare
        ? `Focus on ${serviceNiche}${locationPhrase} with local SEO, GBP readiness, patient trust, reviews, appointment CTAs, and crawl/AI citation work after pages exist.`
        : `Focus on ${serviceNiche}${locationPhrase} with task-driven SEO, AI citation readiness, and conversion assets.`,
    },
    {
      name: `${ctx.name} authority and content engine`,
      businessModel: healthcare ? "Healthcare content and trust engine" : "Content-led growth",
      targetAudience: ctx.audience,
      problemSolved: healthcare
        ? "Builds trust through condition/service pages, recovery FAQs, practitioner proof, reviews, and safe local authority tasks."
        : "Builds topical trust through keyword clusters, supporting pages, and safe authority tasks.",
      recommendedOffer: healthcare ? "Educational recovery content, service pages, review proof, and consultation booking." : ctx.offer,
      seoScore: clampScore(82 + (healthcare ? 5 : 0) + (localIntent ? 3 : 0)),
      competitionScore: clampScore(baseCompetition - 7),
      monetizationScore: clampScore(66 + (healthcare ? 6 : 0) + (wantsReport ? 2 : 0)),
      executionScore: clampScore(70 + (hasWebsite ? 4 : -2)),
      userFitScore: clampScore(70 + (ctx.outputs.some((output) => /seo|content|report|lead magnet/i.test(output)) ? 6 : 0)),
      summary: healthcare
        ? "Best when the clinic can invest in service pages, patient education, reviews, practitioner proof, and recurring local authority work."
        : "Best when the project can invest in pages, lead magnets, and recurring social/authority work.",
    },
    {
      name: `${ctx.name} fast launch package`,
      businessModel: "Fast MVP launch",
      targetAudience: ctx.audience,
      problemSolved: healthcare
        ? "Prioritizes the smallest set of clinic pages, booking CTAs, GBP setup, and local keyword targets needed to start generating appointments."
        : "Prioritizes the smallest publishable set of pages and tasks needed to launch quickly.",
      recommendedOffer: healthcare ? "Fast appointment funnel with core services, location page, reviews, and phone/booking CTA." : ctx.offer,
      seoScore: clampScore(66 + (localIntent ? 5 : 0) + (healthcare ? 2 : 0)),
      competitionScore: clampScore(baseCompetition + (fastTimeline ? 1 : 0)),
      monetizationScore: clampScore(70 + (healthcare ? 5 : 0) + (localIntent ? 3 : 0)),
      executionScore: clampScore(84 + (fastTimeline ? 6 : 0) + (!hasWebsite ? 2 : 0)),
      userFitScore: clampScore(72 + (fastTimeline ? 5 : 0) + (wantsWebsite ? 3 : 0)),
      summary: `Recommended when timeline is ${project.targetLaunchTimeline ?? "short"} and outputs are ${ctx.outputs.join(", ") || "focused"}.`,
    },
  ].map((option) => ({
    ...option,
    opportunityScore: clampScore((option.seoScore + option.monetizationScore + option.executionScore + option.userFitScore + (100 - option.competitionScore)) / 5),
  }));
}

function applyOpportunityRefinement(options: ReturnType<typeof buildOpportunityOptions>, instructions?: string | null) {
  if (!instructions?.trim()) return options;
  const request = instructions.toLowerCase();
  return options.map((option) => {
    let seoScore = option.seoScore;
    let competitionScore = option.competitionScore;
    let monetizationScore = option.monetizationScore;
    let executionScore = option.executionScore;
    let userFitScore = option.userFitScore;
    const evidence: string[] = [];
    if (/quick|faster|quickly|low implementation|low effort|30 days|launch/.test(request)) { executionScore += option.businessModel.includes("Fast") ? 14 : 7; evidence.push("faster execution"); }
    if (/lead|conversion|appointment|call to action|enquir/.test(request)) { monetizationScore += /lead|appointment/.test(option.businessModel.toLowerCase()) ? 14 : 7; userFitScore += 4; evidence.push("lead generation"); }
    if (/local|google business|service-area|location|review/.test(request)) { seoScore += /local|healthcare|appointment/.test(`${option.businessModel} ${option.name}`.toLowerCase()) ? 14 : 5; userFitScore += 6; evidence.push("local growth"); }
    if (/lower competition|realistic|early visibility/.test(request)) { competitionScore -= option.competitionScore <= 65 ? 15 : 9; seoScore += 4; evidence.push("lower competition"); }
    if (/revenue|buyer intent|value per|higher value|sales/.test(request)) { monetizationScore += option.monetizationScore >= 74 ? 14 : 8; evidence.push("revenue potential"); }
    if (/content|topical authority|keyword cluster|authority/.test(request)) { seoScore += /content|authority/.test(option.businessModel.toLowerCase()) ? 15 : 6; userFitScore += 4; evidence.push("content authority"); }
    seoScore = clampScore(seoScore); competitionScore = clampScore(competitionScore); monetizationScore = clampScore(monetizationScore); executionScore = clampScore(executionScore); userFitScore = clampScore(userFitScore);
    return { ...option, seoScore, competitionScore, monetizationScore, executionScore, userFitScore, opportunityScore: clampScore((seoScore + monetizationScore + executionScore + userFitScore + (100 - competitionScore)) / 5), summary: `${option.summary} Adjusted to prioritize ${evidence.length ? evidence.join(", ") : instructions.trim()}.` };
  }).sort((a, b) => b.opportunityScore - a.opportunityScore);
}

async function generateOpportunityRecommendations(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>, context: Awaited<ReturnType<typeof workspaceContext>>, refinement?: string | null) {
  const ctx = projectContext(project);
  const run = opportunityRunMode(project);
  const options = applyOpportunityRefinement(buildOpportunityOptions(project, ctx), refinement);
  // A clear project direction changes the decision required from the user; it
  // should not remove their ability to compare alternatives. Always persist
  // the three ranked options and mark the strongest one for confirmation.
  const recommendations = rankedOpportunityRecommendations(options);
  return prisma.$transaction(async (tx) => {
    // Saved ideas are user-owned decisions and must survive regeneration/refinement.
    await tx.opportunity.deleteMany({ where: { projectId: project.id, status: { in: ["suggested", "confirmation_required"] } } });
    const rows = await Promise.all(recommendations.map((option, index) => tx.opportunity.create({ data: {
      projectId: project.id,
      // Refinement changes the recommendation evidence and scores, not its title.
      // Keeping the stable base name prevents every option from displaying a
      // repeated "refined" suffix after subsequent refinement runs.
      name: option.name.replace(/(?:\s*[—-]\s*refined)+$/i, ""),
      targetAudience: option.targetAudience, problemSolved: option.problemSolved, recommendedOffer: option.recommendedOffer,
      businessModel: option.businessModel, opportunityScore: option.opportunityScore, seoScore: option.seoScore,
      competitionScore: option.competitionScore, monetizationScore: option.monetizationScore, executionScore: option.executionScore,
      userFitScore: option.userFitScore,
      summary: option.summary,
      status: run.mode === "confirmation" && index === 0 && !refinement ? "confirmation_required" : "suggested",
    } })));
    await tx.aiRun.create({ data: {
      projectId: project.id, clientId: project.clientId, moduleName: "opportunity", promptVersion: refinement ? "opportunity-refine-v1" : "dynamic-opportunity-v3",
      inputSnapshotJson: { projectId: project.id, inputs: opportunityInputSummary(project), context: ctx, mode: run.mode, refinement: refinement ?? null },
      outputJson: rows.map((row) => ({ id: row.id, name: row.name, score: row.opportunityScore, status: row.status })),
      outputText: refinement ? `Refined opportunity recommendations using: ${refinement}` : `Generated ${rows.length} ${run.mode} opportunity recommendation(s) from project intake.`, status: "completed",
    } });
    await recordWorkspaceActivity(tx, {
      context, action: refinement ? "opportunity.recommendations_refined" : "opportunity.recommendations_generated", entityType: "project", entityId: project.id,
      agencyClientId: project.agencyClientId, projectId: project.id,
      nextJson: { mode: run.mode, recommendationIds: rows.map((row) => row.id), input: opportunityInputSummary(project), refinement: refinement ?? null },
    });
    await syncProjectWorkflow(tx, project.id);
    return rows;
  });
}

function keywordTopicFromInstruction(instruction?: string | null) {
  if (!instruction) return null;
  const normalized = instruction.trim().replace(/[.!?]+$/, "");
  const explicitTopic = normalized.match(/(?:keywords?\s+for|opportunity:)\s+(.+)$/i)?.[1]?.trim();
  return explicitTopic && explicitTopic.split(/\s+/).length <= 12 ? explicitTopic : null;
}

function validSemanticKeyword(keyword: string, locations: string[]) {
  const normalized = keyword.trim().replace(/\s+/g, " ");
  const lower = normalized.toLocaleLowerCase().replace(/[.!]+$/, "");
  if (normalized.length < 4 || normalized.length > 120) return false;
  if (!lower.includes(" ")) return false;
  if (locations.some((location) => lower === location.trim().toLocaleLowerCase())) return false;
  if (/^(?:and|or)\b|^(?:and\s+)?others?\b|\b(?:and\s+)?others?\.?\s+(?:company|provider|services?)\b/.test(lower)) return false;
  if (/\bincluding\s+\S+$/.test(lower) || /\bservices?\s+services?\b/.test(lower)) return false;
  if (/\b(?:vista|things|stuff)\b/.test(lower)) return false;
  return true;
}

function semanticPreviewGroups(value: unknown, locations: string[]) {
  const rawGroups = value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as { groups?: unknown }).groups) ? (value as { groups: unknown[] }).groups : [];
  const allowed = new Set(["primary", "buyer_intent", "local", "informational", "supporting", "questions", "long_tail"]);
  return rawGroups.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const record = raw as Record<string, unknown>;
    const category = String(record.category ?? "supporting").trim().toLocaleLowerCase();
    if (!allowed.has(category)) return [];
    const keywords = [...new Map((Array.isArray(record.keywords) ? record.keywords : []).map(String).map((item) => item.trim()).filter((item) => validSemanticKeyword(item, locations)).map((item) => [item.toLocaleLowerCase(), item])).values()].slice(0, 10);
    return keywords.length ? [{ category, title: String(record.title ?? category.replaceAll("_", " ")).trim(), keywords }] : [];
  });
}

async function generateProjectKeywordGroups(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>, context: Awaited<ReturnType<typeof workspaceContext>>, manualSeed?: string | null, regenerate = false, append = false, expansionInstruction?: string | null) {
  if (!keywordIntakeSufficient(project) && !manualSeed) throw Object.assign(new Error("Project intake does not yet include a product/service, niche, or selected direction. Add that information or provide a manual seed keyword."), { statusCode: 409 });
  const expansionTopic = keywordTopicFromInstruction(expansionInstruction);
  const groups = buildKeywordGroups(project, manualSeed || expansionTopic);
  const pageText = project.websiteStatus === "existing_website" && project.websiteId
    ? await prisma.page.findMany({ where: { crawlJob: { websiteId: project.websiteId, status: "completed" } }, orderBy: { createdAt: "desc" }, take: 100, select: { url: true, seo: { select: { title: true, metaDescription: true, h1Text: true, h2Json: true } } } })
    : [];
  const content = pageText.map((page) => JSON.stringify(page).toLowerCase()).join(" ");
  const hadApprovedGroups = project.keywordGroups.some((group) => group.status === "approved");
  const strategyApproved = project.strategyPlans.some((strategy) => strategy.status === "approved");
  const rows = await prisma.$transaction(async (tx) => {
    const saved = [];
    for (const group of groups) {
      const existing = project.keywordGroups.find((item) => item.category === group.category);
      const keywords = append ? normalizeKeywordList([...normalizeKeywordList(existing?.keywords), ...group.keywords]) : group.keywords;
      const gapKeywords = pageText.length ? keywords.filter((keyword) => !content.includes(keyword.toLowerCase())) : [];
      saved.push(await tx.projectKeywordGroup.upsert({
        where: { projectId_category: { projectId: project.id, category: group.category } },
        update: { title: group.title, explanation: group.explanation, expectedValue: group.expectedValue, goalSupport: group.goalSupport, keywords, gapKeywords, source: expansionInstruction ? "ai_expansion" : manualSeed ? "manual_seed" : "project_intake", ...(regenerate ? { status: "suggested", approvedAt: null, approvedById: null } : {}) },
        create: { projectId: project.id, ...group, keywords, gapKeywords, source: expansionInstruction ? "ai_expansion" : manualSeed ? "manual_seed" : "project_intake" },
      }));
    }
    await recordWorkspaceActivity(tx, { context, action: regenerate ? "keyword.recommendations_regenerated" : append ? "keyword.more_ideas_generated" : "keyword.recommendations_generated", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { groupIds: saved.map((row) => row.id), manualSeed: manualSeed ?? null, expansionInstruction: expansionInstruction ?? null, expansionTopic, append, usedExistingWebsiteContent: pageText.length > 0 } });
    if ((regenerate || append) && hadApprovedGroups && strategyApproved) await createWorkspaceNotification(tx, { context, userId: context.workspace.ownerUserId, type: "approved_keywords_changed", title: "Approved keywords changed", body: `${project.name}'s approved keyword recommendations changed after Strategy approval. Regenerate Strategy and the Execution Plan.`, actionUrl: "/keywords", agencyClientId: project.agencyClientId, projectId: project.id });
    await syncProjectWorkflow(tx, project.id);
    return saved;
  });
  return rows;
}

function buildLeadMagnetPrompt(input: {
  project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>;
  strategy: NonNullable<NonNullable<Awaited<ReturnType<typeof scopedProject>>>["strategyPlans"][number]>;
  keywordRuns: Array<{ seedKeyword: string; intent: string | null; avgSearchVolume: number | null; opportunityScore: number | null; ideas: Array<{ keyword: string; avgMonthlySearches: number | null }> }>;
  selectedIdea?: string | null;
  instructions?: string | null;
  recommendation?: z.infer<typeof leadRecommendationSchema>;
  branding: Record<string, unknown>;
  research: Record<string, unknown>;
}) {
  const { project, strategy, keywordRuns, selectedIdea, instructions, recommendation, branding, research } = input;
  const ctx = projectContext(project);
  const selectedOpportunity = project.opportunities.find((opportunity) => opportunityDecisionStatus(opportunity.status)) ?? null;
  const keywords = keywordRuns.slice(0, 8).map((run) => ({
    seedKeyword: run.seedKeyword,
    intent: run.intent,
    avgSearchVolume: run.avgSearchVolume,
    opportunityScore: run.opportunityScore,
    relatedIdeas: run.ideas.slice(0, 5).map((idea) => ({ keyword: idea.keyword, volume: idea.avgMonthlySearches })),
  }));
  return [
    "Create a project-specific lead magnet package for SEnuke AI.",
    "The output must be practical, specific to the provided business, and suitable for review before publishing or sending.",
    "Do not use generic placeholder advice. If data is missing, use the best available project context and mark assumptions clearly.",
    "Do not claim measured traffic, conversion, or customer behaviour unless it appears in the supplied evidence. Treat estimated impact as directional.",
    "Generate the complete useful asset—not merely an outline. Each section needs substantive paragraphs, practical bullets, and an action step.",
    "Return JSON with this exact top-level shape:",
    selectedIdea ? `The user selected this lead magnet concept. Preserve its core intent and improve it: ${selectedIdea}` : "Choose the strongest concept from the project evidence.",
    recommendation ? `Evidence-backed recommendation selected by the user: ${JSON.stringify(recommendation)}` : "No structured recommendation was supplied; use the strongest available project evidence.",
    `Required research run completed before generation: ${JSON.stringify(research)}`,
    instructions ? `User requirements and constraints (follow unless unsafe or contradicted by project facts): ${instructions}` : "No additional user requirements were supplied.",
    "The title, promise, format, outline, CTA, and follow-up must align with the selected concept, target audience, offer, primary goal, market, and available keyword intent.",
    "Keep the opt-in form minimal. formFields may contain only First name, Last name, and Email; Email is always required.",
    JSON.stringify({
      leadMagnet: {
        title: "string",
        assetType: "Checklist | Guide | Comparison | Buyer's Guide | eBook | PDF Report | Template | Worksheet | Cheat Sheet | Email Course | Toolkit | Resource List | Case Study | Free Trial | Coupon or Discount | Quiz | Calculator",
        promise: "string",
        targetAudience: "string",
        problemSolved: "string",
        whyThisFits: ["string"],
        outline: ["string"],
        sections: [{ title: "string", summary: "string", paragraphs: ["string"], bullets: ["string"], actionStep: "string" }],
        interactiveDefinition: { inputs: ["string"], resultLogic: ["string"], outcomeCopy: ["string"] },
      },
      businessAnalysis: { business: "string", audience: "string", offer: "string", goal: "string", buyerStage: "awareness | consideration | decision", leadCaptureGap: "string", evidence: ["string"], assumptions: ["string"] },
      branding: { businessName: "string", brandVoice: "string", primaryColor: "#RRGGBB", secondaryColor: "#RRGGBB", logoUsage: "string", visualStyle: "string" },
      imagePlan: [{ role: "cover | section | diagram", prompt: "string", altText: "string", placement: "string" }],
      landingPage: {
        headline: "string",
        subheadline: "string",
        benefitBullets: ["string"],
        formFields: ["string"],
        ctaText: "string",
        proofBlocks: ["string"],
        faqs: [{ question: "string", answer: "string" }],
      },
      deliveryEmail: {
        subject: "string",
        previewText: "string",
        body: "string",
      },
      thankYouPage: {
        headline: "string",
        body: "string",
        nextStepCta: "string",
      },
      followUpSequence: [{ day: "string", subject: "string", goal: "string", body: "string" }],
      ctaFlow: ["string"],
      trackingPlan: ["string"],
      approvalChecklist: ["string"],
    }),
    "",
    "Project context:",
    `Business/project name: ${ctx.name}`,
    `Website: ${project.website?.domain ?? project.websiteUrl ?? "not connected"}`,
    `Project type: ${project.projectType}`,
    `Niche/industry: ${ctx.niche}`,
    `Location/market: ${ctx.location}`,
    `Primary goal: ${ctx.goal}`,
    `Target audience: ${ctx.audience}`,
    `Offer/services: ${ctx.offer}`,
    `Project deliverables: ${ctx.outputs.join(", ") || "not provided"}`,
    `Publishing method: ${project.preferredPublishingMethod ?? "not provided"}`,
    `Saved brand snapshot: ${JSON.stringify(branding)}`,
    "",
    "Approved strategy:",
    `Summary: ${strategy.strategySummary ?? "not provided"}`,
    `Positioning: ${strategy.positioningStatement ?? "not provided"}`,
    `Offer recommendation: ${strategy.offerRecommendation ?? "not provided"}`,
    `Content strategy: ${strategy.contentStrategy ?? "not provided"}`,
    `SEO strategy: ${strategy.seoStrategy ?? "not provided"}`,
    `Social strategy: ${strategy.socialStrategy ?? "not provided"}`,
    "",
    "Selected opportunity:",
    selectedOpportunity ? JSON.stringify({
      name: selectedOpportunity.name,
      summary: selectedOpportunity.summary,
      targetAudience: selectedOpportunity.targetAudience,
      recommendedOffer: selectedOpportunity.recommendedOffer,
      businessModel: selectedOpportunity.businessModel,
      score: selectedOpportunity.opportunityScore,
    }) : "none selected",
    "",
    "Keyword intelligence:",
    keywords.length ? JSON.stringify(keywords) : "No keyword runs yet. Avoid pretending keyword data exists.",
  ].join("\n");
}

function buildLeadMagnetResearchPrompt(input: {
  objective: z.infer<typeof leadMagnetResearchSchema>;
  evidence: Record<string, unknown>;
}) {
  return [
    "Research the strongest lead-magnet opportunities for this specific SEnuke AI project.",
    "This is a research and recommendation step only. Do not generate the lead magnet, landing page, or email sequence yet.",
    "Base every finding on the supplied business intake, keyword evidence, target geography, website analysis, selected Opportunity, approved Strategy, and SEO plan.",
    "Present the strongest recommendation from the existing evidence first. Follow-up questions must only refine genuine uncertainties; never make the initial recommendation depend on answering them.",
    input.objective.excludedRecommendationTitles?.length
      ? `The user requested fresh alternatives. Do not repeat these previous recommendation titles or merely reword the same concepts: ${input.objective.excludedRecommendationTitles.join(" | ")}`
      : "No previous recommendation titles need to be excluded.",
    "Do not claim live web research, measured visitor behaviour, or conversion performance that is absent from the evidence.",
    "When evidence is missing, state the limitation. Estimated impact must be directional and must never be presented as guaranteed.",
    "Rank options by audience usefulness, search intent, geographic relevance, website lead-capture gap, business-goal alignment, and proximity to the requested action.",
    "Return valid JSON with exactly this shape:",
    JSON.stringify({
      research: {
        objectiveSummary: "string",
        audienceNeeds: ["string"],
        keywordInsights: ["string"],
        geographicInsights: ["string"],
        siteInsights: ["string"],
        opportunityGaps: ["string"],
        recommendedStrategy: "string",
        researchLimits: ["string"],
      },
      followUpQuestions: [{ question: "string", why: "string", suggestedAnswer: "string or null" }],
      recommendations: [{
        type: "Checklist | Guide | Comparison | Buyer's Guide | eBook | PDF Report | Template | Worksheet | Cheat Sheet | Email Course | Toolkit | Resource List | Case Study | Free Trial | Coupon or Discount | Quiz | Calculator",
        title: "string",
        score: 90,
        buyerStage: "awareness | consideration | decision",
        signal: "specific evidence signal",
        why: "why this option fits the requested outcome",
        expectedOutcome: "directional expected outcome",
        estimatedImpact: {
          low: 8,
          high: 20,
          metric: "email sign-ups",
          confidence: "directional | medium",
          label: "Estimated +8–20% email sign-ups",
          disclaimer: "Directional projection based on available project evidence; not a guaranteed result.",
        },
        evidence: ["specific evidence item"],
        actionLabel: "Generate with AI",
      }],
    }),
    `What the user plans to achieve: ${JSON.stringify(input.objective)}`,
    `Project evidence: ${JSON.stringify(input.evidence)}`,
  ].join("\n");
}

function leadMagnetCoverImage(input: { title: string; businessName: string; branding: Record<string, unknown>; imagePlan: unknown }) {
  const generatedBrand = input.branding;
  const color = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const primary = color(generatedBrand.primaryColor, "#2563EB");
  const secondary = color(generatedBrand.secondaryColor, "#0F766E");
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
  const titleWords = input.title.slice(0, 90).split(/\s+/);
  const titleLines = titleWords.reduce<string[]>((lines, word) => {
    const index = Math.min(lines.length - 1, 1);
    if (!lines.length) return [word];
    if (lines[index].length + word.length + 1 <= 35) lines[index] += ` ${word}`;
    else if (lines.length < 2) lines.push(word);
    else lines[1] += ` ${word}`;
    return lines;
  }, []);
  const title = titleLines.map(escape);
  const business = escape(input.businessName.slice(0, 80));
  const visual = Array.isArray(input.imagePlan) && input.imagePlan[0] && typeof input.imagePlan[0] === "object"
    ? String((input.imagePlan[0] as Record<string, unknown>).altText ?? "Practical lead resource")
    : "Practical lead resource";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escape(visual.slice(0, 160))}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${primary}"/><stop offset="1" stop-color="${secondary}"/></linearGradient></defs><rect width="1200" height="630" rx="36" fill="#f8fafc"/><path d="M0 0h1200v190C970 278 780 92 560 184 342 274 176 224 0 116Z" fill="url(#g)"/><circle cx="1030" cy="455" r="210" fill="${primary}" opacity=".1"/><circle cx="990" cy="430" r="126" fill="${secondary}" opacity=".14"/><rect x="72" y="86" width="250" height="44" rx="22" fill="#fff" opacity=".92"/><text x="197" y="115" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="${primary}">FREE RESOURCE</text><text x="72" y="285" font-family="Arial,sans-serif" font-size="56" font-weight="800" fill="#0f172a">${title.map((line, index) => `<tspan x="72" dy="${index ? 68 : 0}">${line}</tspan>`).join("")}</text><text x="72" y="430" font-family="Arial,sans-serif" font-size="26" fill="#475569">Prepared for ${business}</text><rect x="72" y="480" width="360" height="12" rx="6" fill="${secondary}"/><rect x="72" y="514" width="500" height="10" rx="5" fill="#cbd5e1"/><rect x="72" y="548" width="430" height="10" rx="5" fill="#e2e8f0"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function leadMagnetSupportingImages(input: { branding: Record<string, unknown>; imagePlan: unknown }) {
  const color = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const primary = color(input.branding.primaryColor, "#2563EB");
  const secondary = color(input.branding.secondaryColor, "#0F766E");
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
  return (Array.isArray(input.imagePlan) ? input.imagePlan : []).slice(0, 3).map((raw, index) => {
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const role = String(item.role ?? `section-${index + 1}`);
    const altText = String(item.altText ?? item.prompt ?? `Supporting visual ${index + 1}`).slice(0, 180);
    const label = escape(altText.slice(0, 72));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="420" viewBox="0 0 900 420" role="img" aria-label="${escape(altText)}"><defs><linearGradient id="v${index}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${primary}" stop-opacity=".18"/><stop offset="1" stop-color="${secondary}" stop-opacity=".08"/></linearGradient></defs><rect width="900" height="420" rx="28" fill="#f8fafc"/><rect x="32" y="32" width="836" height="356" rx="22" fill="url(#v${index})" stroke="${primary}" stroke-opacity=".22"/><circle cx="${150 + index * 70}" cy="160" r="78" fill="${primary}" opacity=".9"/><path d="M110 160l28 28 58-68" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><text x="270" y="160" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="${secondary}">${escape(role.toUpperCase())}</text><text x="270" y="215" font-family="Arial,sans-serif" font-size="34" font-weight="800" fill="#0f172a">${label}</text><rect x="270" y="252" width="430" height="10" rx="5" fill="${primary}" opacity=".45"/><rect x="270" y="282" width="340" height="10" rx="5" fill="${secondary}" opacity=".32"/></svg>`;
    return { role, altText, placement: String(item.placement ?? `After section ${index + 1}`), prompt: String(item.prompt ?? ""), dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}` };
  });
}

async function activePlanId(tx: Prisma.TransactionClient, projectId: string) {
  const existing = await tx.executionPlan.findFirst({ where: { projectId, status: "active" }, orderBy: { createdAt: "asc" } });
  if (existing) return existing.id;
  const created = await tx.executionPlan.create({ data: { projectId, title: "Guided execution plan" } });
  return created.id;
}

type WorkspaceMilestoneStatus = "Completed" | "In Progress" | "Ready" | "Pending";

type WorkspaceMilestone = {
  title: string;
  moduleName: string;
  status: WorkspaceMilestoneStatus;
  reason: string;
  relatedUrl: string;
};

function taskMatches(task: { moduleName: string; title: string }, terms: string[]) {
  const haystack = `${task.moduleName} ${task.title}`.toLowerCase();
  return terms.some((term) => haystack.includes(term.toLowerCase()));
}

function milestoneTask<T extends { moduleName: string; title: string }>(tasks: T[], terms: string[]) {
  return tasks.find((task) => taskMatches(task, terms));
}

function inferWorkspaceMilestone(
  title: string,
  moduleName: string,
  relatedUrl: string,
  task: { title: string; status: string } | undefined,
  signals: { completed?: boolean; inProgress?: boolean; ready?: boolean; completedReason?: string; inProgressReason?: string; readyReason?: string },
): WorkspaceMilestone {
  if (task && ["completed", "skipped"].includes(task.status)) {
    return { title, moduleName, relatedUrl, status: "Completed", reason: `${task.title} is marked ${task.status}.` };
  }
  if (signals.completed) {
    return { title, moduleName, relatedUrl, status: "Completed", reason: signals.completedReason ?? "Existing workspace data confirms this step is already done." };
  }
  if (task && ["running", "queued", "in_progress", "needs_review"].includes(task.status)) {
    return { title, moduleName, relatedUrl, status: "In Progress", reason: `${task.title} is ${task.status.replace(/_/g, " ")}.` };
  }
  if (signals.inProgress) {
    return { title, moduleName, relatedUrl, status: "In Progress", reason: signals.inProgressReason ?? "Related workspace validation is currently running." };
  }
  if (task || signals.ready) {
    return { title, moduleName, relatedUrl, status: "Ready", reason: signals.readyReason ?? "This step is available from the current workspace data." };
  }
  return { title, moduleName, relatedUrl, status: "Pending", reason: "Waiting for earlier workspace data or execution tasks." };
}

function avgNumber(values: (number | null | undefined)[]) {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function keywordRunView(run: Prisma.KeywordResearchRunGetPayload<{ include: { website: { select: { id: true; domain: true; rootUrl: true } }; ideas: true; competitors: true } }>) {
  const avgDifficulty = avgNumber(run.ideas.map((idea) => idea.competitionIndex));
  const avgCpc = avgNumber(run.ideas.map((idea) => idea.cpc));
  const avgSearchVolume = avgNumber(run.ideas.map((idea) => idea.avgMonthlySearches)) ?? run.averageVolume;
  const opportunityScore = Math.round(Math.max(0, Math.min(100, 55 + Math.min(25, run.keywordCount / 20) + (avgDifficulty == null ? 8 : Math.max(0, 20 - avgDifficulty / 5)))));
  return {
    ...run,
    avgDifficulty,
    avgCpc,
    avgSearchVolume,
    opportunityScore,
    intent: run.ideas.some((idea) => (idea.competition ?? "").toLowerCase().includes("high")) ? "Commercial" : "Research",
  };
}

function workspaceRoadmap(input: {
  strategyApproved: boolean;
  tasks: { moduleName: string; title: string; status: string }[];
  website: { rootUrl: string; domain: string; status: string } | null | undefined;
  project: { websiteUrl: string | null } | null | undefined;
  completedCrawl: { pagesCrawled: number } | null | undefined;
  activeCrawl: { status: string } | null | undefined;
  keywordRuns: { status: string; keywordCount: number; ideas?: unknown[] }[];
}): WorkspaceMilestone[] {
  const hasWebsite = Boolean(input.website?.rootUrl || input.website?.domain || input.project?.websiteUrl);
  const hasScannedPages = Boolean(input.completedCrawl && input.completedCrawl.pagesCrawled > 0);
  const hasKeywordPlan = input.keywordRuns.some((run) => run.status === "completed" || run.keywordCount > 0 || (run.ideas?.length ?? 0) > 0);
  const hasDomainData = Boolean(input.website?.domain || input.project?.websiteUrl);

  return [
    {
      title: "Approve Strategy",
      moduleName: "strategy_approval",
      relatedUrl: "/strategy",
      status: input.strategyApproved ? "Completed" : "Pending",
      reason: input.strategyApproved ? "The current strategy plan is approved." : "Approve the strategy before downstream execution.",
    },
    inferWorkspaceMilestone("Generate Sitemap", "site_architect", "/site-architect", milestoneTask(input.tasks, ["site_architect", "sitemap"]), {
      completed: hasScannedPages,
      inProgress: Boolean(input.activeCrawl),
      ready: input.strategyApproved,
      completedReason: `A completed crawl already found ${input.completedCrawl?.pagesCrawled ?? 0} page(s), so sitemap/site structure evidence exists.`,
      inProgressReason: "A website crawl is currently running.",
      readyReason: "Strategy is approved and sitemap generation can start.",
    }),
    inferWorkspaceMilestone("Create Homepage", "content", "/ai-content", milestoneTask(input.tasks, ["content", "homepage"]), {
      completed: hasWebsite && hasScannedPages,
      inProgress: Boolean(input.activeCrawl),
      ready: input.strategyApproved,
      completedReason: "The connected website has a completed crawl, so the homepage/site entry point already exists.",
      inProgressReason: "A crawl is checking the current website pages.",
      readyReason: "Strategy is approved and homepage content can be created.",
    }),
    inferWorkspaceMilestone("Build Lead Magnet", "lead_magnet", "/lead-magnets", milestoneTask(input.tasks, ["lead_magnet", "lead magnet"]), {
      ready: input.strategyApproved,
      readyReason: "Strategy is approved and the lead magnet can be generated from the offer and audience.",
    }),
    inferWorkspaceMilestone("Create SEO Plan", "keyword_research", "/keywords", milestoneTask(input.tasks, ["keyword_research", "seo plan"]), {
      completed: hasKeywordPlan,
      ready: input.strategyApproved,
      completedReason: "Keyword research data already exists for this workspace.",
      readyReason: "Strategy is approved and keyword mapping can start.",
    }),
    inferWorkspaceMilestone("Find Domains", "domain", "/local-seo", milestoneTask(input.tasks, ["domain", "find domains"]), {
      completed: hasDomainData,
      ready: input.strategyApproved,
      completedReason: "A domain or website URL is already connected to this workspace.",
      readyReason: "Strategy is approved and domain discovery can start.",
    }),
    inferWorkspaceMilestone("Publish Site", "publishing", "/ai-content", milestoneTask(input.tasks, ["publishing", "publish"]), {
      completed: input.website?.status === "active" && hasScannedPages,
      ready: input.strategyApproved,
      completedReason: "The website is active and has been crawled successfully.",
      readyReason: "Strategy is approved. Complete upstream execution tasks before publishing.",
    }),
  ];
}

guidedProjectsRouter.get("/projects-v2/intake-questions", (_req, res) => {
  res.json({ questions: intakeQuestions });
});

guidedProjectsRouter.patch("/admin/project-workflow-steps/:stepId", requireRole("super_admin"), async (req, res) => {
  const parsed = workflowStepPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const step = await prisma.projectWorkflowStep.findUnique({
    where: { id: req.params.stepId },
    include: { project: { select: { id: true, clientId: true } } },
  });
  if (!step) return res.status(404).json({ error: "workflow step not found" });
  const clientId = await projectClientIdForRequest(req);
  if (clientId && step.project.clientId !== clientId) return res.status(404).json({ error: "workflow step not found" });

  const status = parsed.data.status;
  const updated = await prisma.projectWorkflowStep.update({
    where: { id: step.id },
    data: {
      ...parsed.data,
      completedAt: status === "completed" || status === "skipped" ? new Date() : status ? null : undefined,
    },
  });
  res.json({ step: updated });
});

guidedProjectsRouter.post("/admin/projects/:projectId/workflow-steps", requireRole("super_admin"), async (req, res) => {
  const parsed = workflowStepCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const status = parsed.data.status;
  const step = await prisma.projectWorkflowStep.create({
    data: {
      projectId: project.id,
      stepKey: parsed.data.stepKey,
      title: parsed.data.title,
      description: parsed.data.description,
      status,
      priority: parsed.data.priority,
      actionLabel: parsed.data.actionLabel ?? null,
      actionUrl: parsed.data.actionUrl ?? null,
      sortOrder: parsed.data.sortOrder,
      sourceType: "admin",
      sourceId: (req as unknown as { user?: { id?: string } }).user?.id ?? null,
      readyReason: status === "ready" ? parsed.data.reason ?? null : null,
      blockedReason: status === "blocked" ? parsed.data.reason ?? null : null,
      completionReason: status === "completed" || status === "skipped" ? parsed.data.reason ?? null : null,
      completedAt: status === "completed" || status === "skipped" ? new Date() : null,
    },
  });
  res.status(201).json({ step });
});

guidedProjectsRouter.post("/admin/projects/:projectId/workflow/sync", requireRole("super_admin"), async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  await prisma.$transaction((tx) => syncProjectWorkflow(tx, project.id));
  const updated = await scopedProject(req, project.id);
  res.json({ project: updated });
});

guidedProjectsRouter.patch("/admin/module-tasks/:taskId", requireRole("super_admin"), async (req, res) => {
  const parsed = moduleTaskPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const task = await prisma.executionTask.findUnique({ where: { id: req.params.taskId } });
  if (!task) return res.status(404).json({ error: "module task not found" });
  const projectWorkflowModules = new Set(["core_intake", "opportunity", "strategy", "strategy_approval"]);
  if (projectWorkflowModules.has(task.moduleName)) return res.status(400).json({ error: "project workflow steps are managed separately" });
  const clientId = await projectClientIdForRequest(req);
  if (clientId && task.clientId !== clientId) return res.status(404).json({ error: "module task not found" });

  const status = parsed.data.status;
  const updated = await prisma.executionTask.update({
    where: { id: task.id },
    data: {
      ...parsed.data,
      completedAt: status === "completed" ? new Date() : status ? null : undefined,
      skippedAt: status === "skipped" ? new Date() : status ? null : undefined,
    },
  });
  if (updated.projectId) {
    await prisma.$transaction((tx) => syncProjectWorkflow(tx, updated.projectId!));
  }
  res.json({ task: updated });
});

guidedProjectsRouter.post("/admin/module-tasks", requireRole("super_admin"), async (req, res) => {
  const parsed = moduleTaskCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await projectClientIdForRequest(req);
  if (!clientId) return res.status(400).json({ error: "client context is required" });

  let project: Awaited<ReturnType<typeof scopedProject>> | null = null;
  if (parsed.data.projectId) {
    project = await scopedProject(req, parsed.data.projectId);
    if (!project) return res.status(404).json({ error: "project not found" });
  }

  const planId = project ? await prisma.$transaction((tx) => activePlanId(tx, project!.id)) : null;
  const dedupeKey = `admin:${clientId}:${parsed.data.projectId ?? "workspace"}:${parsed.data.moduleName}:${Date.now()}`;
  const status = parsed.data.status;
  const task = await prisma.executionTask.create({
    data: {
      clientId,
      websiteId: parsed.data.websiteId ?? project?.websiteId ?? null,
      projectId: parsed.data.projectId ?? null,
      executionPlanId: planId,
      moduleName: parsed.data.moduleName,
      sourceType: "admin",
      sourceId: (req as unknown as { user?: { id?: string } }).user?.id ?? null,
      dedupeKey,
      title: parsed.data.title,
      description: parsed.data.description,
      expectedOutcome: parsed.data.expectedOutcome ?? parsed.data.description,
      priority: parsed.data.priority,
      automationLevel: parsed.data.automationLevel,
      status,
      requiresApproval: parsed.data.requiresApproval,
      requiresIntegration: parsed.data.requiresIntegration,
      manualRequired: parsed.data.manualRequired,
      actionButtonLabel: parsed.data.actionButtonLabel ?? null,
      relatedUrl: parsed.data.relatedUrl ?? null,
      manualInstructions: parsed.data.manualInstructions ?? null,
      completedAt: status === "completed" ? new Date() : null,
      skippedAt: status === "skipped" ? new Date() : null,
    },
  });
  if (task.projectId) {
    await prisma.$transaction((tx) => syncProjectWorkflow(tx, task.projectId!));
  }
  res.status(201).json({ task });
});

guidedProjectsRouter.get("/workspace/intelligence", async (req, res) => {
  const clientId = await projectClientIdForRequest(req);
  if (!clientId) return res.json({
    projects: [],
    websites: [],
    keywordRuns: [],
    tasks: [],
    notifications: [],
    backlinkSummary: null,
    backlinkLinks: null,
    intelligence: {
      activeProjectId: null,
      activeWebsiteId: null,
      signals: {},
      modules: {},
      roadmap: [],
    },
  });

  const requestedProjectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  const requestedWebsiteId = typeof req.query.websiteId === "string" ? req.query.websiteId : null;
  await syncProjectWorkflowsForClient(clientId, requestedProjectId);

  const context = await workspaceContext(req);
  const assignmentFilter = workspaceProjectAssignmentFilter(context);
  const projects = await prisma.project.findMany({
    where: { clientId, ...assignmentFilter, ...(requestedProjectId ? { id: requestedProjectId } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      website: {
        select: {
          id: true,
          domain: true,
          rootUrl: true,
          status: true,
          targetCountry: true,
          targetCities: true,
          createdAt: true,
          _count: { select: { crawlJobs: true } },
          crawlJobs: {
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              id: true,
              status: true,
              siteScore: true,
              pagesCrawled: true,
              errorCount: true,
              options: true,
              createdAt: true,
              startedAt: true,
              completedAt: true,
              error: true,
            },
          },
        },
      },
      agencyClient: { select: { id: true, name: true, contactPhone: true, businessLocations: true, defaultSettings: true } },
      businessProfile: true,
      workflowSteps: { orderBy: { sortOrder: "asc" } },
      intakeAnswers: { orderBy: { createdAt: "asc" } },
      executionPlans: {
        where: { status: "active" },
        orderBy: { createdAt: "asc" },
        take: 1,
        include: {
          tasks: { orderBy: [{ createdAt: "asc" }], take: 100, include: { dependencies: { include: { requiredTask: { select: { id: true, title: true, status: true } } } }, assignee: { select: { id: true, user: { select: { name: true, email: true } } } } } },
        },
      },
      opportunities: { orderBy: { createdAt: "desc" }, take: 5 },
      keywordGroups: { orderBy: { createdAt: "asc" } },
      strategyPlans: { orderBy: { createdAt: "desc" }, take: 3 },
      _count: { select: { intakeAnswers: true, strategyPlans: true, opportunities: true } },
    },
    take: requestedProjectId ? 1 : 25,
  });

  const activeProject = projects[0] ?? null;
  const activeWebsiteId = requestedWebsiteId ?? activeProject?.websiteId ?? activeProject?.website?.id ?? null;
  const websites = await prisma.website.findMany({
    where: { clientId, ...(activeWebsiteId ? { id: activeWebsiteId } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { crawlJobs: true } },
      crawlJobs: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          siteScore: true,
          pagesCrawled: true,
          errorCount: true,
          options: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          error: true,
        },
      },
      localBusinessProfiles: true,
    },
    take: activeWebsiteId ? 1 : 25,
  });
  const activeWebsite = activeProject ? activeProject.website : websites[0] ?? null;
  const websiteIds = Array.from(new Set([activeWebsite?.id, activeProject?.websiteId, ...websites.map((website) => website.id)].filter((id): id is string => Boolean(id))));
  const taskScope: Prisma.ExecutionTaskWhereInput[] = activeProject
    ? [{ projectId: activeProject.id }]
    : websiteIds.length ? [{ websiteId: { in: websiteIds } }] : [];

  const [tasks, keywordRuns, leadMagnetGenerations, notifications] = await Promise.all([
    prisma.executionTask.findMany({
      where: {
        clientId,
        ...(taskScope.length ? { OR: taskScope } : {}),
      },
      orderBy: [{ status: "asc" }, { priority: "asc" }, { updatedAt: "desc" }],
      take: 200,
    }),
    prisma.keywordResearchRun.findMany({
      where: { clientId, ...(activeProject ? { projectId: activeProject.id } : websiteIds.length ? { websiteId: { in: websiteIds } } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        website: { select: { id: true, domain: true, rootUrl: true } },
        ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 10 },
        competitors: { orderBy: { rank: "asc" }, take: 3 },
      },
      take: 500,
    }),
    prisma.aiContentGeneration.findMany({
      where: {
        clientId,
        type: "lead_magnet",
        ...(activeWebsite?.id || activeProject?.websiteId ? { websiteId: activeWebsite?.id ?? activeProject?.websiteId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    activeProject && hasWorkspacePermission(context, "view_notifications") ? prisma.workspaceNotification.findMany({
      where: { workspaceId: context.workspace.id, userId: context.membership.userId, projectId: activeProject.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }) : Promise.resolve([]),
  ]);

  const crawlJobs = websites.flatMap((website) => website.crawlJobs ?? []);
  const completedCrawl = crawlJobs.find((crawl) => crawl.status === "completed") ?? null;
  const activeCrawl = crawlJobs.find((crawl) => crawl.status === "queued" || crawl.status === "running") ?? null;
  const latestStrategy = activeProject?.strategyPlans[0] ?? null;
  const strategyReviewTasks = tasks.filter((task) => task.moduleName === "strategy_approval");
  const strategyApproved = latestStrategy?.status === "approved" || activeProject?.currentStep === "execution" || strategyReviewTasks.some((task) => ["completed", "skipped"].includes(task.status));
  const keywordViews = keywordRuns.map(keywordRunView);
  const roadmap = workspaceRoadmap({
    strategyApproved,
    tasks,
    notifications,
    website: activeWebsite,
    project: activeProject,
    completedCrawl,
    activeCrawl,
    keywordRuns: keywordViews,
  });
  const openTasks = tasks.filter((task) => !["completed", "skipped"].includes(task.status));
  const moduleStatuses = Object.fromEntries(roadmap.map((item) => [item.moduleName, { status: item.status, reason: item.reason, relatedUrl: item.relatedUrl }]));

  res.json({
    projects,
    websites: websites.map((website) => ({ ...website, hasCompletedCrawl: website.crawlJobs?.some((crawl) => crawl.status === "completed") ?? false })),
    keywordRuns: keywordViews,
    leadMagnetGenerations,
    tasks,
    backlinkSummary: null,
    backlinkLinks: null,
    intelligence: {
      activeProjectId: activeProject?.id ?? null,
      activeWebsiteId: activeWebsite?.id ?? null,
      projectWorkflowSteps: activeProject?.workflowSteps ?? [],
      signals: {
        intakeComplete: Boolean((activeProject?._count?.intakeAnswers ?? activeProject?.intakeAnswers.length ?? 0) > 0),
        strategyApproved,
        hasWebsite: Boolean(activeWebsite?.rootUrl || activeWebsite?.domain || activeProject?.websiteUrl),
        hasCompletedCrawl: Boolean(completedCrawl),
        activeCrawlStatus: activeCrawl?.status ?? null,
        pagesCrawled: completedCrawl?.pagesCrawled ?? 0,
        siteScore: completedCrawl?.siteScore ?? null,
        keywordRunCount: keywordRuns.length,
        openTaskCount: openTasks.length,
        completedTaskCount: tasks.filter((task) => ["completed", "skipped"].includes(task.status)).length,
      },
      modules: moduleStatuses,
      roadmap,
    },
  });
});

guidedProjectsRouter.get("/projects-v2", async (req, res) => {
  const clientId = await projectClientIdForRequest(req);
  const context = await workspaceContext(req);
  const assignmentFilter = workspaceProjectAssignmentFilter(context);
  if (clientId) await syncProjectWorkflowsForClient(clientId);
  const projects = clientId ? await prisma.project.findMany({
    where: { clientId, ...assignmentFilter },
    orderBy: { createdAt: "desc" },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true, status: true } },
      agencyClient: { select: { id: true, name: true, contactPhone: true, businessLocations: true, defaultSettings: true } },
      businessProfile: true,
      workflowSteps: { orderBy: { sortOrder: "asc" } },
      executionPlans: {
        where: { status: "active" },
        take: 1,
        include: {
          tasks: {
            where: { status: { notIn: ["completed", "skipped"] } },
            orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
            take: 5,
          },
        },
      },
      _count: { select: { intakeAnswers: true, strategyPlans: true, opportunities: true } },
    },
  }) : [];
  const taskStatusCounts = projects.length ? await prisma.executionTask.groupBy({
    by: ["projectId", "status"],
    where: { projectId: { in: projects.map((project) => project.id) } },
    _count: { _all: true },
  }) : [];
  const executionByProject = new Map<string, { total: number; completed: number }>();
  for (const row of taskStatusCounts) {
    if (!row.projectId) continue;
    const counts = executionByProject.get(row.projectId) ?? { total: 0, completed: 0 };
    counts.total += row._count._all;
    if (["completed", "skipped", "published"].includes(row.status)) counts.completed += row._count._all;
    executionByProject.set(row.projectId, counts);
  }
  res.json({ projects: projects.map((project) => ({
    ...project,
    executionProgress: executionByProject.get(project.id) ?? { total: 0, completed: 0 },
  })) });
});

guidedProjectsRouter.post("/projects-v2/intake-draft", async (req, res) => {
  const parsed = conversationalDraftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "editor");
  const clientId = await projectClientIdForRequest(req);
  if (!clientId) return res.status(400).json({ error: "project context required" });
  if (context.workspace.workspaceType === "agency" && !data.agencyClientId) return res.status(400).json({ error: "Agency Workspace projects require a client." });
  const agencyClient = data.agencyClientId ? await prisma.agencyClient.findFirst({ where: { id: data.agencyClientId, workspaceId: context.workspace.id, status: "active" } }) : null;
  if (data.agencyClientId && (!agencyClient || !await canAccessAgencyClient(context, data.agencyClientId))) return res.status(404).json({ error: "agency client not found" });
  const normalized = data.websiteUrl ? normalizeUrl(data.websiteUrl) : null;
  if (data.websiteStatus === "existing_website" && !data.websiteUrl) return res.status(400).json({ error: "Website URL is required for Existing Website." });
  if (data.websiteUrl && !normalized) return res.status(400).json({ error: "Enter a valid Website URL or leave it blank." });
  const goals = normalizeProjectGoals(data.primaryGoal, [], context.workspace.workspaceType);
  const location = [data.businessLocationDetails.streetAddress, data.businessLocationDetails.city, data.businessLocationDetails.stateProvince, data.businessLocationDetails.postalCode, data.businessLocationDetails.country].filter(Boolean).join(", ");
  const targetMarkets = cleanGeographicTargetMarkets(data.targetLocations);
  if (!targetMarkets.length) return res.status(400).json({ error: "Target Markets must contain at least one country, province/state, region, city, or neighbourhood—not an audience or keyword." });
  const project = await prisma.$transaction(async (tx) => {
    const row = await tx.project.create({ data: {
      clientId, agencyClientId: agencyClient?.id ?? null, name: data.name, projectType: data.projectType,
      websiteStatus: data.websiteStatus, websiteUrl: normalized?.rootUrl ?? null, businessName: agencyClient ? null : (data.businessName || null),
      niche: data.niche, businessLocation: location, businessLocationJson: data.businessLocationDetails, targetLocations: targetMarkets, targetLocation: targetMarkets.join(", ").slice(0, 180), primaryGoal: goals.primaryGoal, status: "intake_draft", currentStep: "intake",
    } });
    if (!context.roles.has("owner") && !context.roles.has("admin")) await tx.projectMemberAssignment.create({ data: { projectId: row.id, membershipId: context.membership.id, assignmentRole: context.roles.has("manager") ? "manager" : "contributor" } });
    await recordWorkspaceActivity(tx, { context, action: "project.intake_draft_saved", entityType: "project", entityId: row.id, agencyClientId: row.agencyClientId, projectId: row.id, nextJson: { name: row.name, projectType: row.projectType, websiteStatus: row.websiteStatus, websiteUrl: row.websiteUrl, niche: row.niche, businessLocation: row.businessLocation, targetLocations: row.targetLocations, primaryGoal: row.primaryGoal, status: row.status } });
    return row;
  });
  res.status(201).json({ project });
});

guidedProjectsRouter.patch("/projects-v2/:projectId/intake-draft", async (req, res) => {
  const parsed = conversationalDraftUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const context = await requireRequestPermission(req, "edit_project_settings");
  const project = await scopedProject(req, req.params.projectId);
  if (!project || project.status === "archived") return res.status(project ? 409 : 404).json({ error: project ? "Restore the project before editing it." : "project not found" });
  const location = data.businessLocation;
  const locationComplete = Boolean(location?.country && location?.stateProvince && location?.city);
  const formattedLocation = locationComplete ? [location?.streetAddress, location?.city, location?.stateProvince, location?.postalCode, location?.country].filter(Boolean).join(", ") : undefined;
  const targetMarkets = data.targetMarkets === undefined ? undefined : cleanGeographicTargetMarkets(data.targetMarkets);
  const normalized = data.websiteUrl ? normalizeUrl(data.websiteUrl) : null;
  if (data.websiteUrl && !normalized) return res.status(400).json({ error: "Enter a valid Website URL or leave it blank." });
  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: project.id }, data: {
      ...(data.projectName ? { name: data.projectName } : {}), ...(data.businessName !== undefined ? { businessName: data.businessName || null } : {}), ...(data.industryNiche !== undefined ? { niche: data.industryNiche || null } : {}),
      ...(data.websiteStatus ? { websiteStatus: data.websiteStatus } : {}), ...(data.websiteUrl !== undefined ? { websiteUrl: normalized?.rootUrl ?? null } : {}),
      ...(location ? formattedLocation ? { businessLocation: formattedLocation, businessLocationJson: location as Prisma.InputJsonValue } : { businessLocation: null, businessLocationJson: Prisma.DbNull } : {}), ...(targetMarkets !== undefined ? { targetLocations: targetMarkets, targetLocation: targetMarkets.join(", ").slice(0, 180) || null } : {}),
      ...(data.primaryGoal !== undefined ? { primaryGoal: data.primaryGoal || null } : {}), ...(data.secondaryGoals ? { secondaryGoals: data.secondaryGoals } : {}), ...(data.competitors ? { competitors: data.competitors } : {}),
      ...(data.brandVoice !== undefined ? { brandVoice: data.brandVoice || null } : {}), ...(data.preferredOutputs ? { preferredOutputs: data.preferredOutputs } : {}), ...(data.targetLaunchTimeline !== undefined ? { targetLaunchTimeline: data.targetLaunchTimeline || null } : {}),
    } });
    if (data.businessDescription !== undefined || data.targetAudience !== undefined || data.productsServices !== undefined) await tx.businessProfile.upsert({ where: { projectId: project.id }, create: { projectId: project.id, businessSummary: data.businessDescription || null, targetAudience: data.targetAudience || null, offerSummary: data.productsServices || null }, update: { ...(data.businessDescription !== undefined ? { businessSummary: data.businessDescription || null } : {}), ...(data.targetAudience !== undefined ? { targetAudience: data.targetAudience || null } : {}), ...(data.productsServices !== undefined ? { offerSummary: data.productsServices || null } : {}) } });
    if (data.primaryKeywords !== undefined) { const keywords = normalizeIntakeKeywords(data.primaryKeywords, targetMarkets ?? cleanGeographicTargetMarkets(Array.isArray(project.targetLocations) ? project.targetLocations.map(String) : [])); if (keywords.length) await tx.projectKeywordGroup.upsert({ where: { projectId_category: { projectId: project.id, category: "primary" } }, create: { projectId: project.id, category: "primary", title: "Primary Keywords", explanation: "Starting keyword directions captured during conversational intake.", expectedValue: "Provides an initial direction for Keyword Intelligence validation.", goalSupport: `Supports ${data.primaryGoal || project.primaryGoal || "the project goal"}.`, keywords, source: "project_intake" }, update: { keywords } }); else await tx.projectKeywordGroup.deleteMany({ where: { projectId: project.id, category: "primary", source: "project_intake" } }); }
    if (data.secondaryKeywords !== undefined) { const keywords = normalizeIntakeKeywords(data.secondaryKeywords, targetMarkets ?? cleanGeographicTargetMarkets(Array.isArray(project.targetLocations) ? project.targetLocations.map(String) : [])); if (keywords.length) await tx.projectKeywordGroup.upsert({ where: { projectId_category: { projectId: project.id, category: "supporting_topics" } }, create: { projectId: project.id, category: "supporting_topics", title: "Secondary Keywords", explanation: "Supporting keyword directions captured during conversational intake.", expectedValue: "Expands topical coverage before Keyword Intelligence validation.", goalSupport: `Supports ${data.primaryGoal || project.primaryGoal || "the project goal"}.`, keywords, source: "project_intake" }, update: { keywords } }); else await tx.projectKeywordGroup.deleteMany({ where: { projectId: project.id, category: "supporting_topics", source: "project_intake" } }); }
    if (data.aiConversationSessionId) {
      const session = await tx.workspaceAiIntakeSession.findFirst({ where: { id: data.aiConversationSessionId, workspaceId: context.workspace.id, userId: context.membership.userId, appliedProjectId: project.id, mode: "conversation", status: { in: ["active", "applied"] } } });
      if (session) {
        const input = session.inputJson && typeof session.inputJson === "object" && !Array.isArray(session.inputJson) ? session.inputJson as Record<string, unknown> : {};
        const safeDraft = { ...data, ...(targetMarkets !== undefined ? { targetMarkets } : {}) };
        await tx.workspaceAiIntakeSession.update({ where: { id: session.id }, data: { inputJson: { ...input, draft: safeDraft } as Prisma.InputJsonValue } });
      }
    }
  });
  res.json({ saved: true, projectId: project.id, savedAt: new Date().toISOString() });
});

guidedProjectsRouter.post("/projects-v2", async (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const targetLocations = cleanGeographicTargetMarkets(cleanLocations(data.targetLocations, data.targetLocation));
  const workspace = await workspaceContext(req);
  requireWorkspaceRole(workspace, "editor");
  const aiIntakeSession = data.aiIntakeSessionId ? await prisma.workspaceAiIntakeSession.findFirst({ where: { id: data.aiIntakeSessionId, workspaceId: workspace.workspace.id, userId: workspace.membership.userId, contextType: "project", status: "reviewed" } }) : null;
  if (data.aiIntakeSessionId && !aiIntakeSession) return res.status(400).json({ error: "Review the AI intake suggestions again before creating this project." });
  const conversationSession = data.aiConversationSessionId ? await prisma.workspaceAiIntakeSession.findFirst({ where: { id: data.aiConversationSessionId, workspaceId: workspace.workspace.id, userId: workspace.membership.userId, contextType: "project", mode: "conversation", status: "active" } }) : null;
  if (data.aiConversationSessionId && !conversationSession) return res.status(400).json({ error: "This AI project conversation is no longer available. Reopen the conversational intake before creating the project." });
  const conversationInput = conversationSession?.inputJson && typeof conversationSession.inputJson === "object" && !Array.isArray(conversationSession.inputJson) ? conversationSession.inputJson as Record<string, unknown> : {};
  const persistedConversation = Array.isArray(conversationInput.messages) ? conversationInput.messages.filter((message): message is { role: "user" | "assistant"; text: string; requestNumber?: number; usageEventId?: string } => Boolean(message && typeof message === "object" && "role" in message && "text" in message && ((message as { role?: unknown }).role === "user" || (message as { role?: unknown }).role === "assistant") && typeof (message as { text?: unknown }).text === "string")) : [];
  const finalConversationTranscript = persistedConversation.length ? persistedConversation : data.conversationTranscript;
  const reviewedAi = aiIntakeSession?.reviewJson && typeof aiIntakeSession.reviewJson === "object" && !Array.isArray(aiIntakeSession.reviewJson) ? aiIntakeSession.reviewJson as Record<string, { action?: string; value?: unknown }> : {};
  const acceptedAi = Object.fromEntries(Object.entries(reviewedAi).filter(([, item]) => item.action === "accepted" || item.action === "edited").map(([field, item]) => [field, item.value]));
  if (workspace.workspace.workspaceType === "agency" && !data.agencyClientId) {
    return res.status(400).json({ error: "Agency Workspace projects require a client." });
  }
  if (data.agencyClientId && !await canAccessAgencyClient(workspace, data.agencyClientId)) {
    return res.status(404).json({ error: "agency client not found" });
  }
  const agencyClient = data.agencyClientId ? await prisma.agencyClient.findFirst({
    where: { id: data.agencyClientId, workspaceId: workspace.workspace.id, status: "active" },
  }) : null;
  if (data.agencyClientId && !agencyClient) return res.status(404).json({ error: "agency client not found" });
  const workspaceDefaults = locationDefaultsFromSettings(workspace.workspace.settingsJson);
  const defaults = agencyClient ? clientDefaults(agencyClient) : {
    businessLocation: workspaceDefaults.businessLocation, businessLocationDetails: workspaceDefaults.businessLocationDetails, targetLocations: workspaceDefaults.targetMarkets,
    websiteUrl: "", niche: "", primaryGoal: "", brandVoice: "", businessDescription: "", targetAudience: "",
    mainProductsServices: "", primaryKeywords: [] as string[], preferredLanguage: "", timeZone: "",
    aiBusinessIntelligence: {} as Record<string, unknown>,
  };
  const inheritedClientNotes = [
    defaults.businessDescription && `Business description: ${defaults.businessDescription}`,
    defaults.targetAudience && `Target audience: ${defaults.targetAudience}`,
    defaults.mainProductsServices && `Main products/services: ${defaults.mainProductsServices}`,
    defaults.primaryKeywords.length && `Primary keywords: ${defaults.primaryKeywords.join(", ")}`,
    defaults.preferredLanguage && `Preferred language: ${defaults.preferredLanguage}`,
    defaults.timeZone && `Time zone: ${defaults.timeZone}`,
  ].filter(Boolean).join("\n");
  const clientId = await projectClientIdForRequest(req, data.clientId);
  if (!clientId) return res.status(400).json({ error: "project context required" });

  const resolvedLocations = resolveProjectLocations({
    businessLocation: data.businessLocation,
    businessLocationDetails: data.businessLocationDetails,
    targetMarkets: targetLocations,
    defaults: { businessLocation: defaults.businessLocation, businessLocationDetails: defaults.businessLocationDetails, targetMarkets: defaults.targetLocations },
  });
  const effectiveBusinessLocation = resolvedLocations.businessLocation || null;
  const effectiveTargetLocations = resolvedLocations.targetMarkets;
  const effectiveBusinessLocationDetails = resolvedLocations.businessLocationDetails;
  const goals = normalizeProjectGoals(clean(data.primaryGoal) || defaults.primaryGoal, data.secondaryGoals, workspace.workspace.workspaceType);
  const effectivePrimaryGoal = goals.primaryGoal;
  const websiteUrl = data.websiteStatus === "existing_website" ? clean(data.websiteUrl) || defaults.websiteUrl : clean(data.websiteUrl);
  const creationErrors = validateProjectCreation({ ...data, websiteUrl, businessLocation: effectiveBusinessLocation, targetLocations: effectiveTargetLocations, primaryGoal: effectivePrimaryGoal }, workspace.workspace.workspaceType);
  if (creationErrors.length) return res.status(400).json({ error: creationErrors.join(" ") });
  const normalized = normalizeUrl(websiteUrl);
  if (websiteUrl && !normalized) return res.status(400).json({ error: "Enter a valid Website URL or leave it blank." });
  const effectiveProjectType = data.projectType;
  const result = await prisma.$transaction(async (tx) => {
    let website = normalized
      ? await tx.website.findFirst({ where: { clientId, domain: normalized.domain, status: "active" } })
      : null;

    if (!website && normalized && effectiveProjectType !== "new_business") {
      website = await tx.website.create({
        data: {
          clientId,
          domain: normalized.domain,
          rootUrl: normalized.rootUrl,
          status: "active",
          targetCountry: effectiveTargetLocations[0] ?? undefined,
          targetCities: effectiveTargetLocations,
        },
      });
    } else if (website && effectiveTargetLocations.length) {
      website = await tx.website.update({
        where: { id: website.id },
        data: {
          targetCountry: effectiveTargetLocations[0],
          targetCities: effectiveTargetLocations,
        },
      });
    }

    const project = await tx.project.create({
      data: {
        clientId,
        agencyClientId: agencyClient?.id ?? null,
        websiteId: website?.id ?? null,
        name: data.name.trim(),
        projectType: effectiveProjectType,
        websiteStatus: data.websiteStatus,
        businessName: agencyClient ? null : clean(data.businessName),
        websiteUrl: normalized?.rootUrl ?? clean(data.websiteUrl),
        niche: clean(data.niche),
        businessLocation: effectiveBusinessLocation,
        businessLocationJson: effectiveBusinessLocationDetails ?? undefined,
        targetLocations: effectiveTargetLocations,
        targetLocation: effectiveTargetLocations.join(", ").slice(0, 180) || null,
        primaryGoal: effectivePrimaryGoal,
        secondaryGoals: goals.secondaryGoals,
        competitors: data.competitors,
        notes: clean(data.notes) || inheritedClientNotes || null,
        brandVoice: clean(data.brandVoice) || defaults.brandVoice || null,
        analyticsPlatforms: data.analyticsPlatforms,
        cmsPlatform: clean(data.cmsPlatform),
        targetLaunchTimeline: clean(data.targetLaunchTimeline),
        preferredOutputs: data.preferredOutputs,
        preferredPublishingMethod: clean(data.preferredPublishingMethod),
      },
    });
    if (aiIntakeSession || finalConversationTranscript.length || Object.keys(defaults.aiBusinessIntelligence).length || data.businessDescription || data.targetAudience || data.productsServices || data.primaryKeywords.length || data.secondaryKeywords.length) {
      const baseFields = new Set(["businessDescription", "industryNiche", "targetAudience", "productsServices", "primaryGoal", "businessLocation", "targetMarkets", "competitors", "seedKeywords", "brandVoice", "cms", "technologyStack"]);
      const intelligence = aiIntakeSession ? Object.fromEntries(Object.entries(acceptedAi).filter(([field]) => !baseFields.has(field))) : defaults.aiBusinessIntelligence;
      const conversationIntelligence = { ...intelligence, ...(data.primaryKeywords.length ? { primaryKeywords: data.primaryKeywords } : {}), ...(data.secondaryKeywords.length ? { secondaryKeywords: data.secondaryKeywords } : {}), ...(finalConversationTranscript.length ? { conversationalIntake: { sessionId: conversationSession?.id ?? null, messages: finalConversationTranscript, confirmedAt: new Date().toISOString() } } : {}) };
      await tx.businessProfile.create({ data: { projectId: project.id, businessSummary: clean(data.businessDescription) || (typeof acceptedAi.businessDescription === "string" ? acceptedAi.businessDescription : defaults.businessDescription || project.niche), targetAudience: clean(data.targetAudience) || (typeof acceptedAi.targetAudience === "string" ? acceptedAi.targetAudience : defaults.targetAudience || null), offerSummary: clean(data.productsServices) || (Array.isArray(acceptedAi.productsServices) ? acceptedAi.productsServices.map(String).join(", ") : typeof acceptedAi.productsServices === "string" ? acceptedAi.productsServices : defaults.mainProductsServices || null), tonePreference: clean(data.brandVoice)?.slice(0, 80) || (typeof acceptedAi.brandVoice === "string" ? acceptedAi.brandVoice.slice(0, 80) : defaults.brandVoice?.slice(0, 80) || null), strengths: Array.isArray(acceptedAi.websiteStrengths) ? acceptedAi.websiteStrengths as Prisma.InputJsonValue : [], constraints: Array.isArray(acceptedAi.websiteWeaknesses) ? acceptedAi.websiteWeaknesses as Prisma.InputJsonValue : [], intelligenceJson: conversationIntelligence as Prisma.InputJsonValue } });
      if (data.primaryKeywords.length) await tx.projectKeywordGroup.create({ data: { projectId: project.id, category: "primary", title: "Primary Keywords", explanation: "Starting keyword directions confirmed during conversational project intake.", expectedValue: "Provides an initial search direction before Keyword Intelligence validates demand, difficulty, intent, and competition.", goalSupport: `Supports ${effectivePrimaryGoal}.`, keywords: [...new Set(data.primaryKeywords.map((item) => item.trim()))], source: "project_intake" } });
      if (data.secondaryKeywords.length) await tx.projectKeywordGroup.create({ data: { projectId: project.id, category: "supporting_topics", title: "Secondary Keywords", explanation: "Supporting keyword directions confirmed during conversational project intake.", expectedValue: "Expands topical coverage before Keyword Intelligence validates and organizes the final direction.", goalSupport: `Supports ${effectivePrimaryGoal}.`, keywords: [...new Set(data.secondaryKeywords.map((item) => item.trim()))], source: "project_intake" } });
      if (aiIntakeSession) { await tx.workspaceAiIntakeSession.update({ where: { id: aiIntakeSession.id }, data: { appliedProjectId: project.id, status: "applied" } }); await recordWorkspaceActivity(tx, { context: workspace, action: "ai_intake.applied_to_project", entityType: "project", entityId: project.id, projectId: project.id, nextJson: { sessionId: aiIntakeSession.id, acceptedFields: Object.keys(acceptedAi), intelligenceFields: Object.keys(intelligence) } }); }
    }
    if (finalConversationTranscript.length) {
      const thread = await tx.projectAgentThread.create({ data: { workspaceId: workspace.workspace.id, userId: workspace.membership.userId, projectId: project.id, title: `${project.name} intake conversation`.slice(0, 180) } });
      await tx.projectAgentMessage.createMany({ data: finalConversationTranscript.map((message) => ({ threadId: thread.id, pageContext: "project-intake", role: message.role, content: message.text, metadata: { source: "conversational_project_intake", intakeSessionId: conversationSession?.id ?? null, requestNumber: message.requestNumber ?? null, usageEventId: message.usageEventId ?? null } })) });
      if (conversationSession) await tx.workspaceAiIntakeSession.update({ where: { id: conversationSession.id }, data: { appliedProjectId: project.id, status: "applied" } });
      await recordWorkspaceActivity(tx, { context: workspace, action: "ai_intake.conversation_saved", entityType: "project_agent_thread", entityId: thread.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { sessionId: conversationSession?.id ?? null, messageCount: finalConversationTranscript.length, aiRequestCount: finalConversationTranscript.filter((message) => message.role === "user").length, userId: workspace.membership.userId } });
    }

    if (agencyClient && data.updateClientDefaults) {
      const previousSettings = agencyClient.defaultSettings && typeof agencyClient.defaultSettings === "object" ? agencyClient.defaultSettings as Record<string, unknown> : {};
      const existingWebsites = Array.isArray(agencyClient.websites) ? agencyClient.websites.map(String) : [];
      await tx.agencyClient.update({ where: { id: agencyClient.id }, data: {
        websites: normalized ? [...new Set([normalized.rootUrl, ...existingWebsites])] : existingWebsites,
        businessLocations: effectiveBusinessLocation ? [effectiveBusinessLocation] : agencyClient.businessLocations,
        targetMarkets: effectiveTargetLocations,
        defaultSettings: { ...previousSettings, ...(effectiveBusinessLocationDetails ? { businessLocationDetails: effectiveBusinessLocationDetails } : {}), ...(clean(data.niche) ? { niche: clean(data.niche), industryNiche: clean(data.niche) } : {}), ...(clean(data.primaryGoal) ? { primaryBusinessGoal: clean(data.primaryGoal) } : {}), ...(clean(data.brandVoice) ? { brandVoice: clean(data.brandVoice) } : {}) },
      } });
      await recordWorkspaceActivity(tx, {
        context: workspace, action: "client.defaults_updated_from_project", entityType: "agency_client", entityId: agencyClient.id, agencyClientId: agencyClient.id, projectId: project.id,
        previousJson: { businessLocations: agencyClient.businessLocations, targetMarkets: agencyClient.targetMarkets, businessLocationDetails: previousSettings.businessLocationDetails ?? null } as Prisma.InputJsonValue,
        nextJson: { businessLocations: effectiveBusinessLocation ? [effectiveBusinessLocation] : agencyClient.businessLocations, targetMarkets: effectiveTargetLocations, businessLocationDetails: effectiveBusinessLocationDetails, projectId: project.id },
      });
    }
    const existingWorkspaceDefaults = locationDefaultsFromSettings(workspace.workspace.settingsJson);
    const shouldSaveWorkspaceDefaults = workspace.workspace.workspaceType !== "agency" && (data.updateWorkspaceDefaults || !existingWorkspaceDefaults.businessLocation || !existingWorkspaceDefaults.targetMarkets.length);
    if (shouldSaveWorkspaceDefaults && effectiveBusinessLocation) {
      const nextSettings = withLocationDefaults(workspace.workspace.settingsJson, {
        businessLocation: effectiveBusinessLocation,
        businessLocationDetails: effectiveBusinessLocationDetails,
        targetMarkets: effectiveTargetLocations,
      });
      await tx.workspace.update({ where: { id: workspace.workspace.id }, data: { settingsJson: nextSettings as Prisma.InputJsonValue } });
      await recordWorkspaceActivity(tx, {
        context: workspace, action: "workspace.location_defaults_updated", entityType: "workspace", entityId: workspace.workspace.id, projectId: project.id,
        previousJson: existingWorkspaceDefaults as unknown as Prisma.InputJsonValue,
        nextJson: locationDefaultsFromSettings(nextSettings) as unknown as Prisma.InputJsonValue,
      });
    }

    await createInitialPlan(tx, project);
    const assignCreator = !workspace.roles.has("owner") && !workspace.roles.has("admin");
    const assignmentIds = [...new Set([
      data.managerMembershipId,
      ...data.assignedMembershipIds,
      ...(assignCreator ? [workspace.membership.id] : []),
    ].filter((id): id is string => Boolean(id)))];
    if (assignmentIds.length) {
      const validMembers = await tx.workspaceMembership.findMany({ where: { id: { in: assignmentIds }, workspaceId: workspace.workspace.id, status: "active" }, select: { id: true, userId: true } });
      if (validMembers.length !== assignmentIds.length) throw Object.assign(new Error("Project assignees must be active workspace members."), { statusCode: 400 });
      await tx.projectMemberAssignment.createMany({ data: validMembers.map((member) => ({
        projectId: project.id,
        membershipId: member.id,
        assignmentRole: member.id === data.managerMembershipId || (member.id === workspace.membership.id && workspace.roles.has("manager")) ? "manager" : "contributor",
      })) });
      for (const member of validMembers) {
        if (member.userId === workspace.membership.userId) continue;
        await createWorkspaceNotification(tx, {
          context: workspace, userId: member.userId, type: "project_created", title: "Project assigned",
          body: `${project.name} was created and assigned to you.`, actionUrl: `/guided-projects/${project.id}`,
          agencyClientId: agencyClient?.id, projectId: project.id,
        });
      }
    }
    if (data.assignedTeamIds.length) {
      const validTeams = await tx.workspaceTeam.findMany({ where: { id: { in: [...new Set(data.assignedTeamIds)] }, workspaceId: workspace.workspace.id, isActive: true }, select: { id: true } });
      if (validTeams.length !== new Set(data.assignedTeamIds).size) throw Object.assign(new Error("Project teams must belong to the active workspace."), { statusCode: 400 });
      await tx.projectTeamAssignment.createMany({ data: validTeams.map((team) => ({ projectId: project.id, teamId: team.id })) });
    }
    await recordWorkspaceActivity(tx, {
      context: workspace, action: "project.created", entityType: "project", entityId: project.id,
      agencyClientId: agencyClient?.id, projectId: project.id,
      nextJson: { name: project.name, projectType: project.projectType, businessLocation: project.businessLocation, businessLocationDetails: project.businessLocationJson, targetMarkets: project.targetLocations, primaryGoal: project.primaryGoal, secondaryGoals: project.secondaryGoals, managerMembershipId: data.managerMembershipId },
    });
    await createWorkspaceNotification(tx, {
      context: workspace, userId: workspace.membership.userId, type: "project_created", title: "Project created",
      body: `${project.name} was created successfully.`, actionUrl: `/guided-projects/${project.id}`,
      agencyClientId: agencyClient?.id, projectId: project.id,
    });
    if (agencyClient) {
      const managers = await tx.workspaceMembership.findMany({
        where: { workspaceId: workspace.workspace.id, status: "active", userId: { not: workspace.membership.userId }, roles: { some: { role: { in: ["manager", "approver", "manager_approver"] } } } },
        select: { userId: true },
      });
      for (const manager of managers) await createWorkspaceNotification(tx, {
        context: workspace, userId: manager.userId, type: "agency_project_created", title: "Agency project created",
        body: `${project.name} was created for ${agencyClient.name}.`, actionUrl: `/guided-projects/${project.id}`,
        agencyClientId: agencyClient.id, projectId: project.id,
      });
    }
    return project;
  });

  res.status(201).json({ project: result });
});

guidedProjectsRouter.get("/projects-v2/:projectId", async (req, res) => {
  const accessible = await scopedProject(req, req.params.projectId);
  if (!accessible) return res.status(404).json({ error: "project not found" });
  await prisma.$transaction((tx) => syncProjectWorkflow(tx, accessible.id));
  const project = await scopedProject(req, accessible.id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const sourceActivitySummaries = await projectSourceActivitySummaries(project);
  res.json({ project: { ...project, sourceActivitySummaries } });
});

guidedProjectsRouter.patch("/projects-v2/:projectId/settings", async (req, res) => {
  await requireRequestPermission(req, "edit_project_settings");
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const project = await scopedProject(req, req.params.projectId);
  if (!project || project.status === "archived") return res.status(project ? 409 : 404).json({ error: project ? "Restore the project before editing it." : "project not found" });
  const data = parsed.data;
  const context = await workspaceContext(req);
  const conversationSession = data.aiConversationSessionId ? await prisma.workspaceAiIntakeSession.findFirst({ where: { id: data.aiConversationSessionId, workspaceId: context.workspace.id, userId: context.membership.userId, contextType: "project", mode: "conversation", status: { in: ["active", "applied"] }, appliedProjectId: project.id } }) : null;
  if (data.aiConversationSessionId && !conversationSession) return res.status(400).json({ error: "This saved AI conversation does not belong to this project." });
  if (context.workspace.workspaceType === "agency" && !data.agencyClientId) return res.status(400).json({ error: "Agency Workspace projects require a client." });
  const agencyClient = data.agencyClientId ? await prisma.agencyClient.findFirst({ where: { id: data.agencyClientId, workspaceId: context.workspace.id, status: "active" } }) : null;
  if (data.agencyClientId && (!agencyClient || !await canAccessAgencyClient(context, data.agencyClientId))) return res.status(404).json({ error: "agency client not found" });
  if (data.websiteStatus === "existing_website" && !data.websiteUrl?.trim()) return res.status(400).json({ error: "Website URL is required for Existing Website." });
  const targetMarkets = cleanGeographicTargetMarkets(data.targetLocations);
  if (!data.businessLocationDetails || !targetMarkets.length) return res.status(400).json({ error: "Business Location and at least one geographic Target Market are required." });
  const goals = normalizeProjectGoals(data.primaryGoal, data.secondaryGoals, context.workspace.workspaceType);
  const location = [data.businessLocationDetails.streetAddress, data.businessLocationDetails.city, data.businessLocationDetails.stateProvince, data.businessLocationDetails.postalCode, data.businessLocationDetails.country].filter(Boolean).join(", ");
  const normalized = normalizeUrl(data.websiteUrl);
  if (data.websiteStatus === "existing_website" && !normalized) return res.status(400).json({ error: "Existing Website requires a valid Website URL." });
  await prisma.$transaction(async (tx) => {
    let website = normalized ? await tx.website.findFirst({ where: { clientId: project.clientId, domain: normalized.domain, status: "active" } }) : null;
    if (!website && normalized && data.projectType !== "new_business") website = await tx.website.create({ data: { clientId: project.clientId, domain: normalized.domain, rootUrl: normalized.rootUrl, status: "active", targetCountry: targetMarkets[0], targetCities: targetMarkets } });
    else if (website) website = await tx.website.update({ where: { id: website.id }, data: { rootUrl: normalized?.rootUrl, targetCountry: targetMarkets[0], targetCities: targetMarkets } });
    await tx.project.update({ where: { id: project.id }, data: { status: "active", agencyClientId: agencyClient?.id ?? null, websiteId: website?.id ?? null, name: data.name.trim(), projectType: data.projectType, websiteStatus: data.websiteStatus, websiteUrl: normalized?.rootUrl ?? (data.websiteUrl?.trim() || null), businessName: agencyClient ? null : (data.businessName?.trim() || null), niche: data.niche?.trim() || null, businessLocation: location, businessLocationJson: data.businessLocationDetails, targetLocations: targetMarkets, targetLocation: targetMarkets.join(", ").slice(0, 180), primaryGoal: goals.primaryGoal, secondaryGoals: goals.secondaryGoals, competitors: data.competitors, notes: data.notes, brandVoice: data.brandVoice, analyticsPlatforms: data.analyticsPlatforms, cmsPlatform: data.cmsPlatform, targetLaunchTimeline: data.targetLaunchTimeline, preferredOutputs: data.preferredOutputs, preferredPublishingMethod: data.preferredPublishingMethod } });
    if (data.businessDescription || data.targetAudience || data.productsServices || conversationSession) {
      const previousIntelligence = project.businessProfile?.intelligenceJson && typeof project.businessProfile.intelligenceJson === "object" && !Array.isArray(project.businessProfile.intelligenceJson) ? project.businessProfile.intelligenceJson as Record<string, unknown> : {};
      const sessionInput = conversationSession?.inputJson && typeof conversationSession.inputJson === "object" && !Array.isArray(conversationSession.inputJson) ? conversationSession.inputJson as Record<string, unknown> : {};
      const conversationMessages = Array.isArray(sessionInput.messages) ? sessionInput.messages : data.conversationTranscript;
      const intelligenceJson = { ...previousIntelligence, primaryKeywords: data.primaryKeywords, secondaryKeywords: data.secondaryKeywords, conversationalIntake: { sessionId: conversationSession?.id ?? null, messages: conversationMessages, confirmedAt: new Date().toISOString() } };
      await tx.businessProfile.upsert({ where: { projectId: project.id }, create: { projectId: project.id, businessSummary: data.businessDescription?.trim() || project.niche, targetAudience: data.targetAudience?.trim() || null, offerSummary: data.productsServices?.trim() || null, tonePreference: data.brandVoice?.trim().slice(0, 80) || null, intelligenceJson: intelligenceJson as Prisma.InputJsonValue }, update: { businessSummary: data.businessDescription?.trim() || project.businessProfile?.businessSummary || project.niche, targetAudience: data.targetAudience?.trim() || project.businessProfile?.targetAudience || null, offerSummary: data.productsServices?.trim() || project.businessProfile?.offerSummary || null, tonePreference: data.brandVoice?.trim().slice(0, 80) || project.businessProfile?.tonePreference || null, intelligenceJson: intelligenceJson as Prisma.InputJsonValue } });
    }
    const primaryKeywords = normalizeIntakeKeywords(data.primaryKeywords, targetMarkets);
    const secondaryKeywords = normalizeIntakeKeywords(data.secondaryKeywords, targetMarkets);
    if (primaryKeywords.length) await tx.projectKeywordGroup.upsert({ where: { projectId_category: { projectId: project.id, category: "primary" } }, create: { projectId: project.id, category: "primary", title: "Primary Keywords", explanation: "Starting keyword directions confirmed during conversational project intake.", expectedValue: "Provides an initial search direction before Keyword Intelligence validates it.", goalSupport: `Supports ${goals.primaryGoal}.`, keywords: primaryKeywords, source: "project_intake" }, update: { keywords: primaryKeywords, goalSupport: `Supports ${goals.primaryGoal}.` } });
    if (secondaryKeywords.length) await tx.projectKeywordGroup.upsert({ where: { projectId_category: { projectId: project.id, category: "supporting_topics" } }, create: { projectId: project.id, category: "supporting_topics", title: "Secondary Keywords", explanation: "Supporting keyword directions confirmed during conversational project intake.", expectedValue: "Expands topical coverage before Keyword Intelligence validates it.", goalSupport: `Supports ${goals.primaryGoal}.`, keywords: secondaryKeywords, source: "project_intake" }, update: { keywords: secondaryKeywords, goalSupport: `Supports ${goals.primaryGoal}.` } });
    if (conversationSession) await tx.workspaceAiIntakeSession.update({ where: { id: conversationSession.id }, data: { status: "applied", appliedProjectId: project.id, completedAt: new Date() } });
    if (agencyClient && data.updateClientDefaults) {
      const previousSettings = agencyClient.defaultSettings && typeof agencyClient.defaultSettings === "object" ? agencyClient.defaultSettings as Record<string, unknown> : {};
      const existingWebsites = Array.isArray(agencyClient.websites) ? agencyClient.websites.map(String) : [];
      await tx.agencyClient.update({ where: { id: agencyClient.id }, data: {
        websites: normalized ? [...new Set([normalized.rootUrl, ...existingWebsites])] : existingWebsites,
        businessLocations: [location], targetMarkets,
        defaultSettings: { ...previousSettings, businessLocationDetails: data.businessLocationDetails, ...(data.niche?.trim() ? { niche: data.niche.trim(), industryNiche: data.niche.trim() } : {}), primaryBusinessGoal: goals.primaryGoal, ...(data.brandVoice?.trim() ? { brandVoice: data.brandVoice.trim() } : {}) },
      } });
    }
    if (context.workspace.workspaceType !== "agency" && data.updateWorkspaceDefaults) {
      const nextSettings = withLocationDefaults(context.workspace.settingsJson, { businessLocation: location, businessLocationDetails: data.businessLocationDetails, targetMarkets });
      await tx.workspace.update({ where: { id: context.workspace.id }, data: { settingsJson: nextSettings as Prisma.InputJsonValue } });
    }
    if (project.status === "intake_draft") await createInitialPlan(tx, { id: project.id, clientId: project.clientId, websiteId: website?.id ?? null });
    else await syncProjectWorkflow(tx, project.id);
    await recordWorkspaceActivity(tx, { context, action: "project.settings_updated", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { name: project.name, projectType: project.projectType, websiteStatus: project.websiteStatus, websiteUrl: project.websiteUrl, businessLocation: project.businessLocation, targetLocations: project.targetLocations, primaryGoal: project.primaryGoal, secondaryGoals: project.secondaryGoals }, nextJson: { name: data.name, projectType: data.projectType, websiteStatus: data.websiteStatus, websiteUrl: data.websiteUrl, businessLocation: location, targetLocations: targetMarkets, primaryGoal: goals.primaryGoal, secondaryGoals: goals.secondaryGoals } });
  });
  res.json({ project: await scopedProject(req, project.id) });
});

guidedProjectsRouter.patch("/projects-v2/:projectId/locations", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const parsed = projectLocationsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const context = await workspaceContext(req);
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const targetMarkets = cleanGeographicTargetMarkets(parsed.data.targetMarkets);
  if (!targetMarkets.length) return res.status(400).json({ error: "At least one Target Market is required." });
  const businessLocationDetails = parsed.data.businessLocationDetails as BusinessLocation;
  const businessLocation = formatBusinessLocation(businessLocationDetails);
  const strategyApproved = project.strategyPlans.some((strategy) => strategy.status === "approved");
  const projectChanged = project.businessLocation !== businessLocation || JSON.stringify(cleanGeographicTargetMarkets(Array.isArray(project.targetLocations) ? project.targetLocations.map(String) : [])) !== JSON.stringify(targetMarkets);
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.project.update({ where: { id: project.id }, data: {
      businessLocation, businessLocationJson: businessLocationDetails,
      targetLocations: targetMarkets, targetLocation: targetMarkets.join(", ").slice(0, 180),
    } });
    if (project.websiteId) await tx.website.update({ where: { id: project.websiteId }, data: { targetCountry: targetMarkets[0], targetCities: targetMarkets } });
    if (parsed.data.updateClient && project.agencyClientId) {
      const previousClient = await tx.agencyClient.findUnique({ where: { id: project.agencyClientId } });
      const previousSettings = previousClient?.defaultSettings && typeof previousClient.defaultSettings === "object" ? previousClient.defaultSettings as Record<string, unknown> : {};
      await tx.agencyClient.update({ where: { id: project.agencyClientId }, data: { businessLocations: [businessLocation], targetMarkets, defaultSettings: { ...previousSettings, businessLocationDetails } } });
      await recordWorkspaceActivity(tx, { context, action: "client.locations_updated", entityType: "agency_client", entityId: project.agencyClientId, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { businessLocations: previousClient?.businessLocations, targetMarkets: previousClient?.targetMarkets, businessLocationDetails: previousSettings.businessLocationDetails ?? null } as Prisma.InputJsonValue, nextJson: { businessLocations: [businessLocation], targetMarkets, businessLocationDetails } });
    }
    if (parsed.data.updateWorkspace && context.workspace.workspaceType !== "agency") {
      const previousDefaults = locationDefaultsFromSettings(context.workspace.settingsJson);
      const nextSettings = withLocationDefaults(context.workspace.settingsJson, { businessLocation, businessLocationDetails, targetMarkets });
      await tx.workspace.update({ where: { id: context.workspace.id }, data: { settingsJson: nextSettings as Prisma.InputJsonValue } });
      await recordWorkspaceActivity(tx, {
        context, action: "workspace.location_defaults_updated", entityType: "workspace", entityId: context.workspace.id, projectId: project.id,
        previousJson: previousDefaults as unknown as Prisma.InputJsonValue,
        nextJson: locationDefaultsFromSettings(nextSettings) as unknown as Prisma.InputJsonValue,
      });
    }
    if (projectChanged) await recordWorkspaceActivity(tx, {
      context, action: "project.locations_updated", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id,
      previousJson: { businessLocation: project.businessLocation, businessLocationDetails: project.businessLocationJson, targetMarkets: project.targetLocations },
      nextJson: { businessLocation, businessLocationDetails, targetMarkets, updateClient: parsed.data.updateClient, updateWorkspace: parsed.data.updateWorkspace },
    });
    if (projectChanged && strategyApproved) await createWorkspaceNotification(tx, {
      context, userId: context.workspace.ownerUserId, type: "project_location_changed", title: "Refresh project research",
      body: `${project.name}'s location or target markets changed after strategy approval. Refresh Strategy and Keyword Research.`,
      actionUrl: `/guided-projects/${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id,
    });
    return next;
  });
  res.json({ project: updated, refreshRecommended: projectChanged && strategyApproved });
});

guidedProjectsRouter.patch("/projects-v2/:projectId/target-markets", async (req, res) => {
  const context = await requireRequestPermission(req, "edit_project_settings");
  const parsed = projectTargetMarketsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });

  const targetMarkets = cleanGeographicTargetMarkets(parsed.data.targetMarkets);
  if (!targetMarkets.length) return res.status(400).json({ error: "At least one geographic Target Market is required." });

  const previousTargetMarkets = cleanGeographicTargetMarkets(
    Array.isArray(project.targetLocations) ? project.targetLocations.map(String) : [],
  );
  const changed = JSON.stringify(previousTargetMarkets) !== JSON.stringify(targetMarkets);
  const strategyApproved = project.strategyPlans.some((strategy) => strategy.status === "approved");
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.project.update({
      where: { id: project.id },
      data: {
        targetLocations: targetMarkets,
        targetLocation: targetMarkets.join(", ").slice(0, 180),
      },
    });
    if (project.websiteId) {
      await tx.website.update({
        where: { id: project.websiteId },
        data: { targetCities: targetMarkets },
      });
    }
    if (changed) {
      await recordWorkspaceActivity(tx, {
        context,
        action: "project.target_markets_updated",
        entityType: "project",
        entityId: project.id,
        agencyClientId: project.agencyClientId,
        projectId: project.id,
        previousJson: { targetMarkets: previousTargetMarkets },
        nextJson: { targetMarkets, source: "seo_content_plan" },
      });
    }
    if (changed && strategyApproved) {
      await createWorkspaceNotification(tx, {
        context,
        userId: context.workspace.ownerUserId,
        type: "project_target_markets_changed",
        title: "Project target markets updated",
        body: `${project.name}'s target markets were updated from the SEO Content Plan. Existing approved research remains historical; refresh it when you want those reports regenerated.`,
        actionUrl: `/guided-projects/${project.id}`,
        agencyClientId: project.agencyClientId,
        projectId: project.id,
      });
    }
    return next;
  });

  res.json({
    project: updated,
    targetMarkets,
    changed,
    refreshRecommended: changed && strategyApproved,
  });
});

guidedProjectsRouter.patch("/projects-v2/:projectId/goals", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const parsed = projectGoalsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const context = await workspaceContext(req);
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const goals = normalizeProjectGoals(parsed.data.primaryGoal, parsed.data.secondaryGoals, context.workspace.workspaceType);
  const previousSecondary = Array.isArray(project.secondaryGoals) ? project.secondaryGoals.map(String) : [];
  const primaryChanged = project.primaryGoal !== goals.primaryGoal;
  const previousSet = new Set(previousSecondary);
  const nextSet = new Set(goals.secondaryGoals);
  const secondaryAdded = goals.secondaryGoals.filter((goal) => !previousSet.has(goal));
  const secondaryRemoved = previousSecondary.filter((goal) => !nextSet.has(goal));
  const changed = primaryChanged || secondaryAdded.length > 0 || secondaryRemoved.length > 0;
  const strategyApproved = project.strategyPlans.some((strategy) => strategy.status === "approved");
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.project.update({ where: { id: project.id }, data: { primaryGoal: goals.primaryGoal, secondaryGoals: goals.secondaryGoals } });
    if (changed) await recordWorkspaceActivity(tx, {
      context, action: "project.goals_updated", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id,
      previousJson: { primaryGoal: project.primaryGoal, secondaryGoals: previousSecondary },
      nextJson: { primaryGoal: goals.primaryGoal, secondaryGoals: goals.secondaryGoals, secondaryAdded, secondaryRemoved, reason: parsed.data.reason ?? null },
    });
    if (primaryChanged && strategyApproved) await createWorkspaceNotification(tx, {
      context, userId: context.workspace.ownerUserId, type: "project_primary_goal_changed", title: "Refresh project plan",
      body: `${project.name}'s Primary Goal changed after strategy approval. Refresh Strategy, Keyword Research, and the Execution Plan.`,
      actionUrl: `/guided-projects/${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id,
    });
    return next;
  });
  res.json({ project: updated, strategyRegenerationRecommended: changed && strategyApproved, primaryGoalChanged: primaryChanged });
});

guidedProjectsRouter.post("/projects-v2/:projectId/reset-after-strategy", async (req, res) => {
  const context = await requireRequestPermission(req, "manage_projects");
  const parsed = resetAfterStrategySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Type RESET to confirm that post-Strategy work should be cleared." });
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (project.status === "archived") return res.status(409).json({ error: "Restore the project before restarting its workflow." });
  const approvedStrategy = project.strategyPlans.find((strategy) => strategy.status === "approved");
  if (!approvedStrategy) return res.status(409).json({ error: "Approve a Strategy before clearing downstream work." });

  const taskAssets = await prisma.executionTask.findMany({
    where: { projectId: project.id, relatedAssetId: { not: null } },
    select: { relatedAssetId: true },
  });
  const candidateGenerationIds = [...new Set(taskAssets.map((task) => task.relatedAssetId).filter((id): id is string => Boolean(id)))];
  const sharedAssets = candidateGenerationIds.length
    ? await prisma.executionTask.findMany({
        where: {
          OR: [{ projectId: { not: project.id } }, { projectId: null }],
          relatedAssetId: { in: candidateGenerationIds },
        },
        select: { relatedAssetId: true },
      })
    : [];
  const sharedAssetIds = new Set(sharedAssets.map((task) => task.relatedAssetId).filter((id): id is string => Boolean(id)));
  const generationIds = candidateGenerationIds.filter((id) => !sharedAssetIds.has(id));

  const cleared = await prisma.$transaction(async (tx) => {
    // Publications must be removed before their immutable releases. The
    // remaining website-model records cascade safely from WebsiteBuild.
    const publications = await tx.websitePublication.deleteMany({ where: { projectId: project.id } });
    await tx.websiteApprovedRelease.deleteMany({ where: { projectId: project.id } });
    const publishingJobs = await tx.wordPressPublishJob.deleteMany({ where: { projectId: project.id } });
    const websiteBuilds = await tx.websiteBuild.deleteMany({ where: { projectId: project.id } });
    const siteArchitectures = await tx.siteArchitectureVersion.deleteMany({ where: { projectId: project.id } });
    const leadMagnets = await tx.leadMagnetFunnel.deleteMany({ where: { projectId: project.id } });
    const localSeoTasks = await tx.gapLocalSeoTask.deleteMany({ where: { projectId: project.id } });
    await tx.nextBestAction.deleteMany({ where: { projectId: project.id } });
    const executionTasks = await tx.executionTask.deleteMany({ where: { projectId: project.id } });
    const executionPlans = await tx.executionPlan.deleteMany({ where: { projectId: project.id } });
    const contentAssets = generationIds.length
      ? await tx.aiContentGeneration.deleteMany({ where: { clientId: project.clientId, id: { in: generationIds } } })
      : { count: 0 };

    await tx.workspaceNotification.deleteMany({
      where: { projectId: project.id, createdAt: { gte: approvedStrategy.approvedAt ?? approvedStrategy.updatedAt } },
    });
    await tx.project.update({ where: { id: project.id }, data: { currentStep: "strategy" } });
    await syncProjectWorkflow(tx, project.id);
    await recordWorkspaceActivity(tx, {
      context,
      action: "project.reset_after_strategy",
      entityType: "project",
      entityId: project.id,
      agencyClientId: project.agencyClientId,
      projectId: project.id,
      previousJson: {
        currentStep: project.currentStep,
        executionTasks: executionTasks.count,
        executionPlans: executionPlans.count,
        siteArchitectures: siteArchitectures.count,
        websiteBuilds: websiteBuilds.count,
      },
      nextJson: {
        currentStep: "strategy",
        preservedStrategyId: approvedStrategy.id,
        preservedStrategyVersion: approvedStrategy.version,
      },
    });

    return {
      executionTasks: executionTasks.count,
      executionPlans: executionPlans.count,
      siteArchitectures: siteArchitectures.count,
      websiteBuilds: websiteBuilds.count,
      contentAssets: contentAssets.count,
      leadMagnets: leadMagnets.count,
      localSeoTasks: localSeoTasks.count,
      publishingRecords: publications.count + publishingJobs.count,
    };
  }, {
    // Resetting a mature project intentionally clears several dependent record
    // groups and rebuilds its workflow atomically. Prisma's five-second default
    // is too short for projects with published website versions and assets.
    maxWait: 10_000,
    timeout: 30_000,
  });

  res.json({ project: await scopedProject(req, project.id), cleared });
});

guidedProjectsRouter.delete("/projects-v2/:projectId", async (req, res) => {
  await requireRequestPermission(req, "manage_projects");
  const workspace = await workspaceContext(req);
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (project.status !== "archived") return res.status(409).json({ error: "Archive the project before permanently deleting it." });

  const result = await prisma.$transaction(async (tx) => {
    const websiteId = project.websiteId;
    let deletedWebsite = false;

    if (websiteId) {
      const otherProjectCount = await tx.project.count({
        where: { clientId: project.clientId, websiteId, id: { not: project.id } },
      });

      await recordWorkspaceActivity(tx, { context: workspace, action: "project.deleted", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { name: project.name, status: project.status } });
      await tx.project.delete({ where: { id: project.id } });

      if (otherProjectCount === 0) {
        await tx.website.deleteMany({ where: { id: websiteId, clientId: project.clientId } });
        deletedWebsite = true;
      }
    } else {
      await recordWorkspaceActivity(tx, { context: workspace, action: "project.deleted", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { name: project.name, status: project.status } });
      await tx.project.delete({ where: { id: project.id } });
    }

    return { deletedWebsite };
  });

  res.json({ deleted: true, deletedWebsite: result.deletedWebsite });
});

guidedProjectsRouter.post("/projects-v2/:projectId/archive", async (req, res) => {
  await requireRequestPermission(req, "manage_projects");
  const context = await workspaceContext(req);
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.project.update({ where: { id: project.id }, data: { status: "archived", archivedAt: new Date(), archivedById: context.membership.userId } });
    await recordWorkspaceActivity(tx, { context, action: "project.archived", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: project.status }, nextJson: { status: "archived" } });
    return next;
  });
  res.json({ project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/restore", async (req, res) => {
  await requireRequestPermission(req, "manage_projects");
  const context = await workspaceContext(req);
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.project.update({ where: { id: project.id }, data: { status: "active", archivedAt: null, archivedById: null } });
    await recordWorkspaceActivity(tx, { context, action: "project.restored", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: project.status }, nextJson: { status: "active" } });
    return next;
  });
  res.json({ project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/intake", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const parsed = saveIntakeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const context = await workspaceContext(req);

  const profileInput = normalizeBusinessProfile(project, parsed.data.answers);

  await prisma.$transaction(async (tx) => {
    for (const answer of parsed.data.answers) {
      await tx.projectIntakeAnswer.upsert({
        where: { projectId_questionKey: { projectId: project.id, questionKey: answer.questionKey } },
        update: {
          questionText: answer.questionText,
          answerValue: answer.answerValue as Prisma.InputJsonValue,
          answerType: answer.answerType,
          moduleContext: answer.moduleContext,
        },
        create: {
          projectId: project.id,
          questionKey: answer.questionKey,
          questionText: answer.questionText,
          answerValue: answer.answerValue as Prisma.InputJsonValue,
          answerType: answer.answerType,
          moduleContext: answer.moduleContext,
        },
      });
    }

    await tx.businessProfile.upsert({
      where: { projectId: project.id },
      update: profileInput,
      create: { projectId: project.id, ...profileInput },
    });

    await tx.project.update({
      where: { id: project.id },
      data: {
        name: answerText(parsed.data.answers, "project_name") ?? project.name,
        currentStep: "strategy",
        businessName: answerText(parsed.data.answers, "business_name") ?? project.businessName,
        businessLocation: answerText(parsed.data.answers, "business_location") ?? project.businessLocation,
        targetLocations: cleanLocations([], answerText(parsed.data.answers, "target_location") ?? project.targetLocation),
        targetLocation: (answerText(parsed.data.answers, "target_location") ?? project.targetLocation)?.slice(0, 180),
        primaryGoal: answerText(parsed.data.answers, "primary_goal") ?? project.primaryGoal,
        niche: answerText(parsed.data.answers, "industry_niche") ?? project.niche,
        targetLaunchTimeline: answerText(parsed.data.answers, "target_launch_timeline") ?? project.targetLaunchTimeline,
        preferredOutputs: answerText(parsed.data.answers, "preferred_output") ? cleanLocations([], answerText(parsed.data.answers, "preferred_output")) : project.preferredOutputs,
        preferredPublishingMethod: answerText(parsed.data.answers, "publishing_preference") ?? project.preferredPublishingMethod,
      },
    });

    await tx.executionTask.updateMany({
      where: { projectId: project.id, moduleName: "core_intake", status: { notIn: ["completed", "skipped"] } },
      data: { status: "completed", completedAt: new Date() },
    });

    await syncProjectWorkflow(tx, project.id);
    await recordWorkspaceActivity(tx, { context, action: "project.milestone.intake_completed", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { milestone: "intake", answerCount: parsed.data.answers.length } });
  });

  let updated = await scopedProject(req, project.id);
  if (updated?.businessProfile && !updated.opportunities.length) {
    await generateOpportunityRecommendations(updated, context);
    updated = await scopedProject(req, project.id);
  }
  res.json({ project: updated, opportunityMode: updated ? opportunityRunMode(updated).mode : null });
});

guidedProjectsRouter.post("/projects-v2/:projectId/opportunities/generate", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!project.businessProfile) return res.status(409).json({ error: "complete intake before generating opportunities" });
  const context = await workspaceContext(req);
  const created = await generateOpportunityRecommendations(project, context);

  const updated = await scopedProject(req, project.id);
  res.json({ opportunities: created, project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/opportunities/refine", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const parsed = opportunityRefineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const project = await scopedProject(req, req.params.projectId);
  if (!project?.businessProfile) return res.status(409).json({ error: "complete intake before refining opportunities" });
  const context = await workspaceContext(req);
  const opportunities = await generateOpportunityRecommendations(project, context, parsed.data.instructions);
  res.json({ opportunities, project: await scopedProject(req, project.id) });
});

guidedProjectsRouter.post("/projects-v2/:projectId/opportunities/:opportunityId/select", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const action = opportunityActionSchema.parse(req.body ?? {});
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });

  const opportunity = await prisma.opportunity.findFirst({
    where: { id: req.params.opportunityId, projectId: project.id },
  });
  if (!opportunity) return res.status(404).json({ error: "opportunity not found" });
  const previous = project.opportunities.find((item) => opportunityDecisionStatus(item.status)) ?? null;
  const strategyApproved = project.strategyPlans.some((strategy) => strategy.status === "approved");
  const changingApprovedDirection = strategyApproved && previous && previous.id !== opportunity.id;
  if (changingApprovedDirection && !action.confirmation) return res.status(409).json({ error: "Confirm changing the approved project direction before selecting this opportunity.", confirmationRequired: true });
  const nextStatus = opportunity.status === "confirmation_required" ? "confirmed" : "selected";
  const context = await workspaceContext(req);

  await prisma.$transaction(async (tx) => {
    await tx.opportunity.updateMany({
      where: { projectId: project.id, status: { in: ["selected", "confirmed"] }, id: { not: opportunity.id } },
      data: { status: "suggested" },
    });
    await tx.opportunity.update({
      where: { id: opportunity.id },
      data: { status: nextStatus },
    });
    await tx.aiRun.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        moduleName: "opportunity",
        promptVersion: "opportunity-select-v1",
        inputSnapshotJson: { projectId: project.id, opportunityId: opportunity.id },
        outputJson: { selectedOpportunityId: opportunity.id, name: opportunity.name, score: opportunity.opportunityScore, status: nextStatus },
        outputText: `${nextStatus === "confirmed" ? "Confirmed" : "Selected"} opportunity: ${opportunity.name}`,
        status: "completed",
      },
    });
    await recordWorkspaceActivity(tx, {
      context, action: previous && previous.id !== opportunity.id ? "opportunity.selection_changed" : nextStatus === "confirmed" ? "opportunity.direction_confirmed" : "opportunity.selected",
      entityType: "opportunity", entityId: opportunity.id, agencyClientId: project.agencyClientId, projectId: project.id,
      previousJson: previous ? { id: previous.id, name: previous.name, status: previous.status } : undefined,
      nextJson: { id: opportunity.id, name: opportunity.name, status: nextStatus, reason: action.reason ?? null },
    });
    if (changingApprovedDirection) await createWorkspaceNotification(tx, {
      context, userId: context.workspace.ownerUserId, type: "approved_opportunity_changed", title: "Approved project direction changed",
      body: `${project.name}'s selected opportunity changed after Strategy approval. Refresh Strategy, Keyword Research, and the Execution Plan.`, actionUrl: `/guided-projects/${project.id}`,
      agencyClientId: project.agencyClientId, projectId: project.id,
    });
    await syncProjectWorkflow(tx, project.id);
  });

  const updated = await scopedProject(req, project.id);
  res.json({ project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/opportunities/clear-selection", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const action = opportunityActionSchema.parse(req.body ?? {});
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const previous = project.opportunities.find((item) => opportunityDecisionStatus(item.status));
  const strategyApproved = project.strategyPlans.some((strategy) => strategy.status === "approved");
  if (previous && strategyApproved && !action.confirmation) return res.status(409).json({ error: "Confirm removing the approved project direction.", confirmationRequired: true });
  const context = await workspaceContext(req);

  await prisma.$transaction(async (tx) => {
    await tx.opportunity.updateMany({
      where: { projectId: project.id, status: { in: ["selected", "confirmed"] } },
      data: { status: "suggested" },
    });
    await tx.aiRun.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        moduleName: "opportunity",
        promptVersion: "opportunity-clear-selection-v1",
        inputSnapshotJson: { projectId: project.id },
        outputJson: { selectedOpportunityId: null },
        outputText: "Cleared selected opportunity.",
        status: "completed",
      },
    });
    if (previous) await recordWorkspaceActivity(tx, { context, action: "opportunity.selection_cleared", entityType: "opportunity", entityId: previous.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { id: previous.id, name: previous.name, status: previous.status }, nextJson: { status: "suggested", reason: action.reason ?? null } });
    if (previous && strategyApproved) await createWorkspaceNotification(tx, { context, userId: context.workspace.ownerUserId, type: "approved_opportunity_changed", title: "Approved project direction removed", body: `${project.name}'s selected opportunity was removed after Strategy approval. Select or confirm a direction and refresh downstream work.`, actionUrl: `/guided-projects/${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id });
    await syncProjectWorkflow(tx, project.id);
  });

  const updated = await scopedProject(req, project.id);
  res.json({ project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/opportunities/:opportunityId/save", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const opportunity = project.opportunities.find((item) => item.id === req.params.opportunityId);
  if (!opportunity) return res.status(404).json({ error: "opportunity not found" });
  if (opportunityDecisionStatus(opportunity.status)) return res.status(409).json({ error: "The active direction cannot be saved for later until another direction is selected." });
  const context = await workspaceContext(req);
  await prisma.$transaction(async (tx) => {
    await tx.opportunity.update({ where: { id: opportunity.id }, data: { status: "saved" } });
    await recordWorkspaceActivity(tx, { context, action: "opportunity.saved_for_later", entityType: "opportunity", entityId: opportunity.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: opportunity.status }, nextJson: { status: "saved" } });
  });
  res.json({ project: await scopedProject(req, project.id) });
});

guidedProjectsRouter.post("/projects-v2/:projectId/opportunities/skip", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const action = opportunityActionSchema.parse(req.body ?? {});
  if (!action.confirmation) return res.status(400).json({ error: "Confirm that the existing project direction should be used." });
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const context = await workspaceContext(req);
  await prisma.$transaction(async (tx) => {
    await tx.opportunity.updateMany({ where: { projectId: project.id, status: { in: ["selected", "confirmed"] } }, data: { status: "suggested" } });
    const confirmation = await tx.opportunity.create({ data: {
      projectId: project.id, name: `${project.name} existing project direction`, targetAudience: project.businessProfile?.targetAudience,
      problemSolved: "Confirms the existing project direction from intake without forcing a new recommendation.", recommendedOffer: project.businessProfile?.offerSummary,
      businessModel: project.projectType, opportunityScore: 75, executionScore: 80, userFitScore: 90,
      summary: `Existing direction confirmed from the project intake, goals, audience, offer, markets, competitors, and website status.${action.reason ? ` Reason: ${action.reason}` : ""}`, status: "confirmed",
    } });
    await recordWorkspaceActivity(tx, { context, action: "opportunity.finder_skipped_direction_confirmed", entityType: "opportunity", entityId: confirmation.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { id: confirmation.id, status: "confirmed", reason: action.reason ?? null } });
    await syncProjectWorkflow(tx, project.id);
  });
  res.json({ project: await scopedProject(req, project.id) });
});

guidedProjectsRouter.post("/projects-v2/:projectId/keyword-groups/generate", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const parsed = keywordGenerateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const context = await workspaceContext(req);
  const groups = await generateProjectKeywordGroups(project, context, parsed.data.manualSeed, parsed.data.regenerate, parsed.data.append, parsed.data.expansionInstruction);
  res.json({ groups, project: await scopedProject(req, project.id) });
});

guidedProjectsRouter.post("/projects-v2/:projectId/keyword-groups/preview", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const parsed = keywordExpansionPreviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const topic = parsed.data.topic || keywordTopicFromInstruction(parsed.data.instruction);
  const previewGeographies = parsed.data.geographies?.length ? parsed.data.geographies : parsed.data.geography ? [parsed.data.geography] : [];
  const previewProject = previewGeographies.length
    ? { ...project, targetLocations: previewGeographies, businessLocation: null }
    : project;
  const locations = Array.isArray(previewProject.targetLocations) ? previewProject.targetLocations.map(String) : [];
  const referenceGroups = parsed.data.groupIds?.length ? project.keywordGroups.filter((group) => parsed.data.groupIds?.includes(group.id)) : project.keywordGroups.filter((group) => ["approved", "suggested"].includes(group.status));
  const existingKeywords = project.keywordGroups.flatMap((group) => normalizeKeywordList(group.keywords));
  let usageEventId: string | null = null;
  try {
    const client = await prisma.client.findUnique({ where: { id: project.clientId }, select: { plan: true } });
    const routedModel = await modelForFeature("keyword_suggestions", client?.plan, config.openaiModel);
    const usage = await preflightUsage({ clientId: project.clientId, userId: req.user?.userId, projectId: project.id, websiteId: project.websiteId, featureKey: "keyword_suggestions", actionKey: "Suggest more project keywords", idempotencyKey: `keyword-preview:${project.id}:${Date.now()}`, metadata: { source: "project_keyword_preview" } });
    usageEventId = usage.usageEventId;
    const generated = await openaiJson([
      "Analyze the project semantically and suggest complete customer search phrases. Return JSON: {groups:[{category,title,keywords:[string]}]}.",
      "Allowed categories: primary, buyer_intent, local, informational, supporting, questions, long_tail.",
      "First identify the real distinct products/services from the client's natural-language intake. Correct obvious grammar and speech-to-text errors only when context makes the intended term clear.",
      "Never treat comma fragments, cities alone, conjunctions, or words such as 'others' as keywords. Never mechanically append company, services, pricing, buy, hire, or expert to an incomplete phrase.",
      "Local keywords must combine one real service with one selected market. Suggest only phrases relevant to this project, not another website or industry.",
      `Project: ${project.name}`,
      `Business: ${project.businessName ?? project.agencyClient?.name ?? "not provided"}`,
      `Industry/niche: ${project.niche ?? "not provided"}`,
      `Business summary: ${project.businessProfile?.businessSummary ?? "not provided"}`,
      `Products/services from intake: ${project.businessProfile?.offerSummary ?? "not provided"}`,
      `Audience: ${project.businessProfile?.targetAudience ?? "not provided"}`,
      `Selected opportunity: ${project.opportunities.find((item) => ["selected", "confirmed"].includes(item.status))?.recommendedOffer ?? "not selected"}`,
      `Target markets: ${locations.join(", ") || "not provided"}`,
      `Primary and secondary keyword groups selected by the user: ${referenceGroups.map((group) => `${group.title}: ${normalizeKeywordList(group.keywords).filter((keyword) => validSemanticKeyword(keyword, locations)).join(" | ")}`).join(" || ") || "none selected"}`,
      "Treat the selected keyword groups as the primary source of truth. Expand their valid service concepts and intent; use intake and offer text only to clarify meaning or identify a clearly supported missing service.",
      `User direction: ${parsed.data.instruction}`,
      `Topic hint: ${topic ?? "derive semantically from the project"}`,
      `Do not repeat: ${existingKeywords.join(", ") || "none"}`,
    ].join("\n"), routedModel);
    const groups = semanticPreviewGroups(generated.result, locations).filter((group) => !parsed.data.supportingOnly || group.category !== "primary");
    await commitUsage({ usageEventId, provider: "openai", model: generated.model, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens });
    res.json({ instruction: parsed.data.instruction, groups });
  } catch (error) {
    if (usageEventId) await refundUsage({ usageEventId, reason: error instanceof Error ? error.message : "keyword preview failed" }).catch(() => undefined);
    const groups = buildKeywordGroups(previewProject, topic).map((group) => ({ category: group.category, title: group.title, keywords: group.keywords.filter((keyword) => validSemanticKeyword(keyword, locations)) })).filter((group) => group.keywords.length && (!parsed.data.supportingOnly || group.category !== "primary"));
    res.json({ instruction: parsed.data.instruction, groups, fallback: true });
  }
});

guidedProjectsRouter.post("/projects-v2/:projectId/keyword-groups/:groupId/approve", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const project = await scopedProject(req, req.params.projectId);
  const group = project?.keywordGroups.find((item) => item.id === req.params.groupId);
  if (!project || !group) return res.status(404).json({ error: "keyword group not found" });
  const context = await workspaceContext(req);
  await prisma.$transaction(async (tx) => {
    await tx.projectKeywordGroup.update({ where: { id: group.id }, data: { status: "approved", approvedAt: new Date(), approvedById: context.membership.userId } });
    await recordWorkspaceActivity(tx, { context, action: "keyword.group_approved", entityType: "project_keyword_group", entityId: group.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: group.status }, nextJson: { status: "approved", keywords: group.keywords } });
    await syncProjectWorkflow(tx, project.id);
  });
  res.json({ project: await scopedProject(req, project.id) });
});

guidedProjectsRouter.patch("/projects-v2/:projectId/keyword-groups/:groupId", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const parsed = keywordGroupUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const project = await scopedProject(req, req.params.projectId);
  const group = project?.keywordGroups.find((item) => item.id === req.params.groupId);
  if (!project || !group) return res.status(404).json({ error: "keyword group not found" });
  const before = normalizeKeywordList(group.keywords);
  const after = normalizeKeywordList(parsed.data.keywords);
  const added = after.filter((keyword) => !before.some((item) => item.toLowerCase() === keyword.toLowerCase()));
  const removed = before.filter((keyword) => !after.some((item) => item.toLowerCase() === keyword.toLowerCase()));
  const strategyApproved = project.strategyPlans.some((strategy) => strategy.status === "approved");
  const context = await workspaceContext(req);
  await prisma.$transaction(async (tx) => {
    await tx.projectKeywordGroup.update({ where: { id: group.id }, data: { keywords: after } });
    await recordWorkspaceActivity(tx, { context, action: removed.length ? "keyword.keywords_deleted_or_edited" : "keyword.keywords_added_or_edited", entityType: "project_keyword_group", entityId: group.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { keywords: before }, nextJson: { keywords: after, added, removed, reason: parsed.data.reason ?? null } });
    if (group.status === "approved" && strategyApproved && (added.length || removed.length)) await createWorkspaceNotification(tx, { context, userId: context.workspace.ownerUserId, type: "approved_keywords_changed", title: "Approved keywords changed", body: `${project.name}'s approved ${group.title} were edited after Strategy approval. Regenerate Strategy and the Execution Plan.`, actionUrl: "/keywords", agencyClientId: project.agencyClientId, projectId: project.id });
  });
  res.json({ project: await scopedProject(req, project.id) });
});

guidedProjectsRouter.post("/projects-v2/:projectId/keyword-groups/manual", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const parsed = keywordManualSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const existing = (parsed.data.groupId ? project.keywordGroups.find((group) => group.id === parsed.data.groupId) : undefined)
    ?? project.keywordGroups.find((group) => group.category === parsed.data.category)
    ?? project.keywordGroups.find((group) => group.category === "supporting");
  if (!existing) return res.status(409).json({ error: "Generate recommendations before adding manual keywords." });
  // Clean legacy conversational fragments before appending, while preserving
  // the user's newly submitted manual keywords exactly as selected.
  const originalBefore = normalizeKeywordList(existing.keywords);
  const before = existing.source === "project_intake" ? normalizeIntakeKeywords(originalBefore, project.targetLocations) : originalBefore;
  const keywords = normalizeKeywordList([...before, ...parsed.data.keywords]);
  const context = await workspaceContext(req);
  await prisma.$transaction(async (tx) => {
    await tx.projectKeywordGroup.update({ where: { id: existing.id }, data: { keywords, source: "manual" } });
    await recordWorkspaceActivity(tx, { context, action: "keyword.manual_keywords_added", entityType: "project_keyword_group", entityId: existing.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { keywords: originalBefore }, nextJson: { keywords, added: parsed.data.keywords, cleanedLegacyFragments: originalBefore.filter((keyword) => !before.includes(keyword)) } });
    if (existing.status === "approved" && project.strategyPlans.some((strategy) => strategy.status === "approved")) await createWorkspaceNotification(tx, { context, userId: context.workspace.ownerUserId, type: "approved_keywords_changed", title: "Approved keywords changed", body: `${project.name}'s approved keywords received manual additions after Strategy approval. Regenerate Strategy and the Execution Plan.`, actionUrl: "/keywords", agencyClientId: project.agencyClientId, projectId: project.id });
  });
  res.json({ project: await scopedProject(req, project.id) });
});

async function extendedStrategyAnalysisForProject(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>) {
  const ctx = projectContext(project);
  const competitorNames = Array.isArray(project.competitors) ? project.competitors.map((item) => typeof item === "string" ? item : item && typeof item === "object" && "name" in item ? String((item as { name: unknown }).name) : "").map((item) => item.trim()).filter(Boolean).slice(0, 10) : [];
  const approvedKeywordGroups = project.keywordGroups.filter((group) => group.status === "approved");
  const latestCrawlEvidence = project.websiteId ? await prisma.crawlJob.findFirst({
    where: { websiteId: project.websiteId, status: "completed" }, orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    select: {
      pages: { select: { url: true, wordCount: true, inlinkCount: true, brokenInternalLinkCount: true, weakAnchorCount: true, isOrphan: true, statusCode: true, seo: { select: { title: true, robotsMeta: true } } } },
      issues: { select: { category: true, severity: true, message: true } },
    },
  }) : null;
  return buildExtendedStrategyAnalysis({
    existingWebsite: isExistingWebsiteCampaign(project), businessName: project.businessName || ctx.name, niche: ctx.niche,
    goals: [ctx.goal, ...ctx.secondaryGoals], markets: Array.isArray(project.targetLocations) ? project.targetLocations.map(String) : [], competitors: competitorNames,
    keywordGroups: approvedKeywordGroups.map((group) => ({ title: group.title, category: group.category, keywords: normalizeKeywordList(group.keywords), gaps: normalizeKeywordList(group.gapKeywords) })),
    pages: (latestCrawlEvidence?.pages ?? []).map((page) => ({ url: page.url, title: page.seo?.title, wordCount: page.wordCount, inlinks: page.inlinkCount, brokenLinks: page.brokenInternalLinkCount, weakAnchors: page.weakAnchorCount, orphan: page.isOrphan, indexable: (page.statusCode ?? 500) < 400 && !/noindex/i.test(page.seo?.robotsMeta ?? "") })),
    issues: latestCrawlEvidence?.issues ?? [],
  });
}

guidedProjectsRouter.post("/projects-v2/:projectId/strategy/generate", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!project.businessProfile) return res.status(409).json({ error: "complete intake before generating strategy" });

  const ctx = projectContext(project);
  const selectedOpportunity = project.opportunities.find((opportunity) => opportunityDecisionStatus(opportunity.status)) ?? null;
  if (!selectedOpportunity) return res.status(409).json({ error: "Select an opportunity or confirm the existing project direction before generating Strategy." });
  const approvedKeywordGroups = project.keywordGroups.filter((group) => group.status === "approved");
  if (!approvedKeywordGroups.length) return res.status(409).json({ error: "Approve at least one keyword group before generating Strategy." });
  if (isExistingWebsiteCampaign(project)) {
    if (!project.websiteId) return res.status(409).json({ error: "Connect the existing website before generating Strategy." });
    const completedCrawl = await prisma.crawlJob.findFirst({ where: { websiteId: project.websiteId, status: "completed", pagesCrawled: { gt: 0 } }, select: { id: true } });
    if (!completedCrawl) return res.status(409).json({ error: "Complete Site Analysis before generating Strategy for an existing website." });
  }
  const context = await workspaceContext(req);
  const generateInput = z.object({ revisionComment: z.string().trim().max(2000).optional() }).safeParse(req.body ?? {});
  if (!generateInput.success) return res.status(400).json({ error: generateInput.error.flatten() });
  const latestVersion = project.strategyPlans.reduce((max, item) => Math.max(max, (item as { version?: number }).version ?? 0), 0);
  const revision = generateInput.data.revisionComment?.trim() ?? "";
  const revisionLines = revision.split(/\n+/).map((item) => item.trim()).filter(Boolean).slice(0, 8);
  const competitorNames = Array.isArray(project.competitors) ? project.competitors.map((item) => typeof item === "string" ? item : item && typeof item === "object" && "name" in item ? String((item as { name: unknown }).name) : "").map((item) => item.trim()).filter(Boolean).slice(0, 10) : [];
  const revisionFocus = revisionLines.length ? ` Revision focus: ${revisionLines.join(" ")}` : "";
  const revisesSeo = /seo|keyword|search|page target|site analysis|technical|market/i.test(revision);
  const revisesContent = /content|topic|funnel|cta|conversion/i.test(revision);
  const revisesLocal = /local|location|target market|business location/i.test(revision);
  const revisesKpis = /kpi|measure|metric|outcome|goal/i.test(revision);
  const previousStrategy = project.strategyPlans[0] as (typeof project.strategyPlans)[number] & { scoreBreakdown?: unknown } | undefined;
  const previousScores = previousStrategy?.scoreBreakdown && typeof previousStrategy.scoreBreakdown === "object" ? previousStrategy.scoreBreakdown as Record<string, unknown> : {};
  const scoreValue = (key: string, fallback: number) => typeof previousScores[key] === "number" ? Number(previousScores[key]) : fallback;
  const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
  const profileDemandFit = clampScore(scoreValue("profileDemandFit", selectedOpportunity?.userFitScore ?? 70) + (revisesKpis ? 3 : 0) + (revisionLines.length ? 1 : 0));
  const seoPotential = clampScore(scoreValue("seoPotential", selectedOpportunity?.seoScore ?? 70) + (revisesSeo ? 5 : 0) + (revisesLocal ? 2 : 0));
  const revenuePotential = clampScore(scoreValue("revenuePotential", selectedOpportunity?.monetizationScore ?? 70) + (revisesContent ? 3 : 0) + (revisesKpis ? 2 : 0));
  const executionComplexity = clampScore(scoreValue("executionComplexity", selectedOpportunity?.executionScore ?? 50) - (revisionLines.length ? Math.min(5, revisionLines.length) : 0));
  const confidence = clampScore(scoreValue("confidence", selectedOpportunity?.opportunityScore ?? 70) + Math.min(6, revisionLines.length));
  const strategyScore = clampScore(profileDemandFit * 0.2 + seoPotential * 0.25 + revenuePotential * 0.2 + (100 - executionComplexity) * 0.15 + confidence * 0.2);
  const scoreBreakdown = { profileDemandFit, seoPotential, revenuePotential, executionComplexity, confidence };
  const advanced = await extendedStrategyAnalysisForProject(project);
  const approvedGapRecommendations = await prisma.gapRecommendation.findMany({ where: { projectId: project.id, status: "approved" }, orderBy: [{ impactScore: "desc" }, { confidenceScore: "desc" }], take: 20 });
  const gapStrategyRecommendations = approvedGapRecommendations.map((item) => ({ gapRecommendationId: item.id, analysisKey: `gap_${item.category}`, key: `gap_${item.category}`, title: item.title, applicable: true, priority: item.priority, impact: item.impactScore, confidence: item.confidenceScore, why: item.explanation, evidence: item.evidenceJson, actions: [item.recommendedAction], expectedImpact: item.expectedImpact }));
  const personalNoApproval = context.workspace.workspaceType === "personal";

  const strategy = await prisma.$transaction(async (tx) => {
    const row = await tx.strategyPlan.create({
      data: {
        projectId: project.id,
        version: latestVersion + 1,
        opportunityId: selectedOpportunity?.id ?? null,
        strategySummary: `Build ${ctx.name} around ${ctx.goal.toLowerCase()}${ctx.secondaryGoals.length ? ` while supporting ${ctx.secondaryGoals.join(", ").toLowerCase()}` : ""}. Prioritize the approved keyword groups: ${approvedKeywordGroups.map((group) => `${group.title} (${normalizeKeywordList(group.keywords).slice(0, 5).join(", ")})`).join("; ")}.${approvedGapRecommendations.length ? ` Include ${approvedGapRecommendations.length} approved Gap Analysis action${approvedGapRecommendations.length === 1 ? "" : "s"}, led by ${approvedGapRecommendations.slice(0, 3).map((item) => item.title).join(", ")}.` : ""} Move from keyword demand to pages, optimization tasks, and approved publishing/export.${revisionFocus}`,
        businessObjectives: [ctx.goal, ...ctx.secondaryGoals],
        positioningStatement: `${ctx.name} should be positioned for ${ctx.audience} with clear proof, direct CTAs, and answer-first content.`,
        audienceProfile: ctx.audience,
        offerRecommendation: ctx.offer,
        businessModel: selectedOpportunity?.businessModel ?? (project.projectType === "ecommerce" ? "Ecommerce" : project.projectType === "local_seo" ? "Local service lead generation" : "Lead generation"),
        seoStrategy: `Prioritize keyword clusters for ${ctx.niche} against these success goals: ${ctx.goalSummary}. Map each approved keyword to a page, and create execution tasks for metadata, internal links, FAQs, and schema.${revisesSeo ? revisionFocus : ""}`,
        localSeoStrategy: project.projectType === "local_seo" || project.businessLocation || (Array.isArray(project.targetLocations) && project.targetLocations.length) ? `Use ${project.businessLocation ?? ctx.location} as the business identity and create market-specific pages and local visibility work for ${Array.isArray(project.targetLocations) ? project.targetLocations.map(String).join(", ") : ctx.location}.${revisesLocal ? revisionFocus : ""}` : null,
        aiCitationStrategy: "Add entity summaries, answer-first sections, source clarity blocks, FAQs, and schema suggestions to improve AI citation readiness.",
        contentStrategy: `Generate the selected outputs: ${ctx.outputs.join(", ") || "SEO plan and supporting pages"}. Keep review approval before publishing.${revisesContent ? revisionFocus : ""}`,
        competitorStrategy: competitorNames.length ? `Benchmark content coverage, positioning, page formats, proof, calls to action, and authority signals against ${competitorNames.join(", ")}. Use gaps to prioritize differentiated pages and supporting content; do not copy competitor messaging.` : "Competitor benchmarking is pending because no primary competitors are saved. Add competitors to the project intake to produce evidence-based content-gap priorities.",
        competitiveInsights: competitorNames.map((name) => ({ competitor: name, review: ["Keyword and topic coverage", "Page and content formats", "Positioning and proof", "Calls to action", "Authority signals"], response: "Find defensible gaps and create a clearer, more useful alternative." })),
        authorityStrategy: "Use safe authority tasks only: citations, partnerships, resource pages, reviews, digital PR, and outreach drafts requiring approval.",
        socialStrategy: "Create platform-specific social drafts from approved strategy, lead magnet, and page content. Require approval before scheduling.",
        publishingStrategy: `Use ${project.preferredPublishingMethod ?? "HTML ZIP"} first, then add direct publishing integrations after approval and provider setup.`,
        growthRecommendations: [`Prioritize ${ctx.goal.toLowerCase()} by expected business impact.`, "Measure approved keyword visibility and conversion actions.", "Refresh recommendations when goals, keywords, site findings, or approved AI Business Intelligence materially change.", ...(Array.isArray(ctx.businessIntelligence.topOpportunities) ? ctx.businessIntelligence.topOpportunities.map(String).slice(0, 5) : []), ...(Array.isArray(ctx.businessIntelligence.thirtyDayPlan) ? ctx.businessIntelligence.thirtyDayPlan.map(String).slice(0, 5) : []), ...revisionLines],
        kpis: [ctx.goal, "Approved keyword visibility", "Organic traffic", "Qualified conversions", "Execution task completion", ...(revisesKpis ? ["Revision-specific goal and outcome tracking"] : [])],
        revisionComment: generateInput.data.revisionComment ?? null,
        strategyScore,
        scoreBreakdown,
        advancedAnalysis: advanced.analyses,
        prioritizedRecommendations: [...gapStrategyRecommendations, ...advanced.recommendations],
        status: personalNoApproval ? "approved" : "draft",
        approvedAt: personalNoApproval ? new Date() : null,
      },
    });

    await tx.aiRun.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        moduleName: "strategy",
        promptVersion: "mock-strategy-v1",
        inputSnapshotJson: { projectId: project.id, context: ctx, opportunityId: selectedOpportunity?.id ?? null, advancedAnalysisKeys: advanced.analyses.filter((item) => item.applicable).map((item) => item.key), approvedGapRecommendationIds: approvedGapRecommendations.map((item) => item.id) },
        outputJson: { id: row.id, status: row.status, recommendationCount: advanced.recommendations.length + gapStrategyRecommendations.length },
        outputText: row.strategySummary,
        status: "completed",
      },
    });

    await tx.executionTask.updateMany({
      where: { projectId: project.id, moduleName: "strategy", status: { notIn: ["completed", "skipped"] } },
      data: { status: "completed", completedAt: new Date() },
    });

    await tx.executionTask.updateMany({
      where: { projectId: project.id, moduleName: "strategy_approval", status: { notIn: ["completed", "skipped"] } },
      data: { status: "completed", completedAt: new Date() },
    });

    if (personalNoApproval) {
      await tx.strategyPlan.updateMany({ where: { projectId: project.id, id: { not: row.id }, status: "approved" }, data: { status: "superseded" } });
      await tx.project.update({ where: { id: project.id }, data: { currentStep: "execution" } });
      const planId = await activePlanId(tx, project.id);
      for (const input of buildCampaignExecutionTasks(project)) await ensureNextTask(tx, {
        clientId: project.clientId, websiteId: project.websiteId, projectId: project.id, executionPlanId: planId,
        key: `project:${project.id}:execution:${input.key}`, moduleName: input.moduleName, title: input.title, description: input.description,
        actionButtonLabel: input.actionButtonLabel, relatedUrl: input.relatedUrl, priority: input.priority, automationLevel: input.automationLevel,
        requiresApproval: false, requiresIntegration: input.requiresIntegration,
      });
      await syncStrategyIntelligenceTasks(tx, project, planId, row, context);
    }

    await syncProjectWorkflow(tx, project.id);
    await recordWorkspaceActivity(tx, { context, action: personalNoApproval ? "strategy.generated_and_activated" : latestVersion ? "strategy.regenerated" : "strategy.generated", entityType: "strategy_plan", entityId: row.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { version: latestVersion + 1, status: personalNoApproval ? "approved" : "draft", revisionComment: generateInput.data.revisionComment ?? null, applicableAnalyses: advanced.analyses.filter((item) => item.applicable).map((item) => item.key), recommendationCount: advanced.recommendations.length } });
    const approvers = await tx.projectMemberAssignment.findMany({
      where: { projectId: project.id, membership: { status: "active", roles: { some: { role: { in: ["manager", "approver", "manager_approver"] } } } } },
      select: { membership: { select: { userId: true } } },
    });
    for (const userId of personalNoApproval ? [] : [...new Set([context.workspace.ownerUserId, ...approvers.map((item) => item.membership.userId)])]) {
      await createWorkspaceNotification(tx, { context, userId, type: "strategy_approval_requested", title: "Strategy ready for review", body: `${project.name} Strategy v${latestVersion + 1} is ready to review and approve.`, actionUrl: `/strategy?projectId=${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id });
    }

    return row;
  });

  const updated = await scopedProject(req, project.id);
  res.json({ strategy, project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/strategy/analyze", async (req, res) => {
  const context = await requireRequestPermission(req, "run_ai_analysis");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const strategy = project.strategyPlans[0];
  if (!strategy) return res.status(409).json({ error: "Generate a Strategy before running optimization analysis." });
  const advanced = await extendedStrategyAnalysisForProject(project);
  await prisma.$transaction(async (tx) => {
    await tx.strategyPlan.update({ where: { id: strategy.id }, data: { advancedAnalysis: advanced.analyses, prioritizedRecommendations: advanced.recommendations } });
    await tx.aiRun.create({ data: { projectId: project.id, clientId: project.clientId, moduleName: "strategy_intelligence", promptVersion: "dev014-v1", inputSnapshotJson: { strategyId: strategy.id, version: strategy.version }, outputJson: { applicableAnalyses: advanced.analyses.filter((item) => item.applicable).map((item) => item.key), recommendationCount: advanced.recommendations.length }, outputText: `Analyzed the current Strategy using ${advanced.analyses.filter((item) => item.applicable).length} applicable optimization areas.`, status: "completed" } });
    if (strategy.status === "approved") {
      const planId = await activePlanId(tx, project.id);
      await syncStrategyIntelligenceTasks(tx, project, planId, { ...strategy, prioritizedRecommendations: advanced.recommendations }, context);
    }
    await recordWorkspaceActivity(tx, { context, action: "strategy.optimization_analysis_completed", entityType: "strategy_plan", entityId: strategy.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { analysisCount: Array.isArray(strategy.advancedAnalysis) ? strategy.advancedAnalysis.length : 0 }, nextJson: { version: strategy.version, status: strategy.status, applicableAnalyses: advanced.analyses.filter((item) => item.applicable).map((item) => item.key), recommendationCount: advanced.recommendations.length } });
  });
  res.json({ strategyId: strategy.id, project: await scopedProject(req, project.id) });
});

guidedProjectsRouter.post("/projects-v2/:projectId/strategy/approve", async (req, res) => {
  await requireRequestPermission(req, "approve");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });

  const latestStrategy = project.strategyPlans[0];
  if (!latestStrategy) return res.status(409).json({ error: "generate strategy before approving" });

  const context = await workspaceContext(req);
  await prisma.$transaction(async (tx) => {
    await tx.strategyPlan.updateMany({
      where: { projectId: project.id, status: "approved" },
      data: { status: "superseded" },
    });
    await tx.strategyPlan.update({
      where: { id: latestStrategy.id },
      data: { status: "approved", approvedAt: new Date() },
    });
    await tx.project.update({
      where: { id: project.id },
      data: { currentStep: "execution" },
    });
    await tx.executionTask.updateMany({
      where: { projectId: project.id, moduleName: "strategy_approval", status: { notIn: ["completed", "skipped"] } },
      data: { status: "completed", completedAt: new Date() },
    });
    const planId = await activePlanId(tx, project.id);
    for (const input of buildCampaignExecutionTasks(project)) {
      const task = await ensureNextTask(tx, {
        clientId: project.clientId,
        websiteId: project.websiteId,
        projectId: project.id,
        executionPlanId: planId,
        key: `project:${project.id}:execution:${input.key}`,
        moduleName: input.moduleName,
        title: input.title,
        description: input.description,
        actionButtonLabel: input.actionButtonLabel,
        relatedUrl: input.relatedUrl,
        priority: input.priority,
        automationLevel: input.automationLevel,
        requiresApproval: input.requiresApproval,
        requiresIntegration: input.requiresIntegration,
      });
      await recordWorkspaceActivity(tx, { context, action: "task.synced_from_strategy", entityType: "execution_task", entityId: task.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { title: task.title, sourceModule: task.moduleName, expectedOutcome: task.expectedOutcome, priority: task.priority, status: task.status, automationLevel: task.automationLevel } });
    }
    await syncStrategyIntelligenceTasks(tx, project, planId, latestStrategy, context);
    await syncProjectWorkflow(tx, project.id);
    await recordWorkspaceActivity(tx, { context, action: "strategy.approved", entityType: "strategy_plan", entityId: latestStrategy.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: latestStrategy.status }, nextJson: { status: "approved", version: (latestStrategy as { version?: number }).version ?? 1 } });
    const recipients = await tx.projectMemberAssignment.findMany({ where: { projectId: project.id }, select: { membership: { select: { userId: true } } } });
    for (const userId of [...new Set([context.workspace.ownerUserId, ...recipients.map((item) => item.membership.userId)])]) await createWorkspaceNotification(tx, { context, userId, type: "strategy_approved", title: "Strategy approved", body: `${project.name}'s official Strategy was approved. Execution planning can now begin.`, actionUrl: `/strategy?projectId=${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id });
  });

  const updated = await scopedProject(req, project.id);
  res.json({ project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/execution-plan/create", async (req, res) => {
  const context = await requireRequestPermission(req, "edit_assigned_work");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const approvedStrategy = project.strategyPlans.find((strategy) => strategy.status === "approved");
  if (!approvedStrategy) return res.status(409).json({ error: "approve strategy before creating execution plan" });

  const websiteId = project.websiteId ?? project.website?.id ?? null;
  const isExistingWebsite = isExistingWebsiteCampaign(project);
  const hasWebsite = Boolean(websiteId || project.websiteUrl || project.website?.rootUrl);
  const [completedCrawl, keywordRuns, existingTasks] = await Promise.all([
    websiteId
      ? prisma.crawlJob.findFirst({
          where: { websiteId, status: "completed", pagesCrawled: { gt: 0 } },
          orderBy: { createdAt: "desc" },
          select: { id: true, pagesCrawled: true },
        })
      : Promise.resolve(null),
    prisma.keywordResearchRun.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, status: true, keywordCount: true },
    }),
    prisma.executionTask.findMany({
      where: { projectId: project.id, status: { notIn: ["cancelled", "canceled"] } },
      select: { moduleName: true, status: true },
      take: 100,
    }),
  ]);
  const keywordAnalysisComplete = keywordRuns.some((run) => run.status === "completed" || run.keywordCount > 0)
    || existingTasks.some((task) => task.moduleName === "keyword_research" && ["completed", "skipped"].includes(task.status));
  const siteAnalysisComplete = !isExistingWebsite || Boolean(completedCrawl)
    || existingTasks.some((task) => task.moduleName === "site_analysis" && ["completed", "skipped"].includes(task.status));
  const siteArchitectureComplete = hasWebsite || existingTasks.some((task) => task.moduleName === "site_architect" && ["completed", "skipped"].includes(task.status));
  const localReadinessComplete = existingTasks.some((task) => task.moduleName === "local_seo" && ["completed", "skipped"].includes(task.status));
  const needsLocalReadiness = project.projectType === "local_seo" || project.projectType === "new_business" || /local|lead|booking|appointment|service area|gbp|google business|review/i.test([project.primaryGoal, project.niche, ...cleanLocations(Array.isArray(project.targetLocations) ? project.targetLocations.filter((item): item is string => typeof item === "string") : [], project.targetLocation), project.businessProfile?.offerSummary].filter(Boolean).join(" "));
  const missingDiscovery: Array<"keyword" | "site" | "architecture"> = [];
  if (!keywordAnalysisComplete) missingDiscovery.push("keyword");
  if (isExistingWebsite && hasWebsite && !siteAnalysisComplete) missingDiscovery.push("site");
  if (!isExistingWebsite && !siteArchitectureComplete) missingDiscovery.push("architecture");

  await prisma.$transaction(async (tx) => {
    const planId = await activePlanId(tx, project.id);
    const readinessTasks = [
      !keywordAnalysisComplete ? {
        key: "readiness-keyword-analysis",
        moduleName: "keyword_research",
        title: "Create keyword plan",
        description: hasWebsite
          ? "Research target keywords, buyer-intent keywords, topical clusters, competitor gaps, difficulty, opportunity score, and revenue potential."
          : "No website exists yet. Create seed keywords, buyer-intent terms, service/page targets, and topical clusters from the project profile.",
        actionButtonLabel: "Open Keywords",
        relatedUrl: websiteId ? `/keyword-insights?project=${websiteId}&add=1` : "/keyword-insights?add=1",
        priority: "high" as const,
      } : null,
      isExistingWebsite && hasWebsite && !siteAnalysisComplete ? {
        key: "readiness-site-analysis",
        moduleName: "site_analysis",
        title: "Run site analysis",
        description: "Crawl the existing website to review pages, technical SEO, titles/metas, structure, internal links, content gaps, speed/mobile basics, indexability, CTAs, conversion issues, and keyword alignment.",
        actionButtonLabel: "Analyze Site",
        relatedUrl: "/site-analysis",
        priority: "high" as const,
      } : null,
      !siteArchitectureComplete ? {
        key: "readiness-site-architecture",
        moduleName: "site_architect",
        title: "Create website architecture",
        description: hasWebsite
          ? "Create or refine the site structure and page plan before deeper content and publishing work."
          : "No website or domain exists yet. Create the site structure, page plan, draft sitemap, and publishing handoff first; crawl after pages exist.",
        actionButtonLabel: "Open Site Architect",
        relatedUrl: "/site-architect",
        priority: "high" as const,
      } : null,
      !hasWebsite ? {
        key: "readiness-domain-website",
        moduleName: "domain",
        title: "Choose domain and website path",
        description: "Recommend domain options, hosting/publishing path, core URL structure, and handoff requirements. This does not block strategy, keyword, local SEO, or content planning.",
        actionButtonLabel: "Plan Domain",
        relatedUrl: "/site-architect",
        priority: "high" as const,
      } : null,
      needsLocalReadiness && !localReadinessComplete ? {
        key: "readiness-local-gbp",
        moduleName: "local_seo",
        title: "Prepare GBP and local SEO foundation",
        description: "Prepare Google Business Profile categories, services, service areas, citation/NAP requirements, review workflow, and local trust signals before or alongside the website build.",
        actionButtonLabel: "Open Local SEO",
        relatedUrl: "/local-seo",
        priority: "high" as const,
      } : null,
      keywordAnalysisComplete && siteAnalysisComplete ? {
        key: "readiness-refresh-strategy",
        moduleName: "strategy",
        title: "Refresh strategy with discovery data",
        description: "Keyword and site discovery data are available. Regenerate or review the strategy so the final execution plan uses the latest evidence.",
        actionButtonLabel: "Review Strategy",
        relatedUrl: "/strategy",
        priority: "medium" as const,
      } : null,
    ].filter((task): task is NonNullable<typeof task> => Boolean(task));

    if (missingDiscovery.length > 0) {
      await tx.executionPlan.update({
        where: { id: planId },
        data: {
          title: "Adaptive SEO/Growth execution plan",
          summary: isExistingWebsite
            ? "The plan is active. Missing crawl, keyword, or setup data appears as tasks and does not stop downstream work."
            : "The plan is active for a pre-website project. Domain, website architecture, keyword seeds, GBP/local setup, content, and publishing tasks can proceed before crawl data exists.",
        },
      });
    }

    await tx.executionPlan.update({
      where: { id: planId },
      data: {
        title: missingDiscovery.length > 0 ? "Adaptive SEO/Growth execution plan" : "Full SEO/Growth execution plan",
        summary: missingDiscovery.length > 0
          ? "Prioritized execution tasks are active now. Missing dependencies are setup tasks, not blockers."
          : "Prioritized execution tasks created from the campaign type, approved strategy, opportunity direction, keyword analysis, site analysis, business goal, and project readiness.",
      },
    });
    for (const input of readinessTasks) {
      const task = await ensureNextTask(tx, {
        clientId: project.clientId,
        websiteId: project.websiteId,
        projectId: project.id,
        executionPlanId: planId,
        key: `project:${project.id}:execution:${input.key}`,
        moduleName: input.moduleName,
        title: input.title,
        description: input.description,
        actionButtonLabel: input.actionButtonLabel,
        relatedUrl: input.relatedUrl,
        priority: input.priority,
        automationLevel: "manual_guided",
      });
      await recordWorkspaceActivity(tx, { context, action: "task.synced_from_module", entityType: "execution_task", entityId: task.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { title: task.title, sourceModule: task.moduleName, expectedOutcome: task.expectedOutcome, priority: task.priority, status: task.status, automationLevel: task.automationLevel } });
    }
    const taskInputs = buildCampaignExecutionTasks(project);

    for (const input of taskInputs) {
      const task = await ensureNextTask(tx, {
        clientId: project.clientId,
        websiteId: project.websiteId,
        projectId: project.id,
        executionPlanId: planId,
        key: `project:${project.id}:execution:${input.key}`,
        moduleName: input.moduleName,
        title: input.title,
        description: input.description,
        actionButtonLabel: input.actionButtonLabel,
        relatedUrl: input.relatedUrl,
        priority: input.priority,
        automationLevel: input.automationLevel,
        requiresApproval: input.requiresApproval,
        requiresIntegration: input.requiresIntegration,
      });
      await recordWorkspaceActivity(tx, { context, action: "task.synced_from_module", entityType: "execution_task", entityId: task.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { title: task.title, sourceModule: task.moduleName, expectedOutcome: task.expectedOutcome, priority: task.priority, status: task.status, automationLevel: task.automationLevel } });
    }
    await syncStrategyIntelligenceTasks(tx, project, planId, approvedStrategy, context);
    await syncProjectWorkflow(tx, project.id);
  });

  const updated = await scopedProject(req, project.id);
  res.json({ project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/execution-tasks", async (req, res) => {
  const context = await requireRequestPermission(req, "execute_tasks");
  const parsed = executionTaskCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const data = parsed.data;
  const assignee = data.assigneeMembershipId ? await prisma.workspaceMembership.findFirst({ where: { id: data.assigneeMembershipId, workspaceId: context.workspace.id, status: "active" }, select: { id: true, userId: true } }) : null;
  if (data.assigneeMembershipId && !assignee) return res.status(400).json({ error: "Assigned user must be an active member of this workspace." });
  const dependencies = data.dependencyTaskIds.length ? await prisma.executionTask.findMany({ where: { id: { in: [...new Set(data.dependencyTaskIds)] }, projectId: project.id }, select: { id: true } }) : [];
  if (dependencies.length !== new Set(data.dependencyTaskIds).size) return res.status(400).json({ error: "Dependencies must belong to this project." });
  const keyPart = `${data.sourceModule}:${data.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 150);
  const result = await prisma.$transaction(async (tx) => {
    const planId = await activePlanId(tx, project.id);
    const existing = await tx.executionTask.findUnique({ where: { dedupeKey: `project:${project.id}:user:${keyPart}` } });
    const taskData = { clientId: project.clientId, websiteId: project.websiteId, projectId: project.id, executionPlanId: planId, moduleName: data.sourceModule, sourceType: "user", sourceId: context.membership.userId, title: data.title, description: data.description, expectedOutcome: data.expectedOutcome, priority: data.priority, automationLevel: data.automationLevel, status: dependencies.some((item) => item.id) ? "pending" : "ready", requiresApproval: data.requiresApproval, manualRequired: data.automationLevel === "manual_guided" || data.automationLevel === "manual_task", assigneeMembershipId: assignee?.id ?? null, dueAt: data.dueAt ?? null, actionButtonLabel: "Review Task", relatedUrl: `/guided-projects/${project.id}?tab=execution#execution-tasks` };
    const task = existing && !["completed", "cancelled", "canceled"].includes(existing.status)
      ? await tx.executionTask.update({ where: { id: existing.id }, data: taskData })
      : await tx.executionTask.create({ data: { ...taskData, dedupeKey: existing ? `project:${project.id}:user:${keyPart}:${Date.now()}` : `project:${project.id}:user:${keyPart}` } });
    await tx.executionTaskDependency.deleteMany({ where: { taskId: task.id } });
    if (dependencies.length) await tx.executionTaskDependency.createMany({ data: dependencies.map((dependency) => ({ taskId: task.id, requiredTaskId: dependency.id })) });
    await recordWorkspaceActivity(tx, { context, action: existing ? "task.updated" : "task.created", entityType: "execution_task", entityId: task.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { title: task.title, expectedOutcome: task.expectedOutcome, sourceModule: task.moduleName, priority: task.priority, status: task.status, automationLevel: task.automationLevel, dependencies: dependencies.map((item) => item.id), assigneeMembershipId: task.assigneeMembershipId, dueAt: task.dueAt } });
    if (assignee) await createWorkspaceNotification(tx, { context, userId: assignee.userId, type: "task_assignment", title: existing ? "Task assignment updated" : "New task assigned", body: `${task.title} was assigned to you. Expected outcome: ${task.expectedOutcome}`, actionUrl: task.relatedUrl ?? `/guided-projects/${project.id}?tab=execution`, agencyClientId: project.agencyClientId, projectId: project.id });
    await syncProjectWorkflow(tx, project.id);
    return task;
  });
  res.status(201).json({ task: result, project: await scopedProject(req, project.id) });
});

guidedProjectsRouter.post("/projects-v2/:projectId/lead-magnet/research", async (req, res) => {
  const context = await requireRequestPermission(req, "run_ai_analysis");
  const parsed = leadMagnetResearchSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!project.businessProfile) return res.status(409).json({ error: "Complete Business Intake before researching lead-magnet opportunities." });
  const researchInput = {
    ...parsed.data,
    objective: parsed.data.objective ?? `Identify the strongest lead-magnet opportunity to support ${project.primaryGoal || "qualified lead generation"} for ${project.businessName ?? project.name}.`,
  };

  let usageEventId: string | null = null;
  try {
    const [client, keywordRuns, crawl] = await Promise.all([
      prisma.client.findUnique({ where: { id: project.clientId }, select: { plan: true } }),
      prisma.keywordResearchRun.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 15 } },
      }),
      project.websiteId ? prisma.crawlJob.findFirst({
        where: { websiteId: project.websiteId, status: "completed" },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true, siteScore: true, pagesCrawled: true, errorCount: true, completedAt: true,
          pages: {
            where: { statusCode: { gte: 200, lt: 400 } },
            orderBy: [{ score: "asc" }, { createdAt: "desc" }],
            take: 40,
            select: { url: true, wordCount: true, score: true, inlinkCount: true, seo: { select: { title: true, metaDescription: true, h1Count: true, h1Text: true } } },
          },
          issues: {
            where: { status: "open" },
            orderBy: [{ severity: "asc" }, { weightImpact: "desc" }],
            take: 30,
            select: { issueType: true, category: true, severity: true, message: true, recommendation: true },
          },
        },
      }) : Promise.resolve(null),
    ]);
    const targetMarkets = cleanLocations(Array.isArray(project.targetLocations) ? project.targetLocations.filter((item): item is string => typeof item === "string") : [], project.targetLocation);
    const keywordEvidence = keywordRuns.flatMap((run) => [
      { keyword: run.seedKeyword, monthlySearches: run.averageVolume ?? 0, intent: "Seed topic", geography: run.locationName, source: "keyword research seed" },
      ...run.ideas.map((idea) => ({ keyword: idea.keyword, monthlySearches: idea.avgMonthlySearches ?? 0, intent: idea.competition ?? "Research", geography: run.locationName, source: "keyword research idea" })),
    ]);
    const dedupedKeywords = [...new Map(keywordEvidence.map((item) => [item.keyword.trim().toLowerCase(), item])).values()]
      .sort((a, b) => b.monthlySearches - a.monthlySearches)
      .slice(0, 40);
    const approvedKeywordGroups = project.keywordGroups.filter((group) => group.status === "approved").map((group) => ({
      category: group.category,
      title: group.title,
      keywords: Array.isArray(group.keywords) ? group.keywords.map(String).slice(0, 20) : [],
      gapKeywords: Array.isArray(group.gapKeywords) ? group.gapKeywords.map(String).slice(0, 20) : [],
      goalSupport: group.goalSupport,
    }));
    const selectedOpportunity = project.opportunities.find((opportunity) => opportunityDecisionStatus(opportunity.status)) ?? null;
    const approvedStrategy = project.strategyPlans.find((strategy) => strategy.status === "approved") ?? project.strategyPlans[0] ?? null;
    const researchText = (value: unknown, max = 1800) => {
      if (value == null) return null;
      const source = typeof value === "string" ? value : JSON.stringify(value);
      return source.length > max ? `${source.slice(0, max)}…` : source;
    };
    const evidence = {
      businessIntake: {
        businessName: project.businessName ?? project.name,
        niche: project.niche,
        primaryGoal: project.primaryGoal,
        secondaryGoals: Array.isArray(project.secondaryGoals) ? project.secondaryGoals.map(String) : [],
        targetAudience: researchText(project.businessProfile.targetAudience),
        offer: researchText(project.businessProfile.offerSummary),
        businessModel: project.businessProfile.businessModel,
        strengths: Array.isArray(project.businessProfile.strengths) ? project.businessProfile.strengths.map(String) : [],
        constraints: Array.isArray(project.businessProfile.constraints) ? project.businessProfile.constraints.map(String) : [],
        tonePreference: project.businessProfile.tonePreference,
        intakeAnswers: project.intakeAnswers.slice(0, 40).map((answer) => ({ question: researchText(answer.questionText, 500), answer: researchText(answer.answerValue, 1200) })),
      },
      geography: {
        businessLocation: project.businessLocation,
        targetMarkets,
        keywordResearchLocations: [...new Set(keywordRuns.map((run) => run.locationName).filter(Boolean))],
      },
      keywords: {
        approvedGroups: approvedKeywordGroups,
        measuredKeywords: dedupedKeywords,
        hasMeasuredDemand: dedupedKeywords.some((item) => item.monthlySearches > 0),
      },
      siteAnalysis: crawl ? {
        crawlId: crawl.id,
        completedAt: crawl.completedAt,
        siteScore: crawl.siteScore,
        pagesCrawled: crawl.pagesCrawled,
        errorCount: crawl.errorCount,
        pages: crawl.pages.map((page) => ({ url: page.url, wordCount: page.wordCount, score: page.score, inlinkCount: page.inlinkCount, title: researchText(page.seo?.title, 500), metaDescription: researchText(page.seo?.metaDescription, 700), h1Count: page.seo?.h1Count, h1Text: researchText(page.seo?.h1Text, 700) })),
        openIssues: crawl.issues.map((issue) => ({ issueType: issue.issueType, category: issue.category, severity: issue.severity, message: researchText(issue.message, 700), recommendation: researchText(issue.recommendation, 700) })),
      } : {
        available: false,
        reason: project.websiteId ? "No completed crawl is available." : "No website is connected to this project.",
      },
      selectedOpportunity: selectedOpportunity ? {
        name: selectedOpportunity.name,
        summary: researchText(selectedOpportunity.summary),
        targetAudience: researchText(selectedOpportunity.targetAudience),
        problemSolved: researchText(selectedOpportunity.problemSolved),
        recommendedOffer: researchText(selectedOpportunity.recommendedOffer),
        opportunityScore: selectedOpportunity.opportunityScore,
      } : { available: false, reason: "No Opportunity has been selected or confirmed." },
      strategyAndSeoPlan: approvedStrategy ? {
        status: approvedStrategy.status,
        strategySummary: researchText(approvedStrategy.strategySummary, 3000),
        positioningStatement: researchText(approvedStrategy.positioningStatement, 2000),
        offerRecommendation: researchText(approvedStrategy.offerRecommendation, 2000),
        contentStrategy: researchText(approvedStrategy.contentStrategy, 3000),
        seoStrategy: researchText(approvedStrategy.seoStrategy, 3000),
        socialStrategy: researchText(approvedStrategy.socialStrategy, 2000),
      } : { available: false, reason: "No approved or draft Strategy is available." },
    };
    const routedModel = await modelForFeature("lead_magnet_research", client?.plan, config.openaiModel);
    const preflight = await preflightUsage({
      clientId: project.clientId,
      userId: req.user?.userId,
      projectId: project.id,
      websiteId: project.websiteId,
      featureKey: "lead_magnet_research",
      actionKey: "Research lead magnet opportunities",
      idempotencyKey: `lead-magnet-research:${project.id}:${Date.now()}`,
      metadata: { objective: researchInput.objective, desiredAction: researchInput.desiredAction, researchMode: researchInput.researchMode },
    });
    usageEventId = preflight.usageEventId;
    const generated = await openaiJson(buildLeadMagnetResearchPrompt({ objective: researchInput, evidence }), routedModel);
    const validated = leadMagnetResearchOutputSchema.safeParse(generated.result);
    if (!validated.success) throw new Error("AI research returned an incomplete evidence or recommendation structure. Please run the research again.");
    const researchRun = await prisma.$transaction(async (tx) => {
      const run = await tx.aiRun.create({
        data: {
          projectId: project.id,
          clientId: project.clientId,
          moduleName: "lead_magnet_research",
          promptVersion: "lead-magnet-research-v1",
          inputSnapshotJson: { objective: researchInput, evidence } as Prisma.InputJsonValue,
          outputJson: { research: validated.data.research, followUpQuestions: validated.data.followUpQuestions, recommendations: validated.data.recommendations, evidence } as Prisma.InputJsonValue,
          outputText: validated.data.research.recommendedStrategy,
          status: "completed",
          tokenUsage: { inputTokens: generated.inputTokens, outputTokens: generated.outputTokens, model: generated.model },
        },
      });
      await recordWorkspaceActivity(tx, {
        context,
        action: "lead_magnet.research_completed",
        entityType: "ai_run",
        entityId: run.id,
        agencyClientId: project.agencyClientId,
        projectId: project.id,
        nextJson: { objective: researchInput, recommendationCount: validated.data.recommendations.length, topRecommendation: validated.data.recommendations[0]?.title ?? null },
      });
      return run;
    });
    await commitUsage({ usageEventId, provider: "openai", model: generated.model, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens, metadata: { aiRunId: researchRun.id } });
    usageEventId = null;
    res.status(201).json({ researchRun: { id: researchRun.id, createdAt: researchRun.createdAt, objective: researchInput }, evidence, ...validated.data });
  } catch (error) {
    if (usageEventId) await refundUsage({ usageEventId, reason: error instanceof Error ? error.message : "Lead-magnet research failed" }).catch(() => undefined);
    throw error;
  }
});

guidedProjectsRouter.post("/projects-v2/:projectId/lead-magnet/generate", async (req, res) => {
  const context = await requireRequestPermission(req, "edit_assigned_work");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!project.businessProfile) return res.status(409).json({ error: "complete intake before generating a lead magnet" });
  const approvedStrategy = project.strategyPlans.find((strategy) => strategy.status === "approved");
  const parsed = leadMagnetGenerateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!approvedStrategy) return res.status(409).json({ error: "approve strategy before generating a lead magnet" });
  const researchRun = await prisma.aiRun.findFirst({ where: { id: parsed.data.researchRunId, projectId: project.id, moduleName: "lead_magnet_research", status: "completed" } });
  if (!researchRun) return res.status(409).json({ error: "Run the AI lead-magnet research step before choosing a format and generating the funnel." });
  const sourceSeries = parsed.data.seriesId ? await prisma.leadMagnetFunnel.findFirst({ where: { projectId: project.id, seriesId: parsed.data.seriesId }, orderBy: { version: "desc" }, select: { seriesId: true } }) : null;
  if (parsed.data.seriesId && !sourceSeries) return res.status(404).json({ error: "The lead magnet selected for refinement was not found." });
  const researchOutput = researchRun.outputJson && typeof researchRun.outputJson === "object" && !Array.isArray(researchRun.outputJson) ? researchRun.outputJson as Record<string, unknown> : {};

  let usageEventId: string | null = null;
  try {
    const client = await prisma.client.findUnique({ where: { id: project.clientId }, select: { plan: true } });
    const routedModel = await modelForFeature("lead_magnet_generate", client?.plan, config.openaiModel);
    const preflight = await preflightUsage({
      clientId: project.clientId,
      userId: req.user?.userId,
      projectId: project.id,
      websiteId: project.websiteId,
      featureKey: "lead_magnet_generate",
      actionKey: "Generate lead magnet",
      idempotencyKey: `lead-magnet:${project.id}:${Date.now()}`,
      metadata: { source: "guided_project_lead_magnet" },
    });
    usageEventId = preflight.usageEventId;

    const [keywordRuns, websiteBrand] = await Promise.all([
      prisma.keywordResearchRun.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: "desc" },
        include: { ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 10 } },
        take: 10,
      }),
      prisma.websiteBuild.findFirst({ where: { projectId: project.id }, orderBy: { updatedAt: "desc" }, select: { brandJson: true } }),
    ]);
    const recordObject = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const combinedBrand = { ...recordObject(context.workspace.brandingJson), ...recordObject(project.agencyClient?.brandingJson), ...recordObject(websiteBrand?.brandJson) };
    const branding = {
      businessName: project.businessName ?? project.agencyClient?.name ?? project.name,
      brandVoice: project.brandVoice || project.businessProfile?.tonePreference || null,
      primaryColor: combinedBrand.primaryColor ?? combinedBrand.colorPreference ?? null,
      secondaryColor: combinedBrand.secondaryColor ?? null,
      accentColor: combinedBrand.accentColor ?? null,
      headingFont: combinedBrand.headingFont ?? null,
      bodyFont: combinedBrand.bodyFont ?? null,
      logoUrl: typeof combinedBrand.logoUrl === "string" && combinedBrand.logoUrl.startsWith("https://") ? combinedBrand.logoUrl : null,
      logoMode: combinedBrand.logoMode ?? null,
    };
    const keywordContext = keywordRuns.map((run) => ({
      seedKeyword: run.seedKeyword,
      intent: run.ideas.some((idea) => (idea.competition ?? "").toLowerCase().includes("high")) ? "Commercial" : "Research",
      avgSearchVolume: avgNumber(run.ideas.map((idea) => idea.avgMonthlySearches)) ?? run.averageVolume,
      opportunityScore: null,
      ideas: run.ideas,
    }));
    const prompt = buildLeadMagnetPrompt({
      project,
      strategy: approvedStrategy,
      keywordRuns: keywordContext,
      selectedIdea: parsed.data.selectedIdea,
      instructions: parsed.data.instructions,
      recommendation: parsed.data.recommendation,
      branding,
      research: { researchRunId: researchRun.id, objective: (researchRun.inputSnapshotJson as Record<string, unknown>)?.objective ?? null, findings: researchOutput.research ?? null },
    });
    const generated = await openaiJson(prompt, routedModel);
    const result = generated.result as { leadMagnet?: { title?: unknown; assetType?: unknown } };
    const title = typeof result.leadMagnet?.title === "string" && result.leadMagnet.title.trim()
      ? result.leadMagnet.title.trim()
      : `${project.businessName ?? project.name} Lead Magnet`;
    const assetType = typeof result.leadMagnet?.assetType === "string" ? result.leadMagnet.assetType : "lead magnet";

    const generatedPackage = generated.result && typeof generated.result === "object" && !Array.isArray(generated.result)
      ? generated.result as Record<string, unknown> : {};
    const packageObject = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const generationResult = await prisma.$transaction(async (tx) => {
      const planId = await activePlanId(tx, project.id);
      const record = await tx.aiContentGeneration.create({
        data: {
          clientId: project.clientId,
          userId: req.user?.userId,
          websiteId: project.websiteId,
          type: "lead_magnet",
          topic: title,
          targetKeyword: keywordRuns[0]?.seedKeyword ?? null,
          targetUrl: project.website?.rootUrl ?? project.websiteUrl ?? null,
          languageCode: "en",
          tone: project.businessProfile?.tonePreference ?? null,
          prompt,
          resultJson: generated.result as object,
          model: generated.model,
          inputTokens: generated.inputTokens,
          outputTokens: generated.outputTokens,
        },
      });
      const latestSeriesVersion = sourceSeries ? await tx.leadMagnetFunnel.findFirst({ where: { projectId: project.id, seriesId: sourceSeries.seriesId }, orderBy: { version: "desc" }, select: { version: true } }) : null;
      const version = (latestSeriesVersion?.version ?? 0) + 1;
      const leadMagnet = packageObject(generatedPackage.leadMagnet);
      const landingPage = packageObject(generatedPackage.landingPage);
      const businessAnalysis = packageObject(generatedPackage.businessAnalysis);
      const generatedBrand = { ...branding, ...packageObject(generatedPackage.branding) };
      const imagePlan = Array.isArray(generatedPackage.imagePlan) ? generatedPackage.imagePlan : [];
      const coverImage = leadMagnetCoverImage({ title, businessName: String(generatedBrand.businessName ?? project.businessName ?? project.name), branding: generatedBrand, imagePlan });
      const generatedImages = leadMagnetSupportingImages({ branding: generatedBrand, imagePlan });
      const formFields = Array.isArray(landingPage.formFields) ? landingPage.formFields.map(String) : ["First name", "Email"];
      const funnel = await tx.leadMagnetFunnel.create({
        data: {
          projectId: project.id, clientId: project.clientId, ...(sourceSeries ? { seriesId: sourceSeries.seriesId } : {}), version, status: "draft", title,
          magnetType: assetType, recommendationScore: parsed.data.recommendation?.score ?? 88,
          recommendationReason: parsed.data.recommendation ? `${parsed.data.recommendation.why} ${parsed.data.recommendation.signal} ${parsed.data.recommendation.estimatedImpact.label}. ${parsed.data.recommendation.estimatedImpact.disclaimer}` : `Selected from the approved Strategy, audience, offer, Primary Goal, target markets, approved keyword evidence, and current website context.`,
          audience: project.businessProfile?.targetAudience, primaryGoal: project.primaryGoal,
          brandVoice: project.brandVoice || project.businessProfile?.tonePreference,
          assetJson: { ...leadMagnet, title, businessAnalysis, branding: generatedBrand, imagePlan, coverImage, generatedImages, leadMagnetResearch: researchOutput.research ?? null, researchRunId: researchRun.id, opportunityEvidence: parsed.data.recommendation?.evidence ?? [], estimatedImpact: parsed.data.recommendation?.estimatedImpact ?? null, setupInstructions: parsed.data.instructions ?? null }, landingPageJson: { ...landingPage, coverImage } as Prisma.InputJsonValue,
          optInFormJson: { fields: formFields.map((field) => ({ name: field.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label: field, type: /email/i.test(field) ? "email" : "text", required: /email/i.test(field) })), submitLabel: String(landingPage.ctaText ?? "Get the resource"), consentText: "I agree to receive this resource and relevant follow-up email. I can unsubscribe at any time." },
          thankYouPageJson: packageObject(generatedPackage.thankYouPage) as Prisma.InputJsonValue,
          deliveryEmailJson: packageObject(generatedPackage.deliveryEmail) as Prisma.InputJsonValue,
          followUpSequenceJson: (Array.isArray(generatedPackage.followUpSequence) ? generatedPackage.followUpSequence : []) as Prisma.InputJsonValue,
          abTestsJson: [
            { element: "headline", control: String(landingPage.headline ?? title), variation: `${String(leadMagnet.promise ?? title)} — get the practical plan`, hypothesis: "A specific outcome-led headline will increase qualified opt-ins." },
            { element: "cta", control: String(landingPage.ctaText ?? "Get the resource"), variation: `Send me ${title}`, hypothesis: "A first-person CTA will make the value exchange clearer." },
            { element: "form", control: formFields, variation: formFields.filter((field) => /name|email/i.test(field)), hypothesis: "Fewer required fields will reduce opt-in friction." },
          ],
          seoMetadataJson: { title: String(landingPage.headline ?? title).slice(0, 60), description: String(landingPage.subheadline ?? leadMagnet.promise ?? title).slice(0, 160), robots: "index,follow", aiSummary: String(leadMagnet.promise ?? "") },
          trackingPlanJson: (Array.isArray(generatedPackage.trackingPlan) ? generatedPackage.trackingPlan : ["Landing page views", "Form submissions", "Downloads", "Delivery email opens", "Email clicks"]) as Prisma.InputJsonValue,
          aiContentGenerationId: record.id, createdByUserId: context.membership.userId,
          validationJson: { valid: false, state: "draft", requiredBeforePublish: ["approval", "verified_esp", "business_evidence", "brand_snapshot", "visual_asset", "link_check", "form_check", "download_check"] },
          decisions: { create: { actorUserId: context.membership.userId, decision: "generated", snapshotJson: { version, title, magnetType: assetType, recommendation: parsed.data.recommendation ?? null } } },
        },
      });
      const leadMagnetTask = await ensureNextTask(tx, {
        clientId: project.clientId,
        websiteId: project.websiteId,
        projectId: project.id,
        executionPlanId: planId,
        key: `project:${project.id}:execution:lead-magnet:${funnel.seriesId}`,
        moduleName: "lead_magnet",
        sourceType: "lead_magnet_funnel",
        sourceId: funnel.seriesId,
        title: `Review lead magnet: ${title}`,
        description: `Review the AI-generated ${assetType} package, landing page, delivery email, thank-you copy, CTA flow, and tracking plan before publishing or sending.`,
        actionButtonLabel: "Review Lead Magnet",
        relatedUrl: "/lead-magnets",
        automationLevel: "generate",
        priority: "medium",
        requiresApproval: true,
      });
      await tx.executionTask.updateMany({
        where: { id: leadMagnetTask.id },
        data: {
          relatedAssetId: funnel.id,
          status: "needs_review",
          automationLevel: "generate",
          requiresApproval: true,
          manualRequired: true,
          actionButtonLabel: "Review Lead Magnet",
          manualInstructions: "Review the generated lead magnet package. Approve the asset, landing page, delivery email, and CTA flow before publishing or sending anything.",
        },
      });
      await tx.aiRun.create({
        data: {
          projectId: project.id,
          clientId: project.clientId,
          moduleName: "lead_magnet",
          promptVersion: "lead-magnet-openai-v2",
          inputSnapshotJson: {
            projectId: project.id,
            strategyId: approvedStrategy.id,
            keywordRunCount: keywordRuns.length,
            researchRunId: researchRun.id,
            selectedIdea: parsed.data.selectedIdea ?? null,
            instructions: parsed.data.instructions ?? null,
            recommendation: parsed.data.recommendation ?? null,
            branding,
          },
          outputJson: { generationId: record.id, funnelId: funnel.id, seriesId: funnel.seriesId, version, title },
          outputText: title,
          status: "completed",
        },
      });
      await recordWorkspaceActivity(tx, { context, action: "lead_magnet.generated", entityType: "lead_magnet_funnel", entityId: funnel.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { seriesId: funnel.seriesId, version, status: "draft", title, magnetType: assetType, researchRunId: researchRun.id, buyerStage: parsed.data.recommendation?.buyerStage ?? businessAnalysis.buyerStage ?? null, estimatedImpact: parsed.data.recommendation?.estimatedImpact ?? null, evidence: parsed.data.recommendation?.evidence ?? [], generatedAssets: ["lead_magnet_research", "business_analysis", "lead_magnet", "brand_snapshot", "cover_image", "image_plan", "landing_page", "opt_in_form", "thank_you_page", "delivery_email", "follow_up_sequence", "ab_tests"] } });
      const approvers = await tx.workspaceMembership.findMany({ where: { workspaceId: context.workspace.id, status: "active", roles: { some: { role: { in: ["owner", "admin", "manager", "approver"] } } } }, select: { userId: true } });
      for (const userId of [...new Set([context.workspace.ownerUserId, ...approvers.map((item) => item.userId)])]) await createWorkspaceNotification(tx, { context, userId, type: "lead_magnet_ready_for_approval", title: "Lead magnet ready for approval", body: `${project.name}: ${title} and its complete lead-capture funnel are ready to review.`, actionUrl: `/lead-magnets?projectId=${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id });
      await syncProjectWorkflow(tx, project.id);
      return { generation: record, funnel };
    });

    await commitUsage({
      usageEventId,
      provider: "openai",
      model: generated.model,
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      providerCostUsd: Number(generationResult.generation.estimatedCostUsd ?? 0),
      metadata: { aiContentGenerationId: generationResult.generation.id, leadMagnetFunnelId: generationResult.funnel.id },
    });
    usageEventId = null;

    const updated = await scopedProject(req, project.id);
    res.status(201).json({ project: updated, generation: generationResult.generation, funnel: generationResult.funnel });
  } catch (error) {
    if (usageEventId) {
      await refundUsage({ usageEventId, reason: error instanceof Error ? error.message : "Lead magnet generation failed" }).catch(() => undefined);
    }
    if (error instanceof Error && error.message === "openai_not_configured") return res.status(503).json({ error: "OpenAI is not configured" });
    res.status(500).json({ error: error instanceof Error ? error.message : "Lead magnet generation failed" });
  }
});
