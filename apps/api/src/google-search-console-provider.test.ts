import { afterEach, describe, expect, it, vi } from "vitest";
import { SEARCH_CONSOLE_SCOPE, createSearchOauthRequest, decryptSearchCredential, encryptSearchCredential, googleSearchRequest, listSearchProperties, propertyMatchesWebsite, searchAnalytics, searchAuthorizationUrl, searchDateRange, searchReviewOpportunities, searchWebsitePattern } from "./google-search-console-provider.js";

afterEach(() => vi.unstubAllGlobals());
describe("Search Console provider", () => {
  it("requests read-only OAuth with unique state and PKCE", () => {
    const first = createSearchOauthRequest(), second = createSearchOauthRequest();
    const url = new URL(searchAuthorizationUrl(first));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe(SEARCH_CONSOLE_SCOPE);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe(first.state);
    expect(url.searchParams.get("redirect_uri")).toContain("/api/integrations/google-search-console/callback");
    expect(first.state).not.toBe(second.state);
    expect(first.stateHash).not.toBe(first.state);
    expect(first.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
  it("encrypts credentials with authentication and random nonces", () => {
    const encrypted = encryptSearchCredential("test-access-token");
    expect(encrypted).not.toContain("test-access-token");
    expect(encrypted).not.toBe(encryptSearchCredential("test-access-token"));
    expect(decryptSearchCredential(encrypted)).toBe("test-access-token");
    const parts = encrypted.split("."); parts[2] = Buffer.alloc(16).toString("base64url");
    expect(() => decryptSearchCredential(parts.join("."))).toThrow();
  });
  it("accepts matching domain and URL-prefix properties only", () => {
    expect(propertyMatchesWebsite("sc-domain:example.com", "https://www.example.com/")).toBe(true);
    expect(propertyMatchesWebsite("https://example.com/blog/", "https://example.com/blog/article")).toBe(true);
    for (const property of ["sc-domain:evil-example.com", "https://example.com.evil.test/", "http://example.com/", "https://example.com/blogger/", "javascript:alert(1)"]) {
      expect(propertyMatchesWebsite(property, "https://example.com/blog/")).toBe(false);
    }
    expect(propertyMatchesWebsite("sc-domain:example.com", "https://notexample.com/")).toBe(false);
    expect(propertyMatchesWebsite("https://example.com/private/", "https://example.com/")).toBe(false);
  });
  it("uses 28 complete Pacific calendar dates ending yesterday", () => {
    expect(searchDateRange(new Date("2026-09-06T01:00:00Z"))).toEqual({ startDate: "2026-08-08", endDate: "2026-09-04" });
  });
  it("queries finalized web data without treating an empty response as zero", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })); vi.stubGlobal("fetch", fetch);
    const result = await searchAnalytics("secret", "sc-domain:example.com", { startDate: "2026-08-01", endDate: "2026-08-28" }, ["query"]);
    expect(result.rows).toBeUndefined();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toContain("sc-domain%3Aexample.com/searchAnalytics/query");
    expect(JSON.parse(options.body)).toMatchObject({ dataState: "final", type: "web", dimensions: ["query"] });
    expect(options.headers.Authorization).toBe("Bearer secret");
  });
  it("excludes unverified properties", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }, { siteUrl: "sc-domain:other.com", permissionLevel: "siteUnverifiedUser" }] }))));
    expect(await listSearchProperties("secret")).toHaveLength(1);
  });
  it("redacts provider error details and identifies revoked authorization", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant", error_description: "sensitive provider payload" }), { status: 400 })));
    await expect(googleSearchRequest("https://oauth2.googleapis.com/token")).rejects.toMatchObject({ reauthRequired: true, message: "Google authorization expired or was revoked. Reconnect Search Console." });
  });
});


it("filters a domain-property import to the exact website URL prefix", () => {
  const regex = new RegExp(searchWebsitePattern("https://www.example.com/blog/"));
  expect(regex.test("https://www.example.com/blog/article/")).toBe(true);
  expect(regex.test("https://wwwXexample.com/blog/article/")).toBe(false);
  expect(regex.test("https://other.example.com/blog/article/")).toBe(false);
  expect(regex.test("https://www.example.com/blogger/")).toBe(false);
});
it("proposes evidence-qualified CTR reviews and excludes low-volume observations", () => {
  const row = { keys: ["example query"], clicks: 1, impressions: 200, ctr: 0.005, position: 10 };
  expect(searchReviewOpportunities([row, { ...row, impressions: 5 }])).toHaveLength(1);
  expect(searchReviewOpportunities([row])[0].detail).toContain("improvement is not guaranteed");
});
