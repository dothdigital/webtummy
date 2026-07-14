import { describe, expect, it } from "vitest";
import { agencyPrimaryGoal, goalContext, normalizeProjectGoals, primaryGoalsForWorkspace, standardSecondaryGoals } from "./dev005.js";
import { buildCampaignExecutionTasks } from "./campaign-intelligence.js";

describe("DEV-005 primary and secondary goals", () => {
  it.each(["personal", "business", "ecommerce"])("uses business goals in %s", (workspaceType) => {
    expect(primaryGoalsForWorkspace(workspaceType)).not.toContain(agencyPrimaryGoal);
    expect(normalizeProjectGoals("Generate More Leads", ["Build Backlinks", "build backlinks"], workspaceType)).toEqual({ primaryGoal: "Generate More Leads", secondaryGoals: ["Build Backlinks"] });
  });
  it("allows the Proposal/Audit primary goal only for Agency", () => {
    expect(normalizeProjectGoals(agencyPrimaryGoal, [], "agency").primaryGoal).toBe(agencyPrimaryGoal);
    expect(() => normalizeProjectGoals(agencyPrimaryGoal, [], "business")).toThrow(/supported Primary Goal/);
  });
  it("requires exactly one supported primary goal and fixed secondary goals", () => {
    expect(() => normalizeProjectGoals("", [], "agency")).toThrow(/Exactly one/);
    expect(() => normalizeProjectGoals("Generate More Leads", ["Unknown"], "agency")).toThrow(/supported Secondary/);
    expect(standardSecondaryGoals).toHaveLength(8);
  });
  it("provides primary and secondary goals to downstream AI context", () => {
    expect(goalContext("Improve SEO Rankings", ["Improve AI Visibility", "Build Backlinks"])).toEqual({ primaryGoal: "Improve SEO Rankings", secondaryGoals: ["Improve AI Visibility", "Build Backlinks"], summary: "Improve SEO Rankings; Improve AI Visibility; Build Backlinks" });
  });
  it("uses secondary goals to prioritize execution and reporting context", () => {
    const tasks = buildCampaignExecutionTasks({ projectType: "existing_website", primaryGoal: "Improve SEO Rankings", secondaryGoals: ["Build Backlinks", "Improve AI Visibility"], targetLocations: ["Canada"] });
    expect(tasks.find((task) => task.moduleName === "backlinks")?.priority).toBe("high");
    expect(tasks.find((task) => task.moduleName === "ai_citations")?.priority).toBe("high");
    expect(tasks.find((task) => task.moduleName === "reports")?.description).toContain("Build Backlinks");
  });
});
