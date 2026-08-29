import { describe, expect, it } from "vitest";
import { businessFirstUseSupportingText, customerPlanLabel, guidedSetupSteps, personalStartingPaths, projectAllowanceLabel, workspaceDashboardVisibility, workspaceDisplayName, workspaceProjectActivityCopy, workspaceProjectAssignmentLabel, workspaceStartingPathEmphasized, workspaceStartingPaths } from "./workspace-dashboard.js";

describe("DEV-056 workspace dashboard rules", () => {
  it("exposes the three approved Personal starting paths", () => {
    expect(personalStartingPaths.map((path) => path.title)).toEqual([
      "I have an existing business",
      "I have an idea to explore",
      "Help me find an opportunity",
    ]);
  });

  it("uses the customer-facing Entrepreneur plan name", () => {
    expect(customerPlanLabel("personal")).toBe("Entrepreneur");
    expect(customerPlanLabel("business")).toBe("Business");
    expect(customerPlanLabel("agency")).toBe("Agency");
  });

  it("never turns missing allowance data into 0 of 0", () => {
    expect(projectAllowanceLabel(0, null)).toBe("No projects yet");
    expect(projectAllowanceLabel(0, 1)).toBe("0 of 1 project");
  });

  it("keeps clients and agency reports out of Personal and Business", () => {
    expect(workspaceDashboardVisibility("personal")).toMatchObject({ clients: false, clientAssignments: false, agencyReports: false, teamMembers: false });
    expect(workspaceDashboardVisibility("business")).toMatchObject({ clients: false, clientAssignments: false, agencyReports: false, teamMembers: true });
    expect(workspaceDashboardVisibility("agency")).toMatchObject({ clients: true, clientAssignments: true, agencyReports: true, teamMembers: true });
  });

  it("uses Business-only first-use emphasis and copy", () => {
    expect(workspaceStartingPathEmphasized("business", "EXISTING_BUSINESS")).toBe(true);
    expect(workspaceStartingPathEmphasized("business", "IDEA_TO_EXPLORE")).toBe(false);
    expect(workspaceStartingPathEmphasized("personal", "EXISTING_BUSINESS")).toBe(false);
    expect(businessFirstUseSupportingText).toContain("right growth path for your business");
    expect(workspaceStartingPaths("business").map((path) => path.key)).toEqual(["EXISTING_BUSINESS"]);
    expect(workspaceStartingPaths("personal")).toEqual(personalStartingPaths);
  });

  it("uses workspace-correct names, project copy, and assignment labels", () => {
    expect(workspaceDisplayName("Business", "business")).toBe("My Business");
    expect(workspaceDisplayName("Acme", "business")).toBe("Acme");
    expect(workspaceDisplayName("Personal", "personal")).toBe("My Workspace");
    expect(workspaceDisplayName("Agency", "agency")).toBe("Agency Portfolio");
    expect(workspaceDisplayName("My Workspace", "agency")).toBe("Agency Portfolio");
    expect(workspaceProjectActivityCopy("business")).toEqual({
      title: "Business project activity",
      detail: "Live totals from your projects' Execution Plans. Select a project to review its status and continue the next action.",
    });
    expect(workspaceProjectActivityCopy("agency").title).toBe("Client and project actions");
    expect(workspaceProjectAssignmentLabel("business", "Growth Plan", "Client shell")).toBe("Growth Plan");
    expect(workspaceProjectAssignmentLabel("agency", "Growth Plan", "Acme")).toBe("Acme · Growth Plan");
  });

  it("prevents viewer-only dashboards from starting or executing work", () => {
    expect(workspaceDashboardVisibility("agency", true)).toMatchObject({ startProject: false, projectActivity: false, clients: false });
  });

  it("derives DEV-073 setup from saved project state and resumes the first incomplete step", () => {
    const project = { id: "p1", status: "active", strategyStatus: "draft", workflowSteps: [{ stepKey: "intake", status: "completed", actionUrl: null }], onboardingReadiness: { intelligenceReady: true, blockersJson: [], moduleStatusJson: [], nextBestActionJson: {} } };
    const steps = guidedSetupSteps({ workspaceType: "business", activeClientCount: 0, approvalMode: "manual", project });
    expect(steps.map((step) => step.state)).toEqual(["complete", "complete", "complete", "in_progress", "in_progress", "not_started"]);
    expect(steps.find((step) => step.key === "governance")?.state).toBe("in_progress");
    expect(guidedSetupSteps({ workspaceType: "business", activeClientCount: 0, project, governanceConfirmed: true }).find((step) => step.key === "governance")?.state).toBe("complete");
    expect(steps.find((step) => step.key === "strategy")?.href).toBe("/strategy?projectId=p1");
  });

  it("blocks an Agency project until a client exists", () => {
    const steps = guidedSetupSteps({ workspaceType: "agency", activeClientCount: 0, project: null });
    expect(steps[0]).toMatchObject({ state: "blocked", href: "/workspace?tab=clients" });
  });
});
