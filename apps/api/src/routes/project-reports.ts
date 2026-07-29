import { Router } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { z } from "zod";
import { projectReportCatalog, projectReportTypes, reportFrequencies } from "@webtummy/core/reporting";
import { canAccessProject, createWorkspaceNotification, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";
import { createProfessionalReportPdf } from "../report-pdf.js";
import { agencyProposalContent } from "@webtummy/core/agency-documents";

export const projectReportsRouter = Router();

const generateSchema = z.object({ projectId: z.string().min(1), reportType: z.enum(projectReportTypes), exportFormat: z.enum(["pdf", "html", "secure_link"]).default("secure_link") });
const approvalSchema = z.object({ decision: z.enum(["approved", "rejected"]), notes: z.string().trim().max(5000).optional() });
const scheduleSchema = z.object({ projectId: z.string().min(1), reportType: z.enum(projectReportTypes), frequency: z.enum(reportFrequencies), automaticClientDelivery: z.boolean().default(false) });
const preferencesSchema = z.object({ nonCriticalEmail: z.boolean(), emailFrequency: z.enum(["immediate", "daily", "weekly", "monthly"]), reportEmails: z.boolean(), inAppNotifications: z.literal(true).default(true) });
const brandingSchema = z.object({
  agencyName: z.string().trim().min(1).max(180), preparedByName: z.string().trim().max(180).optional().nullable(),
  contactEmail: z.string().email().optional().nullable(), colorPreference: z.string().regex(/^#[0-9a-f]{6}$/i).default("#0F9F8F"),
  footerDisclaimer: z.string().trim().max(1000).optional().nullable(),
});
const proposalEditSchema = z.object({
  title: z.string().trim().min(1).max(255), executiveSummary: z.string().trim().min(20).max(10000),
  objectives: z.array(z.string().trim().min(1).max(500)).min(1).max(20), opportunity: z.string().trim().min(1).max(5000),
  scope: z.array(z.string().trim().min(1).max(1000)).min(1).max(50), deliverables: z.array(z.string().trim().min(1).max(1000)).min(1).max(50),
  timeline: z.string().trim().min(1).max(1000), investment: z.object({ currency: z.string().trim().min(3).max(8), setupFee: z.string().trim().min(1).max(80), monthlyFee: z.string().trim().min(1).max(80), lineItems: z.array(z.object({ label: z.string().trim().min(1).max(255), amount: z.string().trim().min(1).max(80) })).max(30) }),
  assumptions: z.array(z.string().trim().min(1).max(1000)).max(30), nextSteps: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
});

function fail(message: string, statusCode = 403) {
  throw Object.assign(new Error(message), { statusCode });
}

async function scopedProject(context: Awaited<ReturnType<typeof workspaceContext>>, projectId: string) {
  if (!await canAccessProject(context, projectId)) fail("Project not found.", 404);
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...(context.workspace.legacyClientId ? { clientId: context.workspace.legacyClientId } : {}) },
    include: {
      agencyClient: { select: { id: true, name: true } }, website: { select: { id: true, domain: true, crawlJobs: { where: { status: "completed" }, orderBy: { completedAt: "desc" }, take: 1, select: { siteScore: true, pagesCrawled: true, completedAt: true, _count: { select: { issues: true } } } } } },
      keywordResearchRuns: { where: { status: "completed" }, orderBy: { createdAt: "desc" }, take: 100, select: { seedKeyword: true, locationName: true, targetRank: true, manualRank: true, averageVolume: true, competitorCount: true, createdAt: true } },
      opportunities: { where: { status: { in: ["selected", "confirmed"] } }, orderBy: { createdAt: "desc" }, take: 1 },
      keywordGroups: { select: { id: true, title: true, status: true, keywords: true } },
      strategyPlans: { orderBy: { updatedAt: "desc" }, take: 1 },
      backlinkProfileSnapshots: { orderBy: { capturedAt: "desc" }, take: 2 },
      authorityOpportunities: { where: { status: { not: "superseded" } }, orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }] },
      authorityAssets: { orderBy: { createdAt: "desc" } },
      earnedMentions: { orderBy: [{ earnedAt: "desc" }, { createdAt: "desc" }] },
      authorityPerformanceMetrics: { orderBy: { periodEnd: "desc" }, take: 100 },
      executionTasks: { orderBy: { createdAt: "desc" }, select: { id: true, title: true, moduleName: true, status: true, priority: true, requiresApproval: true, approvedAt: true, publishedAt: true, completedAt: true, dueAt: true, assignee: { select: { user: { select: { name: true, email: true } } } }, approver: { select: { user: { select: { name: true, email: true } } } } } },
      memberAssignments: { select: { membershipId: true } },
      teamAssignments: { select: { team: { select: { members: { select: { membershipId: true } } } } } },
    },
  });
  if (!project) fail("Project not found.", 404);
  return project;
}

