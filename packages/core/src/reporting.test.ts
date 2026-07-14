import { describe, expect, it } from "vitest";
import { notificationEventCatalog, projectReportCatalog, projectReportTypes } from "./reporting.js";

describe("project reporting catalog", () => {
  it("defines every launch report exactly once", () => {
    expect(projectReportCatalog.map((report) => report.type)).toEqual(projectReportTypes);
    expect(new Set(projectReportCatalog.map((report) => report.type)).size).toBe(8);
  });

  it("keeps Agency Client Report client-safe and Ecommerce Report store-only", () => {
    expect(projectReportCatalog.find((report) => report.type === "agency_client")).toMatchObject({ agencyOnly: true, clientSafe: true });
    expect(projectReportCatalog.find((report) => report.type === "ecommerce")).toMatchObject({ ecommerceOnly: true });
  });

  it("never targets Client Viewer with internal activity summaries", () => {
    expect(notificationEventCatalog.activity_summary.roles).not.toContain("client_viewer");
    expect(notificationEventCatalog.report_ready.roles).toContain("client_viewer");
  });
});
