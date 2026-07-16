export type ExtendedStrategyInput = {
  existingWebsite: boolean;
  businessName: string;
  niche: string;
  goals: string[];
  markets: string[];
  competitors: string[];
  keywordGroups: Array<{ title: string; category: string; keywords: string[]; gaps: string[] }>;
  pages: Array<{ url: string; title?: string | null; wordCount?: number | null; inlinks?: number | null; brokenLinks?: number | null; weakAnchors?: number | null; orphan?: boolean | null; indexable?: boolean | null }>;
  issues: Array<{ category: string; severity: string; message: string }>;
};

export type ExtendedStrategyAnalysis = {
  key: string; title: string; applicable: boolean; priority: "critical" | "high" | "medium" | "low";
  impact: number; confidence: number; why: string; evidence: string[]; actions: string[];
};

export type ExtendedStrategyRecommendation = ExtendedStrategyAnalysis & { analysisKey: string };

const normalized = (value: string) => value.trim().toLocaleLowerCase();
const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

export function buildExtendedStrategyAnalysis(input: ExtendedStrategyInput) {
  const groups = input.keywordGroups;
  const keywords = unique(groups.flatMap((group) => group.keywords));
  const gaps = unique(groups.flatMap((group) => group.gaps));
  const keywordOwners = new Map<string, number>();
  for (const group of groups) for (const keyword of unique(group.keywords.map(normalized))) keywordOwners.set(keyword, (keywordOwners.get(keyword) ?? 0) + 1);
  const cannibalized = [...keywordOwners.entries()].filter(([, count]) => count > 1).map(([keyword]) => keyword);
  const orphanPages = input.pages.filter((page) => page.orphan || (page.inlinks ?? 1) === 0);
  const linkProblems = input.pages.filter((page) => (page.brokenLinks ?? 0) > 0 || (page.weakAnchors ?? 0) > 0);
  const thinPages = input.pages.filter((page) => (page.wordCount ?? 1000) < 600);
  const nonIndexable = input.pages.filter((page) => page.indexable === false);
  const technicalIssues = input.issues.filter((issue) => /technical|index|crawl|link|schema/i.test(`${issue.category} ${issue.message}`));
  const highIssues = input.issues.filter((issue) => /critical|high/i.test(issue.severity));
  const hasQuestions = keywords.some((keyword) => /^(how|what|why|when|where|who|can|does|is)\b/i.test(keyword));
  const marketEvidence = input.markets.length ? `Target markets: ${input.markets.join(", ")}` : "No target markets saved";
  const goalEvidence = input.goals.length ? `Goals: ${input.goals.join(", ")}` : "No goals saved";

  const analyses: ExtendedStrategyAnalysis[] = [
    {
      key: "search_intent", title: "Search intent classification", applicable: keywords.length > 0, priority: "high", impact: 88, confidence: keywords.length > 5 ? 90 : 78,
      why: "Keyword intent must match the page purpose and conversion path before content is created.", evidence: [`${keywords.length} approved keywords`, goalEvidence], actions: ["Classify informational, commercial, transactional, and local intent", "Align CTAs and page types to intent"],
    },
    {
      key: "entity_graph", title: "Entity graph optimization", applicable: Boolean(input.businessName && input.niche), priority: "medium", impact: 74, confidence: 80,
      why: "Clear relationships between the brand, services, locations, people, and proof improve search and AI understanding.", evidence: [`Business: ${input.businessName}`, `Niche: ${input.niche}`, marketEvidence], actions: ["Define the core brand and service entities", "Connect entities through copy, internal links, and schema"],
    },
    {
      key: "topical_gaps", title: "Topical gap analysis", applicable: gaps.length > 0, priority: "high", impact: 86, confidence: Math.min(94, 72 + gaps.length * 3),
      why: "Approved keyword gaps identify useful coverage competitors or existing pages may already satisfy better.", evidence: [`${gaps.length} approved keyword gaps`, ...gaps.slice(0, 3)], actions: ["Map each gap to an existing or new page", "Prioritize gaps closest to the primary goal"],
    },
    {
      key: "eeat", title: "Trust and EEAT recommendations", applicable: input.existingWebsite, priority: "high", impact: 82, confidence: 79,
      why: "Visible experience, expertise, authorship, proof, and business transparency strengthen trust.", evidence: [`${input.pages.length} crawled pages`, `${highIssues.length} high-priority findings`, `Competitors saved: ${input.competitors.length}`], actions: ["Add authorship, proof, policies, and source clarity", "Connect organization and expert signals consistently"],
    },
    {
      key: "freshness", title: "Content freshness", applicable: input.existingWebsite && thinPages.length > 0, priority: "medium", impact: 70, confidence: 76,
      why: "Thin or incomplete pages are more likely to miss current intent, proof, and useful detail.", evidence: [`${thinPages.length} pages below the content-depth threshold`, ...thinPages.slice(0, 2).map((page) => page.url)], actions: ["Review priority pages for outdated or missing sections", "Refresh facts, examples, proof, and intent coverage"],
    },
    {
      key: "crawl_budget", title: "Crawl budget optimization", applicable: input.existingWebsite && (input.pages.length >= 100 || nonIndexable.length >= 25 || technicalIssues.filter((issue) => /crawl|index/i.test(`${issue.category} ${issue.message}`)).length >= 20), priority: "medium", impact: 68, confidence: 75,
      why: "Crawl-budget work is useful only when site size or indexability evidence shows meaningful crawler waste.", evidence: [`${input.pages.length} crawled pages`, `${nonIndexable.length} non-indexable pages`, `${technicalIssues.length} technical findings`], actions: ["Remove low-value crawl paths", "Consolidate canonicals, sitemap entries, and internal discovery"],
    },
    {
      key: "cannibalization", title: "Keyword cannibalization", applicable: cannibalized.length > 0, priority: "high", impact: 84, confidence: 91,
      why: "The same approved keyword appears in multiple groups and may be assigned to competing pages.", evidence: [`${cannibalized.length} overlapping keywords`, ...cannibalized.slice(0, 4)], actions: ["Choose one owning page for each intent", "Merge, differentiate, redirect, or re-link competing pages"],
    },
    {
      key: "internal_link_equity", title: "Internal link equity", applicable: input.existingWebsite && (orphanPages.length > 0 || linkProblems.length > 0), priority: "high", impact: 85, confidence: 89,
      why: "Broken, weak, and missing internal links prevent authority and users from reaching priority pages efficiently.", evidence: [`${orphanPages.length} orphan or zero-inlink pages`, `${linkProblems.length} pages with broken links or weak anchors`], actions: ["Repair broken internal targets", "Link relevant pages to priority conversion and topic pages"],
    },
    {
      key: "serp_ai", title: "SERP features and AI visibility", applicable: keywords.length > 0, priority: "medium", impact: 78, confidence: hasQuestions ? 88 : 75,
      why: "Structured, answer-first coverage can improve eligibility for SERP features and evidence-backed AI citations.", evidence: [`${keywords.length} approved keywords`, `${hasQuestions ? "Question intent is present" : "Question intent should be expanded"}`, marketEvidence], actions: ["Add concise answers, FAQs, comparisons, and supporting evidence", "Apply relevant schema without inventing claims"],
    },
    {
      key: "competitive_monitoring", title: "Competitive change monitoring", applicable: input.competitors.length > 0, priority: "medium", impact: 72, confidence: 82,
      why: "Saved competitors provide a baseline for detecting meaningful changes in coverage, offers, proof, and visibility.", evidence: input.competitors.slice(0, 5), actions: ["Track material competitor page and positioning changes", "Respond only where a change creates a relevant gap"],
    },
    {
      key: "intent_content_mapping", title: "Intent-based content mapping", applicable: keywords.length > 0, priority: "high", impact: 90, confidence: 88,
      why: "Every approved keyword cluster needs one page purpose, journey stage, target market, and measurable CTA.", evidence: [`${groups.length} approved groups`, `${keywords.length} approved keywords`, marketEvidence], actions: ["Assign one primary page target per intent", "Map supporting pages, internal links, and conversion actions"],
    },
  ];

  const recommendations: ExtendedStrategyRecommendation[] = analyses
    .filter((analysis) => analysis.applicable)
    .map((analysis) => ({ ...analysis, analysisKey: analysis.key }))
    .sort((left, right) => right.impact - left.impact || right.confidence - left.confidence);
  return { analyses, recommendations };
}
