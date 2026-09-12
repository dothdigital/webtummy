import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WebsiteCompletionSummary from "./WebsiteCompletionSummary.js";

describe("shared website completion screen", () => {
  it.each(["published", "handoff"] as const)("provides the same actions for %s", (mode) => {
    const html = renderToStaticMarkup(createElement(WebsiteCompletionSummary, { projectId: "client-project", businessName: "Client website", releaseId: "release-123456", mode, websiteUrl: "https://example.test", onManage: () => {}, onHistory: () => {} }));
    expect(html).toContain('/projects/client-project/website/performance');
    expect(html).toContain("Continue to Performance");
    expect(html).toContain("Manage Website");
    expect(html).toContain("History");
    expect(html).toContain("View Website");
    expect(html).toContain(mode === "published" ? "Published" : "Handed off");
    if (mode === "handoff") {
      expect(html).toContain("Delivery is recorded separately from live deployment");
      expect(html).not.toContain("release has been published");
    }
  });
});


it("explains the next action for a manual update handoff", () => {
  const html = renderToStaticMarkup(createElement(WebsiteCompletionSummary, { projectId: "client-project", businessName: "Client website", releaseId: "release-123456", mode: "handoff", existingWebsiteUpdates: true, onManage: () => {}, onHistory: () => {} }));
  expect(html).toContain("Next: ask your developer to apply the approved updates");
  expect(html).toContain("still needs to put the changes on the live website");
  expect(html).toContain("performance?view=senuke");
  expect(html).toContain("performance?view=google");
  expect(html).toContain("page update brief");
});
