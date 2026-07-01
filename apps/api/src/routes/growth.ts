import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "@webtummy/db";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { approvalRequiredForLevel, policyForModule, type AutomationLevel } from "../automation-policy.js";

export const growthRouter = Router();
growthRouter.use(requireAuth);

const terminalStatuses = new Set(["completed", "skipped", "cancelled", "canceled"]);
type GrowthReadinessAction = { label: string; url: string };
type GrowthReadinessItem = {
  key: string;
  title: string;
  description: string;
  status: "complete" | "missing";
  required: boolean;
  actions: GrowthReadinessAction[];
};

async function scopedProject(req: Request, projectId: string) {
  const clientId = await projectClientIdForRequest(req);
  return prisma.project.findFirst({
    where: { id: projectId, ...(clientId ? { clientId } : {}) },
    include: {
      website: {
        include: {
          crawlJobs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { issues: { where: { status: "open" }, take: 50 } },
          },
          keywordResearchRuns: { orderBy: { createdAt: "desc" }, take: 3, include: { ideas: { take: 10 } } },
          socialStrategies: { orderBy: { createdAt: "desc" }, take: 1, include: { posts: { take: 10 } } },
        },
      },
      businessProfile: true,
      intakeAnswers: true,
      opportunities: { orderBy: { createdAt: "desc" }, take: 5 },
      strategyPlans: { orderBy: { createdAt: "desc" }, take: 3 },
      executionTasks: { orderBy: { createdAt: "desc" }, take: 80 },
    },
  });
}

function jsonList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function projectContext(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>) {
  return {
    name: project.businessName ?? project.name,
    website: project.website?.rootUrl ?? project.websiteUrl ?? null,
    niche: project.niche ?? project.businessProfile?.businessSummary ?? "this market",
    audience: project.businessProfile?.targetAudience ?? "the target audience",
    offer: project.businessProfile?.offerSummary ?? project.primaryGoal ?? "the main offer",
    goal: project.primaryGoal ?? "growth",
    outputs: jsonList(project.preferredOutputs),
    strategy: project.strategyPlans[0] ?? null,
    approvedStrategy: project.strategyPlans.find((strategy) => strategy.status === "approved") ?? null,
  };
}

function growthReadiness(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>) {
  const intakeComplete = Boolean(project.businessProfile || project.intakeAnswers.length > 0);
  const opportunityExists = project.opportunities.length > 0;
  const strategyApproved = project.strategyPlans.some((strategy) => strategy.status === "approved");
  const hasWebsite = Boolean(project.website);
  const latestCrawl = project.website?.crawlJobs[0] ?? null;
  const siteAnalysisComplete = Boolean(latestCrawl && latestCrawl.status === "completed");

  const items: GrowthReadinessItem[] = [
    {
      key: "intake",
      title: "Project intake required",
      description: "SEnuke AI needs the business profile, audience, offer, goal, and project context before advanced growth analysis can run.",
      status: intakeComplete ? "complete" : "missing",
      required: true,
      actions: [{ label: "Complete Intake", url: `/guided-projects/${project.id}/intake` }],
    },
    {
      key: "opportunity",
      title: "Opportunity required",
      description: "SEnuke AI needs to know what direction this project is targeting before it can create growth recommendations.",
      status: opportunityExists ? "complete" : "missing",
      required: true,
      actions: [{ label: "Find Opportunity", url: `/opportunities?projectId=${project.id}` }],
    },
    {
      key: "strategy",
      title: "Strategy required",
      description: "SEnuke AI needs an approved strategy before it can diagnose growth bottlenecks or create experiments.",
      status: strategyApproved ? "complete" : "missing",
      required: true,
      actions: [{ label: "Generate Strategy", url: `/strategy?projectId=${project.id}` }],
    },
  ];

  if (!hasWebsite) {
    items.push({
      key: "website",
      title: "No website found",
      description: "Create or connect a website first so SEnuke AI can analyze and optimize it.",
      status: "missing",
      required: true,
      actions: [
        { label: "Create Website", url: `/site-architect?projectId=${project.id}` },
        { label: "Add Website URL", url: `/guided-projects/${project.id}/intake` },
      ],
    });
  } else {
    items.push({
      key: "site_analysis",
      title: "Site analysis required",
      description: "SEnuke AI needs to analyze your website before it can evaluate funnel gaps, conversion issues, SEO issues, internal links, AI citations, or page improvements.",
      status: siteAnalysisComplete ? "complete" : "missing",
      required: true,
      actions: [{ label: "Analyze Site", url: `/site-analysis?projectId=${project.id}` }],
    });
  }

  const missing = items.filter((item) => item.required && item.status === "missing");
  return {
    canRun: missing.length === 0,
    status: missing.length === 0 ? "ready" : "blocked",
    message: missing.length === 0
      ? "Growth Engine has the required foundation data for this project."
      : "Before SEnuke AI can run this, we need to complete these missing steps.",
    items,
    missing,
  };
}

