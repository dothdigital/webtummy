import { Agent } from "@mastra/core/agent";
import { createOpenAI } from "@ai-sdk/openai";
import { prisma } from "@webtummy/db";
import { z } from "zod";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { rankNextBestAction, type NextBestActionContext } from "../dev016.js";

export const agentPageSchema = z.enum([
  "project", "intake", "opportunities", "keywords", "keyword-insights", "site-analysis",
  "strategy", "execution-plan", "approvals", "reports", "notifications", "backlinks",
  "ai-citations", "site-architect", "lead-magnets", "growth", "gap-analysis", "local-seo",
  "publishing", "social", "workspace", "clients", "teams", "billing", "admin", "geo-keywords", "support",
]);

const plannedActivitySchema = z.object({
  title: z.string(),
  reason: z.string(),
  module: agentPageSchema,
  actionUrl: z.string(),
  priority: z.enum(["critical", "high", "medium", "low"]),
  expectedOutcome: z.string(),
  dependencies: z.array(z.string()),
  blocked: z.boolean(),
  score: z.number().min(0).max(100).optional(),
  confidence: z.number().min(0).max(100).optional(),
  signals: z.array(z.object({ key: z.string(), label: z.string(), contribution: z.number(), evidence: z.string() })).optional(),
});

export const projectAgentOutputSchema = z.object({
  projectId: z.string(),
  page: agentPageSchema,
  answer: z.string(),
  summary: z.string(),
  currentState: z.object({ completed: z.array(z.string()), active: z.array(z.string()), blocked: z.array(z.string()) }),
  readinessChecklist: z.array(z.object({
    key: z.string(),
    label: z.string(),
    status: z.enum(["complete", "ready", "blocked", "pending", "not_required"]),
    detail: z.string(),
    actionUrl: z.string().nullable(),
  })).max(14),
  presentation: z.object({ showReadinessChecklist: z.boolean() }),
  followUpQuestions: z.array(z.string()).max(4),
  nextPlannedActivity: plannedActivitySchema,
  suggestions: z.array(z.object({ title: z.string(), reason: z.string(), impact: z.string(), confidence: z.number().min(0).max(100), evidence: z.array(z.string()) })).max(5),
  predictedOutcome: z.object({ statement: z.string(), confidence: z.number().min(0).max(100), assumptions: z.array(z.string()), dependencies: z.array(z.string()) }),
  pageGuidance: z.array(z.object({ title: z.string(), detail: z.string(), actionUrl: z.string().nullable() })).max(5),
  suggestedChanges: z.array(z.object({ title: z.string(), reason: z.string(), requiresApproval: z.boolean(), targetModule: agentPageSchema })).max(5),
  support: z.object({ explanation: z.string(), warnings: z.array(z.string()), missingInputs: z.array(z.string()) }),
  retrieval: z.object({ mode: z.enum(["semantic", "lexical", "none"]), matches: z.array(z.object({ title: z.string(), sourceType: z.string(), score: z.number().min(0).max(1) })).max(8) }),
  generatedBy: z.enum(["mastra", "rules"]),
});

export type AgentPage = z.infer<typeof agentPageSchema>;
export type ProjectAgentOutput = z.infer<typeof projectAgentOutputSchema>;

const flow = [
  { key: "project_created", page: "project", title: "Create the project", url: (id: string) => `/guided-projects/${id}` },
  { key: "intake", page: "intake", title: "Complete project intake", url: (id: string) => `/guided-projects/${id}/intake` },
  { key: "readiness", page: "project", title: "Confirm project readiness", url: (id: string) => `/guided-projects/${id}` },
  { key: "opportunity_generation", page: "opportunities", title: "Generate opportunity recommendations", url: (id: string) => `/opportunities?projectId=${id}#opportunity-options` },
  { key: "opportunity", page: "opportunities", title: "Select the project opportunity", url: (id: string) => `/opportunities?projectId=${id}#opportunity-options` },
  { key: "keyword_groups", page: "keywords", title: "Generate keyword groups", url: (id: string) => `/keywords?projectId=${id}` },
  { key: "keyword_approval", page: "keywords", title: "Approve the keyword direction", url: (id: string) => `/keywords?projectId=${id}` },
  { key: "keyword_analysis", page: "keywords", title: "Run Keyword Analysis", url: (id: string) => `/keywords?projectId=${id}` },
  { key: "site_analysis", page: "site-analysis", title: "Run site analysis", url: (id: string) => `/site-analysis?projectId=${id}` },
  { key: "strategy", page: "strategy", title: "Generate the project strategy", url: (id: string) => `/strategy?projectId=${id}` },
  { key: "strategy_approval", page: "strategy", title: "Review and approve the strategy", url: (id: string) => `/strategy?projectId=${id}` },
  { key: "execution_plan", page: "execution-plan", title: "Create or synchronize the Execution Plan", url: (id: string) => `/guided-projects/${id}?tasks=1` },
] as const;

export async function loadProjectAgentEvidence(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      businessProfile: true,
      workflowSteps: { orderBy: { sortOrder: "asc" } },
      // The selected direction may not be one of the three highest raw scores.
      // Load every project opportunity so agent guidance never loses the active direction.
      opportunities: { orderBy: { opportunityScore: "desc" } },
      keywordGroups: true,
      gapRecommendations: { where: { status: { in: ["suggested", "approved"] } }, orderBy: [{ impactScore: "desc" }, { confidenceScore: "desc" }], take: 30 },
      siteArchitectureVersions: { where: { status: { in: ["draft", "approved"] } }, orderBy: { version: "desc" }, take: 2, include: { pages: { orderBy: { sortOrder: "asc" } }, links: true } },
      strategyPlans: { orderBy: { version: "desc" }, take: 2 },
      executionTasks: { include: { dependencies: { include: { requiredTask: { select: { id: true, title: true, status: true } } } } }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!project) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  const latestCrawl = project.websiteId ? await prisma.crawlJob.findFirst({ where: { websiteId: project.websiteId }, orderBy: { createdAt: "desc" }, select: {
    id: true, status: true, pagesCrawled: true, errorCount: true, siteScore: true, error: true, createdAt: true, completedAt: true,
    _count: { select: { issues: true } },
    issues: { where: { status: "open" }, orderBy: [{ severity: "asc" }, { weightImpact: "desc" }], take: 30, select: { id: true, issueType: true, category: true, severity: true, message: true, recommendation: true, status: true, page: { select: { url: true, statusCode: true } } } },
    pages: { where: { OR: [{ statusCode: { gte: 400 } }, { fetchError: { not: null } }] }, take: 20, select: { id: true, url: true, statusCode: true, fetchError: true } },
  } }) : null;
  const keywordResearchRuns = project.websiteId ? await prisma.keywordResearchRun.findMany({
    where: { websiteId: project.websiteId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      seedKeyword: true,
      locationName: true,
      languageCode: true,
      device: true,
      serpDepth: true,
      status: true,
      keywordCount: true,
      competitorCount: true,
      averageVolume: true,
      targetRank: true,
      rankingUrl: true,
      error: true,
      createdAt: true,
      completedAt: true,
      ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 12, select: { keyword: true, avgMonthlySearches: true, competition: true, competitionIndex: true, cpc: true } },
      competitors: { orderBy: { rank: "asc" }, take: 8, select: { rank: true, domain: true, title: true, contentScore: true } },
    },
  }) : [];
  const activities = await prisma.workspaceActivity.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, action: true, entityType: true, previousJson: true, nextJson: true, metadataJson: true, createdAt: true } });
  return { project, latestCrawl, keywordResearchRuns, activities };
}

type SemanticSource = { sourceType: string; sourceId: string; title: string; content: string; metadata?: Record<string, unknown> };

