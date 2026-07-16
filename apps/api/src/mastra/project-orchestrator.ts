import { Agent } from "@mastra/core/agent";
import { createOpenAI } from "@ai-sdk/openai";
import { prisma } from "@webtummy/db";
import { z } from "zod";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { rankNextBestAction, type NextBestActionContext } from "../dev016.js";

export const agentPageSchema = z.enum([
  "project", "intake", "opportunities", "keywords", "keyword-insights", "site-analysis",
  "strategy", "execution-plan", "approvals", "reports", "notifications", "support",
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
  { key: "intake", page: "intake", title: "Complete project intake", url: (id: string) => `/guided-projects/${id}/intake` },
  { key: "readiness", page: "project", title: "Confirm project readiness", url: (id: string) => `/guided-projects/${id}` },
  { key: "opportunity", page: "opportunities", title: "Select the project opportunity", url: (id: string) => `/opportunities?projectId=${id}` },
  { key: "keyword_analysis", page: "keywords", title: "Approve and analyze keywords", url: (id: string) => `/keywords?projectId=${id}` },
  { key: "site_analysis", page: "site-analysis", title: "Run site analysis", url: (id: string) => `/site-analysis?projectId=${id}` },
  { key: "strategy", page: "strategy", title: "Generate the project strategy", url: (id: string) => `/strategy?projectId=${id}` },
  { key: "strategy_approval", page: "strategy", title: "Review and approve the strategy", url: (id: string) => `/strategy?projectId=${id}` },
  { key: "execution_plan", page: "execution-plan", title: "Work through the execution plan", url: (id: string) => `/guided-projects/${id}?tasks=1` },
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
  const activities = await prisma.workspaceActivity.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, action: true, entityType: true, previousJson: true, nextJson: true, metadataJson: true, createdAt: true } });
  return { project, latestCrawl, activities };
}

type SemanticSource = { sourceType: string; sourceId: string; title: string; content: string; metadata?: Record<string, unknown> };

function semanticSources(evidence: Awaited<ReturnType<typeof loadProjectAgentEvidence>>): SemanticSource[] {
  const { project, latestCrawl, activities } = evidence;
  const sources: SemanticSource[] = [{ sourceType: "project_profile", sourceId: project.id, title: `${project.name} project profile`, content: JSON.stringify({ name: project.name, type: project.projectType, websiteStatus: project.websiteStatus, niche: project.niche, businessLocation: project.businessLocation, targetLocations: project.targetLocations, primaryGoal: project.primaryGoal, secondaryGoals: project.secondaryGoals, competitors: project.competitors, businessProfile: project.businessProfile }) }];
  for (const item of project.opportunities) sources.push({ sourceType: "opportunity", sourceId: item.id, title: item.name, content: JSON.stringify({ name: item.name, status: item.status, audience: item.targetAudience, problem: item.problemSolved, offer: item.recommendedOffer, summary: item.summary, scores: { overall: item.opportunityScore, seo: item.seoScore, competition: item.competitionScore, monetization: item.monetizationScore, execution: item.executionScore, userFit: item.userFitScore } }) });
  for (const item of project.keywordGroups) sources.push({ sourceType: "keyword_group", sourceId: item.id, title: item.title, content: JSON.stringify({ title: item.title, category: item.category, status: item.status, explanation: item.explanation, expectedValue: item.expectedValue, goalSupport: item.goalSupport, keywords: item.keywords, gaps: item.gapKeywords }) });
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
  const crawlText = (latestCrawl?.issues ?? []).map((issue) => `${issue.category} ${issue.message}`).join(" ").toLowerCase();
  return {
    projectId: project.id,
    primaryGoal: project.primaryGoal,
    targetMarkets: list(project.targetLocations),
    keywordGapCount: project.keywordGroups.reduce((total, group) => total + list(group.gapKeywords).length, 0),
    competitorCount: list(project.competitors).length,
    technicalIssueCount: (latestCrawl?.issues ?? []).filter((issue) => /technical|index|canonical|robot|sitemap|redirect|404|broken|link/i.test(`${issue.category} ${issue.message}`)).length,
    contentDecayCount: (crawlText.match(/outdated|stale|freshness|content decay|last updated/g) ?? []).length,
    canExecute: access.canExecute,
    canApprove: access.canApprove,
  };
}

