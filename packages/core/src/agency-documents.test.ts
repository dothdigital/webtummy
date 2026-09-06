import { describe, expect, it } from "vitest";
import { agencyProposalContent } from "./agency-documents.js";

describe("DEV-015 agency proposals", () => {
  it("builds editable client scope and pricing placeholders from project evidence", () => {
    const proposal = agencyProposalContent({ projectName: "Acme SEO", clientName: "Acme", primaryGoal: "Generate More Leads", targetMarkets: ["Toronto"], timeline: "90 days", outputs: ["SEO plan", "Landing pages"], opportunityName: "Local growth", completedTasks: 4, totalTasks: 12 });
    expect(proposal.executiveSummary).toContain("Acme");
    expect(proposal.scope).toEqual(["SEO plan", "Landing pages"]);
    expect(proposal.investment.setupFee).toBe("TBD");
  });

  it("applies the selected Agency proposal type, findings, services, and complete commercial sections", () => {
    const proposal = agencyProposalContent({ projectName: "Acme Local", clientName: "Acme", primaryGoal: "Increase local enquiries", templateId: "local_seo", selectedFindings: ["The current profile evidence is incomplete."], selectedServices: ["GBP readiness review"], completedTasks: 1, totalTasks: 3 });
    expect(proposal.templateId).toBe("local_seo");
    expect(proposal.title).toContain("Local SEO Proposal");
    expect(proposal.findings).toEqual(["The current profile evidence is incomplete."]);
    expect(proposal.scope).toEqual(["GBP readiness review"]);
    expect(proposal).toMatchObject({ roadmap: expect.any(Array), addOns: [], expectedOutcomes: expect.any(Array), exclusions: expect.any(Array), terms: expect.any(Array) });
  });
});