function semanticSources(evidence: Awaited<ReturnType<typeof loadProjectAgentEvidence>>): SemanticSource[] {
  const { project, latestCrawl, keywordResearchRuns, activities } = evidence;
  const sources: SemanticSource[] = [{ sourceType: "project_profile", sourceId: project.id, title: `${project.name} project profile`, content: JSON.stringify({ name: project.name, type: project.projectType, websiteStatus: project.websiteStatus, niche: project.niche, businessLocation: project.businessLocation, targetLocations: project.targetLocations, primaryGoal: project.primaryGoal, secondaryGoals: project.secondaryGoals, competitors: project.competitors, businessProfile: project.businessProfile }) }];
  for (const item of project.opportunities) sources.push({ sourceType: "opportunity", sourceId: item.id, title: item.name, content: JSON.stringify({ name: item.name, status: item.status, audience: item.targetAudience, problem: item.problemSolved, offer: item.recommendedOffer, summary: item.summary, scores: { overall: item.opportunityScore, seo: item.seoScore, competition: item.competitionScore, monetization: item.monetizationScore, execution: item.executionScore, userFit: item.userFitScore } }) });
  for (const item of project.keywordGroups) sources.push({ sourceType: "keyword_group", sourceId: item.id, title: item.title, content: JSON.stringify({ title: item.title, category: item.category, status: item.status, explanation: item.explanation, expectedValue: item.expectedValue, goalSupport: item.goalSupport, keywords: item.keywords, gaps: item.gapKeywords }) });
  for (const item of keywordResearchRuns) sources.push({ sourceType: "keyword_analysis", sourceId: item.id, title: `${item.seedKeyword} · ${item.locationName}`, content: JSON.stringify({ keyword: item.seedKeyword, location: item.locationName, language: item.languageCode, device: item.device, status: item.status, keywordCount: item.keywordCount, competitorCount: item.competitorCount, averageVolume: item.averageVolume, rank: item.targetRank, rankingUrl: item.rankingUrl, ideas: item.ideas, competitors: item.competitors, completedAt: item.completedAt, error: item.error }) });
  for (const item of project.gapRecommendations) sources.push({ sourceType: "gap_recommendation", sourceId: item.id, title: item.title, content: JSON.stringify({ category: item.category, status: item.status, priority: item.priority, explanation: item.explanation, recommendedAction: item.recommendedAction, expectedImpact: item.expectedImpact, evidence: item.evidenceJson, competitors: item.competitorEvidence, impactScore: item.impactScore, confidenceScore: item.confidenceScore }) });
  for (const item of project.siteArchitectureVersions) sources.push({ sourceType: "site_architecture", sourceId: item.id, title: item.title, content: JSON.stringify({ version: item.version, status: item.status, summary: item.executiveSummary, rationale: item.rationale, goals: item.goalsJson, pages: item.pages.map((page) => ({ key: page.pageKey, parent: page.parentPageKey, title: page.title, url: page.suggestedUrl, type: page.pageType, navigation: page.navigationGroup, intent: page.searchIntent, purpose: page.purpose, why: page.recommendationWhy, keywords: page.targetKeywordsJson })), links: item.links.map((link) => ({ source: link.sourcePageKey, target: link.targetPageKey, anchor: link.anchorText, type: link.linkType, rationale: link.rationale })) }) });
  for (const item of project.strategyPlans) sources.push({ sourceType: "strategy", sourceId: item.id, title: `Strategy version ${item.version}`, content: JSON.stringify(item) });
  for (const item of project.executionTasks) sources.push({ sourceType: "execution_task", sourceId: item.id, title: item.title, content: JSON.stringify({ title: item.title, description: item.description, outcome: item.expectedOutcome, impact: item.impact, module: item.moduleName, status: item.status, priority: item.priority, blockedReason: item.blockedReason, instructions: item.manualInstructions, dependencies: item.dependencies.map((dependency) => dependency.requiredTask) }) });
  for (const item of latestCrawl?.issues ?? []) sources.push({ sourceType: "crawl_issue", sourceId: item.id, title: item.message.slice(0, 250), content: JSON.stringify(item) });
  for (const item of activities) sources.push({ sourceType: "activity", sourceId: item.id, title: `${item.action} · ${item.entityType}`, content: JSON.stringify(item) });
  return sources.filter((source) => source.content.length > 2).slice(0, 300);
}

async function embeddings(input: string[]) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: config.openaiEmbeddingModel, input }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        if (attempt < 2 && (response.status === 429 || response.status >= 500)) continue;
        throw new Error(`embedding_request_failed_${response.status}`);
      }
      const data = await response.json() as { data?: { index: number; embedding: number[] }[] };
      const rows = [...(data.data ?? [])].sort((a, b) => a.index - b.index).map((item) => item.embedding);
      if (rows.length !== input.length) throw new Error("embedding_count_mismatch");
      return rows;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("embedding_request_failed_")) throw error;
      const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: { code?: string } }).cause : undefined;
      const code = cause?.code || (error instanceof Error ? error.name : "unknown");
      if (attempt < 2) continue;
      throw new Error(`embedding_network_error_${code}`, { cause: error });
    }
  }
  throw new Error("embedding_network_error_unknown");
}

function semanticHash(source: SemanticSource) {
  return createHash("sha256").update(`${source.title}\n${source.content}`).digest("hex");
}

export async function syncProjectSemanticIndex(evidence: Awaited<ReturnType<typeof loadProjectAgentEvidence>>) {
  const sources = semanticSources(evidence);
  if (!config.openaiApiKey) return { indexed: 0, unchanged: 0, removed: 0, total: sources.length, available: false };
  const existing = await prisma.projectAgentDocument.findMany({ where: { projectId: evidence.project.id }, select: { id: true, sourceType: true, sourceId: true, contentHash: true, model: true } });
  const byKey = new Map(existing.map((item) => [`${item.sourceType}:${item.sourceId}`, item]));
  const changed = sources.filter((source) => {
    const document = byKey.get(`${source.sourceType}:${source.sourceId}`);
    return document?.contentHash !== semanticHash(source) || document.model !== config.openaiEmbeddingModel;
  });
  for (let offset = 0; offset < changed.length; offset += 40) {
    const batch = changed.slice(offset, offset + 40);
    const vectors = await embeddings(batch.map((source) => source.content.slice(0, 20_000)));
    for (let index = 0; index < batch.length; index += 1) {
      const source = batch[index];
      const id = byKey.get(`${source.sourceType}:${source.sourceId}`)?.id ?? `agent_${createHash("sha256").update(`${evidence.project.id}:${source.sourceType}:${source.sourceId}`).digest("hex").slice(0, 24)}`;
      const vector = `[${vectors[index].join(",")}]`;
      const hash = semanticHash(source);
      await prisma.$executeRaw`INSERT INTO "ProjectAgentDocument" ("id", "projectId", "sourceType", "sourceId", "title", "content", "contentHash", "embedding", "model", "metadata", "createdAt", "updatedAt") VALUES (${id}, ${evidence.project.id}, ${source.sourceType}, ${source.sourceId}, ${source.title}, ${source.content}, ${hash}, CAST(${vector} AS vector), ${config.openaiEmbeddingModel}, ${JSON.stringify(source.metadata ?? {})}::jsonb, NOW(), NOW()) ON CONFLICT ("projectId", "sourceType", "sourceId") DO UPDATE SET "title" = EXCLUDED."title", "content" = EXCLUDED."content", "contentHash" = EXCLUDED."contentHash", "embedding" = EXCLUDED."embedding", "model" = EXCLUDED."model", "metadata" = EXCLUDED."metadata", "updatedAt" = NOW()`;
    }
  }
  const sourceKeys = new Set(sources.map((source) => `${source.sourceType}:${source.sourceId}`));
  const staleIds = existing.filter((item) => !sourceKeys.has(`${item.sourceType}:${item.sourceId}`)).map((item) => item.id);
  if (staleIds.length) await prisma.projectAgentDocument.deleteMany({ where: { id: { in: staleIds } } });
  return { indexed: changed.length, unchanged: sources.length - changed.length, removed: staleIds.length, total: sources.length, available: true };
}

