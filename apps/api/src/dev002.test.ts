import { describe, expect, it } from "vitest";
import { agencyNextActions, clientDefaults, clientViewerRouteAllowed } from "./dev002.js";

describe("DEV-002 Agency → Clients → Projects", () => {
  it("reuses the complete client profile as project defaults", () => {
    expect(clientDefaults({
      websites: ["https://example.com", "https://shop.example.com"],
      businessLocations: ["Toronto, Canada"],
      targetMarkets: ["Toronto", "Ontario"],
      defaultSettings: { niche: "Roofing", primaryBusinessGoal: "Leads", brandVoice: "Friendly expert", businessDescription: "Residential roofer", targetAudience: "Toronto homeowners", mainProductsServices: "Roof repair", primaryKeywords: ["roof repair"], preferredLanguage: "English", timeZone: "America/Toronto" },
    })).toEqual({
      websiteUrl: "https://example.com",
      businessLocation: "Toronto, Canada",
      businessLocationDetails: null,
      targetLocations: ["Toronto", "Ontario"],
      niche: "Roofing",
      primaryGoal: "Leads",
      brandVoice: "Friendly expert",
      businessDescription: "Residential roofer",
      targetAudience: "Toronto homeowners",
      mainProductsServices: "Roof repair",
      primaryKeywords: ["roof repair"],
      preferredLanguage: "English",
      timeZone: "America/Toronto",
    });
  });

  it("returns safe empty defaults for incomplete client records", () => {
    expect(clientDefaults({ websites: null, businessLocations: {}, targetMarkets: null, defaultSettings: null })).toEqual({
      websiteUrl: "", businessLocation: "", businessLocationDetails: null, targetLocations: [], niche: "", primaryGoal: "", brandVoice: "", businessDescription: "", targetAudience: "", mainProductsServices: "", primaryKeywords: [], preferredLanguage: "", timeZone: "",
    });
  });

  it("prioritizes creating a client before an agency project", () => {
    expect(agencyNextActions({ clients: 0, activeProjects: 0, pendingApprovals: 0, reportsReady: 0 })[0]?.key).toBe("create_client");
  });

  it("surfaces approvals and intentionally sendable reports", () => {
    const keys = agencyNextActions({ clients: 2, activeProjects: 4, pendingApprovals: 3, reportsReady: 1 }).map((item) => item.key);
    expect(keys).toEqual(["review_approvals", "send_reports"]);
  });

  it("limits Client Viewer API access to shared dashboards and explicit client decisions", () => {
    expect(clientViewerRouteAllowed("GET", "/api/workspace")).toBe(true);
    expect(clientViewerRouteAllowed("GET", "/api/agency/clients/client-1/dashboard")).toBe(true);
    expect(clientViewerRouteAllowed("POST", "/api/agency/tasks/task-1/decision")).toBe(true);
    expect(clientViewerRouteAllowed("GET", "/api/projects-v2")).toBe(false);
  });
});
