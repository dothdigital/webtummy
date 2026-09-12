import { describe, expect, it } from "vitest";
import { agencyProposalTemplates, clientReportTypes, clientSafeReportContent, notificationEventCatalog, projectReportCatalog, projectReportTypes, reportingCapabilitiesForWorkspace, scheduledReportKey } from "./reporting.js";

describe("project reporting catalog", () => {
  it("defines every launch report exactly once", () => {
    expect(projectReportCatalog.map((report) => report.type)).toEqual(projectReportTypes);
    expect(new Set(projectReportCatalog.map((report) => report.type)).size).toBe(projectReportTypes.length);
  });

  it("makes standard project reports available to every plan while proposals remain Agency-only", () => {
    for (const type of clientReportTypes) expect(projectReportCatalog.find((report) => report.type === type)).toMatchObject({ agencyOnly: false, clientSafe: true });
    expect(projectReportCatalog.find((report) => report.type === "agency_proposal")).toMatchObject({ agencyOnly: true, clientSafe: true });
  });

  it("never targets Client Viewer with internal activity summaries", () => {
    expect(notificationEventCatalog.activity_summary.roles).not.toContain("client_viewer");
    expect(notificationEventCatalog.report_ready.roles).toContain("client_viewer");
  });

  it("defines exactly the six approved V1 Agency proposal templates", () => {
    expect(agencyProposalTemplates.map((template) => template.id)).toEqual(["seo_organic", "website_build", "local_seo", "content_authority", "website_seo", "custom"]);
  });

  it("defines the passive weekly summary, five on-demand client reports, and the separate proposal workflow", () => {
    expect(clientReportTypes).toEqual(["weekly_growth", "monthly_growth", "seo_website", "local_visibility", "leads_conversion", "campaign_project"]);
    expect(projectReportTypes).toEqual([...clientReportTypes, "agency_proposal"]);
  });

  it("applies the DEV-065 plan matrix without lowering core intelligence", () => {
    expect(reportingCapabilitiesForWorkspace("personal")).toMatchObject({ coreReports: true, pdfExport: true, secureOwnerSharing: true, clientReports: false, agencyProposal: false });
    expect(reportingCapabilitiesForWorkspace("business")).toMatchObject({ coreReports: true, businessConsolidation: true, teamReporting: true, clientReports: false, agencyBranding: false });
    expect(reportingCapabilitiesForWorkspace("agency")).toMatchObject({ coreReports: true, clientReports: true, clientViewer: true, agencyBranding: true, agencyProposal: true, portfolioReporting: true });
  });

  it("removes internal, cost, margin, capacity, assignment, and secret fields from client-safe output", () => {
    const safe = clientSafeReportContent({ title: "Safe", agencyNotes: "internal", execution: { completed: [{ title: "Done", assignee: "A" }] }, growth: { internalCost: 12, margin: 4 }, clientNarrative: { executiveNarrative: "Verified." }, secretToken: "no" });
    expect(safe).toEqual({ title: "Safe", execution: { completed: [{ title: "Done" }] }, growth: {}, clientNarrative: { executiveNarrative: "Verified." } });
  });

  it("uses a stable project and period key to prevent duplicate scheduled reports", () => {
    expect(scheduledReportKey("project-1", "weekly", new Date("2026-08-17T00:00:00.000Z"))).toBe("dev065:project-1:weekly:2026-08-17");
    expect(scheduledReportKey("project-1", "monthly", new Date("2026-08-01T00:00:00.000Z"))).toBe("dev065:project-1:monthly:2026-08-01");
  });
});
