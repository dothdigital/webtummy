import { describe, expect, it } from "vitest";
import { buildLocationNames, buildProjectMarketLocationNames, projectAnalysisLocations } from "./locationOptions";

describe("projectAnalysisLocations", () => {
  it("uses identical province rules in manual research entry", () => {
    expect(buildLocationNames("Newfoundland, PEI, Nova Scotia, New Brunswick, Atlantic Canada", "New Brunswick", "Canada")).toEqual(["Newfoundland and Labrador, Canada", "Prince Edward Island, Canada", "Nova Scotia, Canada", "New Brunswick, Canada"]);
    expect(buildLocationNames("Newfoundland and Labrador", "New Brunswick", "Canada")).toEqual(["Newfoundland and Labrador, Canada"]);
  });
  it("resolves the selected Atlantic provinces independently of a New Brunswick business address", () => {
    const result = projectAnalysisLocations({ targetLocations: ["Newfoundland", "PEI", "Nova scotia", "New Brunswick", "Atlantic Canada"], businessLocationJson: { country: "Canada", stateProvince: "New Brunswick", city: "Moncton" } });
    expect(result.locationNames).toEqual(["Newfoundland and Labrador, Canada", "Prince Edward Island, Canada", "Nova Scotia, Canada", "New Brunswick, Canada"]);
    expect(buildProjectMarketLocationNames(["Newfoundland and Labrador, Canada", "PEI, Canada"], "New Brunswick", "Canada")).toEqual(["Newfoundland and Labrador, Canada", "Prince Edward Island, Canada"]);
    expect(buildProjectMarketLocationNames(["Moncton", "Ontario", "BC"], "New Brunswick", "Canada")).toEqual(["Moncton, New Brunswick, Canada", "Ontario, Canada", "British Columbia, Canada"]);
  });

  it("keeps the browser request matrix aligned with canonical project markets", () => {
    expect(projectAnalysisLocations({
      targetLocations: ["Milton,Milton,Ontario,Canada", "Oakville", "nearby neighbourhoods"],
      businessLocationJson: { city: "Mississauga", stateProvince: "Ontario", country: "Canada" },
    })).toEqual({
      country: "Canada",
      region: "Ontario",
      markets: ["Milton, Ontario, Canada", "Oakville"],
      locationNames: ["Milton, Ontario, Canada", "Oakville, Ontario, Canada"],
    });
  });

  it("splits compound city input and removes a repeated canonical city", () => {
    expect(projectAnalysisLocations({
      targetLocations: ["Edmonton and Calgary", "edmonton"],
      businessLocationJson: { city: "Edmonton", stateProvince: "Alberta", country: "Canada" },
    })).toEqual({
      country: "Canada",
      region: "Alberta",
      markets: ["Edmonton", "Calgary"],
      locationNames: ["Edmonton, Alberta, Canada", "Calgary, Alberta, Canada"],
    });
  });

  it("keeps independently selected countries out of the business address hierarchy", () => {
    expect(projectAnalysisLocations({
      targetLocations: ["Canada", "United States"],
      businessLocationJson: { city: "Mississauga", stateProvince: "Ontario", country: "Canada" },
    })).toEqual({
      country: "Canada",
      region: "Ontario",
      markets: ["Canada", "United States"],
      locationNames: ["Canada", "United States"],
    });
    expect(buildProjectMarketLocationNames(["United States", "Ontario", "Toronto"], "Ontario", "Canada"))
      .toEqual(["United States", "Ontario, Canada", "Toronto, Ontario, Canada"]);
  });

  it("displays saved country markets using their canonical names", () => {
    expect(projectAnalysisLocations({ targetLocations: ["canada", "united states"] })).toEqual({
      country: "Canada",
      region: "",
      markets: ["Canada", "United States"],
      locationNames: ["Canada", "United States"],
    });
  });

  it("preserves a fully specified foreign city in the project market list", () => {
    expect(projectAnalysisLocations({ targetLocations: ["London, England, United Kingdom"], businessLocationJson: { country: "Canada", stateProvince: "New Brunswick" } }).locationNames).toEqual(["London, England, United Kingdom"]);
  });
  it("keeps multiple city-country regions independent", () => {
    expect(projectAnalysisLocations({ targetLocations: ["Toronto, Canada", "New York, United State"], businessLocationJson: { city: "Toronto", stateProvince: "Ontario", country: "Canada" } }).locationNames).toEqual(["Toronto, Canada", "New York, United States"]);
  });

  it("normalizes common United States aliases before provider location building", () => {
    expect(buildProjectMarketLocationNames(["United State", "USA", "US"], "Ontario", "Canada")).toEqual(["United States"]);
  });
});
