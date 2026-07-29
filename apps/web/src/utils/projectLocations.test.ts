import { describe, expect, it } from "vitest";
import { geographicTargetMarkets } from "./projectLocations.js";

describe("project geographic target markets", () => {
  it("keeps confirmed places and excludes audiences, services, and duplicates", () => {
    expect(geographicTargetMarkets([
      "Dehradun",
      "Uttarakhand",
      "India",
      "dehradun",
      "Tech startups",
      "Enterprises looking for AI integration",
      "AI solutions in India",
    ])).toEqual(["Dehradun", "Uttarakhand", "India"]);
  });
});
