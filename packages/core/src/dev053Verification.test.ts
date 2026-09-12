import { describe, expect, it } from "vitest";
import { dev053AcceptanceScenarios, dev053Capabilities, dev053ExpectedCapabilityIds } from "./dev053Verification.js";

describe("DEV-053 capability register", () => {
  it("registers every required SEO, AEO and GEO capability exactly once", () => {
    const ids = dev053Capabilities.map((item) => item.id);
    expect(ids).toHaveLength(115);
    expect(new Set(ids).size).toBe(115);
    expect([...ids].sort()).toEqual([...dev053ExpectedCapabilityIds].sort());
  });

  it("gives every capability a user destination and validation signal", () => {
    for (const capability of dev053Capabilities) {
      expect(capability.title.trim().length).toBeGreaterThan(3);
      expect(capability.route).toContain("{projectId}");
      expect(capability.signal.trim().length).toBeGreaterThan(2);
    }
  });

  it("registers all mandatory acceptance scenarios", () => {
    expect(dev053AcceptanceScenarios.map(([id]) => id)).toEqual(Array.from({ length: 14 }, (_, index) => `AT-${String(index + 1).padStart(2, "0")}`));
  });
});