function scoreProject(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>) {
  const latestCrawl = project.website?.crawlJobs[0] ?? null;
  const openTasks = project.executionTasks.filter((task) => !terminalStatuses.has(task.status));
  const highIssues = latestCrawl?.issues.filter((issue) => issue.severity === "high").length ?? 0;
  const keywordRuns = project.website?.keywordResearchRuns.length ?? 0;
  const socialPosts = project.website?.socialStrategies[0]?.posts.length ?? 0;
  const hasLeadMagnetTask = project.executionTasks.some((task) => task.moduleName.includes("lead") || task.title.toLowerCase().includes("lead magnet"));
  const strategyApproved = Boolean(project.strategyPlans.find((strategy) => strategy.status === "approved"));

  const traffic = Math.min(100, 35 + keywordRuns * 16 + (latestCrawl ? 18 : 0) + Math.max(0, 20 - highIssues * 4));
  const conversion = Math.min(100, 30 + (strategyApproved ? 18 : 0) + (hasLeadMagnetTask ? 14 : 0) + (project.businessProfile?.offerSummary ? 12 : 0));
  const leadCapture = Math.min(100, 25 + (hasLeadMagnetTask ? 24 : 0) + (project.preferredOutputs && jsonList(project.preferredOutputs).some((item) => /lead/i.test(item)) ? 20 : 0));
  const followUp = Math.min(100, 22 + socialPosts * 3 + (project.preferredPublishingMethod ? 10 : 0));
  const authority = Math.min(100, 35 + openTasks.filter((task) => /backlink|citation|authority/i.test(`${task.moduleName} ${task.title}`)).length * 6);
  const offer = Math.min(100, 35 + (project.businessProfile?.offerSummary ? 22 : 0) + (project.businessProfile?.targetAudience ? 14 : 0) + (project.strategyPlans[0]?.offerRecommendation ? 12 : 0));
  const retention = Math.min(100, 25 + socialPosts * 2 + (project.strategyPlans[0]?.socialStrategy ? 12 : 0));
  const scoreJson = { traffic, conversion, leadCapture, followUp, authority, offer, retention };
  const bottleneckType = Object.entries(scoreJson).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "conversion";
  const growthScore = Math.round(Object.values(scoreJson).reduce((sum, value) => sum + value, 0) / Object.values(scoreJson).length);
  return { scoreJson, bottleneckType, growthScore, latestCrawl, openTasks, keywordRuns, socialPosts, hasLeadMagnetTask, strategyApproved };
}

function diagnosisSummary(bottleneckType: string, ctx: ReturnType<typeof projectContext>) {
  const label = bottleneckType.replace(/([A-Z])/g, " $1").toLowerCase();
  return `${ctx.name} is currently most constrained by ${label}. Growth work should focus there before adding more disconnected tasks.`;
}

