import { describe, expect, it } from "vitest";
import { estimatedOpportunityEffort, opportunityConfidence, opportunityDecisionStatus, opportunityInputSummary, opportunityRunMode } from "./dev006.js";

describe("DEV-006 Opportunity Finder", () => {
  it("runs recommendations when direction is unclear and confirmation when clear", () => {
    expect(opportunityRunMode({ projectType: "existing_website", primaryGoal: "Improve SEO Rankings" }).mode).toBe("recommendation");
    expect(opportunityRunMode({ projectType: "existing_website", primaryGoal: "Improve SEO Rankings", niche: "Roofing", businessProfile: { offerSummary: "Roof repair", targetAudience: "Toronto homeowners" } }).mode).toBe("confirmation");
  });
  it("derives simple effort and confidence values for cards", () => {
    expect(estimatedOpportunityEffort(85)).toBe("Low");
    expect(estimatedOpportunityEffort(70)).toBe("Medium");
    expect(opportunityConfidence(80, 90)).toBe(84);
  });
  it("recognizes selected and confirmed directions as valid strategy decisions", () => {
    expect(opportunityDecisionStatus("selected")).toBe(true);
    expect(opportunityDecisionStatus("confirmed")).toBe(true);
    expect(opportunityDecisionStatus("saved")).toBe(false);
  });
  it("captures every required recommendation input without mixing concerns", () => {
    expect(opportunityInputSummary({ projectType: "local_seo", primaryGoal: "Generate More Leads", secondaryGoals: ["Build Backlinks"], competitors: ["a.com"], websiteStatus: "existing_website", businessLocation: "Toronto, Ontario, Canada", targetLocations: ["Toronto", "Mississauga"], businessProfile: { offerSummary: "Roof repair", targetAudience: "Homeowners" } })).toMatchObject({ businessType: "local_seo", productsServices: "Roof repair", audience: "Homeowners", businessLocation: "Toronto, Ontario, Canada", targetMarkets: ["Toronto", "Mississauga"], secondaryGoals: ["Build Backlinks"], competitors: ["a.com"] });
  });
});
