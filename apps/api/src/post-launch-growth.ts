import { Prisma, prisma } from "@webtummy/db";

export const POST_LAUNCH_GROWTH_ENGINE_VERSION = "post-launch-growth-v1";
const DAY_MS = 86_400_000;

type PostLaunchActionInput = {
  launchVerified: boolean;
  trackingVerified: boolean;
  trackingState: string;
  indexingIssueCount: number;
  sitemapVerified: boolean;
  searchConsoleConnected: boolean;
  formErrors: number;
  formSuccesses: number;
  onPageTaskTitle?: string | null;
  contentTaskTitle?: string | null;
  localSeoTaskTitle?: string | null;
  primaryKeyword?: string | null;
};

export type PostLaunchNextBestAction = {
  key: string;
  title: string;
  recommendation: string;
  expectedImpact: string;
  reason: string;
  route: "content" | "technical" | "local_seo";
  priorityScore: number;
  confidence: number;
  effort: "low" | "medium" | "high";
  actionType: string;
};

export function selectPostLaunchNextBestAction(input: PostLaunchActionInput): PostLaunchNextBestAction {
  if (!input.launchVerified) return {
    key: "fix-launch-verification",
    title: "Fix the launch verification issue",
    recommendation: "Review the failed live-page, navigation, form, canonical, indexing, or deployment checks; correct the affected release and verify it again before relying on performance data.",
    expectedImpact: "A verified live website version with working customer journeys and trustworthy measurement.",
    reason: "Launch integrity and measurement must be reliable before growth work is evaluated.",
    route: "technical", priorityScore: 100, confidence: 100, effort: "high", actionType: "launch_repair",
  };
  if (!input.trackingVerified || ["CONNECTION_REQUIRED", "TRACKING_ERROR", "TRACKING_REVIEW_REQUIRED"].includes(input.trackingState)) return {
    key: "verify-live-tracking",
    title: "Verify tracking on the live website",
    recommendation: "Open the production website, complete a test page view and primary conversion journey, then confirm that SEnuke AI receives the events. Correct the tag, allowed host, consent, or form event mapping if verification fails.",
    expectedImpact: "A verified measurement stream and a defensible start date for the initial baseline.",
    reason: "Tracking verification is the first post-launch dependency and must precede performance claims.",
    route: "technical", priorityScore: 99, confidence: 100, effort: "low", actionType: "tracking_verification",
  };
  if (input.indexingIssueCount > 0) return {
    key: "resolve-indexing-crawl-issues",
    title: "Resolve live indexing and crawl issues",
    recommendation: "Review the live crawl evidence, correct blocked or conflicting robots, canonical, sitemap, status-code, or indexability signals, and verify the affected URLs again.",
    expectedImpact: "Search engines can discover and evaluate the intended canonical website pages.",
    reason: `${input.indexingIssueCount} verified crawl or indexing issue${input.indexingIssueCount === 1 ? " requires" : "s require"} attention before promotion is expanded.`,
    route: "technical", priorityScore: 96, confidence: 95, effort: "medium", actionType: "indexing_repair",
  };
  if (!input.sitemapVerified || !input.searchConsoleConnected) return {
    key: "submit-sitemap-search-console",
    title: "Submit the sitemap and verify Search Console",
    recommendation: "Connect the correct Search Console property, submit the production sitemap, and confirm that the canonical website URLs are discoverable. Keep Search Console optional for launch, but record its limitation until connected.",
    expectedImpact: "Verified search discovery signals and access to impressions, clicks, queries, and indexing evidence.",
    reason: "The website is live and tracking is active; search discovery is the next unresolved launch dependency.",
    route: "technical", priorityScore: 92, confidence: 94, effort: "low", actionType: "search_setup",
  };
  if (input.formErrors > input.formSuccesses && input.formErrors > 0) return {
    key: "fix-live-form-conversion",
    title: "Fix the live lead-form conversion issue",
    recommendation: "Reproduce the failed form journey, correct delivery or validation problems, publish the approved fix, and verify a successful test conversion.",
    expectedImpact: "Visitors can complete the primary lead journey and successful conversions are measured correctly.",
    reason: "Recorded form errors currently exceed successful form completions.",
    route: "technical", priorityScore: 90, confidence: 92, effort: "medium", actionType: "conversion_repair",
  };
  if (input.onPageTaskTitle) return {
    key: "complete-essential-on-page-seo",
    title: input.onPageTaskTitle,
    recommendation: "Prepare the scoped on-page improvement from the approved Strategy, review the exact page changes, obtain approval, publish, and verify the result.",
    expectedImpact: "Stronger relevance and clearer search and conversion signals on a priority page.",
    reason: "A dependency-ready essential on-page SEO task already exists in the approved Execution Plan.",
    route: "technical", priorityScore: 86, confidence: 88, effort: "medium", actionType: "on_page_seo",
  };
  if (input.contentTaskTitle) return {
    key: "publish-priority-content",
    title: input.contentTaskTitle,
    recommendation: "Prepare the approved priority content, review its claims, keyword intent, internal links and conversion path, then approve and publish it through the normal content workflow.",
    expectedImpact: "An additional useful search entry point that strengthens the website’s priority topic coverage.",
    reason: "The Growth Blueprint contains a dependency-ready content priority that can progress while the initial baseline is collecting.",
    route: "content", priorityScore: 82, confidence: 86, effort: "medium", actionType: "content_growth",
  };
  if (input.localSeoTaskTitle) return {
    key: "complete-local-seo-priority",
    title: input.localSeoTaskTitle,
    recommendation: "Prepare the approved Local SEO action, review the exact profile or citation changes, obtain owner approval, implement them, and verify the live result.",
    expectedImpact: "Improved local completeness and stronger evidence for relevant local discovery.",
    reason: "An applicable Local SEO priority is ready without waiting for the complete website baseline.",
    route: "local_seo", priorityScore: 78, confidence: 84, effort: "medium", actionType: "local_growth",
  };
  const topic = input.primaryKeyword?.trim() || "the website’s primary topic cluster";
  return {
    key: "publish-first-supporting-article",
    title: `Publish the first supporting article for ${topic}`.slice(0, 255),
    recommendation: `Create one useful, intent-specific article supporting ${topic}, connect it to the correct canonical service or product page, review it, and publish only after approval.`,
    expectedImpact: "Stronger topical relevance and an additional search entry point while the initial baseline continues collecting.",
    reason: "No higher-priority launch, tracking, indexing, conversion, or approved Execution Plan issue is currently unresolved.",
    route: "content", priorityScore: 74, confidence: 80, effort: "medium", actionType: "content_growth",
  };
}