function reportContent(project: Awaited<ReturnType<typeof scopedProject>>, reportType: typeof projectReportTypes[number], branding: Record<string, unknown>) {
  const definition = projectReportCatalog.find((item) => item.type === reportType)!;
  const completed = project.executionTasks.filter((task) => task.completedAt || task.status === "completed");
  const published = project.executionTasks.filter((task) => task.publishedAt || task.status === "published");
  const awaitingApproval = project.executionTasks.filter((task) => task.requiresApproval && !task.approvedAt);
  const blocked = project.executionTasks.filter((task) => ["blocked", "failed"].includes(task.status));
  const scheduled = project.executionTasks.filter((task) => task.dueAt && !task.completedAt && !task.publishedAt);
  const approvedKeywordGroups = project.keywordGroups.filter((group) => group.status === "approved");
  const contentTasks = project.executionTasks.filter((task) => /content|page|publish/i.test(`${task.moduleName} ${task.title}`));
  const unavailable = "Connect the relevant analytics integration to populate this metric.";
  const strategy = project.strategyPlans[0];
  const crawl = project.website?.crawlJobs[0];
  const selectedOpportunity = project.opportunities[0];
  const rankingRuns = project.keywordResearchRuns;
  const latestRankings = new Map<string, typeof rankingRuns[number]>();
  const previousRankings = new Map<string, typeof rankingRuns[number]>();
  for (const run of rankingRuns) {
    const key = `${run.seedKeyword.toLocaleLowerCase()}|${run.locationName.toLocaleLowerCase()}`;
    if (!latestRankings.has(key)) latestRankings.set(key, run); else if (!previousRankings.has(key)) previousRankings.set(key, run);
  }
  const rankingChanges = [...latestRankings.entries()].map(([key, run]) => { const rank = run.manualRank ?? run.targetRank; const previous = previousRankings.get(key); const previousRank = previous?.manualRank ?? previous?.targetRank; return { keyword: run.seedKeyword, location: run.locationName, rank, previousRank, change: rank != null && previousRank != null ? previousRank - rank : null, averageVolume: run.averageVolume, competitors: run.competitorCount }; }).slice(0, 30);
  const latestBacklinkSnapshot = project.backlinkProfileSnapshots[0];
  const previousBacklinkSnapshot = project.backlinkProfileSnapshots[1];
  const earnedReferralVisits = project.earnedMentions.reduce((sum, mention) => sum + mention.referralVisits, 0);
  const earnedReferralLeads = project.earnedMentions.reduce((sum, mention) => sum + mention.referralLeads, 0);
  const backlinkProgress = latestBacklinkSnapshot ? {
    capturedAt: latestBacklinkSnapshot.capturedAt,
    totalBacklinks: latestBacklinkSnapshot.totalBacklinks,
    referringDomains: latestBacklinkSnapshot.referringDomains,
    referringDomainChange: previousBacklinkSnapshot ? latestBacklinkSnapshot.referringDomains - previousBacklinkSnapshot.referringDomains : null,
    newBacklinks: latestBacklinkSnapshot.newBacklinks,
    lostBacklinks: latestBacklinkSnapshot.lostBacklinks,
    earnedMentions: project.earnedMentions.length,
    referralVisits: earnedReferralVisits,
    referralLeads: earnedReferralLeads,
  } : null;
  const storedScoreBreakdown = strategy?.scoreBreakdown && typeof strategy.scoreBreakdown === "object" ? strategy.scoreBreakdown as Record<string, unknown> : {};
  const strategyScore = strategy?.strategyScore ?? selectedOpportunity?.opportunityScore ?? null;
  const strategyScoreBreakdown = {
    profileDemandFit: typeof storedScoreBreakdown.profileDemandFit === "number" ? storedScoreBreakdown.profileDemandFit : selectedOpportunity?.userFitScore ?? strategyScore,
    seoPotential: typeof storedScoreBreakdown.seoPotential === "number" ? storedScoreBreakdown.seoPotential : selectedOpportunity?.seoScore ?? strategyScore,
    revenuePotential: typeof storedScoreBreakdown.revenuePotential === "number" ? storedScoreBreakdown.revenuePotential : selectedOpportunity?.monetizationScore ?? strategyScore,
    executionComplexity: typeof storedScoreBreakdown.executionComplexity === "number" ? storedScoreBreakdown.executionComplexity : selectedOpportunity?.executionScore ?? 50,
    confidence: typeof storedScoreBreakdown.confidence === "number" ? storedScoreBreakdown.confidence : selectedOpportunity?.opportunityScore ?? strategyScore,
  };
  const base = {
    title: definition.title, reportType, project: { id: project.id, name: project.name, businessName: project.businessName, website: project.website?.domain ?? project.websiteUrl, primaryGoal: project.primaryGoal, targetMarkets: project.targetLocations },
    branding,
    generatedAt: new Date().toISOString(), health: { workflowStep: project.currentStep, strategyStatus: project.strategyPlans[0]?.status ?? "not_started", completedTasks: completed.length, totalTasks: project.executionTasks.length, blockedTasks: blocked.length },
    seo: { approvedKeywordGroups: approvedKeywordGroups.length, approvedKeywords: approvedKeywordGroups.flatMap((group) => Array.isArray(group.keywords) ? group.keywords.map(String) : []).length, websiteConnected: Boolean(project.websiteId) },
    performance: { keywordRankingChanges: rankingChanges, trackedKeywords: rankingChanges.length, rankingLocations: [...new Set(rankingChanges.map((item) => item.location))], averageSearchVolume: rankingRuns.length ? Math.round(rankingRuns.reduce((sum, run) => sum + (run.averageVolume ?? 0), 0) / rankingRuns.length) : null, serpCompetitors: Math.max(0, ...rankingRuns.map((run) => run.competitorCount)), organicTraffic: null, searchImpressions: null, searchClicks: null, indexedPages: crawl?.pagesCrawled ?? null, backlinkProgress, competitorVisibilityChanges: null, unavailableReason: unavailable },
    authorityGrowth: {
      profile: backlinkProgress,
      opportunities: {
        discovered: project.authorityOpportunities.filter((item) => item.status === "discovered").length,
        shortlisted: project.authorityOpportunities.filter((item) => ["shortlisted", "researching"].includes(item.status)).length,
        approved: project.authorityOpportunities.filter((item) => item.status === "approved").length,
      },
      assets: {
        planned: project.authorityAssets.filter((item) => item.status === "planned").length,
        completed: project.authorityAssets.filter((item) => item.status === "completed").length,
      },
      earnedMentions: project.earnedMentions.map((mention) => ({ sourceDomain: mention.sourceDomain, mentionType: mention.mentionType, linkAttribute: mention.linkAttribute, referralVisits: mention.referralVisits, referralLeads: mention.referralLeads, earnedAt: mention.earnedAt })),
    },
    localSeo: { googleBusinessProfilePerformance: null, localGridRankings: null, citationsAndNapIssues: null, recommendations: ["Connect Google Business Profile and Local SEO tracking to populate local performance."] },
    reputation: { newReviews: null, negativeReviewsNeedingAttention: null, averageRating: null, ratingChange: null, responseStatus: null, trends: null, unavailableReason: unavailable },
    execution: { completed: completed.map((task) => ({ title: task.title, module: task.moduleName, completedBy: task.assignee?.user.name || task.assignee?.user.email || "Unassigned", approvedBy: task.approver?.user.name || task.approver?.user.email || null })), published: published.map((task) => task.title), awaitingApproval: awaitingApproval.map((task) => task.title), blocked: blocked.map((task) => task.title), scheduledNext: scheduled.slice(0, 20).map((task) => ({ title: task.title, dueAt: task.dueAt })) },
    contentPublishing: { created: contentTasks.length, approved: contentTasks.filter((task) => Boolean(task.approvedAt)).length, published: contentTasks.filter((task) => Boolean(task.publishedAt) || task.status === "published").map((task) => task.title), performance: null, unavailableReason: unavailable },
    strategy: strategy ? { version: strategy.version, status: strategy.status, score: strategyScore, scoreBreakdown: strategyScoreBreakdown, summary: strategy.strategySummary, businessObjectives: strategy.businessObjectives, positioning: strategy.positioningStatement, audience: strategy.audienceProfile, offer: strategy.offerRecommendation, businessModel: strategy.businessModel, seo: strategy.seoStrategy, localSeo: strategy.localSeoStrategy, content: strategy.contentStrategy, competitors: strategy.competitorStrategy, competitiveInsights: strategy.competitiveInsights, authority: strategy.authorityStrategy, growthRecommendations: strategy.growthRecommendations, social: strategy.socialStrategy, publishing: strategy.publishingStrategy, kpis: strategy.kpis, revisionInstructions: strategy.revisionComment, approvedAt: strategy.approvedAt } : null,
    evidence: { selectedOpportunity: selectedOpportunity?.name ?? null, opportunityScore: selectedOpportunity?.opportunityScore ?? null, businessLocation: project.businessLocation, targetMarkets: project.targetLocations, approvedKeywordGroups: approvedKeywordGroups.map((group) => ({ title: group.title, keywords: group.keywords })), siteAnalysis: crawl ? { score: crawl.siteScore, pagesCrawled: crawl.pagesCrawled, issuesFound: crawl._count.issues, completedAt: crawl.completedAt } : null },
    ecommerce: { productAndCollectionOptimization: project.executionTasks.filter((task) => /product|collection/i.test(`${task.moduleName} ${task.title}`)).map((task) => task.title), organicProductTraffic: null, storeSeoIssues: blocked.filter((task) => /store|product|collection|shopify/i.test(`${task.moduleName} ${task.title}`)).map((task) => task.title), productPagePerformance: null, publishedStoreChanges: published.filter((task) => /store|product|collection|shopify/i.test(`${task.moduleName} ${task.title}`)).map((task) => task.title), salesAndConversions: null, unavailableReason: unavailable },
    sections: definition.sections, recommendations: blocked.length ? ["Resolve blocked work before the next milestone."] : ["Continue with the next approved execution priorities."],
    clientSafe: "clientSafe" in definition && definition.clientSafe === true,
  };
  if (reportType !== "agency_proposal") return base;
  return { ...base, proposal: agencyProposalContent({ projectName: project.name, clientName: project.agencyClient?.name ?? project.businessName ?? project.name, primaryGoal: project.primaryGoal, targetMarkets: project.targetLocations, timeline: project.targetLaunchTimeline, outputs: project.preferredOutputs, strategySummary: strategy?.strategySummary, opportunityName: selectedOpportunity?.name, completedTasks: completed.length, totalTasks: project.executionTasks.length }) };
}

