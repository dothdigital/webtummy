// API response shapes (mirrors apps/api).
export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: "super_admin" | "client_admin" | "client_user";
  clientId: string | null;
  isActive: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  client: { id: string; name: string; contactEmail: string | null; plan: string; isActive: boolean; createdAt: string; aiSubscriptionStatus: string; trialStartedAt: string | null; trialEndsAt: string | null; manualAccessEndsAt: string | null; graceEndsAt: string | null; subscriptionSource: string; offlineAutoRenew: boolean; offlineNextRenewalAt: string | null; offlinePayments: OfflinePayment[] } | null;
  memberships?: Array<{
    id: string; status: string; workspaceId: string; userId: string;
    workspace: { id: string; name: string; workspaceType: string; ownerUserId: string; status: string; autoApprovalPolicyJson: unknown };
    roles: Array<{ role: string }>;
    _count: { clientAssignments: number; projectAssignments: number; assignedTasks: number; managedTasks: number; approvalTasks: number };
  }>;
}

export interface OfflinePayment {
  id: string;
  amountCents: number;
  method: string;
  duration: "monthly" | "yearly" | string;
  reference: string | null;
  notes: string | null;
  autoRenew: boolean;
  subscriptionEndsAt: string;
  nextRenewalAt: string | null;
  status: string;
  createdAt: string;
}

export interface Website {
  id: string;
  clientId: string;
  agencyClientId?: string | null;
  domain: string;
  rootUrl: string;
  status: "active" | "archived" | string;
  archivedAt?: string | null;
  targetCountry: string | null;
  targetCities?: string[] | unknown;
  createdAt: string;
  _count?: { crawlJobs: number };
  hasCompletedCrawl?: boolean;
  localBusinessProfiles?: LocalBusinessProfile[];
  trackingPlan?: WebsiteMeasurementPlan | null;
  trackingSite?: WebsiteTrackingSite | null;
  crawlJobs?: {
    id: string;
    status: "queued" | "running" | "completed" | "failed";
    siteScore: number | null;
    pagesCrawled: number;
    errorCount?: number;
    options?: unknown;
    createdAt: string;
    startedAt?: string | null;
    completedAt: string | null;
    error?: string | null;
  }[];
}

export interface WebsiteTrackingSite {
  id: string;
  websiteId: string;
  enabled: boolean;
  allowedHost: string;
  installation: string;
  lastEventAt?: string | null;
  lastVerifiedAt?: string | null;
}