export function postLaunchBaselineStatus(input: { publishedAt: Date | string | null; trackingVerifiedAt: Date | string | null; evaluationWindowDays?: number; observedSessions?: number; minimumSessions?: number; now?: Date }) {
  const evaluationWindowDays = Math.max(1, Math.min(180, input.evaluationWindowDays ?? 28));
  const publishedAt = input.publishedAt ? new Date(input.publishedAt) : null;
  const startedAt = input.trackingVerifiedAt ? new Date(input.trackingVerifiedAt) : null;
  const now = input.now ?? new Date();
  const completeDays = startedAt ? Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / DAY_MS)) : 0;
  const completesAt = startedAt ? new Date(startedAt.getTime() + evaluationWindowDays * DAY_MS) : null;
  const minimumSessions = Math.max(1, input.minimumSessions ?? 20);
  const lowTrafficExtension = Boolean(startedAt && completeDays >= evaluationWindowDays && input.observedSessions != null && input.observedSessions < minimumSessions);
  return {
    state: !publishedAt ? "not_started" : !startedAt ? "awaiting_tracking_verification" : lowTrafficExtension ? "collecting_extended_baseline" : completeDays >= evaluationWindowDays ? "baseline_established" : "collecting_initial_baseline",
    label: !publishedAt ? "Not started" : !startedAt ? "Tracking verification required" : lowTrafficExtension ? "Extending baseline for low traffic" : completeDays >= evaluationWindowDays ? "Initial baseline established" : "Collecting Initial Baseline",
    evaluationWindowDays,
    completeVerifiedDays: Math.min(completeDays, evaluationWindowDays),
    remainingDays: Math.max(0, evaluationWindowDays - completeDays),
    publishedAt: publishedAt?.toISOString() ?? null,
    startedAt: startedAt?.toISOString() ?? null,
    completesAt: completesAt?.toISOString() ?? null,
    observedSessions: input.observedSessions ?? null,
    minimumSessions,
    lowTrafficExtension,
    performanceClaimsAllowed: Boolean(startedAt && completeDays >= evaluationWindowDays && !lowTrafficExtension),
  };
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sourceConnected(plan: { dataSourcesJson: Prisma.JsonValue } | null, key: string) {
  const sources = Array.isArray(plan?.dataSourcesJson) ? plan.dataSourcesJson : [];
  return sources.some((value) => {
    const row = record(value);
    return row.key === key && row.status === "connected";
  });
}