async function agencyBranding(context: Awaited<ReturnType<typeof workspaceContext>>, projectId?: string) {
  const workspaceBrand = context.workspace.brandingJson && typeof context.workspace.brandingJson === "object" ? context.workspace.brandingJson as Record<string, unknown> : {};
  const profiles = await prisma.whiteLabelProfile.findMany({ where: { clientId: context.workspace.legacyClientId ?? "", OR: [{ projectId: projectId ?? "__none__" }, { projectId: null }] }, orderBy: { updatedAt: "desc" } });
  const profile = profiles.find((item) => item.projectId === projectId) ?? profiles.find((item) => item.projectId == null);
  return {
    agencyName: profile?.agencyName || String(workspaceBrand.agencyName || context.workspace.name),
    preparedByName: profile?.preparedByName || (typeof workspaceBrand.preparedByName === "string" ? workspaceBrand.preparedByName : null),
    contactEmail: profile?.contactEmail || (typeof workspaceBrand.contactEmail === "string" ? workspaceBrand.contactEmail : null),
    colorPreference: profile?.colorPreference || (typeof workspaceBrand.primaryColor === "string" ? workspaceBrand.primaryColor : "#0F9F8F"),
    footerDisclaimer: profile?.footerDisclaimer || (typeof workspaceBrand.footerDisclaimer === "string" ? workspaceBrand.footerDisclaimer : "Confidential — prepared for the named client only."),
  };
}

