import { Router, type Request } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { dev053Capabilities, type Dev053Status } from "@webtummy/core";
import { canAccessProject, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";
import { signalFingerprint } from "../growth-engine.js";

export const dev053VerificationRouter = Router();

type SignalEvidence = Record<string, string | number | boolean | null>;
type SignalResult = { status: Dev053Status; message: string; evidence: SignalEvidence };

function fail(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}

function jsonStrings(value: unknown) {
  if (Array.isArray(value)) return value.flatMap(jsonStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(jsonStrings);
  return typeof value === "string" ? [value.toLowerCase()] : [];
}

function configuredSearchProvider() {
  return Boolean(process.env.SEARCH_DATA_PROVIDER_AUTH_BASE64 || (process.env.SEARCH_DATA_PROVIDER_LOGIN && process.env.SEARCH_DATA_PROVIDER_PASSWORD));
}

async function scopedProject(req: Request, projectId: string) {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, projectId)) fail("Project not found.", 404);
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    include: { businessProfile: true },
  });
  if (!project) fail("Project not found.", 404);
  return { context, project };
}

export async function collectSignals(project: Awaited<ReturnType<typeof scopedProject>>["project"]) {
  const projectId = project.id;
  const websiteId = project.websiteId;
  const [
    brainCount, intakeCount, keywordRuns, keywordIdeas, competitorRuns, crawlCount, gapRuns,
    strategyCount, approvedStrategyCount, executionPlanCount, tasks, publishCount,
    verifiedPublicationCount, contentRoadmapCount, entities, claims, citationFindings,
    aiQueries, aiSnapshots, sourceMentions, authoritySnapshots, authorityOpportunities,
    ecommerceGuides, growthBlueprintCount, growthSignalCount, growthLearningCount,
    measurementCheckpoints, nextBestActionCount, websiteBuildCount, measurementPlans,
    trackingEvents, localProfile,
  ] = await Promise.all([
    prisma.businessBrainVersion.count({ where: { projectId } }),
    prisma.projectIntakeAnswer.count({ where: { projectId } }),
    prisma.keywordResearchRun.count({ where: { projectId, status: "completed" } }),
    prisma.keywordIdea.count({ where: { run: { projectId, status: "completed" } } }),
    prisma.competitiveIntelligenceRun.count({ where: { projectId, status: "completed" } }),
    websiteId ? prisma.crawlJob.count({ where: { websiteId, status: "completed" } }) : Promise.resolve(0),
    prisma.gapAnalysisRun.count({ where: { projectId, status: "completed" } }),
    prisma.strategyPlan.count({ where: { projectId } }),
    prisma.strategyPlan.count({ where: { projectId, status: "approved" } }),
    prisma.executionPlan.count({ where: { projectId } }),
    prisma.executionTask.findMany({ where: { projectId }, select: { moduleName: true, title: true, description: true, status: true, publishedAt: true } }),
    prisma.wordPressPublishJob.count({ where: { projectId } }),
    prisma.websitePublication.count({ where: { projectId, status: "published" } }),
    prisma.growthContentRoadmap.count({ where: { projectId } }),
    prisma.businessEntity.count({ where: { projectId } }),
    prisma.entityClaim.count({ where: { projectId } }),
    prisma.citationReadinessFinding.count({ where: { projectId } }),
    prisma.aiVisibilityQuery.count({ where: { projectId } }),
    prisma.aiVisibilitySnapshot.count({ where: { projectId } }),
    prisma.sourceMention.count({ where: { projectId } }),
    prisma.backlinkProfileSnapshot.count({ where: { projectId, profileType: "owned" } }),
    prisma.authorityOpportunity.count({ where: { projectId } }),
    prisma.ecommerceExportGuide.count({ where: { projectId } }),
    prisma.growthBlueprint.count({ where: { projectId } }),
    prisma.growthSignal.count({ where: { projectId } }),
    prisma.projectGrowthLearning.count({ where: { projectId } }),
    prisma.measurementCheckpoint.findMany({ where: { projectId }, select: { status: true, diagnosis: true, baselineJson: true, metricsJson: true, completedAt: true } }),
    prisma.nextBestAction.count({ where: { projectId, status: { in: ["proposed", "selected"] } } }),
    prisma.websiteBuild.count({ where: { projectId } }),
    websiteId ? prisma.websiteMeasurementPlan.findMany({ where: { websiteId, active: true }, select: { trackingState: true, dataSourcesJson: true, installationJson: true, lastVerifiedAt: true } }) : Promise.resolve([]),
    websiteId ? prisma.websiteTrackingEvent.count({ where: { websiteId } }) : Promise.resolve(0),
    prisma.localBusinessProfile.findFirst({
      where: { projectId },
      include: {
        _count: { select: { keywords: true, competitors: true, reviews: true, citations: true, scores: true, recommendations: true, auditJobs: true, googleBusinessActions: true } },
        googleBusinessConnection: { select: { status: true, lastSyncedAt: true, errorMessage: true } },
      },
    }),
  ]);

  const contentTasks = tasks.filter((task) => /content|on.?page|brief|article/i.test(task.moduleName));
  const internalLinkTasks = tasks.filter((task) => /internal.?link/i.test(task.moduleName));
  const completedContentTasks = contentTasks.filter((task) => ["completed", "published", "verified"].includes(task.status) || task.publishedAt);
  const refreshTasks = tasks.filter((task) => /refresh|decay|outdated|stale|freshness/i.test(`${task.moduleName} ${task.title} ${task.description}`));
  const completedMeasurementCheckpoints = measurementCheckpoints.filter((checkpoint) => checkpoint.completedAt || checkpoint.status === "completed");
  const contentDecaySignals = completedMeasurementCheckpoints.filter((checkpoint) => /decay|declin|outdated|stale|refresh required|lost (?:click|impression|traffic|rank)/i.test(`${checkpoint.diagnosis ?? ""} ${JSON.stringify(checkpoint.metricsJson)} ${JSON.stringify(checkpoint.baselineJson)}`));
  const measurementText = measurementPlans.flatMap((plan) => [...jsonStrings(plan.dataSourcesJson), ...jsonStrings(plan.installationJson)]);
  const hasSearchConsole = [...jsonStrings(project.analyticsPlatforms), ...measurementText].some((item) => /search console|gsc/.test(item));
  const hasGa4 = [...jsonStrings(project.analyticsPlatforms), ...measurementText].some((item) => /google analytics|ga4|gtag/.test(item));
  const isEcommerce = /ecommerce|e-commerce|store|shop/i.test(`${project.projectType} ${project.businessProfile?.businessModel ?? ""}`);
  const hasWebsite = Boolean(project.websiteId || project.websiteUrl || websiteBuildCount);
  const isLocal = Boolean(localProfile || project.businessLocation || (Array.isArray(project.targetLocations) && project.targetLocations.length));
  const provider = configuredSearchProvider();

  const signals: Record<string, SignalResult> = {
    business_brain: brainCount > 0 && Boolean(project.businessProfile?.targetAudience)
      ? { status: "COMPLETE", message: "Approved business context and audience evidence are available.", evidence: { brainVersions: brainCount, intakeAnswers: intakeCount } }
      : intakeCount > 0 || project.businessProfile
        ? { status: "PARTIAL", message: "Business context exists, but the Business Brain still needs a complete approved audience and market snapshot.", evidence: { brainVersions: brainCount, intakeAnswers: intakeCount } }
        : { status: "MISSING", message: "Complete project intake to create the Business Brain evidence required by DEV-053.", evidence: { brainVersions: 0, intakeAnswers: 0 } },
    keyword_intelligence: keywordRuns > 0 && keywordIdeas > 0
      ? { status: "COMPLETE", message: "Completed keyword research and saved keyword evidence are available.", evidence: { completedRuns: keywordRuns, keywordIdeas, competitorRuns } }
      : !provider
        ? { status: "BLOCKED", message: "Keyword evidence is unavailable because the search-data provider is not configured.", evidence: { providerConfigured: false, completedRuns: keywordRuns } }
        : { status: "MISSING", message: "Run keyword research for the approved project markets.", evidence: { providerConfigured: true, completedRuns: keywordRuns, keywordIdeas } },
    technical_seo: crawlCount > 0
      ? { status: "COMPLETE", message: "A completed crawl supplies technical, indexability, linking and schema evidence.", evidence: { completedCrawls: crawlCount } }
      : hasWebsite
        ? { status: "MISSING", message: "The project has a website, but no completed site audit is available.", evidence: { websiteConnected: true, completedCrawls: 0 } }
        : { status: "NOT_APPLICABLE", message: "No current or generated website is attached to this project.", evidence: { websiteConnected: false } },
    on_page_seo: crawlCount > 0 && gapRuns > 0
      ? { status: "COMPLETE", message: "Crawl and gap-analysis evidence are available for page-level validation.", evidence: { completedCrawls: crawlCount, gapRuns } }
      : crawlCount > 0
        ? { status: "PARTIAL", message: "The crawl is complete; run Gap Analysis to prioritize page-level changes.", evidence: { completedCrawls: crawlCount, gapRuns } }
        : hasWebsite
          ? { status: "MISSING", message: "Run Site Analysis before validating page-level SEO.", evidence: { completedCrawls: 0, gapRuns } }
          : { status: "NOT_APPLICABLE", message: "No website pages are currently in scope.", evidence: { websiteConnected: false } },
    content_workflow: contentTasks.length > 0 && completedContentTasks.length > 0
      ? { status: "COMPLETE", message: "Content work has evidence from task creation through completion or publishing.", evidence: { contentTasks: contentTasks.length, completedContentTasks: completedContentTasks.length, roadmaps: contentRoadmapCount } }
      : contentTasks.length > 0 || contentRoadmapCount > 0
        ? { status: "PARTIAL", message: "Content recommendations exist but have not completed the approved execution lifecycle.", evidence: { contentTasks: contentTasks.length, completedContentTasks: completedContentTasks.length, roadmaps: contentRoadmapCount } }
        : { status: "MISSING", message: "Create an approved content roadmap and convert selected work into Execution Plan tasks.", evidence: { contentTasks: 0, roadmaps: 0 } },
    internal_linking: crawlCount > 0 && internalLinkTasks.length > 0
      ? { status: "COMPLETE", message: "Crawl evidence and actionable internal-link tasks are available.", evidence: { completedCrawls: crawlCount, internalLinkTasks: internalLinkTasks.length } }
      : crawlCount > 0
        ? { status: "PARTIAL", message: "Internal-link inventory exists; create or approve the recommended linking tasks.", evidence: { completedCrawls: crawlCount, internalLinkTasks: 0 } }
        : hasWebsite
          ? { status: "MISSING", message: "Run Site Analysis to build the internal-link graph.", evidence: { completedCrawls: 0 } }
          : { status: "NOT_APPLICABLE", message: "No website is currently available for internal-link validation.", evidence: { websiteConnected: false } },
    ai_citation: entities > 0 && citationFindings > 0
      ? { status: aiSnapshots > 0 ? "COMPLETE" : "PARTIAL", message: aiSnapshots > 0 ? "Entity, citation-readiness and observed AI visibility evidence are available." : "Citation readiness is analyzed; add permitted observations to measure actual visibility.", evidence: { entities, claims, citationFindings, queries: aiQueries, observations: aiSnapshots, sourceMentions } }
      : { status: "MISSING", message: "Run AI Citation analysis to establish entity and source-readiness evidence.", evidence: { entities, citationFindings, observations: aiSnapshots } },
    local_seo: !isLocal
      ? { status: "NOT_APPLICABLE", message: "This project has no approved local market or business location.", evidence: { localProfile: false } }
      : localProfile?._count.auditJobs && localProfile._count.scores
        ? { status: "COMPLETE", message: "The local profile has audit and score evidence.", evidence: { audits: localProfile._count.auditJobs, targets: localProfile._count.keywords, competitors: localProfile._count.competitors, scores: localProfile._count.scores } }
        : localProfile
          ? { status: "PARTIAL", message: "The local business profile exists; add targets and run the Local SEO audit.", evidence: { audits: localProfile._count.auditJobs, targets: localProfile._count.keywords, competitors: localProfile._count.competitors } }
          : { status: "MISSING", message: "Create the Local SEO business profile for the approved market.", evidence: { localProfile: false } },
    ecommerce: !isEcommerce
      ? { status: "NOT_APPLICABLE", message: "Ecommerce is not enabled as a capability for this project.", evidence: { ecommerceProject: false } }
      : ecommerceGuides > 0 || gapRuns > 0
        ? { status: "PARTIAL", message: "Ecommerce opportunity evidence exists; validate product, category and technical coverage in execution.", evidence: { ecommerceGuides, gapRuns } }
        : { status: "MISSING", message: "Run Ecommerce Intelligence for product, category and commercial gaps.", evidence: { ecommerceProject: true, ecommerceGuides: 0 } },
    authority: authoritySnapshots > 0 && authorityOpportunities > 0
      ? { status: "COMPLETE", message: "Backlink evidence and prioritized authority opportunities are available.", evidence: { backlinkSnapshots: authoritySnapshots, opportunities: authorityOpportunities } }
      : !provider
        ? { status: "BLOCKED", message: "Authority evidence requires the configured search-data provider or an imported backlink snapshot.", evidence: { providerConfigured: false, backlinkSnapshots: authoritySnapshots } }
        : { status: "MISSING", message: "Run Authority Growth analysis to create a backlink baseline and opportunities.", evidence: { providerConfigured: true, backlinkSnapshots: authoritySnapshots, opportunities: authorityOpportunities } },
    strategy_execution: approvedStrategyCount > 0 && executionPlanCount > 0
      ? { status: "COMPLETE", message: "An approved Strategy is connected to an Execution Plan.", evidence: { strategies: strategyCount, approvedStrategies: approvedStrategyCount, executionPlans: executionPlanCount, tasks: tasks.length, published: publishCount + verifiedPublicationCount } }
      : strategyCount > 0
        ? { status: "PARTIAL", message: "A Strategy exists but must be approved before an Execution Plan can be validated.", evidence: { strategies: strategyCount, approvedStrategies: approvedStrategyCount, executionPlans: executionPlanCount } }
        : { status: "MISSING", message: "Generate and approve the Unified Strategy.", evidence: { strategies: 0, executionPlans: 0 } },
    measurement_learning: growthSignalCount > 0 && growthLearningCount > 0 && growthBlueprintCount > 0
      ? { status: "COMPLETE", message: "Verified signals feed learning and a versioned Growth Blueprint.", evidence: { signals: growthSignalCount, learnings: growthLearningCount, blueprints: growthBlueprintCount, checkpoints: measurementCheckpoints.length, nextBestActions: nextBestActionCount } }
      : measurementPlans.length > 0 || trackingEvents > 0 || measurementCheckpoints.length > 0
        ? { status: "PARTIAL", message: "Measurement foundations exist, but verified outcomes have not completed the learn-and-reevaluate loop.", evidence: { measurementPlans: measurementPlans.length, trackingEvents, signals: growthSignalCount, learnings: growthLearningCount, checkpoints: measurementCheckpoints.length, nextBestActions: nextBestActionCount } }
        : { status: "MISSING", message: "Configure measurement, capture a baseline, and schedule post-work checkpoints.", evidence: { measurementPlans: 0, trackingEvents: 0, checkpoints: 0 } },
    aeo: citationFindings > 0 && aiQueries > 0
      ? { status: aiSnapshots > 0 ? "COMPLETE" : "PARTIAL", message: aiSnapshots > 0 ? "Answer opportunities and observed answer visibility are recorded." : "Answer readiness exists; record an observed answer result to measure visibility.", evidence: { readinessFindings: citationFindings, queries: aiQueries, observations: aiSnapshots } }
      : { status: "MISSING", message: "Run Citation Research, review Answer opportunities, and save question-led monitoring prompts.", evidence: { readinessFindings: citationFindings, queries: aiQueries } },
    geo: entities > 0 && claims > 0 && citationFindings > 0
      ? { status: aiSnapshots > 0 ? "COMPLETE" : "PARTIAL", message: aiSnapshots > 0 ? "GEO readiness and observed generative-engine evidence are separated and available." : "GEO readiness exists; add permitted engine observations for measured visibility.", evidence: { entities, claims, readinessFindings: citationFindings, observations: aiSnapshots, sourceMentions } }
      : { status: "MISSING", message: "Run Citation Research to validate entities, claims, sources and generative citation readiness.", evidence: { entities, claims, readinessFindings: citationFindings } },
  };

  return { signals, flags: { isEcommerce, hasWebsite, isLocal, hasSearchConsole, hasGa4, searchProviderConfigured: provider, pagespeedConfigured: Boolean(process.env.PAGESPEED_API_KEY), gbpConfigured: Boolean(process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID && process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET), gbpConnected: localProfile?.googleBusinessConnection?.status === "connected", gbpActions: localProfile?._count.googleBusinessActions ?? 0, localScores: localProfile?._count.scores ?? 0, observations: aiSnapshots, sourceMentions, nextBestActionCount, measurementCheckpointCount: measurementCheckpoints.length, completedMeasurementCheckpoints: completedMeasurementCheckpoints.length, contentDecaySignals: contentDecaySignals.length, refreshTasks: refreshTasks.length, published: publishCount + verifiedPublicationCount } };
}

