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
    expect(pdf.length).toBeGreaterThan(5000);
  });
});