projectReportsRouter.get("/project-reports/catalog", (_req, res) => res.json({ reports: projectReportCatalog, frequencies: reportFrequencies }));

projectReportsRouter.get("/project-reports", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "view_reports")) return res.status(403).json({ error: "Report viewing permission is required." });
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
  if (!projectId || !await canAccessProject(context, projectId)) return res.status(404).json({ error: "Project not found." });
  const clientViewer = context.roles.has("client_viewer") && context.roles.size === 1;
  const reports = await prisma.gapReportExport.findMany({ where: { projectId, ...(clientViewer ? { approvalStatus: "approved", clientVisible: true } : {}) }, orderBy: { createdAt: "desc" } });
  res.json({ reports });
});

projectReportsRouter.post("/project-reports/generate", async (req, res) => {
  const context = await workspaceContext(req);
  if (context.roles.size === 1 && context.roles.has("client_viewer")) return res.status(403).json({ error: "Client Viewers can view only approved documents shared with them." });
  if (!hasWorkspacePermission(context, "export_reports")) return res.status(403).json({ error: "Report generation permission is required." });
  const data = generateSchema.parse(req.body);
  const project = await scopedProject(context, data.projectId);
  const definition = projectReportCatalog.find((item) => item.type === data.reportType)!;
  if ("ecommerceOnly" in definition && definition.ecommerceOnly && context.workspace.workspaceType !== "ecommerce" && project.projectType !== "ecommerce") return res.status(400).json({ error: "Ecommerce Reports are available only for store projects." });
  if ("agencyOnly" in definition && definition.agencyOnly && context.workspace.workspaceType !== "agency") return res.status(400).json({ error: "Agency Client Reports are available only in Agency workspaces." });
  const approvalStatus = context.workspace.workspaceType === "agency" ? "needs_review" : "approved";
  const branding = await agencyBranding(context, project.id);
  const assignedMembershipIds = new Set([...project.memberAssignments.map((item) => item.membershipId), ...project.teamAssignments.flatMap((item) => item.team.members.map((member) => member.membershipId))]);
  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.gapReportExport.create({ data: { projectId: project.id, clientId: project.clientId, reportType: data.reportType, clientName: project.agencyClient?.name ?? project.businessName ?? project.name, approvalStatus, exportFormat: data.exportFormat, status: "ready", completedAt: new Date(), contentJson: reportContent(project, data.reportType, branding) as Prisma.InputJsonValue } });
    await recordWorkspaceActivity(tx, { context, action: "report.generated", entityType: "gap_report_export", entityId: created.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { reportType: data.reportType, approvalStatus } });
    const memberships = await tx.workspaceMembership.findMany({ where: { workspaceId: context.workspace.id, status: "active", OR: [{ id: { in: [...assignedMembershipIds] } }, { userId: context.workspace.ownerUserId }] }, include: { roles: { select: { role: true } } } });
    for (const membership of memberships) {
      const roles = membership.roles.map((item) => item.role === "owner" ? "admin" : item.role === "approver" ? "manager" : item.role);
      if (!roles.some((role) => definition.audience.includes(role as never)) || roleIsClientViewer(roles)) continue;
      await createWorkspaceNotification(tx, { context, userId: membership.userId, type: "report_ready", title: `${definition.title} ready`, body: `${project.name}'s report is ready${approvalStatus === "needs_review" ? " for review" : ""}.`, actionUrl: `/reports?projectId=${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id });
    }
    return created;
  });
  res.status(201).json({ report });
});

projectReportsRouter.patch("/agency-proposals/:proposalId", async (req, res) => {
  const context = await workspaceContext(req);
  if (context.roles.has("client_viewer") || context.workspace.workspaceType !== "agency" || !hasWorkspacePermission(context, "export_reports")) return res.status(403).json({ error: "Agency proposal editing permission is required." });
  const proposal = await prisma.gapReportExport.findUnique({ where: { id: req.params.proposalId }, include: { project: true } });
  if (!proposal || proposal.reportType !== "agency_proposal" || !await canAccessProject(context, proposal.projectId)) return res.status(404).json({ error: "Proposal not found." });
  if (proposal.sentToClientAt) return res.status(409).json({ error: "A sent proposal is locked. Generate a new version before editing." });
  const data = proposalEditSchema.parse(req.body);
  const previous = proposal.contentJson && typeof proposal.contentJson === "object" ? proposal.contentJson as Record<string, unknown> : {};
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.gapReportExport.update({ where: { id: proposal.id }, data: { contentJson: { ...previous, proposal: data } as Prisma.InputJsonValue, approvalStatus: "needs_review", clientVisible: false } });
    await recordWorkspaceActivity(tx, { context, action: "proposal.edited", entityType: "gap_report_export", entityId: proposal.id, agencyClientId: proposal.project.agencyClientId, projectId: proposal.projectId, previousJson: { approvalStatus: proposal.approvalStatus, proposal: (previous.proposal ?? null) as Prisma.InputJsonValue }, nextJson: { approvalStatus: "needs_review", proposal: data } });
    return next;
  });
  res.json({ proposal: updated });
});

projectReportsRouter.get("/agency-report-branding", async (req, res) => {
  const context = await workspaceContext(req);
  if (context.workspace.workspaceType !== "agency") return res.status(404).json({ error: "Agency branding is available only in Agency workspaces." });
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  if (projectId && !await canAccessProject(context, projectId)) return res.status(404).json({ error: "Project not found." });
  res.json({ branding: await agencyBranding(context, projectId) });
});

projectReportsRouter.put("/agency-report-branding", async (req, res) => {
  const context = await workspaceContext(req);
  if (context.workspace.workspaceType !== "agency" || !hasWorkspacePermission(context, "manage_settings")) return res.status(403).json({ error: "Owner/Admin permission is required to manage report branding." });
  if (!context.workspace.legacyClientId) return res.status(409).json({ error: "Workspace billing identity is required before saving branding." });
  const data = brandingSchema.parse(req.body);
  const current = await prisma.whiteLabelProfile.findFirst({ where: { clientId: context.workspace.legacyClientId, projectId: null }, orderBy: { updatedAt: "desc" } });
  const branding = current ? await prisma.whiteLabelProfile.update({ where: { id: current.id }, data }) : await prisma.whiteLabelProfile.create({ data: { clientId: context.workspace.legacyClientId, projectId: null, ...data } });
  await prisma.workspaceActivity.create({ data: { workspaceId: context.workspace.id, actorUserId: context.membership.userId, action: "report_branding.updated", entityType: "white_label_profile", entityId: branding.id, nextJson: data } });
  res.json({ branding: data });
});

projectReportsRouter.patch("/project-reports/:reportId/approval", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const data = approvalSchema.parse(req.body);
  const report = await prisma.gapReportExport.findUnique({ where: { id: req.params.reportId }, include: { project: true } });
  if (!report || !await canAccessProject(context, report.projectId)) return res.status(404).json({ error: "Report not found." });
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.gapReportExport.update({ where: { id: report.id }, data: { approvalStatus: data.decision } });
    if (data.decision === "approved") {
      const content = report.contentJson && typeof report.contentJson === "object" ? report.contentJson as Record<string, unknown> : {};
      const recommendations = Array.isArray(content.recommendations) ? content.recommendations.map(String).filter(Boolean) : [];
      if (recommendations.length) {
        let plan = await tx.executionPlan.findFirst({ where: { projectId: report.projectId, status: "active" }, orderBy: { createdAt: "asc" } });
        if (!plan) plan = await tx.executionPlan.create({ data: { projectId: report.projectId, title: "Guided execution plan" } });
        for (const [index, recommendation] of recommendations.entries()) await tx.executionTask.upsert({
          where: { dedupeKey: `report:${report.id}:recommendation:${index}` },
          update: { title: recommendation.slice(0, 255), description: recommendation, expectedOutcome: "Complete the approved report recommendation and reflect the result in the next project report.", priority: "medium", status: "ready" },
          create: { clientId: report.clientId, projectId: report.projectId, executionPlanId: plan.id, moduleName: "reports", sourceType: "approved_report", sourceId: report.id, dedupeKey: `report:${report.id}:recommendation:${index}`, title: recommendation.slice(0, 255), description: recommendation, expectedOutcome: "Complete the approved report recommendation and reflect the result in the next project report.", priority: "medium", automationLevel: "manual_guided", status: "ready", requiresApproval: false, manualRequired: true, actionButtonLabel: "Open Report", relatedUrl: `/reports?projectId=${report.projectId}` },
        });
      }
    }
    await recordWorkspaceActivity(tx, { context, action: `report.${data.decision}`, entityType: "gap_report_export", entityId: report.id, agencyClientId: report.project.agencyClientId, projectId: report.projectId, previousJson: { approvalStatus: report.approvalStatus }, nextJson: { approvalStatus: data.decision, notes: data.notes ?? null } });
    return next;
  });
  res.json({ report: updated });
});

projectReportsRouter.get("/project-reports/:reportId/download", async (req, res) => {
  const context = await workspaceContext(req);
  const clientViewer = context.roles.has("client_viewer") && context.roles.size === 1;
  if (clientViewer ? !hasWorkspacePermission(context, "view_reports") : !hasWorkspacePermission(context, "export_reports")) return res.status(403).json({ error: "Report download permission is required." });
  const report = await prisma.gapReportExport.findUnique({ where: { id: req.params.reportId }, include: { project: { include: { agencyClient: { select: { name: true } } } } } });
  if (!report || !await canAccessProject(context, report.projectId) || (clientViewer && (report.approvalStatus !== "approved" || !report.clientVisible))) return res.status(404).json({ error: "Report not found." });
  const content = report.contentJson && typeof report.contentJson === "object" ? report.contentJson as Record<string, unknown> : {};
  const branding = content.branding && typeof content.branding === "object" ? content.branding as Record<string, unknown> : {};
  const pdf = await createProfessionalReportPdf(report.contentJson, { workspaceName: String(branding.agencyName || context.workspace.name), workspaceType: context.workspace.workspaceType, clientName: report.project.agencyClient?.name ?? report.clientName, preparedByName: typeof branding.preparedByName === "string" ? branding.preparedByName : null, contactEmail: typeof branding.contactEmail === "string" ? branding.contactEmail : null, primaryColor: typeof branding.colorPreference === "string" ? branding.colorPreference : null, footerDisclaimer: typeof branding.footerDisclaimer === "string" ? branding.footerDisclaimer : null });
  const safeName = `${report.project.name}-${report.reportType}`.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName || "project-report"}.pdf"`);
  res.setHeader("Content-Length", String(pdf.length));
  res.send(pdf);
});

projectReportsRouter.get("/project-reports/schedules", async (req, res) => {
  const context = await workspaceContext(req);
  const requestedProjectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
  if (!requestedProjectId || !await canAccessProject(context, requestedProjectId)) return res.status(404).json({ error: "Project not found." });
  const settings = context.workspace.settingsJson && typeof context.workspace.settingsJson === "object" ? context.workspace.settingsJson as { reportSchedules?: unknown } : {};
  const schedules = Array.isArray(settings.reportSchedules) ? settings.reportSchedules : [];
  res.json({ schedules: schedules.filter((item) => item && typeof item === "object" && "projectId" in item && canScheduleProject(item, requestedProjectId)) });
});

projectReportsRouter.put("/project-reports/schedules", async (req, res) => {
  const context = await workspaceContext(req);
  if (context.roles.size === 1 && context.roles.has("client_viewer")) return res.status(403).json({ error: "Client Viewers cannot generate or schedule documents." });
  if (!hasWorkspacePermission(context, "export_reports")) return res.status(403).json({ error: "Report scheduling permission is required." });
  const data = scheduleSchema.parse(req.body);
  if (data.reportType === "agency_proposal") return res.status(400).json({ error: "Proposals must be generated, edited, reviewed, and sent manually." });
  await scopedProject(context, data.projectId);
  if (data.automaticClientDelivery && !hasWorkspacePermission(context, "manage_settings")) return res.status(403).json({ error: "Only Owner/Admin can enable automatic client delivery." });
  const previous = context.workspace.settingsJson && typeof context.workspace.settingsJson === "object" ? context.workspace.settingsJson as Record<string, unknown> : {};
  const schedules = (Array.isArray(previous.reportSchedules) ? previous.reportSchedules : []).filter((item) => !(item && typeof item === "object" && "projectId" in item && "reportType" in item && item.projectId === data.projectId && item.reportType === data.reportType));
  if (data.frequency !== "on_demand") schedules.push(data);
  await prisma.workspace.update({ where: { id: context.workspace.id }, data: { settingsJson: { ...previous, reportSchedules: schedules } as Prisma.InputJsonValue } });
  res.json({ schedules });
});

projectReportsRouter.get("/notification-preferences", async (req, res) => {
  const context = await workspaceContext(req);
  const overrides = context.membership.permissionOverrides && typeof context.membership.permissionOverrides === "object" ? context.membership.permissionOverrides as { notificationPreferences?: unknown } : {};
  res.json({ preferences: overrides.notificationPreferences ?? { nonCriticalEmail: true, emailFrequency: "daily", reportEmails: true, inAppNotifications: true }, criticalNotificationsRequired: true });
});

projectReportsRouter.patch("/notification-preferences", async (req, res) => {
  const context = await workspaceContext(req);
  const preferences = preferencesSchema.parse(req.body);
  const previous = context.membership.permissionOverrides && typeof context.membership.permissionOverrides === "object" ? context.membership.permissionOverrides as Record<string, unknown> : {};
  await prisma.workspaceMembership.update({ where: { id: context.membership.id }, data: { permissionOverrides: { ...previous, notificationPreferences: preferences } as Prisma.InputJsonValue } });
  res.json({ preferences, criticalNotificationsRequired: true });
});

function roleIsClientViewer(roles: string[]) { return roles.length === 1 && roles[0] === "client_viewer"; }
function canScheduleProject(item: object, requested: unknown) { return typeof requested !== "string" || (item as { projectId?: unknown }).projectId === requested; }