export function capabilityResult(capability: (typeof dev053Capabilities)[number], collected: Awaited<ReturnType<typeof collectSignals>>) {
  let result = collected.signals[capability.signal] ?? { status: "MISSING" as const, message: "No validator is registered for this capability.", evidence: {} };
  const { flags } = collected;

  // AEO/GEO research and third-party engine observations are optional
  // specialist intelligence, not user-resolvable Connected Coverage work.
  if (capability.id.startsWith("AEO-") || capability.id.startsWith("GEO-")) result = {
    status: "NOT_APPLICABLE",
    message: "Optional advanced AI-search intelligence; excluded from the actionable Connected Coverage queue.",
    evidence: { optionalSpecialistCapability: true },
  };

  if (capability.applicableTo?.includes("website") && !flags.hasWebsite) result = { status: "NOT_APPLICABLE", message: "No website is currently in scope for this project.", evidence: { websiteConnected: false } };
  if (capability.applicableTo?.includes("local") && !flags.isLocal) result = { status: "NOT_APPLICABLE", message: "This project has no approved local market or business location.", evidence: { localProject: false } };
  if (capability.applicableTo?.includes("ecommerce") && !flags.isEcommerce) result = { status: "NOT_APPLICABLE", message: "Ecommerce is a project capability and is not enabled for this project.", evidence: { ecommerceProject: false } };

  if (capability.id === "SEO-022" && flags.hasWebsite && !flags.pagespeedConfigured) result = { status: "BLOCKED", message: "Mobile/performance validation requires PAGESPEED_API_KEY.", evidence: { pagespeedConfigured: false } };
  if (capability.id === "SEO-039") result = flags.published === 0
    ? { status: "DEFERRED", message: "Content-decay detection starts after content is published and a performance baseline exists.", evidence: { published: 0, completedCheckpoints: flags.completedMeasurementCheckpoints } }
    : flags.completedMeasurementCheckpoints === 0
      ? { status: "DEFERRED", message: "Published content exists; complete the scheduled performance checkpoint before assessing decay.", evidence: { published: flags.published, completedCheckpoints: 0 } }
      : { status: "COMPLETE", message: flags.contentDecaySignals ? "Completed performance checkpoints contain content-decay signals." : "Performance checkpoints were evaluated and no content-decay signal is currently present.", evidence: { completedCheckpoints: flags.completedMeasurementCheckpoints, decaySignals: flags.contentDecaySignals } };
  if (capability.id === "SEO-040") result = flags.published === 0 || flags.completedMeasurementCheckpoints === 0
    ? { status: "DEFERRED", message: "The refresh workflow becomes applicable after publication and performance evaluation.", evidence: { published: flags.published, completedCheckpoints: flags.completedMeasurementCheckpoints } }
    : flags.contentDecaySignals > 0 && flags.refreshTasks === 0
      ? { status: "MISSING", message: "Decay was detected, but no content-refresh Execution Plan task has been created.", evidence: { decaySignals: flags.contentDecaySignals, refreshTasks: 0 } }
      : { status: "COMPLETE", message: flags.contentDecaySignals ? "Detected decay is connected to a refresh task." : "No refresh task is required because the latest evaluation found no decay.", evidence: { decaySignals: flags.contentDecaySignals, refreshTasks: flags.refreshTasks } };
  if (capability.id === "SEO-057" && flags.isLocal && !flags.searchProviderConfigured && flags.localScores === 0) result = { status: "BLOCKED", message: "Local rank and grid tracking requires the search-data provider or imported rank observations.", evidence: { providerConfigured: false, localScores: 0 } };
  if (capability.id === "SEO-062" && flags.isLocal) result = !flags.gbpConfigured
    ? { status: "BLOCKED", message: "Configure Google Business Profile OAuth before connecting and auditing the profile.", evidence: { oauthConfigured: false } }
    : flags.gbpConnected
      ? { status: "COMPLETE", message: "Google Business Profile is connected and available for audit.", evidence: { oauthConfigured: true, connected: true } }
      : { status: "MISSING", message: "Connect the authorized Google Business Profile for this location.", evidence: { oauthConfigured: true, connected: false } };
  if (["SEO-063", "SEO-064"].includes(capability.id) && flags.isLocal) result = flags.gbpConnected
    ? { status: flags.gbpActions > 0 ? "COMPLETE" : "PARTIAL", message: flags.gbpActions > 0 ? "Approved GBP draft/action evidence is recorded." : "GBP is connected; prepare and approve the supported review/update action.", evidence: { connected: true, actions: flags.gbpActions } }
    : { status: "BLOCKED", message: "Connect Google Business Profile before validating reviews, responses or profile updates.", evidence: { connected: false } };
  if (capability.id === "SEO-065" && flags.isLocal) result = flags.localScores > 0
    ? { status: "COMPLETE", message: "Saved Local SEO score snapshots provide local performance evidence.", evidence: { localScores: flags.localScores } }
    : { status: "MISSING", message: "Run the Local SEO audit to create a performance snapshot.", evidence: { localScores: 0 } };
  if (capability.id === "SEO-084") result = flags.hasSearchConsole
    ? { status: "PARTIAL", message: "Search Console is recorded; verify imported performance and index evidence to complete validation.", evidence: { connectionRecorded: true } }
    : { status: "MISSING", message: "Connect or record Google Search Console for this website.", evidence: { connectionRecorded: false } };
  if (capability.id === "SEO-085") result = flags.hasGa4
    ? { status: "PARTIAL", message: "GA4 installation is recorded; verify live events to complete the connection.", evidence: { installationRecorded: true } }
    : { status: "MISSING", message: "Add the GA4 measurement ID and verify live events.", evidence: { installationRecorded: false } };
  if (capability.id === "SEO-090" && flags.measurementCheckpointCount === 0) result = { status: "MISSING", message: "No measurement checkpoint connects completed work to a later result yet.", evidence: { checkpoints: 0 } };
  if (capability.id === "SEO-092" && flags.nextBestActionCount === 0) result = { status: "MISSING", message: "Run Growth diagnosis to select and explain the current SEO Next Best Action.", evidence: { nextBestActions: 0 } };
  if (capability.id === "SEO-081" && flags.published === 0) result = { status: "MISSING", message: "No approved publish receipt is available for this project.", evidence: { published: 0 } };
  if (capability.id === "SEO-082" && flags.published === 0) result = { status: "MISSING", message: "Post-publish verification begins after an approved publication is recorded.", evidence: { published: 0 } };
  if ((capability.id === "AEO-010" || capability.id === "GEO-008" || capability.id === "GEO-012") && flags.observations === 0) result = { status: "MISSING", message: "Readiness is not a measured result. Record a permitted engine observation to validate visibility.", evidence: { observations: 0 } };
  if (capability.id === "GEO-009") result = flags.observations > 0
    ? { status: "COMPLETE", message: "Readiness findings and observed results are stored as separate evidence types.", evidence: { observations: flags.observations } }
    : { status: "PARTIAL", message: "Readiness evidence is available, but there is no observed engine result to compare yet.", evidence: { observations: 0 } };

  if (capability.id.startsWith("AEO-") || capability.id.startsWith("GEO-")) result = {
    status: "NOT_APPLICABLE",
    message: "Optional advanced AI-search intelligence; excluded from the actionable Connected Coverage queue.",
    evidence: { optionalSpecialistCapability: true },
  };

  const workflowDestination = capability.id === "AEO-010" || ["GEO-008", "GEO-009", "GEO-012"].includes(capability.id)
    ? capability.route.replace(/tab=[^&]+/, "tab=monitoring")
    : capability.route;
  return {
    capabilityId: capability.id,
    status: result.status,
    message: result.message,
    workflowDestination,
    evidenceJson: result.evidence as Prisma.InputJsonObject,
  };
}

