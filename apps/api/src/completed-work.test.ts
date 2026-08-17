import { describe, expect, it } from "vitest";
import { isCompletedWebsiteLaunchFoundationAction } from "./completed-work.js";

describe("completed website work", () => {
  const completed = { websiteLaunched: true, websitePlanApproved: true };

  it("recognizes a duplicate canonical website foundation action after launch", () => {
    expect(isCompletedWebsiteLaunchFoundationAction({
      title: "Build the focused canonical website foundation",
      recommendation: "Approve the launch sitemap and one canonical owner per approved intent.",
      route: "website",
    }, completed)).toBe(true);
  });

  it("keeps valid post-launch website improvements eligible", () => {
    expect(isCompletedWebsiteLaunchFoundationAction({
      title: "Improve conversion proof on the life insurance page",
      recommendation: "Add approved proof and measure qualified enquiries.",
      route: "website",
    }, completed)).toBe(false);
  });

  it("does not suppress foundation work before both prerequisites are complete", () => {
    expect(isCompletedWebsiteLaunchFoundationAction({
      title: "Build the focused canonical website foundation",
      route: "website",
    }, { websiteLaunched: true, websitePlanApproved: false })).toBe(false);
  });
});
