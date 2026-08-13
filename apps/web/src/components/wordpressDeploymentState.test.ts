import { describe, expect, it } from "vitest";
import {
  showWordPressConnection,
  websiteApprovalComplete,
  wordpressDeploymentBlocker,
} from "./wordpressDeploymentState.js";

describe("WordPress deployment controls", () => {
  it("shows the connection flow when an Own Hosting project has no WordPress integration", () => {
    expect(showWordPressConnection(false)).toBe(true);
    expect(wordpressDeploymentBlocker({
      mode: "draft",
      launchReady: true,
      connected: false,
      draftReady: false,
    })).toBe("connection_required");
  });

  it("allows draft creation after launch readiness and connection", () => {
    expect(wordpressDeploymentBlocker({
      mode: "draft",
      launchReady: true,
      connected: true,
      draftReady: false,
    })).toBeNull();
  });

  it("requires reviewed drafts before live publishing", () => {
    expect(wordpressDeploymentBlocker({
      mode: "publish",
      launchReady: true,
      connected: true,
      draftReady: false,
    })).toBe("draft_review_required");
    expect(wordpressDeploymentBlocker({
      mode: "publish",
      launchReady: true,
      connected: true,
      draftReady: true,
    })).toBeNull();
  });

  it("keeps Approval complete from its immutable release after deployment state changes", () => {
    expect(websiteApprovalComplete({ id: "release-1", status: "approved" })).toBe(true);
    expect(websiteApprovalComplete(null)).toBe(false);
  });
});