export function summarize(results: Array<{ status: Dev053Status }>) {
  const counts = Object.fromEntries(["COMPLETE", "PARTIAL", "MISSING", "BLOCKED", "DEFERRED", "NOT_APPLICABLE"].map((status) => [status, results.filter((item) => item.status === status).length]));
  const applicable = results.length - counts.NOT_APPLICABLE;
  const score = applicable ? Math.round(((counts.COMPLETE + counts.PARTIAL * 0.5) / applicable) * 100) : 100;
  return { total: results.length, applicable, score, counts };
}

function presentRun(run: { id: string; projectId: string; status: string; summaryJson: unknown; createdAt: Date; completedAt: Date | null; results: Array<{ capabilityId: string; status: string; message: string; workflowDestination: string; evidenceJson: unknown; checkedAt: Date }> }) {
  const definitions = new Map(dev053Capabilities.map((item) => [item.id, item]));
  const results = run.results.filter((result) => result.capabilityId.startsWith("SEO-"));
  return {
    id: run.id, projectId: run.projectId, status: run.status, summary: summarize(results.map((result) => ({ status: result.status as Dev053Status }))),
    createdAt: run.createdAt, completedAt: run.completedAt,
    results: results.map((result) => ({ ...definitions.get(result.capabilityId as (typeof dev053Capabilities)[number]["id"]), ...result })),
  };
}

