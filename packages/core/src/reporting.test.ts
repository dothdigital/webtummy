import { describe, expect, it } from "vitest";
import { agencyProposalTemplates, clientReportTypes, notificationEventCatalog, projectReportCatalog, projectReportTypes } from "./reporting.js";

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

  it("defines exactly the five approved client reports plus the separate proposal workflow", () => {
    expect(clientReportTypes).toEqual(["monthly_growth", "seo_website", "local_visibility", "leads_conversion", "campaign_project"]);
    expect(projectReportTypes).toEqual([...clientReportTypes, "agency_proposal"]);
  });
});
