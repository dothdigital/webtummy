import { describe, expect, it } from "vitest";
import { emptyWebsiteContext, websiteRoutingNeedsConfirmation, websiteContext, websiteProjectFields, websiteAnalysisUrl, missingWebsiteContext, websiteBuildRequested, websitePlanningContext } from "./websiteContext.js";
const goal = "Build a New Website";
const domainOnly = { ...emptyWebsiteContext, hasWebsite: "no" as const, hasDomain: "yes" as const, domainUrl: "new.example.com" };
const replacement = { ...emptyWebsiteContext, hasWebsite: "yes" as const, hasDomain: "yes" as const, existingWebsiteUrl: "https://old.example.com", websiteIntent: "replace" as const, replacementDomain: "different" as const, domainUrl: "https://new.example.com" };
describe("website existence and domain ownership", () => {
  it("does not force a website build on a confirmed non-website project", () => {
    const project = websiteProjectFields({ ...domainOnly, hasDomain: "no" }, "Generate More Qualified Leads", "no_website_required");
    expect(project.websiteStatus).toBe("no_website_required");
    expect(websiteBuildRequested(project)).toBe(false);
  });
  it("asks for replacement or separate intent when the user changes no website to yes", () => {
    const project = websiteProjectFields({ ...domainOnly, hasWebsite: "yes", websiteIntent: "new", existingWebsiteUrl: "https://old.example.com" }, goal);
    expect(missingWebsiteContext(project.websiteContextJson, goal)).toContain("websiteIntent");
    expect(websiteAnalysisUrl(project)).toBeNull();
  });
  it("keeps an owned domain on the new-site path without a crawl", () => {
    const project = websiteProjectFields(domainOnly, goal);
    expect(project.websiteStatus).toBe("new_website_required");
    expect(project.websiteUrl).toBe("https://new.example.com");
    expect(websiteAnalysisUrl(project)).toBeNull();
    expect(websiteBuildRequested(project)).toBe(true);
    expect(missingWebsiteContext(project.websiteContextJson, goal)).toEqual([]);
  });
  it("does not infer a live site or ownership from a URL", () => {
    const project = websiteProjectFields({ ...emptyWebsiteContext, domainUrl: "example.com" }, goal);
    expect(project.websiteStatus).toBe("undecided");
    expect(websiteAnalysisUrl(project)).toBeNull();
    expect(missingWebsiteContext(project.websiteContextJson, goal)).toContain("hasWebsite");
    expect(missingWebsiteContext(project.websiteContextJson, goal)).toContain("hasDomain");
  });
  it("allows building before a domain is purchased", () => {
    const project = websiteProjectFields({ ...domainOnly, hasDomain: "no" }, goal);
    expect(project.websiteUrl).toBeNull();
    expect(missingWebsiteContext(project.websiteContextJson, goal)).toEqual([]);
  });
  it("analyzes the old website while keeping the replacement domain separate", () => {
    const project = websiteProjectFields(replacement, goal);
    expect(websiteAnalysisUrl(project)).toBe("https://old.example.com");
    expect(project.websiteUrl).toBe("https://new.example.com");
    expect(websiteBuildRequested(project)).toBe(true);
    expect(websitePlanningContext(project).instruction).toContain("redirects");
  });
  it("reuses the current domain only when same-domain replacement is explicit", () => {
    const project = websiteProjectFields({ ...replacement, replacementDomain: "same", domainUrl: "" }, goal);
    expect(project.websiteUrl).toBe("https://old.example.com");
    expect(missingWebsiteContext(project.websiteContextJson, goal)).toEqual([]);
  });
  it("allows a replacement to be planned before buying its different domain", () => {
    const project = websiteProjectFields({ ...replacement, hasDomain: "no", domainUrl: "" }, goal);
    expect(project.websiteUrl).toBeNull();
    expect(websiteAnalysisUrl(project)).toBe("https://old.example.com");
    expect(missingWebsiteContext(project.websiteContextJson, goal)).toEqual([]);
  });
  it("does not require analysis of a separate site's optional reference", () => {
    const project = websiteProjectFields({ ...replacement, websiteIntent: "separate" }, goal);
    expect(project.websiteStatus).toBe("new_website_required");
    expect(websiteAnalysisUrl(project)).toBeNull();
    expect(project.websiteContextJson.existingWebsiteUrl).toBe("https://old.example.com");
    expect(project.websiteUrl).toBe("https://new.example.com");
  });
  it("asks for intent instead of treating a new-site goal as improvement", () => {
    expect(missingWebsiteContext({ ...replacement, websiteIntent: "improve" }, goal)).toContain("websiteIntent");
  });
  it("does not guess the website status of ambiguous older build projects", () => {
    const project = { websiteStatus: "existing_website", websiteUrl: "https://example.com", primaryGoal: goal };
    expect(websiteContext(project).hasWebsite).toBe("");
    expect(websiteAnalysisUrl(project)).toBeNull();
  });
  it("preserves explicit legacy no-website status and established growth-site behavior", () => {
    expect(websiteAnalysisUrl({ websiteStatus: "new_website_required", websiteUrl: "https://example.com" })).toBeNull();
    expect(websiteAnalysisUrl({ websiteStatus: "existing_website", websiteUrl: "https://example.com", primaryGoal: "Generate More Qualified Leads" })).toBe("https://example.com");
  });
  it("preserves the answers through JSON storage and resuming", () => {
    const saved = websiteProjectFields(replacement, goal);
    expect(websiteContext(JSON.parse(JSON.stringify(saved)))).toEqual(saved.websiteContextJson);
  });
  it("accepts Yes/No and intent choices from conversational controls", () => {
    const saved = websiteProjectFields({ ...replacement, hasWebsite: "Yes", hasDomain: "Yes", websiteIntent: "Replace", replacementDomain: "Different" }, goal);
    expect(missingWebsiteContext(saved.websiteContextJson, goal)).toEqual([]);
  });
  it("enables analysis only for the recorded live destination after publication", () => {
    const project = websiteProjectFields(domainOnly, goal);
    expect(websiteAnalysisUrl({ ...project, websiteContextJson: { ...project.websiteContextJson, launchedWebsiteUrl: "https://new.example.com" } })).toBe("https://new.example.com");
  });
});


