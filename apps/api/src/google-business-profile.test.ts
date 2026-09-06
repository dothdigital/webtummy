import { describe, expect, it } from "vitest";
import { assessGbpProfile, createGbpOauthRequest, defaultGbpCapabilities, friendlyGbpProviderError, isGbpQuotaAccessError } from "./google-business-profile.js";

describe("Google Business Profile limited V1", () => {
  it("uses one-time PKCE OAuth material", () => {
    const first = createGbpOauthRequest();
    const second = createGbpOauthRequest();
    expect(first.state).not.toBe(second.state);
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.stateHash).toHaveLength(64);
    expect(first.challenge.length).toBeGreaterThan(30);
    expect(first.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("scores only profile signals actually present", () => {
    const result = assessGbpProfile({
      title: "North Star Dental",
      categories: { primaryCategory: { displayName: "Dentist" }, additionalCategories: [{ displayName: "Cosmetic dentist" }] },
      storefrontAddress: { locality: "Toronto" },
      phoneNumbers: { primaryPhone: "+1 416 555 0100" },
      websiteUri: "https://example.com",
      regularHours: { periods: [{ openDay: "MONDAY" }] },
      profile: { description: "Local dental care." },
      metadata: { placeId: "example" },
    }, { totalReviewCount: 20, averageRating: 4.8 });
    expect(result.score).toBe(100);
    expect(result.status).toBe("strong");
    expect(result.recommendations).toEqual([]);
  });

  it("keeps direct profile editing outside limited V1", () => {
    const capabilities = defaultGbpCapabilities();
    expect(capabilities.profile_update.status).toBe("UNSUPPORTED");
    expect(capabilities.profile_update.recoverable).toBe(false);
  });

  it("turns Google zero-quota responses into an access-required state", () => {
    const error = Object.assign(new Error("Quota exceeded for quota metric 'Requests' and limit 'Requests per minute' of service 'mybusinessaccountmanagement.googleapis.com'."), { statusCode: 429 });
    expect(isGbpQuotaAccessError(error)).toBe(true);
    expect(friendlyGbpProviderError(error)).toContain("technical difficulties connecting to Google Business Profile");
    expect(isGbpQuotaAccessError(new Error("Quota exceeded for quota metric 'Requests'."))).toBe(true);
  });
});
