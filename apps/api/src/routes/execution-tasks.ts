import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { canAccessProject, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";
import { startTaskPublishing, verifyTaskPublishing } from "../publishing-workflow.js";

export const executionTasksRouter = Router();
executionTasksRouter.use(requireAuth);

const terminalStatuses = new Set(["completed", "skipped"]);

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

const contentPlanSchema = z.object({
  summary: z.string().trim().min(10).max(3000),
  pageUpdates: z.array(z.string().trim().min(2).max(800)).min(1).max(20),
  supportingContent: z.array(z.string().trim().min(2).max(800)).min(1).max(30),
  faqTopics: z.array(z.string().trim().min(2).max(500)).max(30),
  proofBlocks: z.array(z.string().trim().min(2).max(500)).max(20),
  contentBriefs: z.array(z.string().trim().min(2).max(1000)).min(1).max(30),
  publishingSequence: z.array(z.string().trim().min(2).max(800)).min(1).max(20),
  kpis: z.array(z.string().trim().min(2).max(500)).min(1).max(20),
});
type ContentPlan = z.infer<typeof contentPlanSchema>;

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
  const contentRoadmap = keywords.slice(0, 8).map((keyword) => `Map “${keyword}” to one primary target page and supporting content; avoid cannibalization.`);
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

function contentPlanFor(input: { projectName: string; goal: string | null; markets: string[]; keywords: string[]; offer: string | null; audience: string | null; contentStrategy: string | null; websiteUrl: string | null }): ContentPlan {
  const focus = input.offer || input.projectName;
  const keywords = [...new Set(input.keywords)].slice(0, 12);
  const market = input.markets.slice(0, 5).join(", ");
  const audience = input.audience || "the project's priority audience";
  const pageAction = input.websiteUrl ? "Optimize the existing or best-matched page" : "Create the planned primary page";
  const pageUpdates = keywords.slice(0, 5).map((keyword) => `${pageAction} for “${keyword}” with aligned intent, metadata, proof, FAQs, internal links, and a clear conversion action.`);
  const supporting = keywords.slice(0, 8).map((keyword) => `Create supporting content for “${keyword}” that answers a specific buyer question and links to its primary target page.`);
  const briefs = keywords.slice(0, 6).map((keyword) => `Brief: ${keyword} | Audience: ${audience} | Intent: commercial/informational as applicable | Required: unique angle, evidence, internal links, FAQs, CTA.`);
  return {
    summary: (input.contentStrategy || `Build a conversion-focused SEO content system for ${focus}${market ? ` across ${market}` : ""}, aligned with ${input.goal || "the primary project goal"} and the approved keyword direction.`).slice(0, 3000),
    pageUpdates: pageUpdates.length ? pageUpdates : [`Create or improve the main ${focus} service page with clear positioning, proof, FAQs, and a conversion call to action.`],
    supportingContent: supporting.length ? supporting : [`Publish an educational guide that helps ${audience} understand the problem, options, and next step.`],
    faqTopics: [`What does ${focus} include?`, `Who is ${focus} best suited for?`, `How much time and effort does implementation require?`, `What results should a buyer expect?`, ...(market ? [`How is the service delivered in ${market}?`] : [])],
    proofBlocks: ["Add a measurable case-study result with the starting problem, work completed, and outcome.", "Add relevant testimonials or review evidence near the conversion action.", "Show process, experience, credentials, guarantees, or trust signals supporting the key claims."],
    contentBriefs: briefs.length ? briefs : [`Brief: ${focus} | Audience: ${audience} | Cover the buyer problem, approach, proof, FAQs, and next action.`],
    publishingSequence: ["Approve keyword-to-page mapping and prevent cannibalization.", "Update the highest-value commercial page first.", "Publish supporting content in priority order and add contextual internal links.", "Validate metadata, schema, mobile presentation, CTAs, and tracking before publishing.", "Review rankings, qualified traffic, engagement, and conversions after release."],
    kpis: ["Approved pages and briefs completed", "Priority keywords mapped without duplication", "Organic impressions and qualified clicks", "Content-assisted leads or conversions", "Internal links and indexed pages"],
  };
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
  const project = await prisma.project.findFirst({ where: { id: req.params.projectId, ...(clientId ? { clientId } : {}), status: { not: "deleted" } }, select: { id: true, clientId: true, websiteId: true, agencyClientId: true } });
  if (!project) return res.status(404).json({ error: "project not found" });
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, project.id)) return res.status(404).json({ error: "project not found" });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const existing = await prisma.executionTask.findFirst({ where: { projectId: project.id, OR: [{ title: { contains: "SEO plan", mode: "insensitive" } }, { actionButtonLabel: { contains: "SEO Plan", mode: "insensitive" } }] }, orderBy: { updatedAt: "desc" } });
  if (existing) return res.json({ task: existing, created: false });
  const plan = await prisma.executionPlan.findFirst({ where: { projectId: project.id, status: "active" }, orderBy: { createdAt: "asc" } })
    ?? await prisma.executionPlan.create({ data: { projectId: project.id, title: "Guided execution plan", summary: "Project-wide tasks generated from approved discovery and Strategy.", status: "active" } });
  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.executionTask.create({ data: {
      clientId: project.clientId,
      websiteId: project.websiteId,
      projectId: project.id,
      executionPlanId: plan.id,
      moduleName: "content",
      sourceType: "seo_plan",
      sourceId: project.id,
      dedupeKey: `project:${project.id}:seo-plan`,
      title: "Create SEO plan",
      description: "Create the project-wide SEO direction from approved keywords, Strategy, target markets, crawl evidence, content priorities, and success metrics.",
      expectedOutcome: "An approved, editable SEO roadmap creates technical, keyword, content, authority, local, and measurement tasks.",
      priority: "high",
      automationLevel: "prepare",
      status: "ready",
      requiresApproval: false,
      manualRequired: true,
      actionButtonLabel: "Create SEO Plan",
      relatedUrl: `/guided-projects/${project.id}?tab=execution#execution-tasks`,
      manualInstructions: "Review the generated plan, edit the recommendations, then save it to create deduplicated execution tasks.",
      impact: "Turns project discovery and Strategy into a measurable SEO implementation roadmap.",
    } });
    await recordWorkspaceActivity(tx, { context, action: "seo_plan.task_created", entityType: "execution_task", entityId: created.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { status: "ready", sourceType: "seo_plan" } });
    return created;
  });
  res.status(201).json({ task, created: true });
});

