import { describe, expect, it } from "vitest";
import { normalizeWebsiteImagePreferences, websiteImagePreferencePrompt } from "./websiteImagePreferences.js";

describe("website image preferences", () => {
  it("gives existing websites an industry-led default without forcing people", () => {
    expect(normalizeWebsiteImagePreferences(null)).toEqual({ subject: "auto", style: "auto", people: "auto", instructions: "" });
    expect(websiteImagePreferencePrompt(undefined)).toContain("Do not default to people");
  });
  it("normalizes unknown values and limits shared instructions", () => {
    expect(normalizeWebsiteImagePreferences({ subject: "toString", style: "unknown", people: "invalid", instructions: "  " + "x".repeat(1500) })).toEqual({ subject: "auto", style: "auto", people: "auto", instructions: "x".repeat(1000) });
  });
  it("carries subject, medium, and shared instructions into the image prompt", () => {
    const prompt = websiteImagePreferencePrompt({ subject: "equipment", style: "illustration", people: "none", instructions: "Use blue accents and show machinery." });
    expect(prompt).toContain("Tools, equipment and process");
    expect(prompt).toContain("Medium: Illustration");
    expect(prompt).toContain("Use blue accents and show machinery.");
    expect(prompt).toContain("Do not depict people, faces, bodies, silhouettes, or hands");
  });
  it("keeps the no-people choice authoritative even for a people subject", () => {
    expect(websiteImagePreferencePrompt({ subject: "people", people: "none" })).toContain("This exclusion also applies to custom instructions");
  });
});