export function deterministicProjectPlan(evidence: Awaited<ReturnType<typeof loadProjectAgentEvidence>>, page: AgentPage, question?: string, access = { canExecute: true, canApprove: true }): ProjectAgentOutput {
  const { project, latestCrawl } = evidence;
  const steps = new Map(project.workflowSteps.map((step) => [step.stepKey, step]));
  const completed = project.workflowSteps.filter((step) => ["completed", "skipped"].includes(step.status)).map((step) => step.title);
  const active = project.workflowSteps.filter((step) => ["ready", "active", "in_progress", "current"].includes(step.status)).map((step) => step.title);
  const blocked = project.workflowSteps.filter((step) => step.status === "blocked").map((step) => step.blockedReason || step.title);
  const requiresCrawl = project.websiteStatus === "existing_website" || project.projectType === "existing_website";
  const selectedOpportunity = project.opportunities.find((item) => ["selected", "confirmed"].includes(item.status));
  const approvedKeywords = project.keywordGroups.some((group) => group.status === "approved");
  const latestStrategy = project.strategyPlans[0];
  const evidenceCompletesStep = (key: string) => key === "intake" ? Boolean(project.businessProfile)
    : key === "opportunity" ? Boolean(selectedOpportunity)
      : key === "keyword_analysis" ? approvedKeywords
        : key === "site_analysis" ? latestCrawl?.status === "completed"
          : key === "strategy" ? Boolean(latestStrategy)
            : key === "strategy_approval" ? latestStrategy?.status === "approved"
              : key === "execution_plan" ? project.executionTasks.length > 0
                : false;
  const next = flow.find((item) => {
    if (item.key === "site_analysis" && !requiresCrawl) return false;
    return !evidenceCompletesStep(item.key) && !["completed", "skipped"].includes(steps.get(item.key)?.status ?? "pending");
  }) ?? flow[flow.length - 1];
  const pendingTasks = project.executionTasks.filter((task) => !["completed", "cancelled", "skipped"].includes(task.status));
  const nextBestDecision = rankNextBestAction(project.executionTasks, nextBestActionContext(evidence, access));
  const readyTask = nextBestDecision ? project.executionTasks.find((task) => task.id === nextBestDecision.taskId) : pendingTasks.find((task) => task.dependencies.every((dependency) => ["completed", "skipped"].includes(dependency.requiredTask.status)));
  const dependencies = next.key === "execution_plan" && readyTask ? readyTask.dependencies.map((item) => item.requiredTask.title) : blocked;
  const missingInputs = [!project.businessLocation && "Business Location", !(Array.isArray(project.targetLocations) && project.targetLocations.length) && "Target Markets", !project.primaryGoal && "Primary Goal"].filter(Boolean) as string[];
  const actionTitle = next.key === "execution_plan" && readyTask ? readyTask.title : next.title;
  const actionLabel = actionTitle.replace(/[.!?]+$/, "");
  const actionUrl = next.key === "execution_plan" && (nextBestDecision?.actionUrl || readyTask?.relatedUrl) ? (nextBestDecision?.actionUrl || readyTask!.relatedUrl!) : next.url(project.id);
  const measuredSignals = [project.keywordGroups.some((group) => group.status === "approved") ? "approved keyword groups" : "keyword approval pending", latestCrawl?.status === "completed" ? `${latestCrawl.pagesCrawled ?? 0} crawled pages` : requiresCrawl ? `site analysis ${latestCrawl?.status ?? "not started"}` : "crawl not required", project.strategyPlans[0]?.status ? `strategy ${project.strategyPlans[0].status}` : "strategy not generated", `${pendingTasks.length} pending execution tasks`];
  const normalizedQuestion = question?.toLowerCase() ?? "";
  const scoredOpportunity = selectedOpportunity ?? project.opportunities[0];
  const offer = project.businessProfile?.offerSummary?.split(/[,;\n]/)[0]?.trim() || project.niche || "your primary service";
  const markets = Array.isArray(project.targetLocations) ? project.targetLocations.map(String).filter(Boolean) : [];
  const longTailExamples = markets.slice(0, 3).flatMap((market) => [`best ${offer} in ${market}`, `${offer} for ${project.businessProfile?.targetAudience?.split(/[,;\n]/)[0]?.trim() || "businesses"} in ${market}`]).slice(0, 5);
  const crawl404 = latestCrawl?.pages.find((item) => item.statusCode === 404) ?? latestCrawl?.issues.find((item) => /404|not found/i.test(item.message));
  const issue404 = project.executionTasks.find((task) => /404|not found|broken (page|url|link)/i.test(`${task.title} ${task.description}`));
  const completedTasks = project.executionTasks.filter((task) => ["completed", "cancelled", "skipped"].includes(task.status));
  const blockedTasks = pendingTasks.filter((task) => task.status === "blocked" || Boolean(task.blockedReason) || task.dependencies.some((dependency) => !["completed", "skipped"].includes(dependency.requiredTask.status)));
  const achievedMilestones = project.workflowSteps.filter((step) => ["completed", "skipped"].includes(step.status));
  const totalMilestones = project.workflowSteps.length;
  let answer = `The next recommended activity is ${actionLabel}. ${next.key === "execution_plan" && readyTask ? `${nextBestDecision?.reason ?? "It is dependency-ready and has the highest current priority."} Expected outcome: ${nextBestDecision?.expectedOutcome || readyTask.expectedOutcome || readyTask.description}` : "It is the first incomplete workflow dependency."}`;
  if (/current (position|status|stage)|where (is|are) (the )?project|project.*(position|status|stage)/.test(normalizedQuestion)) {
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
  else if (/long.?tail|keyword suggestion|good keyword|is this keyword|add.+keyword/.test(normalizedQuestion)) answer = longTailExamples.length ? `Keyword advice should be checked against the project goal, buyer intent, target market, duplication, search demand, difficulty, and page fit. Project-aware long-tail starting points include: ${longTailExamples.join("; ")}. Preview and analyze them before approval.` : `Add Target Markets and a clear offer first so the agent can create useful local and long-tail keywords. A keyword is only “good” when its intent, relevance, attainable difficulty, and page target support ${project.primaryGoal || "the primary goal"}.`;
  else if (/strategy|positioning|content plan|seo plan/.test(normalizedQuestion)) answer = project.strategyPlans[0] ? `The latest Strategy is version ${project.strategyPlans[0].version} and is ${project.strategyPlans[0].status}. It should be judged against the approved opportunity, keyword groups, latest Site Analysis, goals, target markets, competitors, KPIs, and whether every approved recommendation maps to a non-duplicate Execution Plan task.` : "No Strategy exists yet. Complete intake, select an opportunity, approve keyword direction, and finish Site Analysis for an existing website before generating it.";
  else if (/execution|task|what.*do next|dependency|blocked/.test(normalizedQuestion)) answer = readyTask ? `The Next Best Action is “${readyTask.title}” (${nextBestDecision?.score ?? readyTask.priority}${nextBestDecision ? "/100 decision score" : " priority"}). ${nextBestDecision?.reason ?? "It is dependency-ready."} Expected outcome: ${nextBestDecision?.expectedOutcome || readyTask.expectedOutcome || readyTask.description}${nextBestDecision && !nextBestDecision.actionable ? " You have read-only access to this action; a permitted workspace member must execute or approve it." : ""}` : pendingTasks.length ? `There are ${pendingTasks.length} unfinished tasks, but their dependencies or approval state must be reviewed before execution.` : "There are no pending Execution Plan tasks. Generate or approve the Strategy, or review whether completed module recommendations have been synchronized.";
  else if (/site analysis|crawl|technical seo|site health|issue/.test(normalizedQuestion)) answer = latestCrawl ? `The latest Site Analysis is ${latestCrawl.status}${latestCrawl.siteScore !== null ? ` with a health score of ${latestCrawl.siteScore}/100` : ""}, ${latestCrawl.pagesCrawled} pages crawled, and ${latestCrawl.issues.length} high-priority open issues loaded for agent guidance. Start with issues having the greatest impact, then review and fix them through the Execution Plan.` : requiresCrawl ? "This existing-website project has no Site Analysis yet. Run the crawl before relying on Strategy predictions." : "This project does not require a crawl. Strategy can use intake and approved keywords without Site Analysis.";
  return {
    projectId: project.id,
    page,
    answer,
    summary: `${project.name} is at ${next.title}. Guidance is based on ${measuredSignals.join(", ")}.`,
    currentState: { completed, active, blocked },
    nextPlannedActivity: { title: actionTitle, reason: next.key === "execution_plan" && readyTask ? (nextBestDecision?.reason || readyTask.expectedOutcome || readyTask.description) : `This is the first incomplete dependency in the project workflow.`, module: next.page, actionUrl, priority: (readyTask?.priority as "critical" | "high" | "medium" | "low") || "high", expectedOutcome: nextBestDecision?.expectedOutcome || readyTask?.expectedOutcome || `Move the project safely to the next workflow milestone.`, dependencies, blocked: dependencies.length > 0, score: nextBestDecision?.score, confidence: nextBestDecision?.confidence, signals: nextBestDecision?.signals },
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
  instructions: `You are the SEnuke AI project orchestration agent. Use only supplied project evidence. Never invent completed work, metrics, integrations or permissions. Keep Business Location separate from Target Markets. Respect workflow dependencies, RBAC and approvals. Do not claim predictions are guarantees. Recommend one concrete next activity, page-specific guidance, support, and safe changes. Never execute, approve, publish, delete, or mutate data.`,
});

export async function runProjectAgent(evidence: Awaited<ReturnType<typeof loadProjectAgentEvidence>>, page: AgentPage, question?: string, conversation: { role: "user" | "assistant"; text: string }[] = [], access = { canExecute: true, canApprove: true }) {
  const fallback = deterministicProjectPlan(evidence, page, question, access);
  // Opening the drawer should be instant. Use Mastra only for an actual chat turn.
  const asksForNextAction = /next best action|what (?:should|do) i do next|what.*do next|next action/i.test(question ?? "");
  if (!question?.trim() || !config.openaiApiKey || asksForNextAction) return fallback;
  const retrieval = await retrieveSemanticContext(evidence, question).catch((error) => {
    console.error("[project-agent] semantic retrieval failed", error instanceof Error ? error.message : error);
    const words = new Set(question.toLowerCase().split(/\W+/).filter((word) => word.length > 2));
    const matches = semanticSources(evidence).map((source) => ({ source, score: [...words].filter((word) => `${source.title} ${source.content}`.toLowerCase().includes(word)).length / Math.max(words.size, 1) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
    return { mode: "lexical" as const, matches };
  });
  const enrichedFallback = { ...fallback, retrieval: { mode: retrieval.mode, matches: retrieval.matches.map((item) => ({ title: item.source.title, sourceType: item.source.sourceType, score: Math.max(0, Math.min(1, item.score)) })) } };
  const compactEvidence = { project: evidence.project, latestCrawl: evidence.latestCrawl, deterministicPlan: enrichedFallback, semanticContext: retrieval.matches.map((item) => ({ title: item.source.title, sourceType: item.source.sourceType, similarity: item.score, content: item.source.content.slice(0, 6000) })), currentPage: page, conversation: conversation.slice(-12), userQuestion: question || null };
  try {
    const response = await Promise.race([
      orchestratorAgent.generate(`Answer the user's question using this project-scoped evidence and retrieved semantic context, then return the updated safe plan.\n${JSON.stringify(compactEvidence)}`, { structuredOutput: { schema: projectAgentOutputSchema, errorStrategy: "fallback", fallbackValue: enrichedFallback } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("agent_timeout")), 20_000)),
    ]);
    return projectAgentOutputSchema.parse({ ...response.object, projectId: evidence.project.id, page, nextPlannedActivity: enrichedFallback.nextPlannedActivity, suggestions: enrichedFallback.suggestions, retrieval: enrichedFallback.retrieval, generatedBy: "mastra" });
  } catch {
    return enrichedFallback;
  }
}
