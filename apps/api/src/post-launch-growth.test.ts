import { describe, expect, it } from "vitest";
import { postLaunchBaselineStatus, selectPostLaunchNextBestAction } from "./post-launch-growth.js";

const ready = {
  launchVerified: true,
  trackingVerified: true,
  trackingState: "COLLECTING_INITIAL_DATA",
  indexingIssueCount: 0,
  sitemapVerified: true,
  searchConsoleConnected: true,
  formErrors: 0,
  formSuccesses: 0,
};

describe("post-launch website growth lifecycle", () => {
  it("prioritizes launch and tracking integrity before growth work", () => {
    expect(selectPostLaunchNextBestAction({ ...ready, launchVerified: false }).key).toBe("fix-launch-verification");
    expect(selectPostLaunchNextBestAction({ ...ready, trackingVerified: false }).key).toBe("verify-live-tracking");
    expect(selectPostLaunchNextBestAction({ ...ready, indexingIssueCount: 2 }).key).toBe("resolve-indexing-crawl-issues");
    expect(selectPostLaunchNextBestAction({ ...ready, searchConsoleConnected: false }).key).toBe("submit-sitemap-search-console");
    expect(selectPostLaunchNextBestAction({ ...ready, formErrors: 2, formSuccesses: 1 }).key).toBe("fix-live-form-conversion");
  });

  it("uses dependency-ready work instead of waiting for the baseline", () => {
    expect(selectPostLaunchNextBestAction({ ...ready, contentTaskTitle: "Publish the Ontario buyer guide" })).toMatchObject({ key: "publish-priority-content", title: "Publish the Ontario buyer guide" });
    expect(selectPostLaunchNextBestAction({ ...ready, primaryKeyword: "Super Visa insurance" }).key).toBe("publish-first-supporting-article");
  });

  it("requires 28 complete verified days before allowing performance claims", () => {
    const now = new Date("2026-08-29T12:00:00.000Z");
    const collecting = postLaunchBaselineStatus({ publishedAt: "2026-08-01T12:00:00.000Z", trackingVerifiedAt: "2026-08-02T12:00:00.000Z", now });
    expect(collecting).toMatchObject({ state: "collecting_initial_baseline", completeVerifiedDays: 27, remainingDays: 1, performanceClaimsAllowed: false });
    const established = postLaunchBaselineStatus({ publishedAt: "2026-08-01T12:00:00.000Z", trackingVerifiedAt: "2026-08-01T12:00:00.000Z", now });
    expect(established).toMatchObject({ state: "baseline_established", completeVerifiedDays: 28, remainingDays: 0, performanceClaimsAllowed: true });
    const lowTraffic = postLaunchBaselineStatus({ publishedAt: "2026-08-01T12:00:00.000Z", trackingVerifiedAt: "2026-08-01T12:00:00.000Z", observedSessions: 7, now });
    expect(lowTraffic).toMatchObject({ state: "collecting_extended_baseline", lowTrafficExtension: true, performanceClaimsAllowed: false });
  });
});
