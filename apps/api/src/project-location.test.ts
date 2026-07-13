import { describe, expect, it } from "vitest";
import { cleanTargetMarkets, formatBusinessLocation, locationIsComplete } from "./project-location.js";

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
});