function funnelDefinitions(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>, score: ReturnType<typeof scoreProject>) {
  const ctx = projectContext(project);
  return [
    { stageKey: "traffic_sources", title: "Traffic sources", metric: `${score.keywordRuns} keyword runs`, health: score.scoreJson.traffic, issue: score.keywordRuns ? "Traffic inputs exist. Keep mapping demand to pages." : "Keyword and traffic source data is missing.", automation: "execute_through_integration" },
    { stageKey: "landing_page", title: "Landing page", metric: score.latestCrawl ? `${score.latestCrawl.siteScore ?? 0}/100 site score` : "No crawl", health: score.latestCrawl?.siteScore ?? 35, issue: score.latestCrawl ? "Use crawl findings to improve clarity and page health." : "Run site analysis before conversion work.", automation: "execute_through_integration" },
    { stageKey: "lead_capture", title: "Lead capture", metric: score.hasLeadMagnetTask ? "Lead magnet task exists" : "No lead capture asset", health: score.scoreJson.leadCapture, issue: score.hasLeadMagnetTask ? "Lead capture is planned. Review landing page and form flow." : "Create a lead magnet or capture offer.", automation: "generate" },
    { stageKey: "follow_up", title: "Follow-up", metric: `${score.socialPosts} planned social posts`, health: score.scoreJson.followUp, issue: "Email and nurture follow-up should be reviewed before sending.", automation: "prepare" },
    { stageKey: "conversion", title: "Conversion", metric: ctx.goal, health: score.scoreJson.conversion, issue: "CTA clarity, proof, objections, and form friction need measurable checks.", automation: "generate" },
    { stageKey: "retention_referral", title: "Retention / referral", metric: "Manual tracking", health: score.scoreJson.retention, issue: "Add retention, referral, or review prompts after lead capture is stable.", automation: "manual_guided" },
  ].map((stage, index) => ({
    ...stage,
    status: stage.health >= 75 ? "healthy" : stage.health >= 55 ? "watch" : "needs_attention",
    sortOrder: index + 1,
  }));
}

function experimentIdeas(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>, bottleneckType: string) {
  const ctx = projectContext(project);
  const base = [
    {
      title: "Improve primary CTA clarity",
      hypothesis: `If ${ctx.name} uses a clearer primary CTA tied to ${ctx.offer}, more visitors will take the next step.`,
      metric: "CTA click-through rate",
      successThreshold: "Increase CTA clicks by 15% within 14 days",
      assets: ["CTA copy", "Hero section variant", "Tracking task"],
      impact: bottleneckType === "conversion" ? 9 : 7,
      confidence: 8,
      ease: 8,
      potential: 8,
      importance: 9,
    },
    {
      title: "Launch a focused lead magnet test",
      hypothesis: `If ${ctx.audience} receives a useful lead magnet before booking, lead capture will improve.`,
      metric: "Lead conversion rate",
      successThreshold: "Capture 10 qualified leads or improve opt-in rate by 20%",
      assets: ["Lead magnet outline", "Landing page copy", "Delivery email"],
      impact: bottleneckType === "leadCapture" ? 9 : 8,
      confidence: 7,
      ease: 6,
      potential: 9,
      importance: 8,
    },
    {
      title: "Create one authority-backed SEO page",
      hypothesis: `If ${ctx.name} publishes one page mapped to proven demand and clear proof, qualified traffic will increase.`,
      metric: "Organic visits and ranking movement",
      successThreshold: "Page indexed and reaches top 30 for one target query",
      assets: ["Keyword cluster", "Page brief", "Internal link plan"],
      impact: bottleneckType === "traffic" || bottleneckType === "authority" ? 9 : 7,
      confidence: 7,
      ease: 6,
      potential: 8,
      importance: 8,
    },
  ];
  return base.map((idea) => ({
    ...idea,
    ice: idea.impact * idea.confidence * idea.ease,
    pie: idea.potential * idea.importance * idea.ease,
  })).sort((a, b) => b.ice - a.ice);
}

async function activePlanId(tx: Prisma.TransactionClient, projectId: string) {
  const existing = await tx.executionPlan.findFirst({ where: { projectId, status: "active" }, orderBy: { createdAt: "asc" } });
  if (existing) return existing.id;
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { name: true } });
  return (await tx.executionPlan.create({ data: { projectId, title: `${project?.name ?? "Project"} execution plan` } })).id;
}