export async function activatePostLaunchGrowthLifecycle(input: { projectId: string; releaseId?: string | null; publishedAt?: Date | null; launchVerified?: boolean; actorUserId?: string | null }) {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true, clientId: true, websiteId: true, name: true, businessName: true, primaryGoal: true, projectType: true, targetLocations: true,
      strategyPlans: { where: { status: "approved" }, orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, approvedAt: true, strategySummary: true, businessObjectives: true, seoStrategy: true, contentStrategy: true, localSeoStrategy: true, aiCitationStrategy: true, socialStrategy: true, growthRecommendations: true, kpis: true, businessBrainVersion: true, evidenceVersion: true } },
      website: { select: { trackingSite: { select: { lastVerifiedAt: true, lastEventAt: true, installation: true } }, measurementPlans: { where: { active: true }, orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, trackingState: true, evaluationWindowDays: true, primaryConversion: true, primaryMeasurement: true, dataSourcesJson: true } }, trackingEvents: { orderBy: { occurredAt: "desc" }, take: 5000, select: { eventName: true, sessionId: true } } } },
      websitePublications: { where: { publishedAt: { not: null } }, orderBy: { publishedAt: "desc" }, take: 1, select: { releaseId: true, publishedAt: true, status: true, verificationJson: true } },
      websiteBuilds: { orderBy: { updatedAt: "desc" }, take: 1, select: { pages: { where: { status: { not: "deferred" } }, orderBy: { sortOrder: "asc" }, take: 100, select: { title: true, pageType: true, primaryKeyword: true } } } },
      discoveryChecks: { orderBy: { createdAt: "desc" }, take: 20, select: { status: true, indexable: true, robotsAllowed: true, canonicalMatches: true, sitemapPresent: true } },
      executionTasks: { where: { status: { in: ["ready", "planned", "approved", "pending", "needs_review"] } }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }], take: 100, select: { id: true, title: true, moduleName: true, sourceType: true, status: true } },
      growthBlueprint: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } },
      nextBestActions: { where: { engineVersion: POST_LAUNCH_GROWTH_ENGINE_VERSION }, orderBy: { createdAt: "desc" }, take: 20 },
      localBusinessProfiles: { take: 1, select: { id: true } },
    },
  });
  if (!project) return null;
  const publication = project.websitePublications[0] ?? null;
  const releaseId = input.releaseId || publication?.releaseId || null;
  const publishedAt = input.publishedAt || publication?.publishedAt || null;
  if (!releaseId || !publishedAt) return null;
  const strategy = project.strategyPlans[0] ?? null;
  const plan = project.website?.measurementPlans[0] ?? null;
  const launchVerified = input.launchVerified ?? ["published", "completed"].includes(publication?.status || "");
  const trackingVerifiedAt = project.website?.trackingSite?.lastVerifiedAt ?? null;
  const observedSessions = new Set((project.website?.trackingEvents ?? []).map((event) => event.sessionId).filter(Boolean)).size;
  const baseline = postLaunchBaselineStatus({ publishedAt, trackingVerifiedAt, evaluationWindowDays: plan?.evaluationWindowDays ?? 28, observedSessions });
  const checks = project.discoveryChecks;
  const indexingIssueCount = checks.filter((check) => ["failed", "issue", "issues_found"].includes(check.status) || check.indexable === false || check.robotsAllowed === false || check.canonicalMatches === false).length;
  const sitemapVerified = checks.some((check) => check.sitemapPresent === true);
  const formErrors = project.website?.trackingEvents.filter((event) => event.eventName === "form_error").length ?? 0;
  const formSuccesses = project.website?.trackingEvents.filter((event) => event.eventName === "form_success").length ?? 0;
  const task = (pattern: RegExp, excluded = /website_builder/i) => project.executionTasks.find((item) => pattern.test(`${item.moduleName} ${item.title}`) && !excluded.test(item.moduleName));
  const onPageTask = task(/on[- ]page|technical seo|metadata|internal link/i);
  const contentTask = task(/article|blog|content|topic cluster|publish/i);
  const localTask = task(/local seo|google business|business profile|citation/i, /$^/);
  const pages = project.websiteBuilds[0]?.pages ?? [];
  const primaryKeyword = pages.find((page) => page.pageType === "home")?.primaryKeyword || pages.find((page) => page.primaryKeyword)?.primaryKeyword || null;
  const action = selectPostLaunchNextBestAction({
    launchVerified,
    trackingVerified: Boolean(trackingVerifiedAt),
    trackingState: plan?.trackingState ?? "CONNECTION_REQUIRED",
    indexingIssueCount,
    sitemapVerified,
    searchConsoleConnected: sourceConnected(plan, "search_console"),
    formErrors,
    formSuccesses,
    onPageTaskTitle: onPageTask?.title,
    contentTaskTitle: contentTask?.title,
    localSeoTaskTitle: localTask?.title,
    primaryKeyword,
  });
  const businessName = project.businessName || project.name;
  const primaryGoal = project.primaryGoal || "Grow qualified demand and conversions";
  const blueprintEvidence = {
    lifecycle: "post_launch",
    releaseId,
    publishedAt: publishedAt.toISOString(),
    baseline,
    approvedStrategy: strategy ? { id: strategy.id, version: strategy.version, approvedAt: strategy.approvedAt, foundationLocked: true, summary: strategy.strategySummary } : null,
    measurementPlan: plan ? { id: plan.id, version: plan.version, primaryConversion: plan.primaryConversion, primaryMeasurement: plan.primaryMeasurement } : null,
  };
  const nowItems = [
    { key: "tracking_health", category: "measurement", title: "Verify and monitor tracking health", status: trackingVerifiedAt ? "collecting" : "needs_attention", source: "live_website" },
    { key: "initial_baseline", category: "measurement", title: `Collect ${baseline.evaluationWindowDays} complete verified days for the initial baseline`, status: baseline.state, source: "measurement_plan" },
    { key: action.key, category: action.route, title: action.title, status: "next_best_action", source: "post_launch_priority" },
  ];
  const nextItems = [
    { key: "seo_priorities", category: "seo", title: strategy?.seoStrategy || "Execute approved SEO and keyword priorities", source: "approved_strategy" },
    { key: "content_priorities", category: "content", title: strategy?.contentStrategy || "Publish approved priority content", source: "approved_strategy" },
    { key: "conversion", category: "conversion", title: "Improve lead capture and the primary conversion journey", source: "measurement_plan" },
    ...(strategy?.localSeoStrategy || project.localBusinessProfiles.length || project.projectType === "local_seo" ? [{ key: "local_seo", category: "local_seo", title: strategy?.localSeoStrategy || "Complete applicable Local SEO and Business Profile work", source: "approved_strategy" }] : []),
  ];
  const laterItems = [
    { key: "promotion", category: "promotion", title: strategy?.socialStrategy || "Run the first approved traffic or promotion action", source: "approved_strategy" },
    { key: "ai_visibility", category: "ai_visibility", title: strategy?.aiCitationStrategy || "Review AI search and citation opportunities", source: "approved_strategy" },
    { key: "reputation", category: "reputation", title: "Activate reputation actions when applicable", source: "growth_blueprint" },
    { key: "experiments", category: "experiments", title: "Run the first appropriate growth experiment", source: "growth_blueprint" },
  ];
  const conditionalItems = [
    { key: "launch_issue", condition: "A live launch verification fails", action: "Fix Launch Issue" },
    { key: "tracking_issue", condition: "Tracking stops or primary events fail", action: "Fix Tracking Issue" },
    { key: "no_action", condition: "No valid Blueprint task is dependency-ready", action: "Collecting Data / Waiting for Outcome / No Material Action" },
  ];

  return prisma.$transaction(async (tx) => {
    let blueprint = project.growthBlueprint;
    const latestEvidence = record(blueprint?.versions[0]?.evidenceJson);
    const releaseAlreadyActivated = latestEvidence.releaseId === releaseId;
    if (!blueprint) {
      blueprint = await tx.growthBlueprint.create({
        data: {
          projectId: project.id,
          title: `${businessName} Growth Blueprint`.slice(0, 220),
          status: "active",
          currentVersion: 1,
          primaryGoal: primaryGoal.slice(0, 255),
          approvedStrategyId: strategy?.id,
          businessBrainVersion: strategy?.businessBrainVersion,
          evidenceVersion: strategy?.evidenceVersion,
          nextReviewAt: new Date(Date.now() + 7 * DAY_MS),
          versions: { create: { version: 1, status: "active", goalsJson: [{ title: primaryGoal, status: "baseline_collecting" }], nowJson: nowItems, nextJson: nextItems, laterJson: laterItems, conditionalJson: conditionalItems, evidenceJson: blueprintEvidence as Prisma.InputJsonValue, reason: "Activated automatically from the approved Strategy after the website release was published and verified. The Strategy remains the locked foundation; this Blueprint may evolve from measured evidence.", engineVersion: POST_LAUNCH_GROWTH_ENGINE_VERSION, createdByUserId: input.actorUserId } },
        },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
    } else if (!releaseAlreadyActivated) {
      const version = blueprint.currentVersion + 1;
      await tx.growthBlueprintVersion.create({ data: { blueprintId: blueprint.id, version, status: "active", goalsJson: [{ title: primaryGoal, status: "baseline_collecting" }], nowJson: nowItems, nextJson: nextItems, laterJson: laterItems, conditionalJson: conditionalItems, evidenceJson: blueprintEvidence as Prisma.InputJsonValue, reason: `Activated post-launch lifecycle for verified website release ${releaseId}. The approved Strategy remains the foundation.`, engineVersion: POST_LAUNCH_GROWTH_ENGINE_VERSION, createdByUserId: input.actorUserId } });
      blueprint = await tx.growthBlueprint.update({ where: { id: blueprint.id }, data: { status: "active", currentVersion: version, primaryGoal: primaryGoal.slice(0, 255), approvedStrategyId: strategy?.id, businessBrainVersion: strategy?.businessBrainVersion, evidenceVersion: strategy?.evidenceVersion, nextReviewAt: new Date(Date.now() + 7 * DAY_MS) }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    }

    const dedupeKey = `post-launch:${project.id}:${action.key}`.slice(0, 191);
    const existing = project.nextBestActions.find((item) => item.dedupeKey === dedupeKey);
    const current = project.nextBestActions.find((item) => item.status === "selected");
    if (current && current.dedupeKey !== dedupeKey) await tx.nextBestAction.update({ where: { id: current.id }, data: { status: current.actionType === "tracking_verification" && trackingVerifiedAt ? "completed" : "superseded", decision: trackingVerifiedAt && current.actionType === "tracking_verification" ? "verified_automatically" : "priority_changed", decidedAt: new Date() } });
    const actionData = {
      sourceType: "growth_engine",
      sourceId: releaseId,
      title: action.title,
      recommendation: action.recommendation,
      reasoningSummary: action.reason,
      expectedImpact: action.expectedImpact,
      confidence: action.confidence,
      estimatedEffort: action.effort,
      route: action.route,
      priorityScore: action.priorityScore,
      evidenceJson: { source: "verified_post_launch_lifecycle", releaseId, baseline, priorityOrder: action.priorityScore, trackingState: plan?.trackingState ?? "CONNECTION_REQUIRED" } as Prisma.InputJsonValue,
      actionType: action.actionType,
      businessGoal: primaryGoal.slice(0, 255),
      targetEntitiesJson: [releaseId] as Prisma.InputJsonValue,
      estimatedImpactJson: { statement: action.expectedImpact, evidencePolicy: baseline.performanceClaimsAllowed ? "compare_against_established_baseline" : "do_not_claim_improvement_during_initial_baseline" } as Prisma.InputJsonValue,
      scoreJson: { priorityScore: action.priorityScore, confidence: action.confidence, source: "post_launch_priority_order" } as Prisma.InputJsonValue,
      dependencyIdsJson: [] as Prisma.InputJsonValue,
      approvalType: "user_approval",
      riskLevel: action.route === "technical" ? "medium" : "low",
      urgency: action.priorityScore,
      engineVersion: POST_LAUNCH_GROWTH_ENGINE_VERSION,
      selectedAt: new Date(),
      status: "selected",
    };
    const nextBestAction = existing && ["accepted", "in_progress", "completed"].includes(existing.status)
      ? existing
      : existing && existing.status === "selected" && existing.title === action.title && existing.recommendation === action.recommendation && existing.expectedImpact === action.expectedImpact
        ? existing
      : existing
        ? await tx.nextBestAction.update({ where: { id: existing.id }, data: actionData })
        : await tx.nextBestAction.create({ data: { projectId: project.id, dedupeKey, ...actionData } });
    return { blueprint, nextBestAction, baseline };
  }, { timeout: 15_000 });
}
