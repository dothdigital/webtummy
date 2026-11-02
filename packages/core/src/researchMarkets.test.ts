import { describe, expect, it } from "vitest";
import { canadianResearchMarketLabels, buildResearchMarketLabels, researchMarketMatchesLocation } from "./researchMarkets.js";
describe("Canadian research markets", () => {
  it("preserves explicit foreign hierarchies and countries", () => {
    expect(buildResearchMarketLabels(["Canada", "United States", "London, England, United Kingdom", "Toronto, Canada"], "New Brunswick", "Canada")).toEqual(["Canada", "United States", "London, England, United Kingdom", "Toronto, Canada"]);
    expect(buildResearchMarketLabels(["PEI", "Prince Edward Island, Canada", "Moncton"], "New Brunswick", "Canada")).toEqual(["Prince Edward Island, Canada", "Moncton, New Brunswick, Canada"]);
  });
  it("keeps states and regions independent across provider-supported countries", () => {
    expect(buildResearchMarketLabels(["California", "Texas"], "New York", "United States")).toEqual(["California, United States", "Texas, United States"]);
    expect(buildResearchMarketLabels(["Karnataka", "Kerala"], "Maharashtra", "India")).toEqual(["Karnataka, India", "Kerala, India"]);
    expect(buildResearchMarketLabels(["Victoria", "Queensland"], "New South Wales", "Australia")).toEqual(["Victoria, Australia", "Queensland, Australia"]);
  });
  it("canonicalizes aliases with Canadian context", () => {
    expect(canadianResearchMarketLabels("P.E.I.", "Canada")).toEqual(["Prince Edward Island, Canada"]);
    expect(canadianResearchMarketLabels("Newfoundland", "CA")).toEqual(["Newfoundland and Labrador, Canada"]);
    expect(canadianResearchMarketLabels("Québec", "Canada")).toEqual(["Quebec, Canada"]);
  });
  it("does not relabel foreign cities or explicit mismatched hierarchies", () => {
    expect(canadianResearchMarketLabels("Newfoundland", "United States")).toBeNull();
    expect(canadianResearchMarketLabels("PEI, New Brunswick, Canada", "Canada")).toBeNull();
    expect(canadianResearchMarketLabels("Toronto, Ontario, Canada", "Canada")).toBeNull();
  });
  it("expands Atlantic Canada as exactly four independent provinces", () => {
    expect(canadianResearchMarketLabels("Atlantic Canada", "Canada")).toEqual(["Newfoundland and Labrador, Canada", "Prince Edward Island, Canada", "Nova Scotia, Canada", "New Brunswick, Canada"]);
  });
});

describe("keyword named market matching", () => {
  it("accepts every Atlantic province but rejects other markets", () => {
    for (const province of ["Newfoundland and Labrador", "Prince Edward Island", "Nova Scotia", "New Brunswick"]) {
      expect(researchMarketMatchesLocation("Atlantic Canada", `${province}, Canada`)).toBe(true);
    }
    expect(researchMarketMatchesLocation("Atlantic Canada", "Ontario, Canada")).toBe(false);
    expect(researchMarketMatchesLocation("Atlantic Canada", "New Brunswick, United States")).toBe(false);
  });
  it("matches aliases without allowing unrelated markets", () => {
    expect(researchMarketMatchesLocation("PEI", "Prince Edward Island, Canada")).toBe(true);
    expect(researchMarketMatchesLocation("Newfoundland", "Newfoundland and Labrador, Canada")).toBe(true);
    expect(researchMarketMatchesLocation("Toronto", "Brampton, Ontario, Canada")).toBe(false);
    expect(researchMarketMatchesLocation("Toronto", "Toronto, Ontario, Canada")).toBe(true);
  });
});