async function upsertGrowthTask(tx: Prisma.TransactionClient, input: {
  project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>;
  experimentId?: string | null;
  key: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  automationLevel: AutomationLevel;
  safetyCategory?: string;
  relatedUrl?: string;
  actionButtonLabel?: string;
  manualInstructions?: string;
}) {
  const policy = policyForModule("growth_marketing");
  const executionPlanId = await activePlanId(tx, input.project.id);
  const existing = await tx.executionTask.findUnique({ where: { dedupeKey: input.key } });
  const data = {
    clientId: input.project.clientId,
    websiteId: input.project.websiteId,
    projectId: input.project.id,
    executionPlanId,
    moduleName: "growth_marketing",
    sourceType: "growth_experiment",
    sourceId: input.experimentId ?? input.project.id,
    title: input.title,
    description: input.description,
    priority: input.priority,
    automationLevel: input.automationLevel,
    status: "ready",
    requiresApproval: approvalRequiredForLevel(input.automationLevel),
    requiresIntegration: input.automationLevel === "execute_through_integration",
    manualRequired: input.automationLevel === "manual_guided",
    safetyCategory: input.safetyCategory ?? policy.safetyCategory,
    relatedModule: "growth_marketing",
    actionButtonLabel: input.actionButtonLabel ?? "Review Growth Task",
    relatedUrl: input.relatedUrl ?? "/growth",
    manualInstructions: input.manualInstructions ?? "Review the generated recommendation, approve any live changes, and record the result after the experiment runs.",
    impact: "Connects strategy and execution work to a measurable growth experiment.",
  };
  if (!existing) return tx.executionTask.create({ data: { ...data, dedupeKey: input.key } });
  if (terminalStatuses.has(existing.status)) return existing;
  return tx.executionTask.update({ where: { id: existing.id }, data });
}

async function loadGrowthOverview(projectId: string) {
  const [diagnosis, funnelStages, experiments, channelTests, reports] = await Promise.all([
    prisma.growthDiagnosis.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } }),
    prisma.growthFunnelStage.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    prisma.growthExperiment.findMany({ where: { projectId }, orderBy: [{ status: "asc" }, { iceScore: "desc" }], include: { assets: true, results: { orderBy: { recordedAt: "desc" }, take: 3 } } }),
    prisma.growthChannelTest.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } }),
    prisma.growthReport.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  return { diagnosis, funnelStages, experiments, channelTests, reports };
}

growthRouter.get("/projects-v2/:projectId/growth/overview", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const score = scoreProject(project);
  const readiness = growthReadiness(project);
  const growth = await loadGrowthOverview(project.id);
  res.json({ project, signals: score, readiness, growth, automationPolicy: policyForModule("growth_marketing") });
});

