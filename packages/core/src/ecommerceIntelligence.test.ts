import { describe, expect, it } from "vitest";
import { buildEcommerceIntelligence } from "./ecommerceIntelligence.js";

describe("public ecommerce intelligence", () => {
  it("classifies public products and collections without inventing private performance", () => {
    const result = buildEcommerceIntelligence({
      platformHint: "Shopify",
      pages: [
        { id: "p1", url: "https://store.test/products/trail-pack", statusCode: 200, title: "Trail Pack", metaDescription: "A trail pack.", h1: ["Trail Pack"], wordCount: 90, inlinkCount: 0, outlinkCount: 3, canonicalUrl: "https://store.test/products/trail-pack", schemaTypes: ["Product", "Offer"], imageCount: 3, missingAltCount: 1, issueCount: 2 },
        { id: "c1", url: "https://store.test/collections/backpacks", statusCode: 200, title: "Backpacks", metaDescription: null, h1: ["Backpacks"], wordCount: 80, inlinkCount: 4, outlinkCount: 8, canonicalUrl: "https://store.test/collections/backpacks", schemaTypes: ["CollectionPage", "ItemList"], imageCount: 4, missingAltCount: 0, issueCount: 1 },
      ],
      keywords: [{ keyword: "best trail pack under $150", averageVolume: 320, location: "Canada" }],
    });

    expect(result.store).toMatchObject({ platform: "Shopify", productCount: 1, collectionCount: 1 });
    expect(result.recommendations.some((item) => item.category === "product_seo")).toBe(true);
    expect(result.recommendations.some((item) => item.title.includes("recorded search demand"))).toBe(true);
    expect(result.recommendations.some((item) => item.category === "content")).toBe(true);
    expect(result.recommendations.some((item) => item.title.includes("conversion experiment"))).toBe(true);
    expect(result.evidenceCoverage.find((item) => item.key === "commercial_performance")?.status).toBe("unavailable");
    expect(result.limitations.join(" ")).toContain("cannot determine margins");
  });

  it("labels uploaded performance as user provided", () => {
    const result = buildEcommerceIntelligence({
      pages: [{ id: "p1", url: "https://store.test/product/one", title: "Product One", metaDescription: "Product one", h1: ["Product One"], wordCount: 250, inlinkCount: 2, outlinkCount: 2, schemaTypes: ["Product"], imageCount: 1, missingAltCount: 0, issueCount: 0 }],
      performance: [{ productName: "Product One", revenue: 1200, source: "user_provided" }],
    });
    expect(result.evidenceCoverage.find((item) => item.key === "commercial_performance")?.status).toBe("user_provided");
    const supplied = result.recommendations.find((item) => item.title.includes("supplied product performance"));
    expect(supplied?.evidenceType).toBe("user_provided");
    expect(supplied?.evidence.join(" ")).toContain("revenue 1200");
  });

  it("creates a seasonal recommendation only from recorded keyword evidence", () => {
    const withSeason = buildEcommerceIntelligence({ pages: [], keywords: [{ keyword: "black friday hiking gifts", averageVolume: 500 }] });
    const withoutSeason = buildEcommerceIntelligence({ pages: [], keywords: [{ keyword: "hiking gifts", averageVolume: 500 }] });
    expect(withSeason.recommendations.some((item) => item.title.includes("seasonal"))).toBe(true);
    expect(withoutSeason.recommendations.some((item) => item.title.includes("seasonal"))).toBe(false);
  });
});
