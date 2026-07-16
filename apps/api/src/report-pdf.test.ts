import { describe, expect, it } from "vitest";
import { createProfessionalReportPdf } from "./report-pdf.js";

describe("professional project report PDF", () => {
  it.each(["agency", "business", "ecommerce", "personal"])("generates a valid %s workspace PDF", async (workspaceType) => {
    const pdf = await createProfessionalReportPdf({
      title: "Executive Summary Report", reportType: "executive_summary", generatedAt: "2026-07-14T12:00:00.000Z",
      project: { name: "Acme Growth", website: "acme.test", primaryGoal: "Generate leads", targetMarkets: ["Toronto"] },
      health: { workflowStep: "strategy", strategyStatus: "approved", completedTasks: 8, totalTasks: 12, blockedTasks: 1 },
      seo: { approvedKeywordGroups: 2, approvedKeywords: 18 }, performance: {},
      execution: { completed: [{ title: "Technical audit" }], published: ["Landing page"], awaitingApproval: [], blocked: [], scheduledNext: [{ title: "Local pages" }] },
      recommendations: ["Continue the approved execution plan."],
    }, { workspaceName: "Acme Workspace", workspaceType, clientName: "Acme Client" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(4500);
  });

  it("creates a designed multi-page Strategy report without footer-generated blank pages", async () => {
    const pdf = await createProfessionalReportPdf({
      title: "Complete Strategy Report", reportType: "strategy", generatedAt: "2026-07-15T12:00:00.000Z",
      project: { name: "Acme Growth", website: "acme.test", primaryGoal: "Generate leads", targetMarkets: ["Toronto", "Mississauga"] },
      health: { workflowStep: "strategy", strategyStatus: "approved", completedTasks: 8, totalTasks: 12, blockedTasks: 1 },
      seo: { approvedKeywordGroups: 2, approvedKeywords: 18 }, performance: {},
      execution: { completed: [{ title: "Technical audit" }], published: [], awaitingApproval: ["Landing page"], blocked: [], scheduledNext: [{ title: "Local pages" }] },
      strategy: { version: 2, status: "approved", score: 84, scoreBreakdown: { profileDemandFit: 82, seoPotential: 87, revenuePotential: 80, executionComplexity: 22, confidence: 85 }, summary: "Build qualified search demand into useful pages and measurable conversion paths.", businessObjectives: ["Generate leads", "Increase organic traffic"], positioning: "A focused growth partner for local service businesses.", seo: "Map approved search intent to pages and close technical gaps.", localSeo: "Build market-specific visibility without confusing Business Location and target markets.", content: "Create useful service, comparison and supporting content.", competitors: "Benchmark topic coverage, proof and calls to action.", competitiveInsights: [{ competitor: "Example Competitor" }], authority: "Build citations, partnerships and credible references.", growthRecommendations: ["Prioritize conversion-ready pages", "Measure qualified enquiries"], social: "Repurpose approved content.", publishing: "Publish only after approval.", kpis: ["Qualified leads", "Organic visibility"], revisionInstructions: "Strengthen Local SEO and conversion measurement." },
      evidence: { selectedOpportunity: "Local growth", opportunityScore: 81, businessLocation: "Toronto, Ontario, Canada", targetMarkets: ["Toronto", "Mississauga"], approvedKeywordGroups: [{ title: "Primary Keywords" }, { title: "Buyer Intent" }], siteAnalysis: { score: 83, pagesCrawled: 20, issuesFound: 135, completedAt: "2026-07-15" } },
      recommendations: ["Continue the approved execution plan."],
    }, { workspaceName: "Acme Agency", workspaceType: "agency", clientName: "Acme Client" });
    const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(7);
    expect(pageCount).toBeLessThanOrEqual(9);
    expect(pdf.length).toBeGreaterThan(12000);
  });

  it("creates a branded client proposal with scope, investment and approval pages", async () => {
    const pdf = await createProfessionalReportPdf({
      title: "Agency Proposal", reportType: "agency_proposal", generatedAt: "2026-07-16T12:00:00.000Z",
      project: { name: "Acme Growth", businessName: "Acme", website: "acme.test", primaryGoal: "Generate leads", targetMarkets: ["Toronto"] },
      health: { workflowStep: "strategy", strategyStatus: "approved", completedTasks: 4, totalTasks: 12, blockedTasks: 0 }, seo: {}, performance: {}, execution: {},
      proposal: { title: "Acme Growth Proposal", executiveSummary: "A focused search and conversion engagement based on the approved client evidence.", objectives: ["Generate qualified leads"], opportunity: "Build local buyer-intent coverage.", scope: ["SEO strategy", "Landing pages", "Reporting"], deliverables: ["Approved Strategy", "Execution Plan", "Monthly report"], timeline: "90 days", investment: { currency: "CAD", setupFee: "$2,500", monthlyFee: "$1,500", lineItems: [{ label: "Strategy and setup", amount: "$2,500" }] }, assumptions: ["Client access is provided before implementation."], nextSteps: ["Review scope", "Approve proposal", "Begin onboarding"], evidenceSummary: { completedTasks: 4, totalTasks: 12, targetMarkets: ["Toronto"] } },
    }, { workspaceName: "North Star Agency", workspaceType: "agency", clientName: "Acme", preparedByName: "Manish", contactEmail: "hello@example.com", primaryColor: "#2563EB", footerDisclaimer: "Confidential client proposal" });
    const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(5);
    expect(pageCount).toBeLessThanOrEqual(6);
    expect(pdf.length).toBeGreaterThan(9000);
  });
});