growthRouter.post("/projects-v2/:projectId/growth/analyze", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const readiness = growthReadiness(project);
  if (!readiness.canRun) return res.status(409).json({ error: "growth_readiness_incomplete", readiness });
  const ctx = projectContext(project);
  const score = scoreProject(project);
  const stages = funnelDefinitions(project, score);

  await prisma.$transaction(async (tx) => {
    await tx.growthDiagnosis.create({
      data: {
        projectId: project.id,
        bottleneckType: score.bottleneckType,
        scoreJson: score.scoreJson,
        summary: diagnosisSummary(score.bottleneckType, ctx),
        dataSnapshot: {
          website: ctx.website,
          strategyApproved: score.strategyApproved,
          keywordRuns: score.keywordRuns,
          socialPosts: score.socialPosts,
          openTasks: score.openTasks.length,
          latestCrawlScore: score.latestCrawl?.siteScore ?? null,
        },
      },
    });
    for (const stage of stages) {
      await tx.growthFunnelStage.upsert({
        where: { projectId_stageKey: { projectId: project.id, stageKey: stage.stageKey } },
        update: {
          title: stage.title,
          status: stage.status,
          conversionMetric: stage.metric,
          issueSummary: stage.issue,
          automationStatus: stage.automation,
          sortOrder: stage.sortOrder,
        },
        create: {
          projectId: project.id,
          stageKey: stage.stageKey,
          title: stage.title,
          status: stage.status,
          conversionMetric: stage.metric,
          issueSummary: stage.issue,
          automationStatus: stage.automation,
          sortOrder: stage.sortOrder,
        },
      });
    }
    await upsertGrowthTask(tx, {
      project,
      key: `project:${project.id}:growth:fix-${score.bottleneckType}`,
      title: `Fix growth bottleneck: ${score.bottleneckType.replace(/([A-Z])/g, " $1").toLowerCase()}`,
      description: diagnosisSummary(score.bottleneckType, ctx),
      priority: "high",
      automationLevel: "prepare",
      actionButtonLabel: "Create Fix Tasks",
      relatedUrl: `/growth?projectId=${project.id}&tab=diagnosis`,
    });
  });

  const growth = await loadGrowthOverview(project.id);
  res.json({ project, signals: score, readiness, growth, automationPolicy: policyForModule("growth_marketing") });
});

growthRouter.post("/projects-v2/:projectId/growth/funnel-map", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const readiness = growthReadiness(project);
  if (!readiness.canRun) return res.status(409).json({ error: "growth_readiness_incomplete", readiness });
  const score = scoreProject(project);
  const stages = funnelDefinitions(project, score);
  await prisma.$transaction(async (tx) => {
    for (const stage of stages) {
      await tx.growthFunnelStage.upsert({
        where: { projectId_stageKey: { projectId: project.id, stageKey: stage.stageKey } },
        update: { title: stage.title, status: stage.status, conversionMetric: stage.metric, issueSummary: stage.issue, automationStatus: stage.automation, sortOrder: stage.sortOrder },
        create: { projectId: project.id, stageKey: stage.stageKey, title: stage.title, status: stage.status, conversionMetric: stage.metric, issueSummary: stage.issue, automationStatus: stage.automation, sortOrder: stage.sortOrder },
      });
    }
  });
  res.json(await loadGrowthOverview(project.id));
});

growthRouter.post("/projects-v2/:projectId/growth/experiments/generate", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const readiness = growthReadiness(project);
  if (!readiness.canRun) return res.status(409).json({ error: "growth_readiness_incomplete", readiness });
  const latestDiagnosis = await prisma.growthDiagnosis.findFirst({ where: { projectId: project.id }, orderBy: { createdAt: "desc" } });
  const score = scoreProject(project);
  const bottleneckType = latestDiagnosis?.bottleneckType ?? score.bottleneckType;
  const ideas = experimentIdeas(project, bottleneckType);

  await prisma.$transaction(async (tx) => {
    for (const idea of ideas) {
      const experiment = await tx.growthExperiment.create({
        data: {
          projectId: project.id,
          title: idea.title,
          hypothesis: idea.hypothesis,
          metric: idea.metric,
          successThreshold: idea.successThreshold,
          iceScore: idea.ice,
          pieScore: idea.pie,
          impactScore: idea.impact,
          confidenceScore: idea.confidence,
          easeScore: idea.ease,
          potentialScore: idea.potential,
          importanceScore: idea.importance,
          requiredAssets: idea.assets,
          automationLevel: "prepare",
          requiresApproval: true,
          safetyCategory: "review_required",
        },
      });
      for (const asset of idea.assets) {
        await tx.growthExperimentAsset.create({
          data: {
            experimentId: experiment.id,
            assetType: asset.toLowerCase().replace(/\s+/g, "_"),
            title: asset,
            approvalStatus: "needs_review",
            contentJson: { generatedBy: "growth_engine", status: "draft" },
          },
        });
      }
      await upsertGrowthTask(tx, {
        project,
        experimentId: experiment.id,
        key: `project:${project.id}:growth:experiment:${experiment.id}`,
        title: `Run experiment: ${idea.title}`,
        description: idea.hypothesis,
        priority: idea.ice >= 500 ? "high" : "medium",
        automationLevel: "prepare",
        actionButtonLabel: "Start Experiment",
        relatedUrl: `/growth?projectId=${project.id}&tab=experiments`,
      });
    }
  });

  res.json(await loadGrowthOverview(project.id));
});

