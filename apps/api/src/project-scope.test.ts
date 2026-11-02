import { describe, expect, it } from "vitest";
import { superAdminProjectClientId } from "./project-scope.js";

describe("super-admin project scope", () => {
  it("uses the account tenant for a super admin who owns an Entrepreneur workspace", () => {
    expect(superAdminProjectClientId({ accountClientId: "entrepreneur-client" })).toBe("entrepreneur-client");
  });

  it("allows an explicit admin tenant selection to override the account tenant", () => {
    expect(superAdminProjectClientId({ explicitClientId: "requested-client", accountClientId: "entrepreneur-client" })).toBe("requested-client");
  });

  it("uses the selected tenant header before the account default", () => {
    expect(superAdminProjectClientId({ selectedClientId: "selected-client", accountClientId: "entrepreneur-client" })).toBe("selected-client");
  });

  it("returns null only when the internal admin fallback is actually required", () => {
    expect(superAdminProjectClientId({})).toBeNull();
  });
});
