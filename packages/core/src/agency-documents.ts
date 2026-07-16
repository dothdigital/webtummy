export type AgencyProposalInput = {
  projectName: string; clientName: string; primaryGoal?: string | null; targetMarkets?: unknown;
  timeline?: string | null; outputs?: unknown; strategySummary?: string | null; opportunityName?: string | null;
  completedTasks: number; totalTasks: number;
};

const strings = (value: unknown) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];

export function agencyProposalContent(input: AgencyProposalInput) {
  const markets = strings(input.targetMarkets);
  const outputs = strings(input.outputs);
  const goal = input.primaryGoal?.trim() || "Improve measurable digital performance";
  return {
    title: `${input.projectName} Growth Proposal`,
    executiveSummary: `This proposal outlines a focused engagement for ${input.clientName} to ${goal.toLowerCase()}${markets.length ? ` across ${markets.join(", ")}` : ""}. Recommendations and delivery priorities are based on the saved project intake and current SEnuke AI evidence.`,
    objectives: [goal],
    opportunity: input.opportunityName || input.strategySummary || "Build a measurable search, content, and execution program from the approved project direction.",
    scope: outputs.length ? outputs : ["SEO and keyword opportunity plan", "Content and page recommendations", "Technical and execution priorities", "Measurement and reporting"],
    deliverables: outputs.length ? outputs : ["Approved Strategy", "Prioritized Execution Plan", "Performance report", "Implementation recommendations"],
    timeline: input.timeline || "To be confirmed with the client",
    investment: { currency: "CAD", setupFee: "TBD", monthlyFee: "TBD", lineItems: [{ label: "Strategy and implementation", amount: "TBD" }] },
    assumptions: ["Final scope, access, integrations, and delivery dates are confirmed before work begins.", "External platform, advertising, media, hosting, and third-party fees are excluded unless listed.", "Protected publishing actions require approval."],
    nextSteps: ["Review the proposed scope and investment.", "Request any required revisions.", "Approve the final proposal before delivery begins."],
    evidenceSummary: { completedTasks: input.completedTasks, totalTasks: input.totalTasks, targetMarkets: markets },
  };
}
