import { describe, expect, it } from "vitest";
import { backlinkProviderCost, parseBacklinkProviderLinks, parseBacklinkProviderSummary } from "./backlinkProvider.js";

describe("backlink provider evidence parsing", () => {
  it("preserves unavailable provider facts as null instead of inventing zero", () => {
    const summary = parseBacklinkProviderSummary("example.com", { tasks: [{ cost: 0.02, result: [{}] }] });
    expect(summary.backlinks).toBeNull();
    expect(summary.referringDomains).toBeNull();
    expect(backlinkProviderCost({ tasks: [{ cost: 0.02 }, { cost: 0.03 }] })).toBe(0.05);
  });

  it("normalizes link evidence without assigning Google metrics", () => {
    const links = parseBacklinkProviderLinks({ tasks: [{ result: [{ items: [{ url_from: "https://source.test/a", domain_from: "source.test", url_to: "https://example.com/page", anchor: "Useful guide", dofollow: true, rank: 71 }] }] }] });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ sourceDomain: "source.test", sourceRank: 71, dofollow: true });
  });
});
