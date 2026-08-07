import { describe, expect, it } from "vitest";
import { geographicTargetMarkets } from "./projectLocations.js";

describe("geographicTargetMarkets", () => {
  it("removes vague AI service-area fragments before splitting markets", () => {
    expect(geographicTargetMarkets([
      "Mississauga and nearby neighbourhoods",
      "Brampton, Oakville, Milton, and surrounding communities",
      "Canada",
    ])).toEqual(["Mississauga", "Brampton", "Oakville", "Milton", "Canada"]);
  });

  it("rejects standalone vague market labels", () => {
    expect(geographicTargetMarkets(["nearby neighbourhoods", "and surrounding communities", "Ontario"])).toEqual(["Ontario"]);
  });
});
