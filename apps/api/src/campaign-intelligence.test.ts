import { describe, expect, it } from "vitest";
import { buildCampaignExecutionTasks, projectTypeForWebsiteSituation } from "./campaign-intelligence.js";

describe("new website campaign intelligence", () => {
  it("does not persist a contradictory existing-website type for a new website", () => {
    expect(projectTypeForWebsiteSituation("existing_website", "new_website_required")).toBe("new_business");
    expect(projectTypeForWebsiteSituation("existing_website", "website_planned")).toBe("new_business");
    expect(projectTypeForWebsiteSituation("ecommerce", "new_website_required")).toBe("ecommerce");
    expect(projectTypeForWebsiteSituation("existing_website", "existing_website")).toBe("existing_website");
  });

  it("creates a build-ready Website Plan task after Strategy for a pre-launch website", () => {
    const tasks = buildCampaignExecutionTasks({
      projectType: "new_business",
      websiteStatus: "new_website_required",
      primaryGoal: "Generate More Leads",
      preferredOutputs: ["Website"],
      targetLocations: ["Toronto, Ontario, Canada"],
    });
    const websitePlan = tasks.find((task) => task.key === "seo-keyword-plan");
    expect(websitePlan?.title).toBe("Website Plan");
    expect(websitePlan?.actionButtonLabel).toBe("Create Website Plan");
    expect(websitePlan?.description).toContain("approved Website and Unified Strategy");
  });
});