executionTasksRouter.post("/execution-tasks/:id/content-plan/prepare", async (req, res) => {
  const clientId = await executionClientScope(req);
  const task = await prisma.executionTask.findFirst({ where: { id: req.params.id, ...(clientId ? { clientId } : {}) }, include: { project: { include: { businessProfile: true, keywordGroups: { where: { status: "approved" } }, strategyPlans: { orderBy: [{ version: "desc" }, { updatedAt: "desc" }], take: 1 } } } } });
  if (!task?.project || !/content\s*plan/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`)) return res.status(404).json({ error: "Content-plan task not found" });
  const context = await workspaceContext(req);
  if (!task.projectId || !await canAccessProject(context, task.projectId)) return res.status(404).json({ error: "task not found" });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const snapshot = recordJson(task.approvalSnapshotJson);
  const saved = contentPlanSchema.safeParse(snapshot.contentPlan);
  if (saved.success) return res.json({ task, plan: saved.data, existing: true });
  const strategy = task.project.strategyPlans[0];
  const plan = contentPlanSchema.parse(contentPlanFor({
    projectName: task.project.name,
    goal: task.project.primaryGoal,
    markets: jsonStrings(task.project.targetLocations),
    keywords: task.project.keywordGroups.flatMap((group) => jsonStrings(group.keywords)),
    offer: task.project.businessProfile?.offerSummary ?? task.project.niche,
    audience: task.project.businessProfile?.targetAudience ?? null,
    contentStrategy: strategy?.contentStrategy ?? null,
    websiteUrl: task.project.websiteUrl,
  }));
  const updated = await prisma.executionTask.update({ where: { id: task.id }, data: { status: "in_progress", actionButtonLabel: "Review Content Plan", relatedUrl: `/guided-projects/${task.projectId}?tab=execution&actionTask=${task.id}#execution-tasks`, approvalSnapshotJson: { ...snapshot, contentPlan: plan, contentPlanStatus: "draft", preparedAt: new Date().toISOString() } as Prisma.InputJsonValue } });
  await prisma.$transaction((tx) => recordWorkspaceActivity(tx, { context, action: "content_plan.prepared", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, nextJson: { pages: plan.pageUpdates.length, supportingContent: plan.supportingContent.length, briefs: plan.contentBriefs.length } }));
  res.json({ task: updated, plan, existing: false });
});

executionTasksRouter.post("/execution-tasks/:id/content-plan/save", async (req, res) => {
  const parsed = contentPlanSchema.safeParse(req.body?.plan);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await executionClientScope(req);
  const task = await prisma.executionTask.findFirst({ where: { id: req.params.id, ...(clientId ? { clientId } : {}) }, include: { project: { select: { id: true, agencyClientId: true } } } });
  if (!task?.project || !task.projectId || !/content\s*plan/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`)) return res.status(404).json({ error: "Content-plan task not found" });
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, task.projectId)) return res.status(404).json({ error: "task not found" });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const snapshot = recordJson(task.approvalSnapshotJson);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.executionTask.update({ where: { id: task.id }, data: { status: "in_progress", actionButtonLabel: "Review Content Plan", relatedUrl: `/guided-projects/${task.projectId}?tab=execution&actionTask=${task.id}#execution-tasks`, approvalSnapshotJson: { ...snapshot, contentPlan: parsed.data, contentPlanStatus: "saved", savedAt: new Date().toISOString() } as Prisma.InputJsonValue } });
    await recordWorkspaceActivity(tx, { context, action: "content_plan.saved", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, nextJson: { pages: parsed.data.pageUpdates.length, supportingContent: parsed.data.supportingContent.length, briefs: parsed.data.contentBriefs.length } });
    return row;
  });
  res.json({ task: updated, plan: parsed.data });
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
  if (!task || !task.project || !/create seo plan/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`)) return res.status(404).json({ error: "SEO-plan task not found" });
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
  const updated = await prisma.executionTask.update({ where: { id: task.id }, data: { status: "in_progress", actionButtonLabel: "Review SEO Plan", relatedUrl: `/guided-projects/${task.projectId}?tab=execution`, approvalSnapshotJson: { ...snapshot, seoPlan: plan, seoPlanStatus: "draft", preparedAt: new Date().toISOString() } as Prisma.InputJsonValue } });
  await prisma.$transaction((tx) => recordWorkspaceActivity(tx, { context, action: "seo_plan.prepared", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, nextJson: { objectives: plan.objectives.length, keywords: plan.keywordPriorities.length } }));
  res.json({ task: updated, plan, existing: false });
});

executionTasksRouter.post("/execution-tasks/:id/seo-plan/confirm", async (req, res) => {
  const parsed = seoPlanSchema.safeParse(req.body?.plan);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await executionClientScope(req);
  const task = await prisma.executionTask.findFirst({ where: { id: req.params.id, ...(clientId ? { clientId } : {}) }, include: { project: { select: { id: true, agencyClientId: true } } } });
  if (!task || !task.project || !task.projectId || !/create seo plan/i.test(`${task.title} ${task.actionButtonLabel ?? ""}`)) return res.status(404).json({ error: "SEO-plan task not found" });
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, task.projectId)) return res.status(404).json({ error: "task not found" });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const plan = parsed.data;
  const childDefinitions = [
    { key: "technical", moduleName: "site_analysis", title: "Implement SEO technical priorities", description: plan.technicalPriorities.join("; "), priority: "high", relatedUrl: `/site-analysis?projectId=${task.projectId}` },
    { key: "keywords", moduleName: "keyword_research", title: "Map SEO keywords to target pages", description: plan.keywordPriorities.join(", "), priority: "high", relatedUrl: `/keywords?projectId=${task.projectId}` },
    { key: "content", moduleName: "content", title: "Execute the SEO content roadmap", description: plan.contentRoadmap.join("; "), priority: "medium", relatedUrl: `/guided-projects/${task.projectId}?tab=execution` },
    { key: "authority", moduleName: "backlinks", title: "Build SEO authority and local signals", description: [...plan.localSeoActions, ...plan.authorityActions].join("; "), priority: "medium", relatedUrl: `/backlinks?projectId=${task.projectId}` },
    { key: "measurement", moduleName: "reports", title: "Measure SEO plan performance", description: plan.kpis.join("; "), priority: "low", relatedUrl: `/reports?projectId=${task.projectId}` },
  ] as const;
  const updated = await withTransactionRetry(() => prisma.$transaction(async (tx) => {
    for (const child of childDefinitions) {
      const dedupeKey = `seo-plan:${task.projectId}:${child.key}`;
      const data = { clientId: task.clientId, websiteId: task.websiteId, projectId: task.projectId, executionPlanId: task.executionPlanId, moduleName: child.moduleName, sourceType: "seo_plan_action", sourceId: task.id, title: child.title, description: child.description || "Review and complete this part of the approved SEO plan.", expectedOutcome: `Completes the ${child.title.toLowerCase()} portion of the project SEO plan.`, priority: child.priority, automationLevel: "manual_guided", status: "ready", requiresApproval: false, manualRequired: true, actionButtonLabel: "Review & Execute", relatedUrl: child.relatedUrl, manualInstructions: child.description || "Follow the approved SEO plan and record completion evidence.", impact: "Moves the approved SEO plan into measurable execution." };
      const existing = await tx.executionTask.findUnique({ where: { dedupeKey } });
      if (!existing) await tx.executionTask.create({ data: { ...data, dedupeKey } });
      else if (!terminalStatuses.has(existing.status)) await tx.executionTask.update({ where: { id: existing.id }, data });
    }
    const snapshot = recordJson(task.approvalSnapshotJson);
    const parent = await tx.executionTask.update({ where: { id: task.id }, data: { status: "completed", completedAt: new Date(), actionButtonLabel: "View SEO Plan", relatedUrl: `/guided-projects/${task.projectId}?tab=execution`, approvalSnapshotJson: { ...snapshot, seoPlan: plan, seoPlanStatus: "confirmed", confirmedAt: new Date().toISOString(), childTaskCount: childDefinitions.length } as Prisma.InputJsonValue } });
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
