import { describe, expect, it } from "vitest";
import { agencyProposalContent } from "./agency-documents.js";

describe("DEV-015 agency proposals", () => {
  it("builds editable client scope and pricing placeholders from project evidence", () => {
    const proposal = agencyProposalContent({ projectName: "Acme SEO", clientName: "Acme", primaryGoal: "Generate More Leads", targetMarkets: ["Toronto"], timeline: "90 days", outputs: ["SEO plan", "Landing pages"], opportunityName: "Local growth", completedTasks: 4, totalTasks: 12 });
    expect(proposal.executiveSummary).toContain("Acme");
    expect(proposal.scope).toEqual(["SEO plan", "Landing pages"]);
    expect(proposal.investment.setupFee).toBe("TBD");
  });
});
