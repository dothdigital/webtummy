import { describe, expect, it } from "vitest";
import { workspaceExperience } from "./workspace-experience.js";

describe("workspaceExperience", () => {
  it("keeps Personal/Entrepreneur single-user and project focused", () => {
    const experience = workspaceExperience("personal");
    expect(experience.workspaceLabel).toBe("Entrepreneur Workspace");
    expect(experience.canInviteTeam).toBe(false);
    expect(experience.canManageClients).toBe(false);
    expect(experience.canCreateProposals).toBe(false);
    expect(experience.reportsTitle).toBe("Project Reports");
  });

  it("gives Business team access without agency client features", () => {
    const experience = workspaceExperience("business");
    expect(experience.canInviteTeam).toBe(true);
    expect(experience.canManageClients).toBe(false);
    expect(experience.canCreateProposals).toBe(false);
    expect(experience.reportsTitle).toBe("Business Project Reports");
  });

  it("reserves clients, proposals, and white-label reports for Agency", () => {
    const experience = workspaceExperience("agency");
    expect(experience.canInviteTeam).toBe(true);
    expect(experience.canManageClients).toBe(true);
    expect(experience.canCreateProposals).toBe(true);
    expect(experience.reportsTitle).toMatch(/White-label/);
  });
});
