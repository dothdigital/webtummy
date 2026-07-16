export type OpportunityInput = {
  projectType?: string | null; primaryGoal?: string | null; secondaryGoals?: unknown; niche?: string | null;
  websiteStatus?: string | null; competitors?: unknown; preferredOutputs?: unknown;
  businessLocation?: string | null; businessLocationJson?: unknown; targetLocations?: unknown;
  businessProfile?: { targetAudience?: string | null; offerSummary?: string | null; businessSummary?: string | null } | null;
};

const list = (value: unknown) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];

export function opportunityRunMode(project: OpportunityInput) {
  const explicitDirectionSignals = [project.niche, project.businessProfile?.offerSummary, project.businessProfile?.targetAudience, project.primaryGoal].filter((value) => value?.trim()).length;
  const clearDirection = explicitDirectionSignals >= 4 && Boolean(project.projectType && project.projectType !== "other");
  return { clearDirection, mode: clearDirection ? "confirmation" as const : "recommendation" as const, signalCount: explicitDirectionSignals };
}

export function rankedOpportunityRecommendations<T>(options: T[]) {
  return options.slice(0, 3);
}

export function estimatedOpportunityEffort(executionScore?: number | null) {
  const score = executionScore ?? 50;
  return score >= 82 ? "Low" : score >= 68 ? "Medium" : "High";
}

export function opportunityConfidence(opportunityScore?: number | null, userFitScore?: number | null) {
  return Math.max(0, Math.min(100, Math.round(((opportunityScore ?? 60) * 0.6) + ((userFitScore ?? 60) * 0.4))));
}

export function opportunityInputSummary(project: OpportunityInput) {
  return {
    businessType: project.projectType ?? null,
    businessSummary: project.businessProfile?.businessSummary ?? null,
    productsServices: project.businessProfile?.offerSummary ?? null,
    audience: project.businessProfile?.targetAudience ?? null,
    businessLocation: project.businessLocationJson ?? project.businessLocation ?? null,
    targetMarkets: list(project.targetLocations),
    primaryGoal: project.primaryGoal ?? null,
    secondaryGoals: list(project.secondaryGoals),
    competitors: list(project.competitors),
    websiteStatus: project.websiteStatus ?? null,
    preferredOutputs: list(project.preferredOutputs),
  };
}

export function opportunityDecisionStatus(status: string) {
  return status === "selected" || status === "confirmed";
}
