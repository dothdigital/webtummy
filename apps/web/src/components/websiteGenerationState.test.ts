import { describe, expect, it } from "vitest";
import {
  websiteContentActionsAreLocked,
  websiteGenerationJobCoversPage,
  websiteGenerationJobIsActive,
} from "./websiteGenerationState.js";

describe("website page generation UI state", () => {
  it.each(["queued", "processing", "running", "in_progress", "pending", "retrying"])(
    "treats %s as active",
    (status) => {
      expect(websiteGenerationJobIsActive({ status, inputJson: { mode: "content_generation" }, resultJson: {} })).toBe(true);
    },
  );

  it.each(["failed", "blocked", "cancelled", "canceled", "terminated", "completed"])(
    "unlocks recreate actions when a job is %s",
    (status) => {
      expect(websiteContentActionsAreLocked([{ status, inputJson: { mode: "content_generation" }, resultJson: {} }])).toBe(false);
    },
  );

  it("marks only requested unfinished pages as processing", () => {
    const job = {
      status: "processing",
      inputJson: { mode: "content_generation", pageIds: ["page-1", "page-2"] },
      resultJson: { completedPageIds: ["page-1"] },
    };

    expect(websiteGenerationJobCoversPage(job, "page-1")).toBe(false);
    expect(websiteGenerationJobCoversPage(job, "page-2")).toBe(true);
    expect(websiteGenerationJobCoversPage(job, "page-3")).toBe(false);
  });

  it("treats an empty page selection as an all-page generation run", () => {
    expect(websiteGenerationJobCoversPage({
      status: "processing",
      inputJson: { mode: "website_generation" },
      resultJson: {},
    }, "any-page")).toBe(true);
  });
});
