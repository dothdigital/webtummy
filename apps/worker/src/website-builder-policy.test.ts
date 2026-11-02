import { describe, expect, it } from "vitest";
import { websiteJobShouldPlanVisuals, websiteJobFailureState } from "./website-builder-policy.js";

describe("website builder visual generation policy", () => {
  it("leaves visuals to Design & Images during content preparation", () => {
    expect(websiteJobShouldPlanVisuals("content_generation")).toBe(false);
  });

  it("reuses saved visuals without AI planning when refreshing a website", () => {
    expect(websiteJobShouldPlanVisuals("website_generation", false)).toBe(false);
    expect(websiteJobShouldPlanVisuals("image_generation", true)).toBe(true);
  });

  it("keeps visual planning enabled for image and website generation", () => {
    expect(websiteJobShouldPlanVisuals("image_generation")).toBe(true);
    expect(websiteJobShouldPlanVisuals("website_generation")).toBe(true);
    expect(websiteJobShouldPlanVisuals("website_development")).toBe(true);
  });
});

 describe("website job automatic retry state", () => {
  it("keeps the job active and its reservation unsettled while another attempt remains", () => {
    expect(websiteJobFailureState(1, 2, "provider error", new Date())).toEqual({ status: "queued", stage: "retrying_automatically", errorMessage: null, completedAt: null });
  });
  it("records a final failure only when automatic attempts are exhausted", () => {
    const now = new Date();
    expect(websiteJobFailureState(2, 2, "provider error", now)).toEqual({ status: "failed", stage: "failed", errorMessage: "provider error", completedAt: now });
  });
  it("handles jobs with no automatic retry", () => {
    expect(websiteJobFailureState(1, 1, "provider error", new Date()).status).toBe("failed");
  });
});
