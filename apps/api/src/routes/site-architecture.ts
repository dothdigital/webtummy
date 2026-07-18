import { Router } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { z } from "zod";
import { requireAuth } from "../middleware.js";
import { canAccessProject, createWorkspaceNotification, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";

export const siteArchitectureRouter = Router();
siteArchitectureRouter.use(requireAuth);

const decisionSchema = z.object({ comments: z.string().trim().max(4000).optional().nullable() });

const list = (value: Prisma.JsonValue | null | undefined) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
const unique = (values: string[], limit = 30) => [...new Map(values.map((value) => value.trim()).filter(Boolean).map((value) => [value.toLowerCase(), value])).values()].slice(0, limit);
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "page";
const keyFor = (value: string) => slug(value).replaceAll("-", "_");

async function contextProject(req: Parameters<typeof workspaceContext>[0], permission?: string) {
  const context = await workspaceContext(req);
  const projectId = req.params.projectId;
  if (!(await canAccessProject(context, projectId))) throw Object.assign(new Error("Project unavailable."), { statusCode: 404 });
  if (permission && !hasWorkspacePermission(context, permission)) throw Object.assign(new Error("Insufficient workspace permission."), { statusCode: 403 });
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: {
    businessProfile: true,
    keywordGroups: { where: { status: "approved" }, orderBy: { createdAt: "asc" } },
    strategyPlans: { orderBy: { version: "desc" }, take: 1 },
    opportunities: { where: { status: { in: ["selected", "confirmed"] } }, take: 1 },
    gapRecommendations: { where: { status: "approved" }, orderBy: { impactScore: "desc" }, take: 20 },
  } });
  if (!project) throw Object.assign(new Error("Project unavailable."), { statusCode: 404 });
  return { context, project };
}

type PagePlan = {
  pageKey: string; parentPageKey?: string | null; title: string; suggestedUrl: string; pageType: string; navigationGroup: string;
  category?: string | null; searchIntent: string; purpose: string; recommendationWhy: string; targetKeywords: string[]; status: string; sortOrder: number;
};

function addPage(target: PagePlan[], input: Omit<PagePlan, "sortOrder">) {
  if (target.some((page) => page.pageKey === input.pageKey || page.suggestedUrl === input.suggestedUrl)) return;
  target.push({ ...input, sortOrder: target.length });
}

async function architectureEvidence(project: Awaited<ReturnType<typeof contextProject>>["project"]) {
  const crawl = project.websiteId ? await prisma.crawlJob.findFirst({ where: { websiteId: project.websiteId, status: "completed" }, orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }], include: { pages: { take: 250, select: { url: true, finalUrl: true, isOrphan: true, inlinkCount: true, wordCount: true, statusCode: true, seo: { select: { title: true, h1: true } } } }, issues: { where: { status: "open" }, take: 100, select: { category: true, severity: true, message: true } } } }) : null;
  return { crawl };
}

