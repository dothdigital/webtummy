import { describe, expect, it } from "vitest";
import { connectedSocialPlatforms, socialProviderCapabilities, socialProviderCapability } from "./social-provider-registry.js";

describe("social provider registry", () => {
  it("keeps connected publishing capabilities separate from manual handoffs", () => {
    expect(connectedSocialPlatforms()).toEqual(["facebook", "instagram"]);
    expect(socialProviderCapability("facebook")).toMatchObject({ connectionAvailable: true, publish: true, schedule: true });
    expect(socialProviderCapability("linkedin")).toMatchObject({ connectionAvailable: false, provider: "manual_handoff", draft: true });
  });

  it("defines every supported social strategy platform once", () => {
    const capabilities = socialProviderCapabilities();
    expect(new Set(capabilities.map((item) => item.platform)).size).toBe(capabilities.length);
    expect(capabilities.map((item) => item.platform)).toEqual(expect.arrayContaining(["facebook", "instagram", "linkedin", "x", "threads", "google_business"]));
  });
});