dev053VerificationRouter.get("/projects/:projectId/dev053-verification", async (req, res) => {
  const { project } = await scopedProject(req, req.params.projectId);
  const latest = await prisma.dev053VerificationRun.findFirst({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, include: { results: { orderBy: { capabilityId: "asc" } } } });
  res.json({ project: { id: project.id, name: project.name }, capabilities: dev053Capabilities, latestRun: latest ? presentRun(latest) : null });
});

dev053VerificationRouter.post("/projects/:projectId/dev053-verification/run", async (req, res) => {
  const { context, project } = await scopedProject(req, req.params.projectId);
  if (!hasWorkspacePermission(context, "run_ai_analysis")) fail("AI analysis permission is required to run DEV-053 verification.", 403);
  const run = await prisma.dev053VerificationRun.create({ data: { projectId: project.id, initiatedByUserId: context.membership.userId } });
  try {
    const collected = await collectSignals(project);
    const results = dev053Capabilities.map((capability) => capabilityResult(capability, collected));
    const summary = summarize(results);
    const completed = await prisma.$transaction(async (tx) => {
      await tx.dev053CapabilityResult.createMany({ data: results.map((result) => ({ ...result, runId: run.id })) });
      const definitions = new Map(dev053Capabilities.map((item) => [item.id, item]));
      const collectedAt = new Date();
      for (const result of results) {
        const definition = definitions.get(result.capabilityId);
        if (!definition) continue;
        const signal = {
          category: "connected_coverage",
          signalKey: result.capabilityId,
          sourceType: "site_analysis_coverage",
          sourceId: null,
        };
        await tx.growthSignal.upsert({
          where: { fingerprint: signalFingerprint(project.id, signal) },
          create: {
            projectId: project.id,
            fingerprint: signalFingerprint(project.id, signal),
            ...signal,
            valueJson: {
              title: definition.title,
              section: definition.section,
              status: result.status,
              message: result.message,
              workflowDestination: result.workflowDestination,
            },
            confidence: result.status === "PARTIAL" ? 80 : result.status === "DEFERRED" ? 75 : 95,
            collectedAt,
            effectiveDate: collectedAt,
            freshnessStatus: "fresh",
            expiresAt: new Date(collectedAt.getTime() + 30 * 86_400_000),
            engineVersion: "site-coverage-v1",
          },
          update: {
            valueJson: {
              title: definition.title,
              section: definition.section,
              status: result.status,
              message: result.message,
              workflowDestination: result.workflowDestination,
            },
            confidence: result.status === "PARTIAL" ? 80 : result.status === "DEFERRED" ? 75 : 95,
            collectedAt,
            effectiveDate: collectedAt,
            freshnessStatus: "fresh",
            expiresAt: new Date(collectedAt.getTime() + 30 * 86_400_000),
            engineVersion: "site-coverage-v1",
          },
        });
      }
      const saved = await tx.dev053VerificationRun.update({ where: { id: run.id }, data: { status: "completed", summaryJson: summary, completedAt: new Date() }, include: { results: { orderBy: { capabilityId: "asc" } } } });
      await recordWorkspaceActivity(tx, { context, action: "dev053.verification.completed", entityType: "dev053_verification_run", entityId: run.id, projectId: project.id, metadataJson: summary });
      return saved;
    });
    res.status(201).json(presentRun(completed));
  } catch (error) {
    await prisma.dev053VerificationRun.update({ where: { id: run.id }, data: { status: "failed", completedAt: new Date(), summaryJson: { error: error instanceof Error ? error.message : "Verification failed" } } }).catch(() => undefined);
    throw error;
  }
});