function buildArchitecture(project: Awaited<ReturnType<typeof contextProject>>["project"], evidence: Awaited<ReturnType<typeof architectureEvidence>>) {
  const strategy = project.strategyPlans[0];
  const business = project.businessName || project.name;
  const offerParts = unique((project.businessProfile?.offerSummary || project.niche || "Services").split(/[,;\n]|\band\b/gi), 6);
  const markets = unique(list(project.targetLocations), 8);
  const groups = project.keywordGroups;
  const existingUrls = new Set((evidence.crawl?.pages ?? []).map((page) => {
    try { return new URL(page.finalUrl || page.url).pathname.replace(/\/$/, "") || "/"; } catch { return page.url; }
  }));
  const pages: PagePlan[] = [];
  const statusFor = (url: string) => existingUrls.has(url.replace(/\/$/, "") || "/") ? "existing" : "recommended";
  addPage(pages, { pageKey: "home", title: "Home", suggestedUrl: "/", pageType: "core", navigationGroup: "main", searchIntent: "commercial", purpose: `Explain ${business}'s primary value and route visitors to the right service, proof, resource, and conversion path.`, recommendationWhy: "Every architecture needs one clear entry point aligned to the Primary Goal and primary conversion action.", targetKeywords: [], status: statusFor("/") });
  const serviceKeys: string[] = [];
  for (const service of offerParts) {
    const pageKey = `service_${keyFor(service)}`;
    serviceKeys.push(pageKey);
    const url = `/services/${slug(service)}`;
    addPage(pages, { pageKey, parentPageKey: "services", title: service, suggestedUrl: url, pageType: "service", navigationGroup: "services", category: "Services", searchIntent: "transactional", purpose: `Help buyers evaluate ${service}, understand outcomes and proof, and take the project’s primary conversion action.`, recommendationWhy: "A dedicated service page prevents mixed intent and gives commercial keywords one clear owning URL.", targetKeywords: groups.flatMap((group) => list(group.keywords)).filter((keyword) => keyword.toLowerCase().includes(service.toLowerCase().split(" ")[0])).slice(0, 8), status: statusFor(url) });
  }
  addPage(pages, { pageKey: "services", parentPageKey: "home", title: "Services / Solutions", suggestedUrl: "/services", pageType: "hub", navigationGroup: "main", category: "Services", searchIntent: "commercial", purpose: "Summarize the complete offer and route each visitor to the correct dedicated service page.", recommendationWhy: "A service hub keeps navigation understandable and distributes internal-link equity to commercial pages.", targetKeywords: [], status: statusFor("/services") });
  const pillarKeys: string[] = [];
  for (const group of groups.slice(0, 7)) {
    const keywords = unique(list(group.keywords), 12);
    if (!keywords.length) continue;
    const pageKey = `pillar_${keyFor(group.title)}`;
    pillarKeys.push(pageKey);
    const url = `/resources/${slug(group.title)}`;
    addPage(pages, { pageKey, parentPageKey: "resources", title: `${group.title} Guide`, suggestedUrl: url, pageType: "pillar", navigationGroup: "resources", category: group.title, searchIntent: group.category === "buyer_intent" ? "commercial" : group.category === "local" ? "local" : "informational", purpose: `Build authoritative coverage for ${group.title} and connect supporting questions to relevant service and conversion pages.`, recommendationWhy: `${keywords.length} approved keywords need one coherent topical owner instead of competing pages.`, targetKeywords: keywords.slice(0, 8), status: statusFor(url) });
    for (const keyword of keywords.filter((item) => /^(how|what|why|when|where|can|does|is)\b/i.test(item) || item.split(/\s+/).length >= 5).slice(0, 3)) {
      const supportKey = `support_${keyFor(keyword)}`;
      const supportUrl = `/resources/${slug(keyword)}`;
      addPage(pages, { pageKey: supportKey, parentPageKey: pageKey, title: keyword.replace(/\b\w/g, (char) => char.toUpperCase()), suggestedUrl: supportUrl, pageType: "supporting", navigationGroup: "resources", category: group.title, searchIntent: "informational", purpose: `Answer “${keyword}” clearly, provide evidence, and guide the reader to the related pillar and service page.`, recommendationWhy: "Question and long-tail intent is best handled by a focused supporting page connected to its pillar.", targetKeywords: [keyword], status: statusFor(supportUrl) });
    }
  }
  addPage(pages, { pageKey: "resources", parentPageKey: "home", title: "Resources", suggestedUrl: "/resources", pageType: "hub", navigationGroup: "main", category: "Resources", searchIntent: "informational", purpose: "Organize pillar and supporting content by user need rather than showing an unstructured post archive.", recommendationWhy: "A resource hub makes topical relationships clear to users, search engines, and AI systems.", targetKeywords: [], status: statusFor("/resources") });
  for (const market of markets.slice(0, 6)) {
    const pageKey = `location_${keyFor(market)}`;
    const url = `/locations/${slug(market)}`;
    addPage(pages, { pageKey, parentPageKey: "locations", title: `${offerParts[0] || project.niche || "Services"} in ${market}`, suggestedUrl: url, pageType: "location", navigationGroup: "locations", category: "Locations", searchIntent: "local", purpose: `Explain genuine service availability, proof, and relevance for ${market} without duplicating other location pages.`, recommendationWhy: `${market} is a saved Target Market and needs unique, locally useful coverage when the business genuinely serves it.`, targetKeywords: groups.flatMap((group) => list(group.keywords)).filter((keyword) => keyword.toLowerCase().includes(market.toLowerCase())).slice(0, 8), status: statusFor(url) });
  }
  if (markets.length) addPage(pages, { pageKey: "locations", parentPageKey: "home", title: "Locations / Service Areas", suggestedUrl: "/locations", pageType: "hub", navigationGroup: "main", category: "Locations", searchIntent: "local", purpose: "Show the business’s real service coverage and route visitors to relevant market pages.", recommendationWhy: "Target Markets must be represented separately from the primary Business Location.", targetKeywords: [], status: statusFor("/locations") });
  addPage(pages, { pageKey: "about", parentPageKey: "home", title: "About", suggestedUrl: "/about", pageType: "trust", navigationGroup: "main", searchIntent: "navigational", purpose: "Establish organization, people, expertise, process, proof, and entity clarity.", recommendationWhy: "Visible experience and business identity support trust, EEAT, conversions, and AI understanding.", targetKeywords: [], status: statusFor("/about") });
  addPage(pages, { pageKey: "contact", parentPageKey: "home", title: "Contact / Consultation", suggestedUrl: "/contact", pageType: "conversion", navigationGroup: "main", searchIntent: "transactional", purpose: `Provide the clearest path to ${project.primaryGoal || "contact the business"}.`, recommendationWhy: "High-intent visitors need one consistent conversion destination from services, resources, and location pages.", targetKeywords: [], status: statusFor("/contact") });

  const pageKeys = new Set(pages.map((page) => page.pageKey));
  for (const page of pages) if (page.parentPageKey && !pageKeys.has(page.parentPageKey)) page.parentPageKey = "home";
  const links: { sourcePageKey: string; targetPageKey: string; anchorText: string; linkType: string; rationale: string }[] = [];
  const addLink = (sourcePageKey: string, targetPageKey: string, anchorText: string, linkType: string, rationale: string) => {
    if (sourcePageKey === targetPageKey || !pageKeys.has(sourcePageKey) || !pageKeys.has(targetPageKey) || links.some((link) => link.sourcePageKey === sourcePageKey && link.targetPageKey === targetPageKey)) return;
    links.push({ sourcePageKey, targetPageKey, anchorText, linkType, rationale });
  };
  for (const key of ["services", "resources", "locations", "about", "contact"]) addLink("home", key, pages.find((page) => page.pageKey === key)?.title || key, "navigation", "The homepage should route users to every primary journey and trust destination.");
  for (const key of serviceKeys) { addLink("services", key, pages.find((page) => page.pageKey === key)?.title || "Service", "hub", "The service hub distributes relevance and navigation to each focused commercial page."); addLink(key, "contact", "Discuss this service", "conversion", "Every commercial page needs a consistent conversion path."); }
  for (const key of pillarKeys) { addLink("resources", key, pages.find((page) => page.pageKey === key)?.title || "Guide", "hub", "The resource hub establishes topical hierarchy."); if (serviceKeys[0]) addLink(key, serviceKeys[0], offerParts[0] || "Related service", "contextual", "Pillar content should connect research intent to the most relevant commercial solution."); }
  for (const page of pages.filter((item) => item.pageType === "supporting")) { if (page.parentPageKey) addLink(page.pageKey, page.parentPageKey, pages.find((item) => item.pageKey === page.parentPageKey)?.title || "Complete guide", "contextual", "Supporting content should reinforce its owning pillar."); }
  for (const page of pages.filter((item) => item.pageType === "location")) { if (serviceKeys[0]) addLink(page.pageKey, serviceKeys[0], offerParts[0] || "Service details", "contextual", "Market pages should connect to the genuine service being offered."); addLink(page.pageKey, "contact", `Contact ${business}`, "conversion", "Local visitors need a clear next action."); }

  return {
    pages,
    links,
    summary: `A ${pages.length}-page architecture for ${business}, organized around ${serviceKeys.length} service page${serviceKeys.length === 1 ? "" : "s"}, ${pillarKeys.length} topical pillar${pillarKeys.length === 1 ? "" : "s"}, ${markets.length} target market${markets.length === 1 ? "" : "s"}, and one consistent conversion path.`,
    rationale: `The structure uses ${groups.length} approved keyword group${groups.length === 1 ? "" : "s"}, the approved Strategy, ${evidence.crawl?.pagesCrawled ?? 0} crawled pages, project goals, audience, offer, target markets, approved gaps, and existing URLs. Recommendations separate commercial, informational, local, trust, and conversion intent while avoiding duplicate URLs.`,
    strategy,
  };
}

