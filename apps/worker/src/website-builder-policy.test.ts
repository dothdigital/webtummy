import { describe, expect, it } from "vitest";
import { websiteJobShouldPlanVisuals } from "./website-builder-policy.js";

describe("website builder visual generation policy", () => {
  it("leaves visuals to Design & Images during content preparation", () => {
    expect(websiteJobShouldPlanVisuals("content_generation")).toBe(false);
  });

  it("keeps visual planning enabled for image and website generation", () => {
    expect(websiteJobShouldPlanVisuals("image_generation")).toBe(true);
    expect(websiteJobShouldPlanVisuals("website_generation")).toBe(true);
    expect(websiteJobShouldPlanVisuals("website_development")).toBe(true);
  });
});
