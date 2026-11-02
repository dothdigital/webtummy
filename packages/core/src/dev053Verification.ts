export const dev053Statuses = ["COMPLETE", "PARTIAL", "MISSING", "BLOCKED", "DEFERRED", "NOT_APPLICABLE"] as const;
export type Dev053Status = (typeof dev053Statuses)[number];

export const dev053WorkflowStages = ["understand", "discover", "strategize", "approve", "execute", "measure", "learn", "next_best_action"] as const;
export type Dev053WorkflowStage = (typeof dev053WorkflowStages)[number];

export type Dev053CapabilityDefinition = {
  id: `SEO-${string}` | `AEO-${string}` | `GEO-${string}`;
  title: string;
  section: string;
  workflowStage: Dev053WorkflowStage;
  route: string;
  signal: string;
  provider?: "search_data" | "pagespeed" | "google_business_profile" | "search_console" | "ga4" | "ai_visibility";
  applicableTo?: Array<"standard" | "local" | "ecommerce" | "website">;
};

type SectionInput = Omit<Dev053CapabilityDefinition, "id" | "title"> & {
  prefix: "SEO" | "AEO" | "GEO";
  start: number;
  titles: string[];
};

const section = (input: SectionInput): Dev053CapabilityDefinition[] => input.titles.map((title, index) => ({
  id: `${input.prefix}-${String(input.start + index).padStart(3, "0")}` as Dev053CapabilityDefinition["id"],
  title,
  section: input.section,
  workflowStage: input.workflowStage,
  route: input.route,
  signal: input.signal,
  ...(input.provider ? { provider: input.provider } : {}),
  ...(input.applicableTo ? { applicableTo: input.applicableTo } : {}),
}));