async function activePlanId(tx: Prisma.TransactionClient, projectId: string) {
  const existing = await tx.executionPlan.findFirst({ where: { projectId, status: "active" }, orderBy: { createdAt: "asc" } });
  if (existing) return existing.id;
  return (await tx.executionPlan.create({ data: { projectId, title: "Site architecture execution plan", summary: "Tasks created from an approved Site Architecture version." } })).id;
}

siteArchitectureRouter.get("/projects/:projectId/site-architecture", async (req, res, next) => {
  try {
    const { context, project } = await contextProject(req);
    const clientViewer = context.roles.size === 1 && context.roles.has("client_viewer");
    const versions = await prisma.siteArchitectureVersion.findMany({ where: { projectId: project.id, ...(clientViewer ? { status: "approved" } : {}) }, orderBy: { version: "desc" }, include: { pages: { orderBy: { sortOrder: "asc" } }, links: true, decisions: { orderBy: { createdAt: "desc" } } } });
    res.json({ projectId: project.id, versions, current: versions[0] ?? null, capabilities: { canGenerate: hasWorkspacePermission(context, "run_ai_analysis"), canApprove: hasWorkspacePermission(context, "approve"), readOnly: !hasWorkspacePermission(context, "run_ai_analysis"), clientViewer } });
  } catch (error) { next(error); }
});

