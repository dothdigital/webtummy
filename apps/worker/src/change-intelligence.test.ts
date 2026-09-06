import { describe, expect, it } from "vitest";
import { canonicalizeChangeUrl, extractChangeItems, isApprovedChangeIntelligenceUrl } from "./change-intelligence.js";

describe("Change Intelligence V1 source controls", () => {
  it("allows official hosts and rejects discovery/news or arbitrary hosts", () => {
    expect(isApprovedChangeIntelligenceUrl("https://developers.google.com/search/blog")).toBe(true);
    expect(isApprovedChangeIntelligenceUrl("https://schema.org/docs/releases.html")).toBe(true);
    expect(isApprovedChangeIntelligenceUrl("https://news.google.com/rss")).toBe(false);
    expect(isApprovedChangeIntelligenceUrl("https://example.com/feed.xml")).toBe(false);
  });

  it("normalizes tracking parameters without merging distinct evidence versions", () => {
    expect(canonicalizeChangeUrl("https://Developers.Google.com/search/blog/update/?utm_source=email#details")).toBe("https://developers.google.com/search/blog/update");
  });

  it("extracts independently hashable RSS items with evidence dates", () => {
    const items = extractChangeItems(`<?xml version="1.0"?><rss><channel><item><title>Search update</title><link>https://developers.google.com/search/blog/update</link><pubDate>Sat, 29 Aug 2026 10:00:00 GMT</pubDate><description><![CDATA[Ranking documentation changed.]]></description></item></channel></rss>`, "https://developers.google.com/search/blog/feed.xml", "application/rss+xml");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Search update", url: "https://developers.google.com/search/blog/update", content: "Ranking documentation changed." });
    expect(items[0].publishedAt?.toISOString()).toBe("2026-08-29T10:00:00.000Z");
  });
});
