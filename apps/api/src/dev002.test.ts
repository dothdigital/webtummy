import { describe, expect, it } from "vitest";
import { agencyNextActions, clientDefaults, clientViewerRouteAllowed } from "./dev002.js";

describe("DEV-002 Agency → Clients → Projects", () => {
  it("reuses client-wide website, location, market, and niche defaults", () => {
    expect(clientDefaults({
      websites: ["https://example.com", "https://shop.example.com"],
      businessLocations: ["Toronto, Canada"],
      targetMarkets: ["Toronto", "Ontario"],
      defaultSettings: { niche: "Roofing" },
    })).toEqual({
      websiteUrl: "https://example.com",
      businessLocation: "Toronto, Canada",
      targetLocations: ["Toronto", "Ontario"],
      niche: "Roofing",
    });
  });

  it("returns safe empty defaults for incomplete client records", () => {
    expect(clientDefaults({ websites: null, businessLocations: {}, targetMarkets: null, defaultSettings: null })).toEqual({
      websiteUrl: "", businessLocation: "", targetLocations: [], niche: "",
    });
  });

  it("prioritizes creating a client before an agency project", () => {
    expect(agencyNextActions({ clients: 0, activeProjects: 0, pendingApprovals: 0, reportsReady: 0 })[0]?.key).toBe("create_client");
  });

  it("surfaces approvals and intentionally sendable reports", () => {
    const keys = agencyNextActions({ clients: 2, activeProjects: 4, pendingApprovals: 3, reportsReady: 1 }).map((item) => item.key);
    expect(keys).toEqual(["review_approvals", "send_reports"]);
  });

  it("limits Client Viewer API access to report dashboards", () => {
    expect(clientViewerRouteAllowed("GET", "/api/workspace")).toBe(true);
    expect(clientViewerRouteAllowed("GET", "/api/agency/clients/client-1/dashboard")).toBe(true);
    expect(clientViewerRouteAllowed("POST", "/api/agency/tasks/task-1/decision")).toBe(false);
    expect(clientViewerRouteAllowed("GET", "/api/projects-v2")).toBe(false);
  });
});
