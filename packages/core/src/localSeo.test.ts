import { describe, expect, it } from "vitest";
import { matchLocalBusinessEntity, scoreLocalSeo } from "./localSeo.js";

const business = {
  businessName: "Example Dental LLC",
  domain: "exampledental.com",
  phone: "+1 (555) 123-4567",
  address: "100 Main Street",
  city: "Austin",
  region: "TX",
  country: "United States",
  postalCode: "78701",
  mainCategory: "Dentist",
};

describe("Local SEO entity matching", () => {
  it("confirms a business from domain, phone, address, name, and category signals", () => {
    const result = matchLocalBusinessEntity(business, {
      name: "Example Dental",
      website: "https://www.exampledental.com/services",
      phone: "5551234567",
      address: "100 Main St, Austin, TX 78701",
      category: "Dental clinic",
    });

    expect(result.confidence).toBeGreaterThanOrEqual(90);
    expect(result.status).toBe("confirmed_match");
    expect(result.signals).toContain("Website/domain match");
    expect(result.signals).toContain("Phone match");
  });

  it("does not confirm an unrelated listing only because it has a place ID", () => {
    const result = matchLocalBusinessEntity({ ...business, googleBusinessProfileUrl: "https://share.google/example" }, {
      name: "Different Studio",
      website: "https://different.example",
      phone: "5559990000",
      address: "500 Other Road, Austin, TX 78701",
      category: "Marketing agency",
      placeId: "ChIJ-unrelated-place",
    });

    expect(result.status).toBe("no_reliable_match");
    expect(result.confidence).toBeLessThan(40);
  });
});

describe("Local SEO scoring", () => {
  it("continues scoring local visibility when the domain is not found organically", () => {
    const result = scoreLocalSeo({
      organicPosition: null,
      mapsPosition: 6,
      localPackPosition: null,
      matchConfidence: 86,
      listingComplete: true,
      averageRating: 4.6,
      reviewCount: 42,
      competitorMedianReviewCount: 50,
      recentReviewCount: 2,
      citationGroups: { google: true, bing: true, apple: false, facebook: true, directories: 2, noDuplicates: true },
      websiteBasics: { titleMetaLocal: true, h1ContentLocal: true, napVisible: true, localSchema: false, technicalPass: true },
      contentCoverage: { servicePage: true, cityPage: true, articleCoverage: false, competitorDepth: false },
    });

    expect(result.organicScore).toBe(0);
    expect(result.mapsScore).toBeGreaterThan(0);
    expect(result.reviewScore).toBeGreaterThan(0);
    expect(result.totalScore).toBeGreaterThan(0);
  });
});
