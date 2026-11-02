import { agencyProposalTemplates, type AgencyProposalTemplateId } from "./reporting.js";

export type AgencyProposalInput = {
  projectName: string; clientName: string; primaryGoal?: string | null; targetMarkets?: unknown;
  timeline?: string | null; outputs?: unknown; strategySummary?: string | null; opportunityName?: string | null;
  completedTasks: number; totalTasks: number;
  templateId?: AgencyProposalTemplateId; selectedServices?: unknown; selectedFindings?: unknown;
};

const strings = (value: unknown) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];

export function agencyProposalContent(input: AgencyProposalInput) {
  const markets = strings(input.targetMarkets);
  const outputs = strings(input.outputs);
  const selectedServices = strings(input.selectedServices);
  const selectedFindings = strings(input.selectedFindings);
  const templateId = input.templateId ?? "seo_organic";
  const template = agencyProposalTemplates.find((item) => item.id === templateId) ?? agencyProposalTemplates[0];
  const goal = input.primaryGoal?.trim() || "Improve measurable digital performance";
  const services = selectedServices.length ? selectedServices : outputs.length ? outputs : [...template.defaultServices];
  const opportunity = input.opportunityName || input.strategySummary || "Build a measurable search, content, and execution program from the approved project direction.";
  return {
    templateId,
    title: `${input.projectName} ${template.title}`,
    executiveSummary: `This proposal outlines a focused engagement for ${input.clientName} to ${goal.toLowerCase()}${markets.length ? ` across ${markets.join(", ")}` : ""}. Recommendations and delivery priorities are based on the saved project intake and current SEnuke AI - AI Growth Operating System evidence.`,
    objectives: [goal],
    findings: selectedFindings,
    opportunity,
    recommendedApproach: services,
    scope: services.length ? services : ["SEO and keyword opportunity plan", "Content and page recommendations", "Technical and execution priorities", "Measurement and reporting"],
    deliverables: services.length ? services : ["Approved Strategy", "Prioritized Execution Plan", "Performance report", "Implementation recommendations"],
    roadmap: ["Confirm the evidence and final scope.", "Complete the approved foundation and priority work.", "Measure progress and agree the next prioritized actions."],
    timeline: input.timeline || "To be confirmed with the client",
    investment: { currency: "CAD", setupFee: "TBD", monthlyFee: "TBD", lineItems: [{ label: "Strategy and implementation", amount: "TBD" }] },
    addOns: [],
    expectedOutcomes: [`Improve progress toward: ${goal}.`, "Create a clearer evidence-backed plan for the next approved actions."],
    assumptions: ["Final scope, access, integrations, and delivery dates are confirmed before work begins.", "External platform, advertising, media, hosting, and third-party fees are excluded unless listed.", "Protected publishing actions require approval."],
    exclusions: ["Results such as rankings, leads, revenue, map placement, or AI citations are not guaranteed.", "Work not listed in the approved scope requires a documented scope change."],
    terms: ["Pricing, taxes, payment schedule, access requirements, and termination terms must be confirmed by the agency before delivery."],
    nextSteps: ["Review the proposed scope and investment.", "Request any required revisions.", "Approve the final proposal before delivery begins."],
    evidenceSummary: { completedTasks: input.completedTasks, totalTasks: input.totalTasks, targetMarkets: markets, selectedFindings, sourceLabel: "Current saved project evidence" },
  };
}
