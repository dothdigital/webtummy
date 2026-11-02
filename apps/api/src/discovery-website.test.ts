import { describe, expect, it } from "vitest";
import { normalizeDiscoveryWebsiteUrl } from "./discovery-website.js";

describe("discovery website normalization", () => {
  it("accepts and normalizes a bare domain", () => {
    expect(normalizeDiscoveryWebsiteUrl("procarephysioandrehab.com")).toEqual({ domain: "procarephysioandrehab.com", rootUrl: "https://procarephysioandrehab.com" });
  });

  it("normalizes an HTTP or HTTPS URL to its origin", () => {
    expect(normalizeDiscoveryWebsiteUrl("https://Example.com/services?q=physio")).toEqual({ domain: "example.com", rootUrl: "https://example.com" });
  });

  it("rejects unsafe or malformed values", () => {
    expect(normalizeDiscoveryWebsiteUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeDiscoveryWebsiteUrl("https://user:pass@example.com")).toBeNull();
  });
});
