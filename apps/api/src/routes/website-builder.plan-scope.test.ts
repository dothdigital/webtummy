import { describe, expect, it } from "vitest";
import { approvedWebsiteBuildPages } from "./website-builder.js";

describe("approved website improvement scope", () => {
  it("keeps ten approved pages when the live crawl still has all twenty-four", () => {
    const crawl = Array.from({ length: 24 }, (_, index) => ({
      targetUrl: index ? `/page-${index}` : "/",
      pageName: `Live page ${index}`,
      source: "existing_crawl",
      crawlPageId: `crawl-${index}`,
      liveUrl: `https://example.com/${index ? `page-${index}` : ""}`,
    }));
    const approved = crawl.slice(0, 10).map((page) => ({
      targetUrl: page.liveUrl,
      pageName: "Approved title",
      canonicalKeyword: "Approved keyword",
      contentBrief: "Approved improvements",
      recommendedAction: "update_existing",
    }));
    const result = approvedWebsiteBuildPages(approved, crawl);
    expect(result).toHaveLength(10);
    expect(result.map((page) => page.targetUrl)).toEqual(approved.map((page) => page.targetUrl));
    expect(result[1]).toMatchObject({ ...approved[1], source: "existing_crawl", crawlPageId: "crawl-1" });
  });

  it("retains approved new pages without adding unrelated crawl pages", () => {
    const page = { targetUrl: "/new-service", source: "suggested", recommendedAction: "create_new" };
    expect(approvedWebsiteBuildPages([page], [{ targetUrl: "/old-service", source: "existing_crawl" }])).toEqual([page]);
    expect(approvedWebsiteBuildPages([], [{ targetUrl: "/old-service" }])).toEqual([]);
  });

  it("requires exact live URL evidence before updating an existing page", () => {
    const result = approvedWebsiteBuildPages([
      { targetUrl: "/service", pageName: "Service", source: "existing_crawl", recommendedAction: "update_existing", liveUrl: "https://example.com/service" },
    ], [{ targetUrl: "/other-service", pageName: "Service", source: "existing_crawl" }]);
    expect(result[0]).toMatchObject({ targetUrl: "/service", source: "suggested", recommendedAction: "create_new", liveUrl: null });
  });
});
