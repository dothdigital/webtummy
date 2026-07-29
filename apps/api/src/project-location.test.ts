import { describe, expect, it } from "vitest";
import { cleanGeographicTargetMarkets, cleanTargetMarkets, explicitlyTargetsGeographicMarket, formatBusinessLocation, isPlausibleGeographicTargetMarket, locationIsComplete } from "./project-location.js";

describe("DEV-004 business location and target markets", () => {
  it("stores one structured business location", () => {
    const location = { country: "Canada", stateProvince: "Ontario", city: "Toronto", streetAddress: "1 King St", postalCode: "M5H 1A1" };
    expect(locationIsComplete(location)).toBe(true);
    expect(formatBusinessLocation(location)).toBe("1 King St, Toronto, Ontario, M5H 1A1, Canada");
  });

  it("allows multiple markets and removes case-insensitive duplicates", () => {
    expect(cleanTargetMarkets(["Canada", " Toronto ", "canada", "Ontario", "TORONTO"])).toEqual(["Canada", "Toronto", "Ontario"]);
  });

  it("requires country, state/province and city", () => {
    expect(locationIsComplete({ country: "Canada", city: "Toronto" })).toBe(false);
  });

  it("keeps geographic markets separate from audiences and keywords", () => {
    expect(cleanGeographicTargetMarkets([
      "Dehradun",
      "Uttarakhand",
      "India",
      "Greater Toronto Area",
      "Tech startups",
      "Enterprises looking for AI integration",
      "AI solutions Toronto",
    ])).toEqual(["Dehradun", "Uttarakhand", "India", "Greater Toronto Area"]);
    expect(isPlausibleGeographicTargetMarket("Mississauga")).toBe(true);
    expect(isPlausibleGeographicTargetMarket("Businesses seeking insurance")).toBe(false);
  });

  it("does not treat a business base or audience phrase as a confirmed target market", () => {
    expect(explicitlyTargetsGeographicMarket("We are based in India and target businesses building AI products.", "India")).toBe(false);
    expect(explicitlyTargetsGeographicMarket("We target customers in India and serve Dehradun.", "India")).toBe(true);
    expect(explicitlyTargetsGeographicMarket("We target customers in India and serve Dehradun.", "Dehradun")).toBe(true);
  });
});