siteArchitectureRouter.post("/projects/:projectId/site-architecture/generate", async (req, res, next) => {
  try {
    const { context, project } = await contextProject(req, "run_ai_analysis");
    if (!project.businessProfile) return res.status(409).json({ error: "Complete Project Intake before generating Site Architecture." });
    if (!project.primaryGoal) return res.status(409).json({ error: "Select a Primary Goal before generating Site Architecture." });
    if (!project.keywordGroups.length) return res.status(409).json({ error: "Approve at least one Keyword Intelligence group before generating Site Architecture." });
    const strategy = project.strategyPlans[0];
    if (!strategy || strategy.status !== "approved") return res.status(409).json({ error: "Approve the Strategy before generating Site Architecture." });
    const evidence = await architectureEvidence(project);
    const existingWebsite = project.websiteStatus === "existing_website" || project.projectType === "existing_website";
    if (existingWebsite && !evidence.crawl) return res.status(409).json({ error: "Complete Site Analysis before generating architecture for an existing website." });
    const generated = buildArchitecture(project, evidence);
    const latest = await prisma.siteArchitectureVersion.findFirst({ where: { projectId: project.id }, orderBy: { version: "desc" }, select: { version: true } });
    const version = (latest?.version ?? 0) + 1;
    const result = await prisma.$transaction(async (tx) => {
      const architecture = await tx.siteArchitectureVersion.create({ data: {
        projectId: project.id, clientId: project.clientId, version, status: "draft", title: `${project.name} Site Architecture v${version}`,
        executiveSummary: generated.summary, rationale: generated.rationale, goalsJson: [project.primaryGoal, ...list(project.secondaryGoals)],
        evidenceJson: { strategyId: strategy.id, keywordGroupIds: project.keywordGroups.map((item) => item.id), crawlId: evidence.crawl?.id ?? null, approvedGapIds: project.gapRecommendations.map((item) => item.id), targetMarkets: list(project.targetLocations) }, createdByUserId: context.membership.userId,
        pages: { create: generated.pages.map(({ targetKeywords, ...page }) => ({ ...page, targetKeywordsJson: targetKeywords })) },
        links: { create: generated.links },
        decisions: { create: { actorUserId: context.membership.userId, decision: "generated", snapshotJson: { pageCount: generated.pages.length, linkCount: generated.links.length } } },
      }, include: { pages: { orderBy: { sortOrder: "asc" } }, links: true, decisions: true } });
      await tx.aiRun.create({ data: { projectId: project.id, clientId: project.clientId, moduleName: "site_architect", promptVersion: "dev-011b-evidence-v1", inputSnapshotJson: architecture.evidenceJson, outputJson: { architectureId: architecture.id, version, pageCount: architecture.pages.length, linkCount: architecture.links.length }, outputText: architecture.executiveSummary, status: "completed" } });
      await recordWorkspaceActivity(tx, { context, action: "site_architecture.generated", entityType: "site_architecture", entityId: architecture.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { version, status: "draft", pageCount: architecture.pages.length, linkCount: architecture.links.length } });
      const approvers = await tx.workspaceMembership.findMany({ where: { workspaceId: context.workspace.id, status: "active", roles: { some: { role: { in: ["owner", "admin", "manager", "approver"] } } } }, select: { userId: true } });
      for (const userId of [...new Set([context.workspace.ownerUserId, ...approvers.map((item) => item.userId)])]) await createWorkspaceNotification(tx, { context, userId, type: "site_architecture_ready", title: "Architecture ready for review", body: `${project.name} Site Architecture v${version} recommends ${architecture.pages.length} pages and ${architecture.links.length} internal links.`, actionUrl: `/site-architect?projectId=${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id });
      return architecture;
    });
    res.status(201).json({ architecture: result });
  } catch (error) { next(error); }
});

siteArchitectureRouter.post("/projects/:projectId/site-architecture/:architectureId/approve", async (req, res, next) => {
  try {
    const input = decisionSchema.parse(req.body ?? {});
    const { context, project } = await contextProject(req, "approve");
    const architecture = await prisma.siteArchitectureVersion.findFirst({ where: { id: req.params.architectureId, projectId: project.id }, include: { pages: { orderBy: { sortOrder: "asc" } }, links: true } });
    if (!architecture) return res.status(404).json({ error: "Architecture version not found." });
    if (architecture.status === "approved") return res.json({ architecture, duplicate: false });
    const result = await prisma.$transaction(async (tx) => {
      await tx.siteArchitectureVersion.updateMany({ where: { projectId: project.id, status: "approved" }, data: { status: "superseded" } });
      const planId = await activePlanId(tx, project.id);
      for (const page of architecture.pages) {
        const dedupeKey = `site-architecture:${project.id}:page:${page.pageKey}`;
        const data = { clientId: project.clientId, websiteId: project.websiteId, projectId: project.id, executionPlanId: planId, moduleName: "site_architect", sourceType: "site_architecture_page", sourceId: page.id, title: `${page.status === "existing" ? "Review and align" : "Create"} ${page.title}`, description: `${page.purpose}\n\nWhy recommended: ${page.recommendationWhy}\nSuggested URL: ${page.suggestedUrl}`, expectedOutcome: `An approved ${page.pageType} page aligned to ${page.searchIntent} intent and the project architecture.`, priority: ["core", "service", "conversion"].includes(page.pageType) ? "high" : "medium", automationLevel: "manual_guided", status: "ready", requiresApproval: false, manualRequired: true, safetyCategory: "safe", actionButtonLabel: "Review Page Plan", relatedUrl: `/site-architect?projectId=${project.id}`, manualInstructions: `Prepare ${page.title} at ${page.suggestedUrl}. Target keywords: ${list(page.targetKeywordsJson).join(", ") || "Use approved page intent"}.`, impact: page.recommendationWhy };
        const existing = await tx.executionTask.findUnique({ where: { dedupeKey } });
        const task = existing && ["completed", "skipped"].includes(existing.status) ? existing : existing ? await tx.executionTask.update({ where: { id: existing.id }, data }) : await tx.executionTask.create({ data: { ...data, dedupeKey } });
        await tx.siteArchitecturePage.update({ where: { id: page.id }, data: { executionTaskId: task.id } });
      }
      for (const link of architecture.links) {
        const dedupeKey = `site-architecture:${project.id}:link:${link.sourcePageKey}:${link.targetPageKey}`;
        const data = { clientId: project.clientId, websiteId: project.websiteId, projectId: project.id, executionPlanId: planId, moduleName: "site_architect", sourceType: "site_architecture_link", sourceId: link.id, title: `Internal link: ${link.sourcePageKey.replaceAll("_", " ")} → ${link.targetPageKey.replaceAll("_", " ")}`, description: `${link.rationale}\nSuggested anchor: ${link.anchorText}`, expectedOutcome: "The approved architecture is connected with clear contextual navigation and intentional link equity.", priority: "medium", automationLevel: "manual_guided", status: "ready", requiresApproval: false, manualRequired: true, safetyCategory: "safe", actionButtonLabel: "Review Link Plan", relatedUrl: `/site-architect?projectId=${project.id}`, manualInstructions: `Add a ${link.linkType} link using a natural variation of “${link.anchorText}”.`, impact: link.rationale };
        const existing = await tx.executionTask.findUnique({ where: { dedupeKey } });
        const task = existing && ["completed", "skipped"].includes(existing.status) ? existing : existing ? await tx.executionTask.update({ where: { id: existing.id }, data }) : await tx.executionTask.create({ data: { ...data, dedupeKey } });
        await tx.siteArchitectureLink.update({ where: { id: link.id }, data: { executionTaskId: task.id } });
      }
      const approved = await tx.siteArchitectureVersion.update({ where: { id: architecture.id }, data: { status: "approved", approvedByUserId: context.membership.userId, approvedAt: new Date(), rejectedAt: null, rejectionReason: null }, include: { pages: { orderBy: { sortOrder: "asc" } }, links: true, decisions: true } });
      await tx.siteArchitectureDecision.create({ data: { architectureId: architecture.id, actorUserId: context.membership.userId, decision: "approved", comments: input.comments, snapshotJson: { pageCount: architecture.pages.length, linkCount: architecture.links.length, executionPlanId: planId } } });
      await recordWorkspaceActivity(tx, { context, action: "site_architecture.approved", entityType: "site_architecture", entityId: architecture.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: architecture.status }, nextJson: { status: "approved", version: architecture.version, pageTasks: architecture.pages.length, linkTasks: architecture.links.length } });
      for (const userId of [...new Set([architecture.createdByUserId, context.workspace.ownerUserId].filter((item): item is string => Boolean(item)))]) await createWorkspaceNotification(tx, { context, userId, type: "site_architecture_approved", title: "Site Architecture approved", body: `${project.name} Site Architecture v${architecture.version} was approved and added to the Execution Plan.`, actionUrl: `/site-architect?projectId=${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id });
      return approved;
    });
    res.json({ architecture: result });
  } catch (error) { next(error); }
});

siteArchitectureRouter.post("/projects/:projectId/site-architecture/:architectureId/reject", async (req, res, next) => {
  try {
    const input = decisionSchema.extend({ comments: z.string().trim().min(3).max(4000) }).parse(req.body ?? {});
    const { context, project } = await contextProject(req, "approve");
    const architecture = await prisma.siteArchitectureVersion.findFirst({ where: { id: req.params.architectureId, projectId: project.id } });
    if (!architecture) return res.status(404).json({ error: "Architecture version not found." });
    const rejected = await prisma.$transaction(async (tx) => {
      const row = await tx.siteArchitectureVersion.update({ where: { id: architecture.id }, data: { status: "rejected", rejectedAt: new Date(), rejectionReason: input.comments } });
      await tx.siteArchitectureDecision.create({ data: { architectureId: architecture.id, actorUserId: context.membership.userId, decision: "rejected", comments: input.comments, snapshotJson: { version: architecture.version } } });
      await recordWorkspaceActivity(tx, { context, action: "site_architecture.rejected", entityType: "site_architecture", entityId: architecture.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: architecture.status }, nextJson: { status: "rejected", comments: input.comments } });
      for (const userId of [...new Set([architecture.createdByUserId, context.workspace.ownerUserId].filter((item): item is string => Boolean(item)))]) await createWorkspaceNotification(tx, { context, userId, type: "site_architecture_rejected", title: "Site Architecture changes requested", body: `${project.name} Site Architecture v${architecture.version} was rejected: ${input.comments}`, actionUrl: `/site-architect?projectId=${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id });
      return row;
    });
    res.json({ architecture: rejected });
  } catch (error) { next(error); }
});
