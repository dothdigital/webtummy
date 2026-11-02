import { describe, expect, it } from "vitest";
import { locationDefaultsFromSettings, normalizeRequiredLocations, resolveProjectLocations, withLocationDefaults } from "./dev004.js";

describe("DEV-004 shared location defaults", () => {
  const details = { country: "Canada", stateProvince: "Ontario", city: "Toronto", streetAddress: "1 King St", postalCode: "M5H 1A1" };

  it.each(["personal", "business", "ecommerce"])("reuses structured defaults for %s workspaces", () => {
    const settings = withLocationDefaults({ theme: "dark" }, { businessLocation: "", businessLocationDetails: details, targetMarkets: ["Canada", "Toronto", "canada"] });
    expect(locationDefaultsFromSettings(settings)).toEqual({ businessLocation: "1 King St, Toronto, Ontario, M5H 1A1, Canada", businessLocationDetails: details, targetMarkets: ["Canada", "Toronto"] });
    expect(settings).toMatchObject({ theme: "dark" });
  });

  it("normalizes Agency client locations and prevents required values being cleared", () => {
    expect(normalizeRequiredLocations(["Toronto, Ontario, Canada"], ["Canada", "canada", " Ontario "])).toEqual({ businessLocations: ["Toronto, Ontario, Canada"], targetMarkets: ["Canada", "Ontario"] });
    expect(() => normalizeRequiredLocations(["Dehradun, Uttarakhand, India"], ["Tech startups", "Enterprises looking for AI integration"])).toThrow(/target market/);
    expect(() => normalizeRequiredLocations([], ["Canada"])).toThrow(/Business location/);
    expect(() => normalizeRequiredLocations(["Toronto"], [])).toThrow(/target market/);
  });

  it("keeps Agency inheritance project-only and uses a structured override when supplied", () => {
    const defaults = { businessLocation: "Toronto, Ontario, Canada", businessLocationDetails: { country: "Canada", stateProvince: "Ontario", city: "Toronto" }, targetMarkets: ["Ontario"] };
    expect(resolveProjectLocations({ defaults })).toMatchObject({ businessLocation: "Toronto, Ontario, Canada", targetMarkets: ["Ontario"] });
    expect(resolveProjectLocations({ defaults, businessLocationDetails: { country: "United States", stateProvince: "New York", city: "New York" }, targetMarkets: ["USA", "usa"] })).toMatchObject({ businessLocation: "New York, New York, United States", targetMarkets: ["USA"] });
    expect(defaults).toMatchObject({ businessLocation: "Toronto, Ontario, Canada", targetMarkets: ["Ontario"] });
  });
});
