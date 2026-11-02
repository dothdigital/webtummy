import { describe, expect, it } from "vitest";
import { keywordTargetUrlSchema } from "./keyword-target-url.js";
import { keywordResearchTargets } from "./routes/keyword-research.js";
const project = { id: "cmu1bq3wt04p9nrcadnxg8ev9", clientId: "client", websiteId: null, targetLocations: ["Canada"], websiteStatus: "new_website_required", websiteUrl: "KPIRY.com", primaryGoal: "Build a New Website", websiteContextJson: null };
const input = { seedKeyword: "insurance", locationName: "Canada", languageCode: "en", device: "desktop" as const, serpDepth: 20, keywordLimit: 25, targetUrl: keywordTargetUrlSchema.parse("KPIRY.com"), targetDomain: "KPIRY.com" };
describe("keyword estimate URL regression", () => {
  it("accepts the exact bare-domain value from the affected project's old request", () => {
    expect(keywordTargetUrlSchema.parse("KPIRY.com")).toBe("https://KPIRY.com");
  });
  it("runs keyword-only research for a domain-only project without fetching a site", () => {
    expect(keywordResearchTargets(input, { clientId: "client", project, website: null })).toEqual({ targetUrl: null, targetDomain: null });
  });
  it("does not treat a stale website relation as proof that the new site exists", () => {
    expect(keywordResearchTargets(input, { clientId: "client", project, website: { id: "old", clientId: "client", domain: "kpiry.com", rootUrl: "https://kpiry.com" } })).toEqual({ targetUrl: null, targetDomain: null });
  });
  it("retains an explicit live-site target for existing website research", () => {
    expect(keywordResearchTargets({ ...input, targetUrl: "https://kpiry.com/services" }, { clientId: "client", project: { ...project, websiteStatus: "existing_website", primaryGoal: "Generate More Qualified Leads" }, website: { id: "website", clientId: "client", domain: "kpiry.com", rootUrl: "https://kpiry.com" } })).toEqual({ targetUrl: "https://kpiry.com/services", targetDomain: "kpiry.com" });
  });
  it("accepts missing targets and rejects malformed URLs", () => {
    expect(keywordTargetUrlSchema.parse("")).toBeNull();
    expect(keywordTargetUrlSchema.parse(null)).toBeNull();
    expect(keywordTargetUrlSchema.parse(undefined)).toBeUndefined();
    expect(keywordTargetUrlSchema.safeParse("not a url").success).toBe(false);
    expect(keywordTargetUrlSchema.safeParse("ftp://example.com").success).toBe(false);
  });
});
