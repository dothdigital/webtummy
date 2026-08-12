import { describe, expect, it } from "vitest";
import { agencyProposalTemplates, notificationEventCatalog, projectReportCatalog, projectReportTypes } from "./reporting.js";

describe("project reporting catalog", () => {
  it("defines every launch report exactly once", () => {
    expect(projectReportCatalog.map((report) => report.type)).toEqual(projectReportTypes);
    expect(new Set(projectReportCatalog.map((report) => report.type)).size).toBe(projectReportTypes.length);
  });

  it("keeps Agency Client Report client-safe and Ecommerce Report store-only", () => {
    expect(projectReportCatalog.find((report) => report.type === "agency_client")).toMatchObject({ agencyOnly: true, clientSafe: true });
    expect(projectReportCatalog.find((report) => report.type === "ecommerce")).toMatchObject({ ecommerceOnly: true });
    expect(projectReportCatalog.find((report) => report.type === "agency_proposal")).toMatchObject({ agencyOnly: true, clientSafe: true });
  });

  it("never targets Client Viewer with internal activity summaries", () => {
    expect(notificationEventCatalog.activity_summary.roles).not.toContain("client_viewer");
    expect(notificationEventCatalog.report_ready.roles).toContain("client_viewer");
  });

  it("defines all seven V1 Agency proposal templates", () => {
    expect(agencyProposalTemplates.map((template) => template.id)).toEqual(["growth_strategy", "seo_website", "local_growth", "website_build", "content_authority_ai", "growth_campaign", "custom"]);
  });

  it("includes every V1 Agency white-label report family", () => {
    expect(projectReportTypes).toEqual(expect.arrayContaining(["executive_summary", "monthly_growth", "seo_performance", "local_seo", "ai_search_citation", "content_publishing", "growth_marketing_cro", "lead_crm", "social_email", "project_campaign"]));
  });
});
