import { describe, expect, it } from "vitest";
import type { WebsiteModel } from "@webtummy/core/website-model";
import { assertWebsiteReleaseRequirements, missingWebsiteReleaseRequirements } from "./website-release-requirements.js";

function model(phone = "416-555-0100", email = "hello@example.test") {
  return { identity: { businessName: "Example", contactPhone: phone, contactEmail: email, copyrightText: "© Example" }, pages: [{ name: "Home", pageType: "home", slug: "/", sections: [{ componentId: "hero.local_service", props: { imageAssetId: "hero" } }] }], mediaAssets: [{ assetId: "hero", status: "approved", sourceUrl: "https://example.test/hero.jpg" }] } as unknown as WebsiteModel;
}

describe("website release preflight", () => {
  it("reports the exact missing contact requirements for an otherwise complete website", () => {
    expect(() => assertWebsiteReleaseRequirements(model("", ""))).toThrow("Website approval is waiting for: verified business phone, verified business email.");
  });
  it("provides Quality Review the same blockers before the model is validated", () => {
    const site = model("", "");
    expect(missingWebsiteReleaseRequirements(site)).toEqual(["verified business phone", "verified business email"]);
  });
  it("accepts a website with saved contacts and approved hero", () => {
    expect(() => assertWebsiteReleaseRequirements(model())).not.toThrow();
  });
  it("still requires approval of the hero image", () => {
    const site = model();
    site.mediaAssets = [];
    expect(() => assertWebsiteReleaseRequirements(site)).toThrow("approved Home first-fold hero image");
  });
});