export interface WebsiteMeasurementPlan {
  id: string;
  websiteId: string;
  projectId?: string | null;
  version: number;
  active: boolean;
  status: string;
  businessGoal: string;
  primaryConversion: string;
  primaryMeasurement: string;
  supportingActionsJson: string[] | unknown;
  guardrailsJson: string[] | unknown;
  pagesAndFormsJson: string[] | unknown;
  dataSourcesJson: Array<{ key: string; status: string; required: boolean; identifier?: string | null }> | unknown;
  baselineRule: string;
  evaluationWindowDays: number;
  consentRequirementsJson: string[] | unknown;
  installationMethod: string;
  installationJson: { ga4MeasurementId?: string | null; searchConsoleProperty?: string | null; measurementTagEnabled?: boolean; excludeStaging?: boolean; consentModeEnabled?: boolean } | unknown;
  trackingState: string;
  lastVerifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GuidedExecutionTask {
  id: string;
  projectId?: string | null;
  moduleName: string;
  sourceType: string;
  sourceId?: string | null;
  title: string;
  description: string;
  expectedOutcome?: string | null;
  priority: "high" | "medium" | "low" | string;
  automationLevel: string;
  status: string;
  requiresApproval: boolean;
  requiresIntegration: boolean;
  manualRequired: boolean;
  safetyCategory?: string;
  relatedModule?: string | null;
  approvedAt?: string | null;
  approvalSnapshotJson?: Record<string, unknown> | null;
  blockedReason?: string | null;
  actionButtonLabel: string | null;
  relatedUrl: string | null;
  relatedAssetId?: string | null;
  manualInstructions: string | null;
  impact?: string | null;
  publishedAt?: string | null;
  dueAt?: string | null;
  assignee?: { id: string; user: { name?: string | null; email: string } } | null;
  dependencies?: Array<{ requiredTask: { id: string; title: string; status: string } }>;
  executionGovernance?: {
    contractVersion: string;
    module: string;
    moduleLabel: string;
    canonicalState: string;
    executionMode: string;
    prepared: boolean;
    validated: boolean;
    approvalStatus: string;
    publicationStatus: string;
    measurementStatus: string;
    blockedReason?: string | null;
    nextAction: { key: string; label: string; reason: string };
  };
  createdAt: string;
}

export interface ProjectWorkflowStep {
  id: string;
  projectId: string;
  stepKey: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  actionLabel: string | null;
  actionUrl: string | null;
  sortOrder: number;
  sourceType: string | null;
  sourceId: string | null;
  completionReason: string | null;
  readyReason: string | null;
  blockedReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWorkflowController {
  version: string;
  projectId: string;
  state: string;
  stateLabel: string;
  readinessPercent: number;
  overallProgressPercent: number;
  intelligenceReady: boolean;
  strategyStale: boolean;
  executionPlanStale: boolean;
  businessBrainVersion: number;
  evidenceVersion: number;
  strategyVersion: number;
  executionPlanVersion: string | null;
  growthBlueprintVersion: number;
  confidence: {
    overall: number;
    completeness: number;
    freshness: number;
    signalCoverage: number;
    dataQuality: number;
    conflictPenalty: number;
    independentSignals: number;
    reasons: string[];
    cautions: string[];
  };
  blockers: Array<{ key: string; title: string; reason: string; action: WorkflowControllerAction | null }>;
  nextBestAction: {
    title: string;
    reason: string;
    expectedResult: string;
    action: WorkflowControllerAction;
    aiWill: string[];
    userWill: string;
    confidence: number;
    explainability: string;
  };
  stages: WorkflowControllerStage[];
  intelligenceModules: WorkflowControllerModule[];
  updatedAt: string;
}

export interface WorkflowControllerAction {
  label: string;
  url: string;
  type: "navigate" | "review" | "approve" | "generate" | "implement";
}

export interface WorkflowControllerModule {
  key: string;
  label: string;
  description: string;
  status: string;
  required: boolean;
  weight: number;
  reason: string;
  evidenceAt: string | null;
  action: WorkflowControllerAction | null;
  ai: { mode: string; suggestion: string; implementation: string; humanRole: string };
}

export interface WorkflowControllerStage {
  key: string;
  label: string;
  description: string;
  status: string;
  reason: string;
  action: WorkflowControllerAction | null;
  ai: { mode: string; suggestion: string; implementation: string; humanRole: string };
  modules?: WorkflowControllerModule[];
}

export interface Opportunity {
  id: string;
  projectId: string;
  name: string;
  targetAudience: string | null;
  problemSolved: string | null;
  recommendedOffer: string | null;
  businessModel: string | null;
  opportunityScore: number | null;
  seoScore: number | null;
  competitionScore: number | null;
  monetizationScore: number | null;
  executionScore: number | null;
  userFitScore: number | null;
  summary: string | null;
  status: string;
  createdAt: string;
}

export interface GuidedProject {
  id: string;
  clientId: string;
  agencyClientId?: string | null;
  websiteId: string | null;
  name: string;
  projectType: "new_business" | "existing_website" | "local_seo" | "agency_client" | "ecommerce" | string;
  websiteStatus?: string;
  status: string;
  currentStep: string;
  businessName: string | null;
  websiteUrl: string | null;
  niche: string | null;
  businessLocation: string | null;
  businessLocationJson?: { country: string; stateProvince: string; city: string; streetAddress?: string; postalCode?: string } | null;
  targetLocations: unknown;
  targetLocation: string | null;
  primaryGoal: string | null;
  secondaryGoals: unknown;
  targetLaunchTimeline: string | null;
  preferredOutputs: unknown;
  preferredPublishingMethod: string | null;
  createdAt: string;
  updatedAt: string;
  website?: { id: string; domain: string; rootUrl: string; status: string } | null;
  agencyClient?: {
    id: string;
    name: string;
    contactPhone?: string | null;
    businessLocations?: unknown;
    targetMarkets?: unknown;
    defaultSettings?: unknown;
  } | null;
  sourceActivitySummaries?: Array<{
    key: string;
    label: string;
    total: number;
    metrics: Array<{ label: string; value: number; tone?: string }>;
    items: Array<{ id: string; title: string; detail?: string | null; status?: string; priority?: string }>;
    actionUrl: string;
  }>;
  businessProfile?: {
    id: string;
    businessSummary: string | null;
    targetAudience: string | null;
    offerSummary: string | null;
    businessModel: string | null;
    strengths: unknown;
    constraints: unknown;
    budgetLevel: string | null;
    skillLevel: string | null;
    tonePreference: string | null;
  } | null;
  intakeAnswers?: {
    id: string;
    questionKey: string;
    questionText: string;
    answerValue: unknown;
    answerType: string;
  }[];
  executionPlans?: {
    id: string;
    title: string;
    summary: string | null;
    status: string;
    tasks: GuidedExecutionTask[];
  }[];
  executionTasks?: GuidedExecutionTask[];
  workflowSteps?: ProjectWorkflowStep[];
  executionProgress?: { total: number; completed: number };
  opportunities?: Opportunity[];
  keywordGroups?: ProjectKeywordGroup[];
  strategyPlans?: unknown[];
  _count?: { intakeAnswers: number; strategyPlans: number; opportunities: number };
}

export interface ProjectNotification {
  id: string;
  projectId: string | null;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ProjectKeywordGroup {
  id: string;
  projectId: string;
  category: string;
  title: string;
  explanation: string;
  expectedValue: string;
  goalSupport: string;
  keywords: unknown;
  gapKeywords: unknown;
  status: string;
  source: string;
  approvedAt: string | null;
}

export interface AutomationPolicy {
  key: string;
  label: string;
  coverage: string;
  levels: string[];
  approvalRequirement: string;
  safetyCategory: string;
  examples: string[];
}

export interface GrowthDiagnosis {
  id: string;
  projectId: string;
  bottleneckType: string;
  scoreJson: Record<string, number>;
  summary: string;
  dataSnapshot: unknown;
  findingsJson: unknown;
  evidenceJson: unknown;
  confidence: number;
  engineVersion: string;
  runType: string;
  createdAt: string;
}

export interface GrowthBlueprintVersion {
  id: string;
  version: number;
  status: string;
  goalsJson: unknown;
  nowJson: unknown;
  nextJson: unknown;
  laterJson: unknown;
  conditionalJson: unknown;
  evidenceJson: unknown;
  reason: string | null;
  engineVersion: string;
  createdAt: string;
}

export interface GrowthBlueprint {
  id: string;
  projectId: string;
  title: string;
  status: string;
  currentVersion: number;
  primaryGoal: string | null;
  currentPhase: string;
  approvedStrategyId: string | null;
  nextReviewAt: string | null;
  updatedAt: string;
  versions: GrowthBlueprintVersion[];
}

export interface GrowthContentOpportunity {
  id: string;
  roadmapId: string;
  projectId: string;
  batchId: string | null;
  title: string;
  contentType: string;
  primaryKeyword: string;
  searchIntent: string;
  clusterName: string;
  serviceName: string | null;
  locationName: string | null;
  targetPageId: string | null;
  targetUrl: string | null;
  internalLinkTargetPageId: string | null;
  internalLinkTargetUrl: string | null;
  businessPurpose: string;
  recommendationReason: string;
  expectedImpact: string | null;
  priorityScore: number;
  confidence: number;
  queue: "now" | "next" | "later" | "conditional";
  lifecycleStatus: string;
  plannedPhase: string;
  plannedPublishAt: string | null;
  conditionsJson: unknown;
  evidenceJson: unknown;
  executionTaskId: string | null;
  generationId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GrowthContentBatch {
  id: string;
  roadmapId: string;
  projectId: string;
  title: string;
  phase: string;
  status: string;
  rationale: string;
  opportunityCount: number;
  approvedAt: string | null;
  createdAt: string;
  opportunities: Pick<GrowthContentOpportunity, "id" | "title" | "lifecycleStatus" | "executionTaskId" | "generationId">[];
}

export interface GrowthContentRoadmap {
  id: string;
  projectId: string;
  status: string;
  currentVersion: number;
  opportunityCount: number;
  nowCount: number;
  nextCount: number;
  laterCount: number;
  conditionalCount: number;
  recommendedCadence: string;
  recommendationRationale: string | null;
  lastResearchedAt: string | null;
  nextReviewAt: string | null;
  opportunities: GrowthContentOpportunity[];
  batches: GrowthContentBatch[];
}

export interface GrowthEvidenceSignal {
  id: string;
  category: string;
  signalKey: string;
  sourceType: string;
  sourceId: string | null;
  valueJson: unknown;
  confidence: number;
  collectedAt: string;
  effectiveDate: string;
  freshnessStatus: string;
  expiresAt: string | null;
}

export interface GrowthCandidateAction {
  id: string;
  title: string;
  recommendation: string;
  reasoningSummary: string;
  expectedImpact: string;
  confidence: number;
  estimatedEffort: string;
  route: string;
  priorityScore: number;
  evidenceJson: unknown;
  actionType: string;
  businessGoal: string | null;
  targetEntitiesJson: unknown;
  estimatedImpactJson: unknown;
  scoreJson: unknown;
  dependencyIdsJson: unknown;
  approvalType: string;
  riskLevel: string;
  urgency: number;
  status: string;
  decision: string | null;
  decisionComment: string | null;
  reviewAfter: string | null;
  selectedAt: string | null;
  createdAt: string;
  followupTask: { id: string; title: string; status: string; relatedUrl: string | null } | null;
}

export interface GrowthFunnelStage {
  id: string;
  projectId: string;
  stageKey: string;
  title: string;
  status: string;
  conversionMetric: string | null;
  issueSummary: string | null;
  automationStatus: string;
  sortOrder: number;
}

export interface GrowthExperiment {
  id: string;
  projectId: string;
  title: string;
  hypothesis: string;
  metric: string;
  successThreshold: string;
  status: string;
  iceScore: number;
  pieScore: number;
  impactScore: number;
  confidenceScore: number;
  easeScore: number;
  potentialScore: number;
  importanceScore: number;
  requiredAssets: unknown;
  automationLevel: string;
  requiresApproval: boolean;
  safetyCategory: string;
  startedAt: string | null;
  completedAt: string | null;
  assets?: { id: string; title: string; assetType: string; approvalStatus: string; contentJson: unknown }[];
  results?: { id: string; baselineValue: number | null; currentValue: number | null; resultStatus: string; notes: string | null; recordedAt: string }[];
}

export interface GrowthOverviewResponse {
  project: GuidedProject;
  workflowController: ProjectWorkflowController | null;
  strategyContext?: {
    strategyId: string | null;
    version: number | null;
    status: string | null;
    isApproved: boolean;
    contractVersion: string;
    summary: string | null;
    focusAreas: Array<{ key: string; title: string; priority: string; objective: string; channels: string[] }>;
    phases: Array<{ name: string; timeframe: string; objective: string }>;
    topActions: string[];
  } | null;
  signals: {
    scoreJson: Record<string, number>;
    bottleneckType: string;
    growthScore: number;
    keywordRuns: number;
    socialPosts: number;
    hasLeadMagnetTask: boolean;
    strategyApproved: boolean;
    openTasks: GuidedExecutionTask[];
  };
  readiness: {
    canRun: boolean;
    status: "ready" | "blocked" | string;
    message: string;
    items: GrowthReadinessItem[];
    missing: GrowthReadinessItem[];
  };
  growth: {
    diagnosis: GrowthDiagnosis | null;
    funnelStages: GrowthFunnelStage[];
    experiments: GrowthExperiment[];
    channelTests: { id: string; channel: string; cadence: string; metric: string; durationDays: number; status: string; assetsNeeded: unknown }[];
    reports: { id: string; reportType: string; status: string; htmlContent: string | null; pdfUrl: string | null; createdAt: string }[];
    blueprint: GrowthBlueprint | null;
    contentRoadmap: GrowthContentRoadmap | null;
    socialDistribution: {
      id: string;
      status: string;
      generationMode: string;
      campaignName: string | null;
      campaignStartAt: string | null;
      campaignEndAt: string | null;
      campaignTimezone: string | null;
      goalMetric: string | null;
      goalTarget: number | null;
      strategySummary: string | null;
      platforms: string[];
      postingFrequency: string | null;
      nextReviewAt: string | null;
      posts: Array<{ id: string; platform: string; status: string; publishDate: string }>;
      metrics: SocialPerformanceMetric[];
      repurposingBatches: Array<{ id: string; status: string; sourceTitle: string; assets: Array<{ id: string; status: string; channel: string }> }>;
    } | null;
    evidenceSignals: GrowthEvidenceSignal[];
    candidateActions: GrowthCandidateAction[];
    selectedAction: GrowthCandidateAction | null;
    learnings: { id: string; outcome: string; summary: string; learningJson: unknown; createdAt: string }[];
    recentRuns: { id: string; status: string; promptVersion: string; inputSnapshotJson: unknown; outputJson: unknown; createdAt: string }[];
  };
  growthIntelligence: {
    contractVersion: string;
    lifecycle: {
      state: string;
      verifiedExposures: number;
      completedEvaluations: number;
      dueEvaluations: number;
      scheduledEvaluations: number;
      nextEvaluationAt: string | null;
    };
    dataQuality: {
      status: string;
      sourceCount: number;
      limitedSourceCount: number;
      staleSourceCount: number;
      limitations: string[];
    };
    activeWork: {
      count: number;
      tasks: Array<{ id: string; status: string; title: string; moduleName: string }>;
    };
    evaluations: Array<{ id: string; experimentId: string; title: string; metric: string; status: string; evaluation: unknown; recordedAt: string }>;
    blueprint: {
      version: number | null;
      patchCount: number;
      patches: unknown[];
      strategyReviewRequired: boolean;
    };
  };
  automationPolicy: AutomationPolicy;
}

export interface GrowthReadinessItem {
  key: string;
  title: string;
  description: string;
  status: "complete" | "in_progress" | "missing";
  required: boolean;
  actions: { label: string; url: string }[];
}

export interface DomainBacklinkLink {
  sourceUrl: string | null;
  sourceDomain: string | null;
  targetUrl: string | null;
  anchor: string | null;
  dofollow: boolean | null;
  firstSeen: string | null;
  lastSeen: string | null;
  sourceRank: number | null;
  pageRank: number | null;
  toxicityScore: number | null;
}

export interface DomainBacklinkLinks {
  target: string;
  links: DomainBacklinkLink[];
  source: string;
  fetchedAt: string;
  cached: boolean;
}

export interface DomainBacklinkSummary {
  target: string;
  backlinks: number | null;
  backlinksNew: number | null;
  backlinksLost: number | null;
  referringDomains: number | null;
  referringDomainsNew: number | null;
  referringDomainsLost: number | null;
  referringDomainsBroken: number | null;
  referringMainDomains: number | null;
  referringPages: number | null;
  dofollow: number | null;
  nofollow: number | null;
  brokenBacklinks: number | null;
  brokenPages: number | null;
  spamScore: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  source: string;
  fetchedAt: string;
  cached: boolean;
}

export interface CrawlStatus {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  pagesCrawled: number;
  errorCount: number;
  siteScore: number | null;
  website?: {
    id: string;
    domain: string;
    rootUrl: string;
  } | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface IssueBreakdown {
  brokenLinks: number;
  titleIssues: number;
  descriptionIssues: number;
  h1Issues: number;
  contentIssues: number;
  indexabilityIssues: number;
  siteFileIssues: number;
}

export interface CrawlSummary {
  siteScore: number | null;
  status: string;
  pageCount: number;
  indexable: number;
  brokenLinks: number;
  duplicateTitles: number;
  issuesBySeverity: { severity: "high" | "medium" | "low"; _count: number }[];
  breakdown: IssueBreakdown;
}

export interface PageRow {
  id: string;
  url: string;
  finalUrl?: string | null;
  statusCode: number | null;
  depth: number;
  wordCount: number | null;
  responseTimeMs: number | null;
  crawlerPerformance?: {
    score: number;
    grade: "fast" | "okay" | "slow";
    responseTimeMs: number | null;
    redirectCount: number;
    imageIssues: number;
    assetCount: number;
    cssCount: number;
    jsCount: number;
    imageAssetCount: number;
    totalAssetBytes: number;
    cssBytes: number;
    jsBytes: number;
    imageBytes: number;
    renderBlockingAssets: number;
    unreachableAssets: number;
    largeAssets: number;
    jsDependent: boolean;
    issues: string[];
  };
  assets?: {
    id: string;
    url: string;
    type: "css" | "javascript" | "image" | string;
    renderBlocking: boolean;
    statusCode: number | null;
    sizeBytes: number | null;
    responseTimeMs: number | null;
    issueType: string | null;
  }[];
  inlinkCount: number;
  outgoingInternalLinkCount?: number;
  brokenInternalLinkCount?: number;
  weakAnchorCount?: number;
  internalLinkScore?: number | null;
  internalLinkGrade?: string | null;
  isOrphan: boolean;
  seo: {
    title: string | null;
    titleLength?: number | null;
    metaDescription: string | null;
    metaDescLength?: number | null;
    h1Text?: unknown;
    h1Count: number;
    canonicalUrl?: string | null;
    hreflangJson?: unknown;
    ogTags?: unknown;
    twitterTags?: unknown;
    looksJsDependent?: boolean;
  } | null;
}

export interface IssueRow {
  id: string;
  issueType: string;
  category: string;
  severity: "high" | "medium" | "low";
  message: string;
  recommendation: string | null;
  relatedPages?: { url: string; title: string | null }[];
  page: {
    url: string;
    seo: PageRow["seo"];
  } | null;
}

export interface BrokenLinkRow {
  id: string;
  targetUrl: string;
  targetStatus: number | null;
  anchorText: string | null;
  sourcePage: {
    url: string;
    seo: { title: string | null } | null;
  };
}

export interface PageSpeedStrategyResult {
  strategy: "mobile" | "desktop";
  ok: boolean;
  error?: string;
  scores?: {
    performance: number | null;
    accessibility: number | null;
    bestPractices: number | null;
    seo: number | null;
  };
  metrics?: {
    firstContentfulPaint: string | null;
    largestContentfulPaint: string | null;
    cumulativeLayoutShift: string | null;
    totalBlockingTime: string | null;
    speedIndex: string | null;
  };
}

export interface PageSpeedResponse {
  page: { id: string; url: string };
  results: Partial<Record<"mobile" | "desktop", PageSpeedStrategyResult>>;
}

export interface HealthReport {
  overallScore: number;
  pageCount: number;
  severityCounts: { high: number; medium: number; low: number };
  technical: {
    score: number;
    issueCount: number;
    brokenLinks: number;
    indexabilityIssues: number;
  };
  internalLinking: {
    score: number | null;
    orphanPages: number;
    brokenInternalLinks: number;
    weakAnchorText: number;
  };
  aiSearch: {
    score: number;
    llmsTxtPresent: boolean;
    llmsTxtScore: number | null;
    sitemapUrls: number;
    organizationSchema: boolean;
  };
  schema: {
    score: number;
    total: number;
    invalid: number;
    types: Record<string, number>;
    hasOrganization: boolean;
    hasWebsite: boolean;
    hasBreadcrumb: boolean;
    hasFAQ: boolean;
  };
  faq: { hasFAQSchema: boolean; issue: string | null };
  breadcrumb: { hasBreadcrumbSchema: boolean; issue: string | null };
  siteFiles: {
    robotsStatus: number | null;
    sitemapCount: number;
    healthySitemaps: number;
    sitemapUrls: number;
  };
  details?: {
    technicalIssues: {
      issueType: string;
      category: string;
      severity: "high" | "medium" | "low";
      message: string;
      recommendation: string | null;
      pageUrl: string | null;
      pageTitle: string | null;
    }[];
    orphanPages: {
      url: string;
      title: string | null;
      depth: number;
      internalLinkScore: number | null;
      brokenInternalLinkCount: number;
      weakAnchorCount: number;
    }[];
    weakAnchorLinks: {
      anchorText: string | null;
      placement: string;
      targetUrl: string;
      sourceUrl: string;
      sourceTitle: string | null;
    }[];
    brokenInternalLinks: {
      anchorText: string | null;
      targetUrl: string;
      targetStatus: number | null;
      sourceUrl: string;
      sourceTitle: string | null;
    }[];
    schemas: Record<string, {
      url: string;
      title: string | null;
      valid: boolean;
      issueType: string | null;
    }[]>;
    faqPages: {
      url: string;
      title: string | null;
      valid: boolean;
      issueType: string | null;
    }[];
    breadcrumbPages: {
      url: string;
      title: string | null;
      valid: boolean;
      issueType: string | null;
    }[];
    siteFiles: {
      robots: { statusCode: number | null; sitemapRefs: unknown } | null;
      sitemaps: { url: string; statusCode: number | null; urlCount: number }[];
      llms: { statusCode: number | null; sectionScore: number | null } | null;
    };
  };
}

export interface KeywordIdea {
  id: string;
  keyword: string;
  avgMonthlySearches: number | null;
  competition: string | null;
  competitionIndex: number | null;
  cpc: number | null;
  lowTopOfPageBid: number | null;
  highTopOfPageBid: number | null;
  currency: string | null;
  rawJson?: unknown;
}

export interface KeywordSerpCompetitor {
  id: string;
  rank: number;
  url: string;
  domain: string;
  title: string | null;
  description: string | null;
  fetchStatus: number | null;
  contentTitle: string | null;
  metaDescription: string | null;
  h1Json: string[];
  h2Json: string[];
  schemaTypesJson: string[];
  wordCount: number | null;
  faqCount: number;
  contentScore: number | null;
  missingTopicsJson: string[];
  recommendationsJson: string[];
}

export interface OrganicGrowthTask {
  id: string;
  group: "create" | "improve" | "fix" | "support" | "track";
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
  url: string | null;
  impact: string;
}

export interface OrganicGrowthPlan {
  summary: {
    headline: string;
    nextStep: string;
    why: string[];
  };
  opportunity: {
    score: number;
    label: string;
    action: string;
    nextAction: string;
    signals: {
      volume: number;
      competitionIndex: number | null;
      currentRank: number | null;
      bestPageScore: number | null;
      competitorAverageScore: number | null;
      blockerCount: number;
    };
  };
  clusters: {
    name: string;
    intent: "core_service" | "local" | "question" | "comparison" | "commercial" | "supporting";
    pageType: "service_page" | "location_page" | "article" | "faq" | "comparison_page" | "landing_page";
    keywords: string[];
  }[];
  tasks: OrganicGrowthTask[];
  aiSearch: {
    score: number;
    checks: { label: string; status: "good" | "needs_work"; recommendation: string }[];
  };
  bestPage: {
    id: string;
    url: string;
    title: string | null;
    score: number;
    intentMatch: string;
    missing: string[];
    recommendations: string[];
  } | null;
  topCompetitor: {
    rank: number;
    domain: string;
    url: string;
    contentScore: number | null;
    wordCount: number | null;
    faqCount: number;
    schemaTypes: string[];
  } | null;
}

export interface KeywordResearchRun {
  id: string;
  projectId: string | null;
  websiteId: string | null;
  seedKeyword: string;
  targetUrl: string | null;
  targetDomain: string | null;
  targetRank: number | null;
  rankingUrl: string | null;
  rankFoundDepth: number | null;
  manualRank: number | null;
  manualPage: number | null;
  manualPosition: number | null;
  manualUrl: string | null;
  manualNote: string | null;
  manualObservedAt: string | null;
  locationName: string;
  languageCode: string;
  device: string;
  serpDepth: number;
  status: string;
  source: string;
  keywordCount: number;
  competitorCount: number;
  averageVolume: number | null;
  competitorsAboveJson: { rank: number; domain: string; url: string; title: string | null }[];
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  canRefresh?: boolean;
  lastRefreshAt?: string;
  refreshBlockedUntil?: string | null;
  previousRank?: number | null;
  rankChange?: number | null;
  avgDifficulty?: number | null;
  avgCpc?: number | null;
  avgSearchVolume?: number | null;
  opportunityScore?: number | null;
  intent?: string | null;
  website?: { id: string; domain: string; rootUrl: string } | null;
  ideas?: KeywordIdea[];
  competitors?: KeywordSerpCompetitor[];
}

export type WorkspaceMilestoneStatus = "Completed" | "In Progress" | "Ready" | "Pending";

export interface WorkspaceMilestone {
  title: string;
  moduleName: string;
  status: WorkspaceMilestoneStatus;
  reason: string;
  relatedUrl: string;
}

export interface WorkspaceIntelligence {
  activeProjectId: string | null;
  activeWebsiteId: string | null;
  signals: {
    intakeComplete?: boolean;
    strategyApproved?: boolean;
    hasWebsite?: boolean;
    hasCompletedCrawl?: boolean;
    activeCrawlStatus?: string | null;
    pagesCrawled?: number;
    siteScore?: number | null;
    keywordRunCount?: number;
    openTaskCount?: number;
    completedTaskCount?: number;
  };
  projectWorkflowSteps?: ProjectWorkflowStep[];
  modules: Record<string, { status: WorkspaceMilestoneStatus; reason: string; relatedUrl: string }>;
  roadmap: WorkspaceMilestone[];
}

export interface WorkspaceIntelligenceResponse {
  projects: GuidedProject[];
  websites: Website[];
  keywordRuns: KeywordResearchRun[];
  strategyPagePriorities?: StrategyPagePriority[];
  leadMagnetGenerations?: AiContentGeneration[];
  tasks: GuidedExecutionTask[];
  notifications?: ProjectNotification[];
  backlinkSummary: DomainBacklinkSummary | null;
  backlinkLinks: DomainBacklinkLinks | null;
  intelligence: WorkspaceIntelligence;
}

export interface StrategyPagePriority {
  url: string;
  severity: "high" | "medium" | "low";
  score: number;
  categories: Array<{ key: string; label: string }>;
  findingCount: number;
  summary: string;
  reasons: string[];
  recommendedActions: string[];
  source: "site_and_gap_analysis";
  executionTaskId: string | null;
  executionStatus: string;
}

export interface GeoKeywordAuditPage {
  id: string;
  campaignId: string;
  pageId: string | null;
  url: string;
  normalizedUrl: string;
  title: string | null;
  totalScore: number;
  intentMatch: "strong" | "medium" | "weak";
  isBestCandidate: boolean;
  isTargetUrl: boolean;
  cannibalRisk: string | null;
  breakdownJson: {
    key: string;
    label: string;
    score: number;
    max: number;
    status: "good" | "partial" | "missing";
    detail: string;
  }[];
  missingJson: string[];
  recommendationsJson: string[];
  createdAt: string;
}

export interface GeoKeywordAudit {
  id: string;
  websiteId: string;
  crawlJobId: string | null;
  targetKeyword: string;
  targetCity: string | null;
  secondaryKeywords: string[];
  targetUrl: string | null;
  crawlMode: string;
  maxPages: number;
  useAi: boolean;
  status: string;
  averageScore: number | null;
  bestPageId: string | null;
  weakPageCount: number;
  cannibalRiskCount: number;
  createdAt: string;
  completedAt: string | null;
  website?: { id: string; domain: string; rootUrl: string };
  pages?: GeoKeywordAuditPage[];
  topPages?: GeoKeywordAuditPage[];
  targetPage?: GeoKeywordAuditPage | null;
  pageCount?: number;
  weakPages?: number;
}


export interface BillingPlan {
  code: string;
  name: string;
  description: string;
  priceMonthly: number;
  priceMonthlyCents: number;
  articleLimit: number;
  articles: number;
  helperMonthlyLimit: number;
  helperDailyLimit: number;
  features: string[];
  stripeProductId: string | null;
  stripePriceId: string | null;
  isActive: boolean;
  sortOrder: number;
  memberCount?: number;
  commercialVersion?: number;
  workspaceTypeEligibility?: unknown;
  prices?: CommercialPrice[];
}

export interface CommercialPrice {
  id: string;
  code: string;
  billingInterval: "monthly" | "annual" | string;
  currency: string;
  amountCents: number;
  priceClass: "founding" | "standard" | "interim" | "legacy" | string;
  provider: string;
  providerProductRef: string | null;
  checkoutUrl: string | null;
  status: string;
}

export interface CommercialSummary {
  workspace: {
    id: string;
    name: string;
    workspaceType: string;
    commercialState: string;
    accessMode: string;
    retentionEndsAt: string | null;
    deletionScheduledAt: string | null;
  };
  subscription: {
    id: string;
    status: string;
    provider: string;
    billingInterval: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    foundingMember: boolean;
    protectedPriceId: string | null;
    plan: { code: string; name: string; version: number };
    price: { id: string; amountCents: number; currency: string; priceClass: string } | null;
    policy: { code: string; version: number; graceDays: number; retentionDays: number };
  } | null;
  entitlements: {
    features: Record<string, unknown>;
    limits: Record<string, unknown>;
    seatLimit: number | null;
  };
  usage: {
    activeProjects: number;
    archivedProjects: number;
    activeAgencyClients: number;
    activeMemberships: number;
    assignedSeats: number;
    capacity: {
      balance: number;
      monthlyAllowance: number;
      reserved: number;
      periodStart: string;
      periodEnd: string;
    } | null;
  };
  recentBillingEvents: Array<{
    id: string;
    eventType: string;
    status: string;
    verified: boolean;
    occurredAt: string | null;
    createdAt: string;
  }>;
}

export interface BillingInvoice {
  id: string;
  number: string | null;
  status: string | null;
  currency: string;
  amountDue: number;
  amountPaid: number;
  createdAt: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

export interface BillingStatus {
  plan: BillingPlan | null;
  status: string;
  hasAccess: boolean;
  blockReason: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialDaysRemaining: number;
  trialDurationDays?: number;
  manualAccessEndsAt: string | null;
  manualAccessDaysRemaining: number;
  graceEndsAt?: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  billingProvider?: string;
  commercial?: CommercialSummary | null;
  subscriptionCurrentPeriodEnd: string | null;
  reportEmailEnabled: boolean;
  weeklyReportEmailEnabled: boolean;
  monthlyReportEmailEnabled: boolean;
  rankingChangeEmailEnabled: boolean;
}

export type AiGenerationType = "article" | "h1" | "title" | "meta_description" | "faq" | "page_schema" | "domain_schema" | "page_llms_txt" | "domain_llms_txt" | "robots_txt" | "sitemap" | "ai_search" | "lead_magnet";

export interface AiContentGeneration {
  id: string;
  clientId: string;
  userId: string | null;
  projectId: string | null;
  websiteId: string | null;
  sourceContext: string | null;
  sourceType: string | null;
  sourceRecordId: string | null;
  type: AiGenerationType;
  status: string;
  topic: string;
  targetKeyword: string | null;
  targetUrl: string | null;
  languageCode: string;
  tone: string | null;
  resultJson: unknown;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
  error: string | null;
  validatedAt: string | null;
  createdAt: string;
}

export interface AiContentStatus {
  plan: {
    code: string;
    name: string;
    articles: number;
    helperDailyLimit: number;
    priceMonthly: number;
    subscriptionStatus: string;
    hasAccess?: boolean;
  };
  usage: {
    articlesUsed: number;
    articleLimit: number;
    helpersUsed: number;
    helperDailyLimit: number;
    tokens: number;
  };
}

export interface SocialProfile {
  id?: string;
  websiteId?: string;
  platform: string;
  profileUrl: string;
  handle: string | null;
  displayName: string | null;
  bio: string | null;
  followerCount: number | null;
  postingFrequency: string | null;
  lastPostAt: string | null;
  websiteLinked: boolean;
  profileComplete: boolean;
  brandConsistent: boolean;
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SocialCompetitorProfile {
  id?: string;
  websiteId?: string;
  competitorName: string;
  competitorDomain: string | null;
  platform: string;
  profileUrl: string | null;
  followerCount: number | null;
  postingFrequency: string | null;
  engagementLevel: string | null;
  contentThemes: string[];
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SocialContentPillar {
  id: string;
  strategyId: string;
  title: string;
  description: string;
  formatsJson: string[];
  createdAt: string;
}

export interface SocialCalendarPost {
  id: string;
  strategyId: string;
  platform: string;
  publishDate: string;
  topic: string;
  caption: string;
  creativeDirection: string | null;
  cta: string | null;
  hashtagsJson: string[];
  imageSuggestion: string | null;
  imageUrl: string | null;
  imageAltText: string | null;
  imageStatus: string;
  externalPostId: string | null;
  targetKeyword: string | null;
  targetUrl: string | null;
  sourceType: string | null;
  sourceId: string | null;
  funnelStage: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  metrics?: SocialPerformanceMetric[];
}

export interface SocialStrategy {
  id: string;
  websiteId: string;
  projectId: string | null;
  campaignName: string | null;
  campaignStartAt: string | null;
  campaignEndAt: string | null;
  campaignTimezone: string | null;
  goalMetric: string | null;
  goalTarget: number | null;
  goal: string;
  audience: string | null;
  platforms: string[];
  targetKeywordsJson: string[];
  targetUrlsJson: string[];
  postingFrequency: string | null;
  tone: string | null;
  imageDirection: string | null;
  publishingProfileJson: {
    accountIds?: string[];
    timezone?: string;
  };
  monthlyTheme: string | null;
  status: string;
  generationMode: string;
  strategySummary: string | null;
  platformRecommendationsJson: SocialPlatformRecommendation[];
  campaignThemesJson: string[];
  bestPostingTimesJson: Array<{ platform: string; times: string[] }>;
  intelligenceSnapshotJson: Record<string, unknown>;
  socialScore: number;
  profileScore: number;
  consistencyScore: number;
  activityScore: number;
  competitorScore: number;
  seoAlignmentScore: number;
  recommendationsJson: string[];
  nextReviewAt: string | null;
  createdAt: string;
  updatedAt: string;
  pillars: SocialContentPillar[];
  posts: SocialCalendarPost[];
}

export interface SocialPlatformRecommendation {
  platform: string;
  score: number;
  recommended: boolean;
  reason: string;
  frequency: string;
  bestTimes: string[];
  primaryFormats: string[];
}

export interface SocialContentSource {
  id: string;
  type: string;
  title: string;
  url: string | null;
  summary: string;
  keyword: string | null;
  status: string;
}

export interface SocialRepurposedAsset {
  id: string;
  batchId: string;
  channel: string;
  assetType: string;
  title: string;
  content: string;
  cta: string | null;
  hashtagsJson: string[];
  visualSuggestion: string | null;
  status: string;
  socialCalendarPostId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialRepurposingBatch {
  id: string;
  projectId: string;
  strategyId: string | null;
  sourceType: string;
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string | null;
  keyMessagesJson: string[];
  targetChannelsJson: string[];
  status: string;
  generationMode: string;
  createdAt: string;
  updatedAt: string;
  assets: SocialRepurposedAsset[];
}

export interface SocialPerformanceMetric {
  id: string;
  projectId: string;
  strategyId: string | null;
  postId: string | null;
  platform: string;
  sourceType: string;
  impressions: number;
  reach: number;
  engagements: number;
  clicks: number;
  leads: number;
  conversions: number;
  recordedAt: string;
}

export interface SocialPerformanceSummary {
  impressions: number;
  reach: number;
  engagements: number;
  clicks: number;
  leads: number;
  conversions: number;
  observations: number;
  engagementRate: number;
  clickThroughRate: number;
  conversionRate: number;
}

export interface SocialProviderCapability {
  platform: string;
  label: string;
  provider: string;
  connectionAvailable: boolean;
  draft: boolean;
  schedule: boolean;
  publish: boolean;
  metrics: boolean;
  requirements: string[];
}

export interface SocialStrategyResponse {
  website: { id: string; domain: string; rootUrl: string; targetCities?: unknown };
  project: { id: string; name: string; businessName: string | null } | null;
  intelligence: {
    projectId: string;
    businessName: string;
    businessSummary: string;
    audience: string;
    offer: string;
    primaryGoal: unknown;
    brandVoice: string;
    targetMarkets: string[];
    competitors: string[];
    analyticsPlatforms: string[];
    keywords: string[];
    sourceCount: number;
    sourceTypes: string[];
    approvedStrategyId: string | null;
  } | null;
  contentSources: SocialContentSource[];
  profiles: SocialProfile[];
  competitors: SocialCompetitorProfile[];
  strategies: SocialStrategy[];
  repurposingBatches: SocialRepurposingBatch[];
  batch?: SocialRepurposingBatch;
  performanceSummary: SocialPerformanceSummary;
  strategy?: SocialStrategy;
  platformOptions: string[];
  providers: SocialProviderCapability[];
  repurposingChannels: string[];
}

export interface LocalBusinessProfile {
  id: string;
  clientId: string;
  projectId: string | null;
  websiteId: string | null;
  website?: { id: string; domain: string; rootUrl?: string } | null;
  businessName: string;
  domain: string;
  phone: string;
  address: string;
  city: string;
  region: string | null;
  country: string;
  postalCode: string | null;
  mainCategory: string;
  services: string[];
  targetLocations: string[];
  googleBusinessProfileUrl: string | null;
  googleBusinessAccountRef: string | null;
  googleBusinessConnectionStatus: string;
  googleAverageRating: number | null;
  googleReviewCount: number | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  updatedAt: string;
  keywords?: LocalKeyword[];
  scores?: LocalScore[];
  recommendations?: LocalRecommendation[];
  citations?: LocalCitation[];
  reviews?: LocalReview[];
  competitors?: LocalCompetitor[];
  _count?: { keywords: number; recommendations: number };
}

export interface LocalKeyword {
  id: string;
  businessId: string;
  keyword: string;
  city: string;
  country: string;
  device: string;
  language: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocalRankSnapshot {
  id: string;
  keywordId: string;
  keyword?: LocalKeyword;
  scanDate: string;
  organicPosition: number | null;
  mapsPosition: number | null;
  localPackPosition: number | null;
  foundDomain: boolean;
  matchedBusinessName: string | null;
  confidenceScore: number;
  matchStatus: string;
  rawResponseRef: string | null;
  evidenceJson: unknown;
  previousOrganicPosition?: number | null;
  organicPositionChange?: number | null;
  previousMapsPosition?: number | null;
  mapsPositionChange?: number | null;
  previousLocalPackPosition?: number | null;
  localPackPositionChange?: number | null;
}

export interface LocalScore {
  id: string;
  businessId: string;
  keywordId: string | null;
  keyword?: LocalKeyword | null;
  scoreDate: string;
  totalScore: number;
  organicScore: number;
  mapsScore: number;
  packScore: number;
  reviewScore: number;
  napScore: number;
  websiteScore: number;
  contentScore: number;
  statusLabel: string;
  evidenceJson: unknown;
  previousOrganicPosition?: number | null;
  organicPositionChange?: number | null;
  previousMapsPosition?: number | null;
  mapsPositionChange?: number | null;
  previousLocalPackPosition?: number | null;
  localPackPositionChange?: number | null;
}

export interface LocalRecommendation {
  id: string;
  businessId: string;
  priority: string;
  category: string;
  recommendation: string;
  expectedImpact: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalCitation {
  id: string;
  businessId: string;
  source: string;
  found: boolean;
  nameMatch: boolean;
  phoneMatch: boolean;
  addressMatch: boolean;
  websiteMatch: boolean;
  status: string;
  fixUrl: string | null;
  notes: string | null;
  checkedAt: string;
}

export interface LocalReview {
  id: string;
  businessId: string;
  source: string;
  reviewer: string | null;
  rating: number | null;
  reviewText: string | null;
  reviewDate: string | null;
  sentiment: string | null;
  replyStatus: string;
  createdAt: string;
}

export interface LocalCompetitor {
  id: string;
  businessId: string;
  keywordId: string | null;
  competitorName: string;
  domain: string | null;
  phone: string | null;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
  mapsPosition: number | null;
  organicPosition: number | null;
  categoriesJson: string[];
  evidenceJson: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface LocalSeoDashboardResponse {
  business: LocalBusinessProfile;
  latestSnapshots: LocalRankSnapshot[];
}

export type GoogleBusinessCapabilityStatus = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN" | "TEMPORARILY_UNAVAILABLE" | "REAUTH_REQUIRED";

export interface GoogleBusinessCapability {
  status: GoogleBusinessCapabilityStatus;
  reason: string;
  source: string;
  lastCheckedAt: string;
  providerVersion: string;
  recoverable: boolean;
}

export interface GoogleBusinessProfileConnection {
  id: string;
  businessId: string;
  status: string;
  grantedScopesJson: string[];
  googleAccountName: string | null;
  googleAccountLabel: string | null;
  googleLocationName: string | null;
  googleLocationLabel: string | null;
  googleLocationMetadata: unknown;
  capabilitiesJson: Record<string, GoogleBusinessCapability>;
  lastCapabilityCheckAt: string | null;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleBusinessProfileSnapshot {
  id: string;
  connectionId: string;
  kind: string;
  providerRef: string | null;
  dataJson: unknown;
  sourceFetchedAt: string;
  expiresAt: string;
  createdAt: string;
}

export interface GoogleBusinessProfileDraft {
  id: string;
  businessId: string;
  subjectKey: string;
  contentType: "business_description" | "local_post" | "review_reply" | "profile_update" | string;
  version: number;
  title: string | null;
  body: string;
  callToActionJson: unknown;
  status: string;
  reviewNote: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleBusinessProfileAction {
  id: string;
  businessId: string;
  draftId: string | null;
  actionType: string;
  capabilityKey: string;
  status: string;
  payloadJson: unknown;
  providerReceiptJson: unknown;
  handoffUrl: string | null;
  handoffInstructions: string | null;
  executedAt: string | null;
  verifiedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleBusinessProfileAudit {
  score: number;
  status: "strong" | "needs_attention" | "incomplete";
  checks: Array<{ key: string; label: string; passed: boolean; weight: number; detail: string }>;
  recommendations: Array<{ priority: "high" | "medium" | "low"; category: string; recommendation: string; expectedImpact: string }>;
}

export interface GoogleBusinessProfileResponse {
  configured: boolean;
  writesEnabled: boolean;
  authorizationReady: boolean;
  providerProjectNumber: string | null;
  connection: GoogleBusinessProfileConnection | null;
  availableLocations: Array<{ accountName: string; accountLabel: string; accountRole?: string | null; locationName: string; locationLabel: string; storeCode?: string | null }>;
  profile: GoogleBusinessProfileSnapshot | null;
  reviews: GoogleBusinessProfileSnapshot | null;
  performance: GoogleBusinessProfileSnapshot | null;
  performanceHistory: GoogleBusinessProfileSnapshot[];
  audit: GoogleBusinessProfileAudit;
  drafts: GoogleBusinessProfileDraft[];
  actions: GoogleBusinessProfileAction[];
}

export interface ExecutionTask {
  id: string;
  clientId: string;
  websiteId: string | null;
  moduleName: string;
  sourceType: string;
  sourceId: string | null;
  dedupeKey: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low" | string;
  automationLevel: string;
  status: string;
  requiresApproval: boolean;
  requiresIntegration: boolean;
  manualRequired: boolean;
  actionButtonLabel: string | null;
  relatedUrl: string | null;
  relatedAssetId: string | null;
  manualInstructions: string | null;
  impact: string | null;
  completedAt: string | null;
  skippedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
