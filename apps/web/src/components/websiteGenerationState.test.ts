import { describe, expect, it } from "vitest";
import {
  qualityWaiverDestination,
  reconcileWebsitePageDetail,
  websiteContentActionsAreLocked,
  websiteGenerationJobCoversPage,
  websiteGenerationJobIsActive,
  websitePageContentIsProcessing,
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

  it("shows completed page content as ready for review while the batch continues", () => {
    const jobs = [{
      status: "processing",
      inputJson: { mode: "website_generation" },
      resultJson: {},
    }];

    expect(websitePageContentIsProcessing(jobs, "completed-page", true)).toBe(false);
    expect(websitePageContentIsProcessing(jobs, "queued-page", false)).toBe(true);
  });

  it("uses the current summary approval after a same-version page approval", () => {
    const detail = {
      id: "home",
      version: 3,
      status: "review",
      approvalReadiness: { state: "ready" },
      contentJson: { components: ["full detail payload"] },
    };
    const summary = {
      id: "home",
      version: 3,
      status: "approved",
      approvalReadiness: { state: "approved" },
      contentJson: { components: [] },
    };

    expect(reconcileWebsitePageDetail(summary, detail)).toEqual({
      ...detail,
      status: "approved",
      approvalReadiness: { state: "approved" },
      seoQuality: undefined,
      contentSummary: undefined,
    });
  });

  it("continues to approval after the last quality blocker is cleared", () => {
    expect(qualityWaiverDestination(0)).toBe("review");
    expect(qualityWaiverDestination(2)).toBe("optimization");
    expect(qualityWaiverDestination(undefined)).toBe("optimization");
  });
});
