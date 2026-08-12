import { describe, expect, it } from "vitest";
import { projectAnalysisLocations } from "./locationOptions";

describe("projectAnalysisLocations", () => {
  it("keeps the browser request matrix aligned with canonical project markets", () => {
    expect(projectAnalysisLocations({
      targetLocations: ["Milton,Milton,Ontario,Canada", "Oakville", "nearby neighbourhoods"],
      businessLocationJson: { city: "Mississauga", stateProvince: "Ontario", country: "Canada" },
    })).toEqual({
      country: "Canada",
      region: "Ontario",
      markets: ["Milton", "Oakville"],
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
});
