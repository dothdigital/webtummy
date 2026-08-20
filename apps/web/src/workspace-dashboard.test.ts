import { describe, expect, it } from "vitest";
import { customerPlanLabel, personalStartingPaths, projectAllowanceLabel, workspaceDashboardVisibility } from "./workspace-dashboard.js";

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
    expect(workspaceDashboardVisibility("personal")).toMatchObject({ clients: false, agencyReports: false, teamMembers: false });
    expect(workspaceDashboardVisibility("business")).toMatchObject({ clients: false, agencyReports: false, teamMembers: true });
    expect(workspaceDashboardVisibility("agency")).toMatchObject({ clients: true, agencyReports: true, teamMembers: true });
  });

  it("prevents viewer-only dashboards from starting or executing work", () => {
    expect(workspaceDashboardVisibility("agency", true)).toMatchObject({ startProject: false, projectActivity: false, clients: false });
  });
});