describe("ongoing workflow website confirmation", () => {
  it.each(["new_website_required", "website_planned", "no_website_required"])("does not interrupt a legacy %s project for missing domain ownership", (websiteStatus) => {
    const project = { websiteStatus, websiteUrl: "KPIRY.com", websiteContextJson: null, primaryGoal: "Build a New Website" };
    expect(websiteRoutingNeedsConfirmation(project)).toBe(false);
    expect(websiteAnalysisUrl(project)).toBeNull();
  });
  it("keeps full intake requirements without imposing them on ongoing work", () => {
    const project = { websiteStatus: "new_website_required", websiteContextJson: { ...emptyWebsiteContext, hasWebsite: "no", websiteIntent: "new" }, primaryGoal: "Build a New Website" };
    expect(missingWebsiteContext(websiteContext(project), project.primaryGoal)).toContain("hasDomain");
    expect(websiteRoutingNeedsConfirmation(project)).toBe(false);
  });
  it("still asks when an old new-site goal is marked as an existing website", () => {
    expect(websiteRoutingNeedsConfirmation({ websiteStatus: "existing_website", websiteUrl: "example.com", primaryGoal: "Build a New Website" })).toBe(true);
  });
  it("still asks whether a confirmed existing site is being replaced or used as a reference", () => {
    expect(websiteRoutingNeedsConfirmation({ websiteContextJson: { ...emptyWebsiteContext, hasWebsite: "yes", existingWebsiteUrl: "https://example.com" }, primaryGoal: "Build a New Website" })).toBe(true);
  });
});
