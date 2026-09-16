import { describe, expect, it } from "vitest";
import { validateWebsiteContext, websiteContextSchema } from "./website-context.js";
import { emptyWebsiteContext, websiteProjectFields } from "@webtummy/core/website-context";
describe("website context validation", () => {
  const context = { ...emptyWebsiteContext, hasWebsite: "yes", hasDomain: "yes", existingWebsiteUrl: "https://old.example.com", domainUrl: "https://new.example.com", websiteIntent: "separate" };
  it("requires independent confirmation before discovery conversion", () => {
    expect(validateWebsiteContext(emptyWebsiteContext, "Build a New Website")).toContain("live website");
  });
  it("accepts a separate new website with a different destination", () => {
    expect(validateWebsiteContext(context, "Build a New Website")).toBeNull();
  });
  it("rejects silently reusing the existing destination for a separate website", () => {
    expect(validateWebsiteContext({ ...context, domainUrl: context.existingWebsiteUrl })).toContain("different domain");
  });
  it("rejects malformed website/domain input before save", () => {
    expect(validateWebsiteContext({ ...context, domainUrl: "not a domain" })).toContain("valid domain");
  });
  it("accepts domain-only project data through the API schema without changing existence", () => {
    const parsed = websiteContextSchema.parse({ ...emptyWebsiteContext, hasWebsite: "no", hasDomain: "yes", domainUrl: "example.com" });
    expect(websiteProjectFields(parsed, "Build a New Website").websiteStatus).toBe("new_website_required");
  });
});
