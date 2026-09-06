import { describe, expect, it } from "vitest";
import { projectReadinessComplete } from "./project-readiness.js";

describe("project readiness reconciliation", () => {
  it("completes readiness when all required project details exist", () => {
    expect(projectReadinessComplete({ intakeComplete: true, requiredDetailsComplete: true, downstreamEvidenceComplete: false })).toBe(true);
  });

  it("keeps AI-created workflows monotonic after downstream evidence is completed", () => {
    expect(projectReadinessComplete({ intakeComplete: true, requiredDetailsComplete: false, downstreamEvidenceComplete: true })).toBe(true);
  });

  it("does not bypass an incomplete intake", () => {
    expect(projectReadinessComplete({ intakeComplete: false, requiredDetailsComplete: true, downstreamEvidenceComplete: true })).toBe(false);
  });
});
