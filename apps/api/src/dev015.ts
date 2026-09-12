export type StrategyRecommendation = {
  analysisKey: string;
  title: string;
  why: string;
  priority: "critical" | "high" | "medium" | "low";
  impact: number;
  confidence: number;
  evidence: string[];
  applicable?: boolean;
  actions?: string[];
  expectedImpact?: string;
  destination?: string;
  destinationUrl?: string;
  validationRequirement?: string;
  recommendedExperiment?: string;
  successMeasure?: string;
  executionMethod?: string;
  whatHappensAfterApproval?: string;
  requiredPermissions?: string[];
  dependencies?: string[];
  capacityRequirement?: string;
  priorityScore?: number;
  disposition?: "selected" | "queued" | "deferred";
  selected?: boolean;
  engineVersion?: string;
  sourceModule?: string;
};
export type IntelligentTask = { key: string; analysisKey: string; title: string; description: string; expectedOutcome: string; priority: StrategyRecommendation["priority"]; automationLevel: string; requiresApproval: boolean; approvalRisk: string; safetyCategory: string; manualInstructions: string; dependencyKeys: string[]; destination?: string; destinationUrl?: string; sourceModule?: string };

// Strategy may describe the complete customer journey, but a description is
// not an Execution task. Only recommendations backed by a concrete platform
// workflow are admitted here. Funnel recommendations remain visible in
// Strategy until a module materializes exact assets or records to operate on.
const supported = new Set(["freshness", "internal_link_equity", "cannibalization", "serp_ai", "crawl_budget", "intent_content_mapping"]);
const liveChange = new Set(["freshness", "internal_link_equity", "cannibalization", "crawl_budget"]);
const dependencies: Record<string, string[]> = {
  cannibalization: ["intent_content_mapping"], serp_ai: ["intent_content_mapping"], internal_link_equity: ["intent_content_mapping"],
  funnel_evaluate: ["funnel_discover"], funnel_trust: ["funnel_evaluate"], funnel_convert: ["funnel_trust"], funnel_delight: ["funnel_convert"], funnel_grow_refer: ["funnel_delight"],
};
const outcomes: Record<string, string> = {
  freshness: "Keep priority content accurate, current, and aligned with present search intent.",
  internal_link_equity: "Move internal authority to priority pages while repairing broken, weak, or missing paths.",
  cannibalization: "Give each important intent one clear owning page so pages do not compete with each other.",
  serp_ai: "Increase eligibility for useful SERP features and evidence-backed AI answer citations.",
  crawl_budget: "Focus crawler attention on canonical, indexable, high-value URLs.",
  intent_content_mapping: "Assign every approved keyword cluster to one page purpose, journey stage, and CTA.",
  funnel_discover: "Improve how the priority audience discovers the business through relevant, evidence-backed entry paths.",
  funnel_evaluate: "Help prospective customers evaluate the solution through useful, intent-matched assets and a clear next step.",
  funnel_trust: "Strengthen verified proof and reassurance before customers reach the primary conversion action.",
  funnel_convert: "Make the approved enquiry, booking, purchase, signup, or sales action clear and measurable.",
  funnel_delight: "Create a reassuring onboarding and delivery experience that fulfills the customer promise.",
  funnel_grow_refer: "Use verified outcomes to improve retention, expansion, advocacy, referrals, and the next growth cycle.",
};

const executableSpecs: Record<string, { title: string; destination: string; destinationUrl: string; instruction: string }> = {
  freshness: {
    title: "Review outdated pages and create refresh drafts",
    destination: "content",
    destinationUrl: "/ai-content",
    instruction: "Open Content Studio, review the pages flagged as outdated, generate a refresh draft for each selected page, then send the exact drafts for approval.",
  },
  internal_link_equity: {
    title: "Fix broken, weak, and missing internal links",
    destination: "gap_analysis",
    destinationUrl: "/gap-analysis",
    instruction: "Open SEO & Gap Analysis, review the source URL, target URL, and proposed anchor for each finding, then approve the exact link changes to implement.",
  },
  cannibalization: {
    title: "Resolve pages competing for the same keyword",
    destination: "gap_analysis",
    destinationUrl: "/gap-analysis",
    instruction: "Open SEO & Gap Analysis, choose the owner URL for each competing keyword set, then approve the proposed merge, redirect, or reposition action for the other URLs.",
  },
  serp_ai: {
    title: "Prepare answer and schema updates for selected pages",
    destination: "ai_citations",
    destinationUrl: "/ai-citations",
    instruction: "Open AI Citations, review the cited page and missing answer or entity signal, generate the supported update, and approve only claims backed by saved evidence.",
  },
  crawl_budget: {
    title: "Fix indexability, canonical, and crawl-path issues",
    destination: "gap_analysis",
    destinationUrl: "/gap-analysis",
    instruction: "Open SEO & Gap Analysis, review each affected URL and its proposed canonical, redirect, sitemap, or indexability change, then approve the exact fixes.",
  },
  intent_content_mapping: {
    title: "Review the keyword-to-page map",
    destination: "content",
    destinationUrl: "/seo-page-map",
    instruction: "Open the SEO Page Map, review every approved keyword cluster and owner URL, resolve duplicate owners or unmapped clusters, then approve the map.",
  },
};

export function buildIntelligentExecutionTasks(recommendations: StrategyRecommendation[]): IntelligentTask[] {
  const applicable = recommendations.filter((item) => {
    if (item.applicable === false || item.analysisKey === "unified_strategy_plan" || item.disposition === "deferred") return false;
    return supported.has(item.analysisKey);
  });
  const recommendationKeys = new Set(applicable.map((item) => item.analysisKey));
  return applicable.map((item, index) => {
    const spec = executableSpecs[item.analysisKey];
    const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
    const approval = liveChange.has(item.analysisKey) || Boolean(item.requiredPermissions?.some((permission) => /approval|public|protected|publish|external/i.test(permission)));
    const actionSummary = item.actions?.length ? ` AI will prepare: ${item.actions.join("; ")}.` : "";
    const explicitDependencies = (item.dependencies ?? []).filter((dependency) => recommendationKeys.has(dependency));
    const dependencyContext = item.dependencies?.length ? ` Dependencies: ${item.dependencies.join("; ")}.` : "";
    const capacityContext = item.capacityRequirement ? ` Capacity: ${item.capacityRequirement}.` : "";
    return {
      key: `dev015:${item.analysisKey}:${slug || index}`,
      analysisKey: item.analysisKey,
      title: spec.title,
      description: `${spec.instruction} Evidence: ${item.evidence.join("; ") || "Approved Strategy evidence"}.${actionSummary}`,
      expectedOutcome: item.successMeasure ?? item.expectedImpact ?? outcomes[item.analysisKey] ?? `Complete the ${item.analysisKey.replaceAll("_", " ")} recommendation with measurable improvement and no duplicate work.`,
      priority: item.priority,
      automationLevel: approval ? "one_click_approval" : "manual_guided",
      requiresApproval: approval,
      approvalRisk: approval ? "high" : "low",
      safetyCategory: approval ? "protected_change" : "safe",
      manualInstructions: `${spec.instruction}${dependencyContext}${capacityContext} ${item.validationRequirement ?? "Confirm the module reports no unresolved selected findings before completion."}`,
      dependencyKeys: [...new Set([...(dependencies[item.analysisKey] ?? []), ...explicitDependencies])],
      destination: spec.destination,
      destinationUrl: spec.destinationUrl,
      sourceModule: spec.destination,
    };
  });
}