export async function retrieveSemanticContext(evidence: Awaited<ReturnType<typeof loadProjectAgentEvidence>>, query: string) {
  const sources = semanticSources(evidence);
  const lexical = () => {
    const words = new Set(query.toLowerCase().split(/\W+/).filter((word) => word.length > 2));
    const matches = sources.map((source) => ({ source, score: [...words].filter((word) => `${source.title} ${source.content}`.toLowerCase().includes(word)).length / Math.max(words.size, 1) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
    return { mode: "lexical" as const, matches };
  };
  if (!config.openaiApiKey) return lexical();
  await syncProjectSemanticIndex(evidence);
  const [queryVector] = await embeddings([query]);
  const vector = `[${queryVector.join(",")}]`;
  const documents = await prisma.$queryRaw<{ sourceType: string; sourceId: string; title: string; content: string; score: number }[]>`
    WITH ranked AS (
      SELECT "sourceType", "sourceId", "title", "content",
        (1 - ("embedding" <=> CAST(${vector} AS vector)))::float8 AS semantic_score,
        ts_rank_cd(to_tsvector('english', "title" || ' ' || "content"), websearch_to_tsquery('english', ${query}))::float8 AS lexical_score
      FROM "ProjectAgentDocument"
      WHERE "projectId" = ${evidence.project.id}
    )
    SELECT "sourceType", "sourceId", "title", "content",
      LEAST(1, GREATEST(0, semantic_score * 0.85 + LEAST(lexical_score, 1) * 0.15))::float8 AS score
    FROM ranked
    ORDER BY score DESC
    LIMIT 8`;
  const matches = documents.filter((document) => document.score >= 0.2).map((document) => ({ source: { sourceType: document.sourceType, sourceId: document.sourceId, title: document.title, content: document.content }, score: document.score }));
  return { mode: "semantic" as const, matches };
}

export function nextBestActionContext(evidence: Awaited<ReturnType<typeof loadProjectAgentEvidence>>, access: { canExecute: boolean; canApprove: boolean }): NextBestActionContext {
  const { project, latestCrawl } = evidence;
  const list = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  const intelligence = project.businessProfile?.intelligenceJson && typeof project.businessProfile.intelligenceJson === "object" && !Array.isArray(project.businessProfile.intelligenceJson) ? project.businessProfile.intelligenceJson as Record<string, unknown> : {};
  const crawlText = (latestCrawl?.issues ?? []).map((issue) => `${issue.category} ${issue.message}`).join(" ").toLowerCase();
  return {
    projectId: project.id,
    primaryGoal: project.primaryGoal,
    targetMarkets: list(project.targetLocations),
    keywordGapCount: project.keywordGroups.reduce((total, group) => total + list(group.gapKeywords).length, 0),
    competitorCount: list(project.competitors).length,
    technicalIssueCount: (latestCrawl?.issues ?? []).filter((issue) => /technical|index|canonical|robot|sitemap|redirect|404|broken|link/i.test(`${issue.category} ${issue.message}`)).length,
    contentDecayCount: (crawlText.match(/outdated|stale|freshness|content decay|last updated/g) ?? []).length,
    intelligenceOpportunityTerms: [...list(intelligence.topOpportunities), ...list(intelligence.automationOpportunities), ...list(intelligence.missingContentOpportunities), ...list(intelligence.localSeoOpportunities), ...list(intelligence.aiCitationOpportunities)].slice(0, 30),
    aiReadinessScore: typeof intelligence.aiReadinessScore === "number" ? intelligence.aiReadinessScore : null,
    canExecute: access.canExecute,
    canApprove: access.canApprove,
  };
}

export function deterministicProjectPlan(evidence: Awaited<ReturnType<typeof loadProjectAgentEvidence>>, page: AgentPage, question?: string, access = { canExecute: true, canApprove: true }): ProjectAgentOutput {
  const { project, latestCrawl, keywordResearchRuns } = evidence;
  const steps = new Map(project.workflowSteps.map((step) => [step.stepKey, step]));
  const completed = project.workflowSteps.filter((step) => ["completed", "skipped"].includes(step.status)).map((step) => step.title);
  const active = project.workflowSteps.filter((step) => ["ready", "active", "in_progress", "current"].includes(step.status)).map((step) => step.title);
  const blocked = project.workflowSteps.filter((step) => step.status === "blocked").map((step) => step.blockedReason || step.title);
  const requiresCrawl = project.websiteStatus === "existing_website" || project.projectType === "existing_website";
  const selectedOpportunity = project.opportunities.find((item) => ["selected", "confirmed"].includes(item.status));
  const approvedKeywordGroups = project.keywordGroups.filter((group) => group.status === "approved");
  const approvedKeywords = approvedKeywordGroups.length > 0;
  const completedKeywordRuns = keywordResearchRuns.filter((run) => run.status === "completed");
  const activeKeywordRuns = keywordResearchRuns.filter((run) => ["queued", "running", "in_progress", "processing"].includes(run.status));
  const failedKeywordRuns = keywordResearchRuns.filter((run) => run.status === "failed");
  const keywordAnalysisComplete = completedKeywordRuns.length > 0;
  const approvedGroupIds = approvedKeywordGroups.map((group) => group.id);
  const keywordAnalysisUrl = `/keyword-insights?${project.websiteId ? `project=${encodeURIComponent(project.websiteId)}&` : ""}projectId=${encodeURIComponent(project.id)}${approvedGroupIds.length ? `&groupIds=${encodeURIComponent(approvedGroupIds.join(","))}` : ""}&add=1`;
  const latestStrategy = project.strategyPlans[0];
  const evidenceCompletesStep = (key: string) => key === "project_created" ? true
    : key === "intake" ? Boolean(project.businessProfile)
      : key === "opportunity_generation" ? project.opportunities.length > 0
        : key === "opportunity" ? Boolean(selectedOpportunity)
          : key === "keyword_groups" ? project.keywordGroups.length > 0
            : key === "keyword_approval" ? approvedKeywords
              : key === "keyword_analysis" ? keywordAnalysisComplete
        : key === "site_analysis" ? latestCrawl?.status === "completed"
          : key === "strategy" ? Boolean(latestStrategy)
            : key === "strategy_approval" ? latestStrategy?.status === "approved"
              : key === "execution_plan" ? project.executionTasks.length > 0
                : false;
  const evidenceRequiredSteps = new Set(["project_created", "intake", "opportunity_generation", "opportunity", "keyword_groups", "keyword_approval", "keyword_analysis", "site_analysis", "strategy", "strategy_approval", "execution_plan"]);
  const next = flow.find((item) => {
    if (item.key === "site_analysis" && !requiresCrawl) return false;
    // These stages require live evidence. A stale workflow flag must not skip
    // generation, approval, analysis, or plan creation.
    if (evidenceRequiredSteps.has(item.key)) return !evidenceCompletesStep(item.key);
    return !evidenceCompletesStep(item.key) && !["completed", "skipped"].includes(steps.get(item.key)?.status ?? "pending");
  }) ?? flow[flow.length - 1];
  const pendingTasks = project.executionTasks.filter((task) => !["completed", "cancelled", "skipped"].includes(task.status));
  const nextBestDecision = rankNextBestAction(project.executionTasks, nextBestActionContext(evidence, access));
  const readyTask = nextBestDecision ? project.executionTasks.find((task) => task.id === nextBestDecision.taskId) : pendingTasks.find((task) => task.dependencies.every((dependency) => ["completed", "skipped"].includes(dependency.requiredTask.status)));
  const dependencies = next.key === "execution_plan" && readyTask ? readyTask.dependencies.map((item) => item.requiredTask.title) : blocked;
  const missingInputs = [!project.businessLocation && "Business Location", !(Array.isArray(project.targetLocations) && project.targetLocations.length) && "Target Markets", !project.primaryGoal && "Primary Goal"].filter(Boolean) as string[];
  const actionTitle = next.key === "execution_plan" && readyTask ? readyTask.title : next.key === "keyword_analysis" && approvedKeywords ? activeKeywordRuns.length ? "Wait for Keyword Analysis to finish" : "Run Keyword Analysis" : next.title;
  const actionLabel = actionTitle.replace(/[.!?]+$/, "");
  const actionUrl = next.key === "execution_plan" && (nextBestDecision?.actionUrl || readyTask?.relatedUrl) ? (nextBestDecision?.actionUrl || readyTask!.relatedUrl!) : next.key === "keyword_analysis" && approvedKeywords ? keywordAnalysisUrl : next.url(project.id);
  const measuredSignals = [approvedKeywords ? "approved keyword groups" : "keyword approval pending", keywordAnalysisComplete ? `${completedKeywordRuns.length} completed keyword analysis run${completedKeywordRuns.length === 1 ? "" : "s"}` : activeKeywordRuns.length ? `${activeKeywordRuns.length} keyword analysis run${activeKeywordRuns.length === 1 ? "" : "s"} in progress` : "keyword analysis not completed", latestCrawl?.status === "completed" ? `${latestCrawl.pagesCrawled ?? 0} crawled pages` : requiresCrawl ? `site analysis ${latestCrawl?.status ?? "not started"}` : "crawl not required", project.strategyPlans[0]?.status ? `strategy ${project.strategyPlans[0].status}` : "strategy not generated", `${pendingTasks.length} pending execution tasks`];
  const normalizedQuestion = question?.toLowerCase() ?? "";
  const asksForKeywordSuggestions = /(?:suggest|recommend|generate|give|find|show|need|want).{0,70}(?:keyword|search term)|(?:keyword|search term).{0,70}(?:suggest|recommend|generate|give|find|more|add)/.test(normalizedQuestion);
  const asksForLocalKeywordSuggestions = asksForKeywordSuggestions && /local|near me|location|market|city|region|area|geo/.test(normalizedQuestion);
  const showReadinessChecklist = (page === "opportunities" && /(am i ready|readiness|what.*missing|before.*opportunit|can i (generate|start|continue)|what.*d.?o next|selected.{0,80}(what|how|next|do)|next action|block|stuck)/.test(normalizedQuestion))
    || (page === "keywords" && /(am i ready|readiness|what.*missing|can i (run|start|continue)|what.*d.?o next|i added|next action|block|stuck)/.test(normalizedQuestion));
  const scoredOpportunity = selectedOpportunity ?? project.opportunities[0];
  const offer = project.businessProfile?.offerSummary?.split(/[,;\n]/)[0]?.trim() || project.niche || "your primary service";
  const markets = Array.isArray(project.targetLocations) ? project.targetLocations.map(String).filter(Boolean) : [];
  const longTailExamples = markets.slice(0, 3).flatMap((market) => [`best ${offer} in ${market}`, `${offer} for ${project.businessProfile?.targetAudience?.split(/[,;\n]/)[0]?.trim() || "businesses"} in ${market}`]).slice(0, 5);
  const approvedKeywordTerms = approvedKeywordGroups.flatMap((group) => Array.isArray(group.keywords) ? group.keywords.map(String) : []).map((item) => item.trim()).filter(Boolean);
  const offerTerms = (project.businessProfile?.offerSummary || "").split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  const localKeywordBases = [...new Map([...offerTerms, ...approvedKeywordTerms, project.niche || ""].filter(Boolean).map((item) => [item.toLowerCase(), item])).values()]
    .filter((item) => item.split(/\s+/).length <= 7)
    .filter((item) => !/^(best|top|buy|hire|affordable|cheap)\b|\bnear me\b|\b(company|pricing)\s*$/i.test(item))
    .filter((item) => !markets.some((market) => item.toLowerCase().includes(market.toLowerCase())))
    .slice(0, 4);
  const localKeywordSuggestions = markets.slice(0, 4).flatMap((market) => localKeywordBases.slice(0, 3).map((base) => `${base.toLowerCase()} in ${market}`)).slice(0, 10);
  if (localKeywordBases[0]) {
    localKeywordSuggestions.push(`${localKeywordBases[0].toLowerCase()} near me`, `best ${localKeywordBases[0].toLowerCase()} company near me`);
  }
  const crawl404 = latestCrawl?.pages.find((item) => item.statusCode === 404) ?? latestCrawl?.issues.find((item) => /404|not found/i.test(item.message));
  const issue404 = project.executionTasks.find((task) => /404|not found|broken (page|url|link)/i.test(`${task.title} ${task.description}`));
  const completedTasks = project.executionTasks.filter((task) => ["completed", "cancelled", "skipped"].includes(task.status));
  const blockedTasks = pendingTasks.filter((task) => task.status === "blocked" || Boolean(task.blockedReason) || task.dependencies.some((dependency) => !["completed", "skipped"].includes(dependency.requiredTask.status)));
  const readyTasks = pendingTasks.filter((task) => !["blocked", "waiting_for_approval", "waiting_approval"].includes(task.status) && task.dependencies.every((dependency) => ["completed", "skipped"].includes(dependency.requiredTask.status)));
  const approvalTasks = pendingTasks.filter((task) => task.requiresApproval || task.clientApprovalRequired || ["waiting_for_approval", "waiting_approval", "needs_approval"].includes(task.status));
  const achievedMilestones = project.workflowSteps.filter((step) => ["completed", "skipped"].includes(step.status));
  const totalMilestones = project.workflowSteps.length;
  const profileMissing = [
    !project.name && "Project Name",
    !project.projectType && "Project Type",
    !project.websiteStatus && "Website Status",
    requiresCrawl && !project.websiteUrl && "Website URL",
    !project.niche && "Industry / Niche",
    !project.businessLocation && "Business Location",
    !markets.length && "Target Markets",
    !project.primaryGoal && "Primary Goal",
    !project.businessProfile?.targetAudience && "Audience",
    !project.businessProfile?.offerSummary && "Offer",
  ].filter(Boolean) as string[];
  const workflowStatus = (key: string) => steps.get(key)?.status ?? "pending";
  const milestoneComplete = (key: string) => evidenceRequiredSteps.has(key) ? evidenceCompletesStep(key) : evidenceCompletesStep(key) || ["completed", "skipped"].includes(workflowStatus(key));
  const opportunityReadiness = [
    {
      key: "project",
      label: "Project created",
      status: "complete" as const,
      detail: `${project.name} is the active project for this guidance.`,
      actionUrl: `/guided-projects/${project.id}`,
    },
    {
      key: "intake",
      label: "Intake profile",
      status: (milestoneComplete("intake") ? "complete" : "ready") as "complete" | "ready",
      detail: milestoneComplete("intake") ? "The saved business profile and intake are available." : "Complete the audience, offer, goals, location, and market context.",
      actionUrl: `/guided-projects/${project.id}/intake`,
    },
    {
      key: "readiness",
      label: "Project readiness",
      status: (milestoneComplete("readiness") ? "complete" : milestoneComplete("intake") ? "ready" : "blocked") as "complete" | "ready" | "blocked",
      detail: milestoneComplete("readiness") ? "Required project information has been confirmed." : milestoneComplete("intake") ? "Review and confirm the required project details." : "Waiting for the intake profile.",
      actionUrl: `/guided-projects/${project.id}`,
    },
    {
      key: "opportunities",
      label: "Opportunity recommendations",
      status: (project.opportunities.length ? "complete" : milestoneComplete("readiness") ? "ready" : "blocked") as "complete" | "ready" | "blocked",
      detail: project.opportunities.length ? `${project.opportunities.length} project-specific direction${project.opportunities.length === 1 ? " is" : "s are"} available.` : milestoneComplete("readiness") ? "Ready to generate from the confirmed intake." : "Waiting for project readiness.",
      actionUrl: `/opportunities?projectId=${project.id}#opportunity-options`,
    },
    {
      key: "selection",
      label: "Opportunity direction",
      status: (selectedOpportunity ? "complete" : project.opportunities.length ? "ready" : "blocked") as "complete" | "ready" | "blocked",
      detail: selectedOpportunity ? `“${selectedOpportunity.name}” is the active direction.` : project.opportunities.length ? "Compare the recommendations and select one direction." : "Generate recommendations before selecting a direction.",
      actionUrl: `/opportunities?projectId=${project.id}#opportunity-options`,
    },
  ];
  const keywordReadiness = [
    {
      key: "opportunity",
      label: "Opportunity direction",
      status: (selectedOpportunity ? "complete" : "blocked") as "complete" | "blocked",
      detail: selectedOpportunity ? `“${selectedOpportunity.name}” supplies the active search direction.` : "Select an opportunity before finalizing keyword direction.",
      actionUrl: `/opportunities?projectId=${project.id}#opportunity-options`,
    },
    {
      key: "groups",
      label: "Keyword groups",
      status: (project.keywordGroups.length ? "complete" : selectedOpportunity ? "ready" : "blocked") as "complete" | "ready" | "blocked",
      detail: project.keywordGroups.length ? `${project.keywordGroups.length} project-specific group${project.keywordGroups.length === 1 ? " is" : "s are"} available.` : "Generate keyword groups from the selected direction and intake.",
      actionUrl: `/keywords?projectId=${project.id}`,
    },
    {
      key: "approval",
      label: "Approved keyword direction",
      status: (approvedKeywords ? "complete" : project.keywordGroups.length ? "ready" : "blocked") as "complete" | "ready" | "blocked",
      detail: approvedKeywords ? `${approvedKeywordGroups.length} group${approvedKeywordGroups.length === 1 ? " is" : "s are"} approved for research.` : "Review the recommendations and approve at least one useful group.",
      actionUrl: `/keywords?projectId=${project.id}`,
    },
    {
      key: "analysis",
      label: "Keyword Analysis",
      status: (keywordAnalysisComplete ? "complete" : activeKeywordRuns.length ? "pending" : approvedKeywords ? "ready" : "blocked") as "complete" | "pending" | "ready" | "blocked",
      detail: keywordAnalysisComplete ? `${completedKeywordRuns.length} completed run${completedKeywordRuns.length === 1 ? "" : "s"} provide demand, competition, CPC, ranking, and SERP evidence.` : activeKeywordRuns.length ? `${activeKeywordRuns.length} run${activeKeywordRuns.length === 1 ? " is" : "s are"} currently being processed.` : approvedKeywords ? "Ready to analyze the approved keywords and target markets." : "Approve a keyword group before running analysis.",
      actionUrl: approvedKeywords ? keywordAnalysisUrl : `/keywords?projectId=${project.id}`,
    },
  ];
  const readinessChecklist = page === "opportunities"
    ? opportunityReadiness
    : page === "keywords"
      ? keywordReadiness
    : flow.map((item) => ({
        key: item.key,
        label: item.title,
        status: (milestoneComplete(item.key) ? "complete" : workflowStatus(item.key) === "ready" ? "ready" : workflowStatus(item.key) === "blocked" ? "blocked" : "pending") as "complete" | "ready" | "blocked" | "pending",
        detail: steps.get(item.key)?.completionReason || steps.get(item.key)?.readyReason || `Status: ${workflowStatus(item.key).replaceAll("_", " ")}.`,
        actionUrl: item.url(project.id),
      }));
  const preExecutionJourney = flow.map((item) => {
    const notRequired = item.key === "site_analysis" && !requiresCrawl;
    const isComplete = notRequired || milestoneComplete(item.key);
    const isCurrent = !isComplete && item.key === next.key;
    return { ...item, status: notRequired ? "not_required" as const : isComplete ? "complete" as const : isCurrent ? "current" as const : "pending" as const };
  });
  let answer = `The next recommended activity is ${actionLabel}. ${next.key === "execution_plan" && readyTask ? `${nextBestDecision?.reason ?? "It is dependency-ready and has the highest current priority."} Expected outcome: ${nextBestDecision?.expectedOutcome || readyTask.expectedOutcome || readyTask.description}` : "It is the first incomplete workflow dependency."}`;
  if (page === "opportunities" && /(am i ready|readiness|what.*missing|before.*opportunit|can i (generate|start|continue))/.test(normalizedQuestion)) {
    const incomplete = opportunityReadiness.filter((item) => item.status !== "complete");
    const nextCheck = incomplete[0];
    answer = nextCheck
      ? `${project.name} is ${["blocked", "pending"].includes(nextCheck.status) ? "not ready yet" : `ready for ${nextCheck.label.toLowerCase()}`}. ${opportunityReadiness.filter((item) => item.status === "complete").length} of ${opportunityReadiness.length} Opportunity Finder checks are complete. Your next action is ${nextCheck.label}: ${nextCheck.detail}`
      : `${project.name} is ready. The intake, readiness checks, recommendations, and opportunity selection are complete. Continue to Keyword Intelligence using the selected direction.`;
  }
  else if (page === "opportunities" && selectedOpportunity && /((now|already|have|just).{0,24}selected.*(what|how|next))|(selected.{0,80}(what|how|next|do))|(what.*(after|next).*(select|opportunit))|(how.*(continue|proceed))|(next action)|(what should i d.?o next)/.test(normalizedQuestion)) {
    answer = [
      `“${selectedOpportunity.name}” is now the active project direction (${selectedOpportunity.opportunityScore ?? "unscored"}/100).`,
      `Next action: Open Keyword Intelligence.`,
      `How to continue:`,
      `1. Review the keyword groups generated from the selected opportunity, audience, offer, Primary Goal, and Target Markets (${markets.join(", ") || "not set"}).`,
      `2. Edit or remove irrelevant keywords and add any important manual keywords.`,
      `3. Approve at least one useful keyword group. Strategy cannot proceed without an approved group.`,
      `4. Start Keyword Analysis to collect demand, difficulty, CPC, intent, rankings, competitors, and page-target evidence.`,
      requiresCrawl ? `5. After keyword analysis, run Site Analysis for ${project.websiteUrl || "the connected website"}; then generate Strategy.` : `5. This project does not require an existing-site crawl, so generate Strategy after keyword approval and analysis.`,
      `The selected opportunity supplies planning context only. No website, publishing, email, integration, or external account is changed.`,
    ].join("\n");
  }
  else if (page === "opportunities" && /(which|best|select|choose).*(opportunit|direction)|(opportunit|direction).*(which|best|select|choose)/.test(normalizedQuestion)) {
    const candidates = project.opportunities.slice(0, 3);
    answer = selectedOpportunity
      ? `The active direction is “${selectedOpportunity.name}” (${selectedOpportunity.opportunityScore ?? "unscored"}/100). It currently best anchors downstream Keyword Intelligence and Strategy. Refresh or change it only when the intake evidence has materially changed.`
      : candidates.length
        ? [`Compare these saved directions against ${project.primaryGoal || "the Primary Goal"}:`, ...candidates.map((item, index) => `${index + 1}. ${item.name} — ${item.opportunityScore ?? "unscored"}/100 overall; SEO ${item.seoScore ?? "n/a"}; revenue ${item.monetizationScore ?? "n/a"}; user fit ${item.userFitScore ?? "n/a"}.`), `Start with ${candidates[0].name}, then confirm its audience, offer, effort, and evidence before selecting it.`].join("\n")
        : `No opportunity recommendations exist yet. Complete the readiness checklist, then generate project-specific directions before comparing or selecting one.`;
  }
  else if (page === "opportunities" && /(what.*after|after.*select|next.*after).*(opportunit|direction|selection)/.test(normalizedQuestion)) {
    answer = selectedOpportunity
      ? `“${selectedOpportunity.name}” is selected. Next, open Keyword Intelligence to approve the keyword direction. Because this is ${requiresCrawl ? "an existing-website project, Site Analysis follows keyword approval before Strategy" : "a project without a required existing-site crawl, Strategy can follow keyword approval"}. Nothing will be published or changed externally from this selection.`
      : `After you select an opportunity, it becomes the active direction for Keyword Intelligence, Site Analysis context, Strategy, and the Execution Plan. Selection changes project planning only; it does not publish, email, buy, schedule, or modify an external system.`;
  }
  else if (/(list|show|what).{0,30}(activit|step|workflow|process).{0,30}(execution|task|plan)|before.{0,20}(execution|task)|pre.?execution|full.{0,20}activity list|activity.{0,20}journey|project.{0,20}(journey|workflow|process)/.test(normalizedQuestion)) {
    answer = [
      `${project.name} pre-execution activity journey:`,
      ...preExecutionJourney.map((item, index) => `${index + 1}. ${item.status === "complete" ? "✓" : item.status === "current" ? "→" : item.status === "not_required" ? "–" : "○"} ${item.title}${item.status === "current" ? " — next activity" : item.status === "not_required" ? " — not required for this website status" : ""}`),
      project.executionTasks.length
        ? `The Execution Plan is available with ${pendingTasks.length} unfinished task${pendingTasks.length === 1 ? "" : "s"}. After the pre-execution journey, SEnuke recommends the highest-priority task whose dependencies and approvals are satisfied.`
        : `After Strategy approval, SEnuke creates or synchronizes the Execution Plan, then recommends the highest-priority dependency-ready task.`,
    ].join("\n");
  }
  else if ((page === "keywords" || page === "keyword-insights") && asksForLocalKeywordSuggestions) {
    answer = localKeywordSuggestions.length && markets.length
      ? [
          `Here are project-specific Local SEO keyword candidates based on ${project.name}’s saved offers and Target Markets (${markets.join(", ")}):`,
          ...localKeywordSuggestions.map((keyword, index) => `${index + 1}. ${keyword}`),
          `Add only the phrases that accurately describe the offer and intended landing page. Put them in Local Keywords or the closest relevant group, remove duplicates, and keep each city phrase as a separate keyword.`,
          `These are starting candidates, not measured results. After saving them, run Keyword Analysis to validate demand, difficulty, CPC, rankings, competitors, and page fit by market.`,
        ].join("\n")
      : `I need both a clear saved offer and at least one Target Market before suggesting useful Local SEO keywords. Add those project details first; then I can create city-, region-, and “near me”-style candidates without inventing locations.`;
  }
  else if (page === "keywords" && /(can|could|will) you add|add (these|them).*(keyword|list)|put (these|them).*(keyword|group)/.test(normalizedQuestion)) {
    answer = approvedKeywords
      ? `I can help you evaluate and organize keywords, but this guidance chat does not silently change saved project data. On this page, use Add Keyword inside the appropriate group, review the updated group, and keep it approved. Once the keywords are saved, the next step is Start Keyword Analysis so SEnuke can measure demand, difficulty, CPC, intent, rankings, competitors, and page-target opportunities for each selected market.`
      : `I can help you evaluate and organize keywords, but this guidance chat does not silently change saved project data. Add the keywords to the most relevant group on this page, review them, and approve at least one useful group. The next step will then be Start Keyword Analysis.`;
  }
  else if (page === "keywords" && /(i|we).{0,18}(added|saved|approved|selected).{0,60}(what|next|now|do)|what.*(do|happen).{0,20}(next|after)|next action|where.*next/.test(normalizedQuestion)) {
    answer = !approvedKeywords
      ? `The saved keyword groups still need an approved direction. Review the groups, remove irrelevant terms, add any missing keywords, and approve at least one group. Keyword Analysis is available only after that approval.`
      : activeKeywordRuns.length
        ? `Your keywords are saved and Keyword Analysis is already running for ${activeKeywordRuns.length} queued or active run${activeKeywordRuns.length === 1 ? "" : "s"}. You can leave this page and continue working; use the background status strip or Refresh Status to check progress. When the run completes, ask me to explain the analysis and I’ll use the saved demand, CPC, difficulty, ranking, location, and competitor evidence.`
        : keywordAnalysisComplete
          ? `Keyword Analysis is complete: ${completedKeywordRuns.length} saved run${completedKeywordRuns.length === 1 ? "" : "s"} across ${new Set(completedKeywordRuns.map((run) => run.locationName)).size} market${new Set(completedKeywordRuns.map((run) => run.locationName)).size === 1 ? "" : "s"}. Review which keywords combine relevant intent, useful demand, attainable competition, and a clear page target. ${requiresCrawl ? "Then continue to Site Analysis so the approved search direction can be compared with the existing website." : "This project does not require a crawl, so continue to Strategy after reviewing the analysis."}`
          : `Your keyword direction is approved, but research has not been run yet. Click Start Keyword Analysis. It will analyze the approved keywords by target market and collect demand, difficulty, CPC, intent, rankings, SERP competitors, and page-target evidence. Approval alone does not complete this step.`;
  }
  else if ((page === "keywords" || page === "keyword-insights") && /(explain|summari[sz]e|interpret|what.*(mean|show|find|result)|how.*perform).*(keyword|analysis|research|result)|(keyword|analysis|research|result).*(explain|mean|show|find|perform)/.test(normalizedQuestion)) {
    if (!keywordAnalysisComplete) {
      answer = activeKeywordRuns.length
        ? `Keyword Analysis is still running for ${activeKeywordRuns.length} run${activeKeywordRuns.length === 1 ? "" : "s"}. Results are not final yet. Refresh the status after completion, then ask again and I’ll explain the saved demand, CPC, competition, rankings, locations, and competitors.`
        : failedKeywordRuns.length
          ? `There is no completed Keyword Analysis to explain. ${failedKeywordRuns.length} run${failedKeywordRuns.length === 1 ? "" : "s"} failed; review the keyword and location, then retry the analysis. Saved keyword groups remain available and do not need to be recreated.`
          : approvedKeywords
            ? `There is no completed Keyword Analysis yet. The groups are approved, so click Start Keyword Analysis first. Once it finishes, I can explain the actual demand, difficulty, CPC, rankings, locations, competitors, and page opportunities.`
            : `There is no completed Keyword Analysis yet. Approve at least one useful keyword group, then start the analysis.`;
    } else {
      const uniqueSeeds = [...new Set(completedKeywordRuns.map((run) => run.seedKeyword))];
      const uniqueMarkets = [...new Set(completedKeywordRuns.map((run) => run.locationName))];
      const rankedRuns = completedKeywordRuns.filter((run) => typeof run.targetRank === "number");
      const volumes = completedKeywordRuns.map((run) => run.averageVolume).filter((value): value is number => typeof value === "number");
      const avgVolume = volumes.length ? Math.round(volumes.reduce((sum, value) => sum + value, 0) / volumes.length) : null;
      const topIdeas = [...new Map(completedKeywordRuns.flatMap((run) => run.ideas).filter((idea) => idea.keyword).map((idea) => [idea.keyword.toLowerCase(), idea])).values()]
        .sort((a, b) => (b.avgMonthlySearches ?? 0) - (a.avgMonthlySearches ?? 0))
        .slice(0, 5);
      const topCompetitors = [...new Set(completedKeywordRuns.flatMap((run) => run.competitors.map((competitor) => competitor.domain)))].slice(0, 5);
      answer = [
        `${project.name} has ${completedKeywordRuns.length} completed Keyword Analysis run${completedKeywordRuns.length === 1 ? "" : "s"}, covering ${uniqueSeeds.length} analyzed keyword${uniqueSeeds.length === 1 ? "" : "s"} across ${uniqueMarkets.length} market${uniqueMarkets.length === 1 ? "" : "s"}: ${uniqueMarkets.join(", ")}.`,
        `Visibility: the project domain was found for ${rankedRuns.length} of ${completedKeywordRuns.length} runs${rankedRuns.length ? `; best recorded position is ${Math.min(...rankedRuns.map((run) => run.targetRank!))}` : "; no tracked ranking was found within the configured depth"}.`,
        `Demand: ${avgVolume === null ? "the provider did not return a usable average search-volume figure" : `average saved search volume is ${avgVolume}`}. Treat zero or missing provider values as unavailable evidence, not proof that nobody searches for the term.`,
        topIdeas.length ? `Highest-demand saved ideas: ${topIdeas.map((idea) => `${idea.keyword}${typeof idea.avgMonthlySearches === "number" ? ` (${idea.avgMonthlySearches})` : ""}`).join("; ")}.` : "No related keyword ideas were stored by the provider.",
        topCompetitors.length ? `Recurring SERP competitors include ${topCompetitors.join(", ")}. Compare their page intent, coverage, trust signals, and content depth before choosing page targets.` : "No detailed SERP competitor profiles were stored.",
        requiresCrawl ? `Next: prioritize relevant, attainable keywords with clear page intent, then open Site Analysis to compare them against ${project.websiteUrl || "the existing website"}.` : "Next: prioritize relevant, attainable keywords with clear page intent, then continue to Strategy.",
      ].join("\n");
    }
  }
  else if (/how is (the )?project progress calculated|what.*progress.*mean|progress calculation/.test(normalizedQuestion)) {
    const workflowRatio = totalMilestones ? achievedMilestones.length / totalMilestones : 0;
    const executionRatio = project.executionTasks.length ? completedTasks.length / project.executionTasks.length : 0;
    answer = `Project progress combines two equally weighted measures: workflow/setup milestones contribute 50%, and completed Execution Plan tasks contribute 50%. ${project.name} currently has ${achievedMilestones.length} of ${totalMilestones} milestones achieved and ${completedTasks.length} of ${project.executionTasks.length} tasks completed, producing an overall progress of ${Math.round((workflowRatio * 50) + (executionRatio * 50))}%.`;
  }
  else if (/profile.*complete|intake.*complete|profile fields need|fields.*improve|information.*missing/.test(normalizedQuestion)) {
    answer = profileMissing.length
      ? `${project.name} still needs ${profileMissing.join(", ")}. Complete these values before relying on downstream Opportunity, Keyword, Site Analysis, and Strategy recommendations. Existing Website projects must also keep a valid Website URL.`
      : `${project.name} has the core profile information required for downstream recommendations: website status, niche, Business Location, Target Markets, Primary Goal, Audience, and Offer. Optional competitors, secondary goals, brand voice, analytics, and CMS details can make recommendations more specific.`;
  }
  else if (/how.*target markets.*used|what.*target markets|why.*target markets/.test(normalizedQuestion)) {
    answer = `${project.name} currently targets ${markets.length ? markets.join(", ") : "no saved markets"}. Target Markets control local and regional keyword variants, competitor discovery, content and landing-page planning, Local SEO recommendations, Strategy priorities, and Execution Plan tasks. They remain separate from Business Location, which represents the company’s physical identity.`;
  }
  else if (/what.*refresh.*(edit|change).*profile|refresh.*profile|edit.*profile.*affect|change.*profile.*affect/.test(normalizedQuestion)) {
    answer = `Profile changes affect the modules that consume the edited field. Changes to Audience, Offer, Goals, Target Markets, competitors, niche, or website status should trigger a review of Opportunities and Keyword Intelligence; if a Strategy is already approved, it should be regenerated before relying on its Execution Plan. Changing an Agency project override does not update the Client record unless Update Client is explicitly selected.`;
  }
  else if (/how many tasks|tasks.*(ready|blocked|completed)|ready.*blocked.*completed/.test(normalizedQuestion)) {
    answer = `${project.name} has ${project.executionTasks.length} Execution Plan tasks: ${completedTasks.length} completed, ${readyTasks.length} dependency-ready, ${blockedTasks.length} blocked, ${approvalTasks.length} requiring or waiting for approval, and ${pendingTasks.length} total unfinished. Counts come from tasks created across Strategy, Keyword Intelligence, Site Analysis, and other project modules.`;
  }
  else if (/which tasks.*approval|what.*requires approval|tasks require approval/.test(normalizedQuestion)) {
    answer = approvalTasks.length
      ? `${approvalTasks.length} unfinished task${approvalTasks.length === 1 ? " requires" : "s require"} approval: ${approvalTasks.slice(0, 5).map((task) => task.title).join("; ")}${approvalTasks.length > 5 ? `; and ${approvalTasks.length - 5} more` : ""}. Protected work cannot execute until the applicable Owner/Admin, Manager/Approver, or requested Agency client approves it.`
      : `No unfinished ${project.name} task currently requires approval. Tasks can still become approval-required when they affect publishing, live websites, client deliverables, integrations, or other protected actions.`;
  }
  else if (/current (position|status|stage)|where (is|are) (the )?project|project.*(position|status|stage)/.test(normalizedQuestion)) {
    answer = `${project.name} has achieved ${achievedMilestones.length} of ${totalMilestones || flow.length} workflow milestones and completed ${completedTasks.length} of ${project.executionTasks.length} Execution Plan tasks. ${active.length ? `The active workflow stage is ${active.join(", ")}.` : `The next incomplete workflow stage is ${next.title}.`} ${pendingTasks.length ? `${pendingTasks.length} execution tasks remain open${blockedTasks.length ? `, including ${blockedTasks.length} blocked by status or dependencies` : ""}.` : "There are no open execution tasks."} The next dependency-ready action is ${actionLabel}.`;
  }
  else if (/what.*block|blocker|blocking (this|the) project|why.*stuck|cannot proceed|can.t proceed/.test(normalizedQuestion)) {
    const workflowBlockers = project.workflowSteps.filter((step) => step.status === "blocked").map((step) => step.blockedReason || step.title);
    const taskBlockers = blockedTasks.slice(0, 5).map((task) => task.blockedReason || `${task.title}${task.dependencies.length ? ` depends on ${task.dependencies.filter((dependency) => !["completed", "skipped"].includes(dependency.requiredTask.status)).map((dependency) => dependency.requiredTask.title).join(", ")}` : " is marked blocked"}`);
    const allBlockers = [...workflowBlockers, ...taskBlockers];
    answer = allBlockers.length
      ? `${project.name} has ${allBlockers.length} identified blocker${allBlockers.length === 1 ? "" : "s"}: ${allBlockers.join("; ")}. Resolve the first unmet dependency before starting dependent work. The next currently ready action is ${readyTask?.title || next.title}.`
      : `${project.name} has no recorded workflow or task blockers. ${pendingTasks.length ? `${pendingTasks.length} tasks remain open, but they are pending work rather than blocked.` : "No execution tasks remain open."} The next recommended action is ${actionLabel}.`;
  }
  else if (/summari[sz]e.*progress|project progress|progress summary|what.*completed|how much.*done/.test(normalizedQuestion)) {
    const completedNames = achievedMilestones.slice(-3).map((step) => step.title);
    const list = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    const targets = list(project.targetLocations);
    const secondaryGoals = list(project.secondaryGoals);
    const approvedGroups = project.keywordGroups.filter((group) => group.status === "approved");
    const approvedKeywordCount = approvedGroups.reduce((total, group) => total + list(group.keywords).length, 0);
    const selectedDirection = project.opportunities.find((item) => ["selected", "confirmed"].includes(item.status));
    const taskStatusCounts = project.executionTasks.reduce<Record<string, number>>((counts, task) => ({ ...counts, [task.status]: (counts[task.status] ?? 0) + 1 }), {});
    answer = [
      `${project.name} — project progress summary`,
      `Project: ${project.projectType.replaceAll("_", " ")}; ${project.websiteStatus.replaceAll("_", " ")}${project.websiteUrl ? ` at ${project.websiteUrl}` : ""}.`,
      `Business: ${project.businessName || project.name}${project.niche ? ` in ${project.niche}` : ""}. Location: ${project.businessLocation || "not set"}. Target markets: ${targets.join(", ") || "not set"}.`,
      `Goals: ${project.primaryGoal || "not set"}${secondaryGoals.length ? `. Secondary goals: ${secondaryGoals.join(", ")}` : ""}.`,
      selectedDirection ? `Opportunity: “${selectedDirection.name}” is selected with a ${selectedDirection.opportunityScore}/100 score.` : "Opportunity: no direction has been selected.",
      approvedGroups.length ? `Keywords: ${approvedGroups.length} approved groups (${approvedGroups.map((group) => group.title).join(", ")}) containing ${approvedKeywordCount} saved keywords.` : "Keywords: no keyword groups are approved.",
      latestCrawl?.status === "completed" ? `Site Analysis: complete; ${latestCrawl.pagesCrawled ?? 0} pages crawled, health score ${latestCrawl.siteScore ?? "not scored"}/100, and ${latestCrawl._count.issues} issues recorded by the latest crawl.` : requiresCrawl ? `Site Analysis: ${latestCrawl?.status ?? "not started"}.` : "Site Analysis: not required for this website status.",
      latestStrategy ? `Strategy: version ${latestStrategy.version} is ${latestStrategy.status}.` : "Strategy: not generated.",
      `Workflow: ${achievedMilestones.length} of ${totalMilestones || flow.length} milestones achieved${completedNames.length ? `; latest achievements: ${completedNames.join(", ")}` : ""}.`,
      `Execution: ${completedTasks.length} finished and ${pendingTasks.length} open tasks${Object.keys(taskStatusCounts).length ? ` (${Object.entries(taskStatusCounts).map(([status, count]) => `${count} ${status.replaceAll("_", " ")}`).join(", ")})` : ""}${blockedTasks.length ? `; ${blockedTasks.length} blocked by status or dependency` : ""}.`,
      `Next action: ${actionLabel}.`,
    ].join("\n");
  }
  else if (/(how many|number of|total).*(pending|open|remaining|unfinished).*(task|item)|(pending|open|remaining|unfinished).*(task|item).*(how many|number of|total)|how many tasks/.test(normalizedQuestion)) {
    const countStatus = (statuses: string[]) => project.executionTasks.filter((task) => statuses.includes(task.status)).length;
    const finishedCount = countStatus(["completed", "cancelled", "skipped"]);
    const inProgressCount = countStatus(["in_progress"]);
    const approvalCount = countStatus(["waiting_for_approval", "pending_approval"]);
    const explicitlyBlockedCount = countStatus(["blocked"]);
    const readyCount = countStatus(["ready"]);
    const pendingCount = project.executionTasks.length - finishedCount;
    answer = [
      `${project.name} has ${project.executionTasks.length} total Execution Plan tasks.`,
      `${pendingCount} pending or unfinished.`,
      `${finishedCount} finished, cancelled, or skipped.`,
      `${readyCount} ready to start.`,
      `${inProgressCount} in progress.`,
      `${approvalCount} waiting for approval.`,
      `${explicitlyBlockedCount} explicitly blocked.`,
      pendingCount ? `Next ready task: ${readyTask?.title?.replace(/[.!?]+$/, "") || actionLabel}.` : "There are no pending tasks.",
    ].join("\n");
  }
  else if (/(which|what).*(three|3|top).*(task|action).*(prioriti|first)|(prioriti[sz]e|recommend).*(three|3|top).*(task|action)|(target market|approved keyword|crawl problem).*(task|prioriti)/.test(normalizedQuestion)) {
    const priorityWeight: Record<string, number> = { critical: 40, high: 30, medium: 20, low: 10 };
    const topicWeight = (task: typeof project.executionTasks[number]) => {
      const text = `${task.moduleName} ${task.sourceType} ${task.title} ${task.description}`.toLowerCase();
      return [
        /crawl|site|404|broken|technical/.test(text) && /crawl|site|404|problem/.test(normalizedQuestion),
        /keyword|search|ranking|content/.test(text) && /keyword|search|target market/.test(normalizedQuestion),
        /strategy|conversion|lead|opportunit/.test(text) && /strategy|goal|opportunit/.test(normalizedQuestion),
      ].filter(Boolean).length * 12;
    };
    const candidates = pendingTasks
      .filter((task) => task.dependencies.every((dependency) => ["completed", "skipped"].includes(dependency.requiredTask.status)))
      .sort((a, b) => (priorityWeight[b.priority] ?? 0) + topicWeight(b) - ((priorityWeight[a.priority] ?? 0) + topicWeight(a)));
    const selected: typeof candidates = [];
    for (const task of candidates) {
      if (selected.length >= 3) break;
      if (!selected.some((item) => item.moduleName === task.moduleName)) selected.push(task);
    }
    for (const task of candidates) {
      if (selected.length >= 3) break;
      if (!selected.some((item) => item.id === task.id)) selected.push(task);
    }
    answer = selected.length ? [
      `Based on ${project.name}’s selected direction, approved keyword groups, latest crawl, approved Strategy, task priority, and resolved dependencies, prioritize:`,
      ...selected.map((task, index) => `${index + 1}. ${task.title.replace(/[.!?]+$/, "")} — ${task.expectedOutcome || task.impact || task.description} (${task.priority} priority; source: ${task.moduleName.replaceAll("_", " ")}).`),
      `These are ready now. I excluded tasks with unresolved dependencies and recommend completing them in this order unless an assigned due date or approval changes their urgency.`,
    ].join("\n") : "No dependency-ready Execution Plan tasks are available. Review blocked tasks and approvals before choosing the next three actions.";
  }
  else if (/(opportunit|selected).*(score|percent)|(increase|improve|raise|change).{0,30}score|score.*opportunit|\b(72|80|88)%?\b/.test(normalizedQuestion)) {
    const scoreParts = [
      ["SEO potential", scoredOpportunity?.seoScore], ["revenue potential", scoredOpportunity?.monetizationScore],
      ["competition opportunity", scoredOpportunity?.competitionScore], ["speed to execution", scoredOpportunity?.executionScore],
      ["user fit", scoredOpportunity?.userFitScore],
    ] as [string, number | null | undefined][];
    const weakest = scoreParts.filter((item): item is [string, number] => typeof item[1] === "number").sort((a, b) => a[1] - b[1]).slice(0, 2);
    const target = normalizedQuestion.match(/(?:to|target|reach)\s*(\d{2,3})/)?.[1] ?? "88";
    answer = `You cannot directly set the selected opportunity score to ${target}; it must be recalculated from stronger project evidence. The current score is ${scoredOpportunity?.opportunityScore ?? "not available"}/100${weakest.length ? `, with the weakest signals being ${weakest.map(([label, value]) => `${label} (${value}/100)`).join(" and ")}` : ""}. Improve the saved audience and offer, add evidence-backed competitors, confirm specific target markets, strengthen buyer-intent keywords, and make the delivery plan more realistic. Then use Ask AI to Refine or Refresh Opportunities. Reaching ${target} is not guaranteed—the new score must reflect the updated evidence.`;
  }
  else if (/404|not found page|broken page/.test(normalizedQuestion)) answer = issue404 ? `A matching saved task was found: “${issue404.title}”. Review the affected URL, decide whether to restore it, redirect it to the closest relevant live page, or remove the broken reference, then complete the task after verification.` : crawl404 ? `Site Analysis found a matching 404: ${"url" in crawl404 ? crawl404.url : crawl404.page?.url || crawl404.message}. Restore the page if it should exist, otherwise 301 redirect it to the closest relevant live page and remove broken internal or sitemap references.` : "No saved 404 was found in the latest analysis. Run or refresh Site Analysis first; then choose restore, redirect, or removal based on whether the page should still exist.";
  else if (asksForKeywordSuggestions || /long.?tail|good keyword|is this keyword|add.+keyword/.test(normalizedQuestion)) answer = longTailExamples.length ? `Keyword advice should be checked against the project goal, buyer intent, target market, duplication, search demand, difficulty, and page fit. Project-aware long-tail starting points include: ${longTailExamples.join("; ")}. Preview and analyze them before approval.` : `Add Target Markets and a clear offer first so the agent can create useful local and long-tail keywords. A keyword is only “good” when its intent, relevance, attainable difficulty, and page target support ${project.primaryGoal || "the primary goal"}.`;
  else if (/strategy|positioning|content plan|seo plan/.test(normalizedQuestion)) answer = project.strategyPlans[0] ? `The latest Strategy is version ${project.strategyPlans[0].version} and is ${project.strategyPlans[0].status}. It should be judged against the approved opportunity, keyword groups, latest Site Analysis, goals, target markets, competitors, KPIs, and whether every approved recommendation maps to a non-duplicate Execution Plan task.` : "No Strategy exists yet. Complete intake, select an opportunity, approve keyword direction, and finish Site Analysis for an existing website before generating it.";
  else if (/execution|task|what.*do next|dependency|blocked/.test(normalizedQuestion)) answer = readyTask ? `The Next Best Action is “${readyTask.title}” (${nextBestDecision?.score ?? readyTask.priority}${nextBestDecision ? "/100 decision score" : " priority"}). ${nextBestDecision?.reason ?? "It is dependency-ready."} Expected outcome: ${nextBestDecision?.expectedOutcome || readyTask.expectedOutcome || readyTask.description}${nextBestDecision && !nextBestDecision.actionable ? " You have read-only access to this action; a permitted workspace member must execute or approve it." : ""}` : pendingTasks.length ? `There are ${pendingTasks.length} unfinished tasks, but their dependencies or approval state must be reviewed before execution.` : "There are no pending Execution Plan tasks. Generate or approve the Strategy, or review whether completed module recommendations have been synchronized.";
  else if (/site analysis|crawl|technical seo|site health|issue/.test(normalizedQuestion)) answer = latestCrawl ? `The latest Site Analysis is ${latestCrawl.status}${latestCrawl.siteScore !== null ? ` with a health score of ${latestCrawl.siteScore}/100` : ""}, ${latestCrawl.pagesCrawled} pages crawled, and ${latestCrawl.issues.length} high-priority open issues loaded for agent guidance. Start with issues having the greatest impact, then review and fix them through the Execution Plan.` : requiresCrawl ? "This existing-website project has no Site Analysis yet. Run the crawl before relying on Strategy predictions." : "This project does not require a crawl. Strategy can use intake and approved keywords without Site Analysis.";
  const nextReason = next.key === "opportunity_generation"
    ? "The confirmed intake is ready to produce project-specific directions."
    : next.key === "opportunity"
    ? selectedOpportunity ? "The project direction is selected and ready for downstream research." : project.opportunities.length ? "Recommendations exist and one direction must be selected." : "The intake is ready to generate project-specific opportunity directions."
    : next.key === "keyword_groups"
      ? "The selected opportunity can now be translated into intent-based and market-aware keyword groups."
    : next.key === "keyword_approval"
      ? "Keyword groups exist, but at least one useful direction must be reviewed and approved."
    : next.key === "keyword_analysis" && selectedOpportunity
      ? `“${selectedOpportunity.name}” is selected, so Keyword Intelligence can now build and validate the search direction.`
    : next.key === "execution_plan" && readyTask ? (nextBestDecision?.reason || readyTask.expectedOutcome || readyTask.description) : "This is the first incomplete dependency in the project workflow.";
  const nextOutcome = next.key === "opportunity_generation"
    ? "Create ranked opportunity directions from the confirmed intake."
    : next.key === "opportunity"
    ? selectedOpportunity ? "Continue to Keyword Intelligence using the selected direction." : "Set the active direction used by Keyword Intelligence, Strategy, and the Execution Plan."
    : next.key === "keyword_groups"
      ? "Create editable keyword groups from the opportunity, audience, offer, goals, and Target Markets."
    : next.key === "keyword_approval"
      ? "Confirm at least one relevant keyword direction before collecting search evidence."
    : next.key === "keyword_analysis" && selectedOpportunity
      ? "Review project-specific keyword groups, approve the useful direction, and run analysis before Site Analysis and Strategy."
    : nextBestDecision?.expectedOutcome || readyTask?.expectedOutcome || `Move the project safely to the next workflow milestone.`;
  const followUpQuestions = page === "keywords" || page === "keyword-insights"
    ? asksForLocalKeywordSuggestions
      ? ["Which of these should go in Local Keywords?", "Should I create a page for each target market?", "How do I avoid duplicate local keywords?", "Which local keywords should I analyze first?"]
    : activeKeywordRuns.length
      ? ["What happens while Keyword Analysis is running?", "How will I know when it finishes?", "Why are target markets analyzed separately?"]
      : keywordAnalysisComplete
        ? ["Explain my latest Keyword Analysis", "Which analyzed keywords should I prioritize?", "What competitor gaps did the analysis find?", requiresCrawl ? "Am I ready for Site Analysis?" : "Am I ready to generate Strategy?"]
        : approvedKeywords
          ? ["Which approved keywords should I analyze first?", "How are Target Markets applied during analysis?", "What will Keyword Analysis measure?"]
          : ["Which keyword groups should I approve?", "Suggest project-specific long-tail keywords", "How should I use Target Markets in keywords?"]
    : page === "opportunities"
      ? selectedOpportunity
        ? ["Why does this opportunity fit the project?", "How does it affect Keyword Intelligence?", "What evidence could improve its score?"]
        : ["Which opportunity should I select and why?", "How are opportunity scores calculated?", "What happens after I select one?"]
      : [`Why is “${actionLabel}” the next step?`, "What evidence supports this recommendation?", "What could block the next step?", "Show me the full pre-execution activity list"];
  return {
    projectId: project.id,
    page,
    answer,
    summary: `${project.name} is at ${next.title}. Guidance is based on ${measuredSignals.join(", ")}.`,
    currentState: { completed, active, blocked },
    readinessChecklist,
    presentation: { showReadinessChecklist },
    followUpQuestions,
    nextPlannedActivity: { title: actionTitle, reason: nextReason, module: next.page, actionUrl, priority: (readyTask?.priority as "critical" | "high" | "medium" | "low") || "high", expectedOutcome: nextOutcome, dependencies, blocked: dependencies.length > 0, score: nextBestDecision?.score, confidence: nextBestDecision?.confidence, signals: nextBestDecision?.signals },
    suggestions: [{ title: actionTitle, reason: nextBestDecision?.reason || "It is the highest-priority dependency-ready action.", impact: nextBestDecision?.expectedOutcome || readyTask?.impact || "Advances the project workflow and improves downstream evidence.", confidence: nextBestDecision?.confidence ?? (missingInputs.length ? 68 : 88), evidence: nextBestDecision?.signals.map((item) => item.evidence) ?? measuredSignals }],
    predictedOutcome: { statement: `Completing ${actionTitle.toLowerCase()} should unlock or improve the next dependent module.`, confidence: missingInputs.length ? 62 : 82, assumptions: ["Saved project data is current", "External integrations remain available"], dependencies: dependencies.length ? dependencies : [next.title] },
    pageGuidance: [{ title: page === next.page ? "Continue here" : `Continue in ${next.page}`, detail: `Complete ${actionTitle} before relying on downstream predictions.`, actionUrl }],
    suggestedChanges: missingInputs.map((input) => ({ title: `Add ${input}`, reason: "This input improves recommendations across downstream modules.", requiresApproval: false, targetModule: "intake" as const })),
    support: { explanation: "Predictions are planning estimates derived from saved project evidence. Protected actions still follow RBAC and approval rules.", warnings: blocked, missingInputs },
    retrieval: { mode: "none", matches: [] },
    generatedBy: "rules",
  };
}

const openai = createOpenAI({ apiKey: config.openaiApiKey });
const orchestratorAgent = new Agent({
  id: "senuke-project-orchestrator",
  name: "SEnuke Project Orchestrator",
  description: "Project-scoped planning agent for SEO workflow guidance, predictions, dependencies and next actions.",
  model: openai(config.openaiModel),
  instructions: `You are the SEnuke AI project orchestration agent. Use only supplied project evidence. Never invent completed work, metrics, integrations or permissions. Keep Business Location separate from Target Markets. Respect workflow dependencies, RBAC and approvals. Do not claim predictions are guarantees. Intent takes precedence over sequence: first answer the user's direct question fully using current-page and project evidence; then offer relevant follow-up guidance; mention the workflow sequence only after the answer. Lead with the next activity only when the user explicitly asks what to do next, asks about readiness, dependencies, blockers, or progress. Never replace a requested explanation, recommendation, comparison, or suggestion with a generic workflow reminder. Never execute, approve, publish, delete, or mutate data.`,
});

export async function runProjectAgent(evidence: Awaited<ReturnType<typeof loadProjectAgentEvidence>>, page: AgentPage, question?: string, conversation: { role: "user" | "assistant"; text: string }[] = [], access = { canExecute: true, canApprove: true }) {
  const fallback = deterministicProjectPlan(evidence, page, question, access);
  // Opening the drawer should be instant. Use Mastra only for an actual chat turn.
  const asksForNextAction = /next best action|what (?:should|do) i d.?o next|what.*d.?o next|selected.{0,80}(what|how|next|do)|next action/i.test(question ?? "");
  const asksForKeywordState = ["keywords", "keyword-insights"].includes(page) && (/(can|could|will) you add|add (these|them).*(keyword|list)|i.{0,18}(added|saved|approved|selected)|keyword analysis|keyword research|analysis result|what.*(mean|show|find)|what.*happen.*next/i.test(question ?? "") || /(?:suggest|recommend|generate|give|find|show|need|want).{0,70}(?:keyword|search term)|(?:keyword|search term).{0,70}(?:suggest|recommend|generate|give|find|more|add)/i.test(question ?? ""));
  if (!question?.trim() || !config.openaiApiKey || asksForNextAction || asksForKeywordState) return fallback;
  const retrieval = await retrieveSemanticContext(evidence, question).catch((error) => {
    console.error("[project-agent] semantic retrieval failed", error instanceof Error ? error.message : error);
    const words = new Set(question.toLowerCase().split(/\W+/).filter((word) => word.length > 2));
    const matches = semanticSources(evidence).map((source) => ({ source, score: [...words].filter((word) => `${source.title} ${source.content}`.toLowerCase().includes(word)).length / Math.max(words.size, 1) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
    return { mode: "lexical" as const, matches };
  });
  const enrichedFallback = { ...fallback, retrieval: { mode: retrieval.mode, matches: retrieval.matches.map((item) => ({ title: item.source.title, sourceType: item.source.sourceType, score: Math.max(0, Math.min(1, item.score)) })) } };
  const requestIntent = asksForNextAction ? "workflow_next_action" : /suggest|recommend|generate|give|find|compare|explain|why|how|what/i.test(question ?? "") ? "direct_page_question" : "page_guidance";
  const compactEvidence = { requestIntent, instructionPriority: ["answer_direct_intent", "use_current_page_and_project_evidence", "offer_relevant_follow_ups", "mention_sequence_last_if_useful"], project: evidence.project, latestCrawl: evidence.latestCrawl, keywordResearchRuns: evidence.keywordResearchRuns, deterministicPlan: enrichedFallback, semanticContext: retrieval.matches.map((item) => ({ title: item.source.title, sourceType: item.source.sourceType, similarity: item.score, content: item.source.content.slice(0, 6000) })), currentPage: page, conversation: conversation.slice(-12), userQuestion: question || null };
  try {
    const response = await Promise.race([
      orchestratorAgent.generate(`Follow instructionPriority strictly. Answer the user's intent before discussing workflow sequence. Use this project-scoped evidence and retrieved semantic context, then return the updated safe plan.\n${JSON.stringify(compactEvidence)}`, { structuredOutput: { schema: projectAgentOutputSchema, errorStrategy: "fallback", fallbackValue: enrichedFallback } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("agent_timeout")), 20_000)),
    ]);
    return projectAgentOutputSchema.parse({ ...response.object, projectId: evidence.project.id, page, nextPlannedActivity: enrichedFallback.nextPlannedActivity, suggestions: enrichedFallback.suggestions, followUpQuestions: enrichedFallback.followUpQuestions, retrieval: enrichedFallback.retrieval, generatedBy: "mastra" });
  } catch {
    return enrichedFallback;
  }
}
