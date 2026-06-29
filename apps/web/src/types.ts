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
  crawlJobs?: {
    id: string;
    status: "queued" | "running" | "completed" | "failed";
    siteScore: number | null;
    pagesCrawled: number;
    errorCount?: number;
    createdAt: string;
    startedAt?: string | null;
    completedAt: string | null;
    error?: string | null;
  }[];
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
  website?: { id: string; domain: string; rootUrl: string } | null;
  ideas?: KeywordIdea[];
  competitors?: KeywordSerpCompetitor[];
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
  manualAccessEndsAt: string | null;
  manualAccessDaysRemaining: number;
  graceEndsAt?: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  reportEmailEnabled: boolean;
  weeklyReportEmailEnabled: boolean;
  monthlyReportEmailEnabled: boolean;
  rankingChangeEmailEnabled: boolean;
}

export type AiGenerationType = "article" | "h1" | "title" | "meta_description" | "faq" | "page_schema" | "domain_schema" | "page_llms_txt" | "domain_llms_txt" | "sitemap" | "ai_search";

export interface AiContentGeneration {
  id: string;
  clientId: string;
  userId: string | null;
  websiteId: string | null;
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
  targetKeyword: string | null;
  targetUrl: string | null;
  funnelStage: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SocialStrategy {
  id: string;
  websiteId: string;
  goal: string;
  audience: string | null;
  platforms: string[];
  postingFrequency: string | null;
  tone: string | null;
  monthlyTheme: string | null;
  socialScore: number;
  profileScore: number;
  consistencyScore: number;
  activityScore: number;
  competitorScore: number;
  seoAlignmentScore: number;
  recommendationsJson: string[];
  createdAt: string;
  updatedAt: string;
  pillars: SocialContentPillar[];
  posts: SocialCalendarPost[];
}

export interface SocialStrategyResponse {
  website: { id: string; domain: string; rootUrl: string; targetCities?: unknown };
  profiles: SocialProfile[];
  competitors: SocialCompetitorProfile[];
  strategies: SocialStrategy[];
  strategy?: SocialStrategy;
  platformOptions: string[];
}

export interface LocalBusinessProfile {
  id: string;
  clientId: string;
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
