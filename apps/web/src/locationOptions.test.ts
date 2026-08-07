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
});
