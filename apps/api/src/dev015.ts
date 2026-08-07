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

const funnelKeys = ["funnel_discover", "funnel_evaluate", "funnel_trust", "funnel_convert", "funnel_delight", "funnel_grow_refer"];
const supported = new Set(["freshness", "internal_link_equity", "cannibalization", "serp_ai", "crawl_budget", "intent_content_mapping", ...funnelKeys]);
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

export function buildIntelligentExecutionTasks(recommendations: StrategyRecommendation[]): IntelligentTask[] {
  const applicable = recommendations.filter((item) => {
    if (item.applicable === false || item.analysisKey === "unified_strategy_plan" || item.disposition === "deferred") return false;
    return supported.has(item.analysisKey) || item.engineVersion === "dev-047-part2-v1";
  });
  const recommendationKeys = new Set(applicable.map((item) => item.analysisKey));
  return applicable.map((item, index) => {
    const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
    const funnelAction = item.analysisKey.startsWith("funnel_");
    const approval = liveChange.has(item.analysisKey) || funnelAction || Boolean(item.requiredPermissions?.some((permission) => /approval|public|protected|publish|external/i.test(permission)));
    const actionSummary = item.actions?.length ? ` AI will prepare: ${item.actions.join("; ")}.` : "";
    const explicitDependencies = (item.dependencies ?? []).filter((dependency) => recommendationKeys.has(dependency));
    const dependencyContext = item.dependencies?.length ? ` Dependencies: ${item.dependencies.join("; ")}.` : "";
    const capacityContext = item.capacityRequirement ? ` Capacity: ${item.capacityRequirement}.` : "";
    return {
      key: `dev015:${item.analysisKey}:${slug || index}`,
      analysisKey: item.analysisKey,
      title: item.title,
      description: `${item.why} Evidence: ${item.evidence.join("; ") || "Approved Strategy evidence"}.${actionSummary}`,
      expectedOutcome: item.successMeasure ?? item.expectedImpact ?? outcomes[item.analysisKey] ?? `Complete the ${item.analysisKey.replaceAll("_", " ")} recommendation with measurable improvement and no duplicate work.`,
      priority: item.priority,
      automationLevel: approval ? "one_click_approval" : "manual_guided",
      requiresApproval: approval,
      approvalRisk: approval ? "high" : "low",
      safetyCategory: approval ? "protected_change" : "safe",
      manualInstructions: `${item.executionMethod ?? item.title} Review the cited evidence and AI-prepared assets, preview every affected page or customer touchpoint, and approve before implementation.${dependencyContext}${capacityContext} ${item.validationRequirement ?? "Validate the result before completion."} ${item.recommendedExperiment ? `Recommended experiment: ${item.recommendedExperiment}` : ""} ${item.whatHappensAfterApproval ?? ""} Impact ${item.impact}/100; confidence ${item.confidence}%; decision priority ${item.priorityScore ?? item.impact}/100.`,
      dependencyKeys: [...new Set([...(dependencies[item.analysisKey] ?? []), ...explicitDependencies])],
      destination: item.destination,
      destinationUrl: item.destinationUrl,
      sourceModule: item.sourceModule,
    };
  });
}