export const dev053Capabilities: Dev053CapabilityDefinition[] = [
  ...section({ prefix: "SEO", start: 1, section: "Business, market and competitor intelligence", workflowStage: "understand", route: "/guided-projects/{projectId}/intake", signal: "business_brain", titles: [
    "Business and audience understanding", "Business model and market classification", "Search-market opportunity discovery", "Organic competitor discovery", "Competitor comparison", "Competitive gap detection",
  ] }),
  ...section({ prefix: "SEO", start: 7, section: "Keyword intelligence and mapping", workflowStage: "discover", route: "/keyword-insights?projectId={projectId}", signal: "keyword_intelligence", provider: "search_data", titles: [
    "Keyword discovery", "Search-intent classification", "Keyword value and prioritization", "Topic clustering", "Keyword-to-page mapping", "Cannibalization detection", "SERP feature awareness", "Ranking tracking",
  ] }),
  ...section({ prefix: "SEO", start: 15, section: "Website crawling and technical SEO", workflowStage: "discover", route: "/site-analysis?projectId={projectId}", signal: "technical_seo", applicableTo: ["website"], titles: [
    "Website crawl", "Indexability review", "Sitemap and robots.txt checks", "HTTP status and redirect checks", "Broken-link detection", "Duplicate and canonical-content issues", "Site architecture and crawl depth", "Mobile and performance review", "Structured-data validation", "Change and availability monitoring",
  ] }),
  ...section({ prefix: "SEO", start: 25, section: "On-page SEO", workflowStage: "discover", route: "/gap-analysis?projectId={projectId}", signal: "on_page_seo", applicableTo: ["website"], titles: [
    "Title and meta-description review", "Heading and page-structure review", "Page-topic alignment", "Semantic coverage", "Thin or low-value content detection", "Image SEO", "Conversion-path review", "Pre-launch website analysis",
  ] }),
  ...section({ prefix: "SEO", start: 33, section: "Content strategy, creation and maintenance", workflowStage: "execute", route: "/ai-content?projectId={projectId}", signal: "content_workflow", titles: [
    "SEO content strategy", "Topic-cluster plan", "Intent-based content calendar", "Content brief generation", "Content drafting and optimization", "Originality and information-gain checks", "Content-decay detection", "Content refresh workflow",
  ] }),
  ...section({ prefix: "SEO", start: 41, section: "Topical authority and internal linking", workflowStage: "execute", route: "/site-analysis?projectId={projectId}", signal: "internal_linking", applicableTo: ["website"], titles: [
    "Topical coverage measurement", "Missing supporting-topic discovery", "Internal-link inventory", "Internal-link opportunities", "Approved internal-link execution", "Multi-location authority graph",
  ] }),
  ...section({ prefix: "SEO", start: 47, section: "Entity, AI-search and citation intelligence", workflowStage: "discover", route: "/ai-citations?projectId={projectId}", signal: "ai_citation", titles: [
    "Entity identification", "Entity clarity and consistency", "Knowledge-graph recommendations", "AI-citation readiness", "Observed AI mentions/citations", "Competitor AI-citation comparison", "Authority and evidence gaps", "AI-search improvement plan",
  ] }),
  ...section({ prefix: "SEO", start: 55, section: "Local SEO and Google Business Profile", workflowStage: "discover", route: "/local-seo?projectId={projectId}", signal: "local_seo", provider: "google_business_profile", applicableTo: ["local"], titles: [
    "Local keyword and intent research", "Local competitor analysis", "Local rank and grid tracking", "Location and service-area strategy", "Local-page recommendations and creation", "NAP and citation consistency", "Local schema", "GBP profile connection and audit", "GBP reviews and responses", "GBP updates and supported actions", "Local performance",
  ] }),
  ...section({ prefix: "SEO", start: 66, section: "Ecommerce SEO", workflowStage: "discover", route: "/gap-analysis?projectId={projectId}&mode=ecommerce", signal: "ecommerce", applicableTo: ["ecommerce"], titles: [
    "Product and category keyword research", "Product-page optimization", "Category architecture", "Ecommerce technical SEO", "Commercial opportunity gaps",
  ] }),
  ...section({ prefix: "SEO", start: 71, section: "Authority, citations and reputation", workflowStage: "discover", route: "/backlinks?projectId={projectId}", signal: "authority", provider: "search_data", titles: [
    "Backlink profile data", "Authority-gap analysis", "Link and mention opportunities", "Brand-signal monitoring", "Review and reputation intelligence",
  ] }),
  ...section({ prefix: "SEO", start: 76, section: "Strategy, execution and publishing", workflowStage: "strategize", route: "/strategy?projectId={projectId}", signal: "strategy_execution", titles: [
    "Unified SEO strategy", "Priority and expected impact", "Strategy approval", "Execution Plan creation", "Website/content preparation", "Publishing", "Post-publish verification", "Activity History",
  ] }),
  ...section({ prefix: "SEO", start: 84, section: "Measurement, learning and Next Best Action", workflowStage: "measure", route: "/reports?projectId={projectId}", signal: "measurement_learning", titles: [
    "Search Console connection", "GA4 connection", "Search performance", "Index coverage monitoring", "Conversion measurement", "Baseline handling", "Work-to-result connection", "Growth Blueprint update", "SEO Next Best Action", "Continuous reevaluation",
  ] }),
  ...section({ prefix: "AEO", start: 1, section: "Answer Engine Optimization", workflowStage: "discover", route: "/ai-citations?projectId={projectId}&tab=answers", signal: "aeo", provider: "ai_visibility", titles: [
    "Question and conversational-query discovery", "Answer-intent classification", "Direct-answer optimization", "Answer-passage structure", "FAQ and question-led content", "Featured-answer opportunity analysis", "Answer-related structured data", "Voice and conversational readiness", "Answer quality and factual support", "Answer visibility measurement",
  ] }),
  ...section({ prefix: "GEO", start: 1, section: "Generative Engine Optimization", workflowStage: "discover", route: "/ai-citations?projectId={projectId}&tab=generative", signal: "geo", provider: "ai_visibility", titles: [
    "Generative-engine citation readiness", "Brand and entity understanding", "Verifiable claims and source support", "Expertise and corroboration signals", "Quotable facts and definitions", "Information gain and distinct value", "Generative competitor citation gaps", "Observed mention and citation tracking", "Readiness versus observed-result separation", "Engine-specific improvement recommendations", "GEO execution workflow", "GEO performance and learning",
  ] }),
];

export const dev053AcceptanceScenarios = [
  ["AT-01", "Existing website"], ["AT-02", "New website"], ["AT-03", "Internal links"], ["AT-04", "Content decay"], ["AT-05", "AI citation"], ["AT-06", "Local without Google"], ["AT-07", "GBP connected"], ["AT-08", "Ecommerce"], ["AT-09", "Missing provider"], ["AT-10", "Permissions"], ["AT-11", "Agency isolation"], ["AT-12", "Next Best Action"], ["AT-13", "AEO"], ["AT-14", "GEO"],
] as const;

export const dev053ExpectedCapabilityIds = [
  ...Array.from({ length: 93 }, (_, index) => `SEO-${String(index + 1).padStart(3, "0")}`),
  ...Array.from({ length: 10 }, (_, index) => `AEO-${String(index + 1).padStart(3, "0")}`),
  ...Array.from({ length: 12 }, (_, index) => `GEO-${String(index + 1).padStart(3, "0")}`),
] as Dev053CapabilityDefinition["id"][];
