export type StrategyRecommendation = { analysisKey: string; title: string; why: string; priority: "critical" | "high" | "medium" | "low"; impact: number; confidence: number; evidence: string[]; applicable?: boolean };
export type IntelligentTask = { key: string; analysisKey: string; title: string; description: string; expectedOutcome: string; priority: StrategyRecommendation["priority"]; automationLevel: string; requiresApproval: boolean; approvalRisk: string; safetyCategory: string; manualInstructions: string; dependencyKeys: string[] };

const supported = new Set(["freshness", "internal_link_equity", "cannibalization", "serp_ai", "crawl_budget", "intent_content_mapping"]);
const liveChange = new Set(["freshness", "internal_link_equity", "cannibalization", "crawl_budget"]);
const dependencies: Record<string, string[]> = {
  cannibalization: ["intent_content_mapping"], serp_ai: ["intent_content_mapping"], internal_link_equity: ["intent_content_mapping"],
};
const outcomes: Record<string, string> = {
  freshness: "Keep priority content accurate, current, and aligned with present search intent.",
  internal_link_equity: "Move internal authority to priority pages while repairing broken, weak, or missing paths.",
  cannibalization: "Give each important intent one clear owning page so pages do not compete with each other.",
  serp_ai: "Increase eligibility for useful SERP features and evidence-backed AI answer citations.",
  crawl_budget: "Focus crawler attention on canonical, indexable, high-value URLs.",
  intent_content_mapping: "Assign every approved keyword cluster to one page purpose, journey stage, and CTA.",
};

export function buildIntelligentExecutionTasks(recommendations: StrategyRecommendation[]): IntelligentTask[] {
  const applicable = recommendations.filter((item) => item.applicable !== false && supported.has(item.analysisKey));
  return applicable.map((item, index) => {
    const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
    const approval = liveChange.has(item.analysisKey);
    return {
      key: `dev015:${item.analysisKey}:${slug || index}`,
      analysisKey: item.analysisKey,
      title: item.title,
      description: `${item.why} Evidence: ${item.evidence.join("; ") || "Approved Strategy evidence"}.`,
      expectedOutcome: outcomes[item.analysisKey] ?? `Complete the ${item.analysisKey.replaceAll("_", " ")} recommendation with measurable improvement and no duplicate work.`,
      priority: item.priority,
      automationLevel: approval ? "one_click_approval" : "manual_guided",
      requiresApproval: approval,
      approvalRisk: approval ? "high" : "low",
      safetyCategory: approval ? "protected_change" : "safe",
      manualInstructions: `${item.title} Review the cited evidence, preview affected pages or keywords, and validate the result before completion. Impact ${item.impact}/100; confidence ${item.confidence}%.`,
      dependencyKeys: dependencies[item.analysisKey] ?? [],
    };
  });
}
