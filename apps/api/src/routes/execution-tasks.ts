import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";

export const executionTasksRouter = Router();
executionTasksRouter.use(requireAuth);

const terminalStatuses = new Set(["completed", "skipped"]);

const querySchema = z.object({
  websiteId: z.string().optional(),
  status: z.string().optional(),
  moduleName: z.string().optional(),
  priority: z.string().optional(),
});

const patchSchema = z.object({
  status: z.string().min(2).max(60).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  manualInstructions: z.string().max(5000).optional().nullable(),
});

type TaskInput = {
  clientId: string;
  websiteId: string;
  moduleName: string;
  sourceType: string;
  sourceId?: string | null;
  dedupeKey: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
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
    moduleName: input.moduleName,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    title: input.title,
    description: input.description,
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
    await tx.executionTask.create({ data: { ...data, dedupeKey: input.dedupeKey } });
    return "created";
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

async function buildTasksForWebsite(website: { id: string; clientId: string; domain: string; rootUrl: string }): Promise<TaskInput[]> {
  const tasks: TaskInput[] = [];
  const latestCrawl = await prisma.crawlJob.findFirst({
    where: { websiteId: website.id, status: "completed" },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    include: {
      issues: {
        where: { status: "open", severity: { in: ["high", "medium", "low"] } },
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

  return tasks;
}

executionTasksRouter.get("/execution-tasks", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await executionClientScope(req);
  const where: Prisma.ExecutionTaskWhereInput = {
    ...(clientId ? { clientId } : {}),
    ...(parsed.data.websiteId ? { websiteId: parsed.data.websiteId } : {}),
    ...(parsed.data.status ? { status: parsed.data.status } : {}),
    ...(parsed.data.moduleName ? { moduleName: parsed.data.moduleName } : {}),
    ...(parsed.data.priority ? { priority: parsed.data.priority } : {}),
  };
  const tasks = await prisma.executionTask.findMany({
    where,
    orderBy: [{ status: "asc" }, { priority: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });
  res.json({ tasks });
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

  const inputs = await buildTasksForWebsite(website);
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
  });
  if (!existing) return res.status(404).json({ error: "task not found" });
  const status = parsed.data.status ?? existing.status;
  const task = await prisma.executionTask.update({
    where: { id: existing.id },
    data: {
      ...parsed.data,
      completedAt: status === "completed" ? new Date() : existing.completedAt,
      skippedAt: status === "skipped" ? new Date() : existing.skippedAt,
    },
  });
  res.json({ task });
});

executionTasksRouter.post("/execution-tasks/:id/complete", async (req, res) => {
  const clientId = await executionClientScope(req);
  const existing = await prisma.executionTask.findFirst({
    where: { id: req.params.id, ...(clientId ? { clientId } : {}) },
  });
  if (!existing) return res.status(404).json({ error: "task not found" });
  const task = await prisma.executionTask.update({ where: { id: existing.id }, data: { status: "completed", completedAt: new Date() } });
  res.json({ task });
});

executionTasksRouter.post("/execution-tasks/:id/skip", async (req, res) => {
  const clientId = await executionClientScope(req);
  const existing = await prisma.executionTask.findFirst({
    where: { id: req.params.id, ...(clientId ? { clientId } : {}) },
  });
  if (!existing) return res.status(404).json({ error: "task not found" });
  const task = await prisma.executionTask.update({ where: { id: existing.id }, data: { status: "skipped", skippedAt: new Date() } });
  res.json({ task });
});
