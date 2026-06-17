// API response shapes (mirrors apps/api).
export interface Client {
  id: string;
  name: string;
  contactEmail: string | null;
  plan: string;
  isActive: boolean;
  createdAt: string;
  _count?: { websites: number; users: number };
}

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
  client: { id: string; name: string } | null;
}

export interface Website {
  id: string;
  clientId: string;
  domain: string;
  rootUrl: string;
  targetCountry: string | null;
  createdAt: string;
  _count?: { crawlJobs: number };
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
