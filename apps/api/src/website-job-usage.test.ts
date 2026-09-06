import { describe, expect, it } from "vitest";
import { websiteJobIsIncludedRevision } from "./website-job-usage.js";

describe("website job billing policy", () => {
  it("includes content and image regeneration without another Capacity charge", () => {
    expect(websiteJobIsIncludedRevision({ mode: "content_generation", regenerate: true })).toBe(true);
    expect(websiteJobIsIncludedRevision({ mode: "image_generation", regenerate: true })).toBe(true);
    expect(websiteJobIsIncludedRevision({ mode: "website_generation", regenerateImages: true })).toBe(true);
  });

  it("keeps first-time content and image generation chargeable", () => {
    expect(websiteJobIsIncludedRevision({ mode: "content_generation", regenerate: false })).toBe(false);
    expect(websiteJobIsIncludedRevision({ mode: "image_generation" })).toBe(false);
    expect(websiteJobIsIncludedRevision({ mode: "website_generation", generateImages: true })).toBe(false);
  });
});