growthRouter.post("/growth/experiments/:experimentId/start", async (req, res) => {
  const clientId = await projectClientIdForRequest(req);
  const experiment = await prisma.growthExperiment.findFirst({
    where: { id: req.params.experimentId, ...(clientId ? { project: { clientId } } : {}) },
    include: { project: true },
  });
  if (!experiment) return res.status(404).json({ error: "experiment not found" });
  const updated = await prisma.growthExperiment.update({
    where: { id: experiment.id },
    data: { status: "running", startedAt: new Date() },
  });
  await prisma.executionTask.updateMany({
    where: { projectId: experiment.projectId, sourceId: experiment.id, moduleName: "growth_marketing", status: { notIn: Array.from(terminalStatuses) } },
    data: { status: "in_progress" },
  });
  res.json({ experiment: updated });
});

const resultSchema = z.object({
  baselineValue: z.number().optional(),
  currentValue: z.number().optional(),
  resultStatus: z.enum(["tracking", "winner", "failed", "inconclusive", "scaled"]).default("tracking"),
  notes: z.string().max(5000).optional(),
});

growthRouter.post("/growth/experiments/:experimentId/results", async (req, res) => {
  const parsed = resultSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await projectClientIdForRequest(req);
  const experiment = await prisma.growthExperiment.findFirst({
    where: { id: req.params.experimentId, ...(clientId ? { project: { clientId } } : {}) },
  });
  if (!experiment) return res.status(404).json({ error: "experiment not found" });
  const result = await prisma.growthExperimentResult.create({
    data: { experimentId: experiment.id, ...parsed.data },
  });
  if (["winner", "failed", "inconclusive", "scaled"].includes(parsed.data.resultStatus)) {
    await prisma.growthExperiment.update({
      where: { id: experiment.id },
      data: { status: parsed.data.resultStatus === "winner" ? "completed" : parsed.data.resultStatus, completedAt: new Date() },
    });
  }
  res.json({ result });
});

growthRouter.post("/projects-v2/:projectId/growth/channel-tests", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const readiness = growthReadiness(project);
  if (!readiness.canRun) return res.status(409).json({ error: "growth_readiness_incomplete", readiness });
  const channels = [
    { channel: "SEO", cadence: "2 optimized pages per month", metric: "Indexed pages and ranking movement", assetsNeeded: ["Keyword map", "Page briefs"] },
    { channel: "Social", cadence: "3 posts per week", metric: "Profile clicks and assisted leads", assetsNeeded: ["Post drafts", "Creative prompts"] },
    { channel: "Email", cadence: "4-message follow-up", metric: "Reply or booked-call rate", assetsNeeded: ["Sequence copy", "Lead magnet"] },
  ];
  await prisma.$transaction(channels.map((test) => prisma.growthChannelTest.create({ data: { projectId: project.id, durationDays: 30, status: "planned", ...test } })));
  res.json(await loadGrowthOverview(project.id));
});

growthRouter.post("/projects-v2/:projectId/growth/reports", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const readiness = growthReadiness(project);
  if (!readiness.canRun) return res.status(409).json({ error: "growth_readiness_incomplete", readiness });
  const growth = await loadGrowthOverview(project.id);
  const report = await prisma.growthReport.create({
    data: {
      projectId: project.id,
      clientId: project.clientId,
      reportType: "agency_growth_report",
      status: "draft",
      htmlContent: `<h1>${project.businessName ?? project.name} Growth Report</h1><p>${growth.diagnosis?.summary ?? "Run a diagnosis to populate the report."}</p>`,
    },
  });
  res.json({ report });
});
