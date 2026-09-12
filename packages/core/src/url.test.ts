import { describe, it, expect } from "vitest";
import { fileUrlWithoutTrailingSlash, logicalPageIdentityKeys, normalizeForDedup, resolveUrl, isSameHost, urlAliasKey } from "./url.js";

describe("normalizeForDedup", () => {
  it("lowercases scheme and host", () => {
    expect(normalizeForDedup("HTTPS://Example.COM/Path")).toBe("https://example.com/Path");
  });

  it("forces https by default", () => {
    expect(normalizeForDedup("http://example.com/")).toBe("https://example.com/");
  });

  it("drops the fragment", () => {
    expect(normalizeForDedup("https://example.com/a#section")).toBe("https://example.com/a");
  });

  it("strips trailing slash on non-root paths", () => {
    expect(normalizeForDedup("https://example.com/blog/")).toBe("https://example.com/blog");
  });

  it("keeps a slash after a file-style path because it can resolve differently", () => {
    expect(normalizeForDedup("https://example.com/blog.html/")).toBe(
      "https://example.com/blog.html/",
    );
    expect(normalizeForDedup("https://example.com/blog.html")).toBe(
      "https://example.com/blog.html",
    );
  });

  it("keeps the root slash", () => {
    expect(normalizeForDedup("https://example.com/")).toBe("https://example.com/");
  });

  it("removes default ports", () => {
    expect(normalizeForDedup("https://example.com:443/x")).toBe("https://example.com/x");
  });

  it("strips tracking params but keeps real ones", () => {
    expect(normalizeForDedup("https://example.com/p?utm_source=x&id=5&gclid=9")).toBe(
      "https://example.com/p?id=5",
    );
  });

  it("sorts query params for a stable key", () => {
    const a = normalizeForDedup("https://example.com/p?b=2&a=1");
    const b = normalizeForDedup("https://example.com/p?a=1&b=2");
    expect(a).toBe(b);
  });

  it("strips session params", () => {
    expect(normalizeForDedup("https://example.com/p?PHPSESSID=abc&q=1")).toBe(
      "https://example.com/p?q=1",
    );
  });
});

describe("resolveUrl", () => {
  it("resolves relative paths", () => {
    expect(resolveUrl("https://example.com/blog/post", "../about")).toBe(
      "https://example.com/about",
    );
  });
  it("returns null for mailto/tel/js/anchors", () => {
    expect(resolveUrl("https://example.com", "mailto:a@b.com")).toBeNull();
    expect(resolveUrl("https://example.com", "tel:+123")).toBeNull();
    expect(resolveUrl("https://example.com", "javascript:void(0)")).toBeNull();
    expect(resolveUrl("https://example.com", "#top")).toBeNull();
  });
});

describe("fileUrlWithoutTrailingSlash", () => {
  it("suggests the slashless counterpart only for file-style paths", () => {
    expect(fileUrlWithoutTrailingSlash("https://example.com/blog.html/")).toBe(
      "https://example.com/blog.html",
    );
    expect(fileUrlWithoutTrailingSlash("https://example.com/blog/")).toBeNull();
    expect(fileUrlWithoutTrailingSlash("https://example.com/blog.html")).toBeNull();
  });
});

describe("urlAliasKey", () => {
  it("groups homepage host and index aliases", () => {
    expect(urlAliasKey("https://www.example.com")).toBe("example.com/");
    expect(urlAliasKey("https://example.com/")).toBe("example.com/");
    expect(urlAliasKey("https://www.example.com/index.html")).toBe("example.com/");
    expect(urlAliasKey("https://example.com/home/")).toBe("example.com/");
    expect(urlAliasKey("https://example.com/homepage")).toBe("example.com/");
  });

  it("does not merge a file URL with its slash-suffixed 404 variant", () => {
    expect(urlAliasKey("https://example.com/blog.html/")).not.toBe(
      urlAliasKey("https://example.com/blog.html"),
    );
  });
});

describe("logicalPageIdentityKeys", () => {
  it("groups equivalent root and service routes only when their rendered content matches", () => {
    const keys = logicalPageIdentityKeys([
      { id: "root", url: "https://example.com/life-insurance-broker/", contentFingerprint: "same-page" },
      { id: "service", url: "https://example.com/services/life-insurance-broker/", contentFingerprint: "same-page" },
      { id: "different", url: "https://example.com/services/critical-illness/", contentFingerprint: "other-page" },
    ]);
    expect(keys.get("root")).toBe(keys.get("service"));
    expect(keys.get("root")).not.toBe(keys.get("different"));
  });

  it("does not collapse genuine submenu pages or same-slug routes with different content", () => {
    const keys = logicalPageIdentityKeys([
      { id: "services", url: "https://example.com/services/", contentFingerprint: "service-hub" },
      { id: "life", url: "https://example.com/services/life-insurance/", contentFingerprint: "life-page" },
      { id: "root-life", url: "https://example.com/life-insurance/", contentFingerprint: "different-life-page" },
    ]);
    expect(new Set(keys.values())).toHaveLength(3);
  });

  it("groups matching rendered pages that declare the same canonical owner", () => {
    const keys = logicalPageIdentityKeys([
      { id: "one", url: "https://example.com/route-a", canonicalUrl: "https://example.com/preferred", contentFingerprint: "same" },
      { id: "two", url: "https://example.com/route-b", canonicalUrl: "https://example.com/preferred", contentFingerprint: "same" },
    ]);
    expect(keys.get("one")).toBe(keys.get("two"));
  });

  it("groups a redirected source with its final page", () => {
    const keys = logicalPageIdentityKeys([
      { id: "old", url: "https://example.com/old-page", finalUrl: "https://example.com/new-page" },
      { id: "new", url: "https://example.com/new-page", finalUrl: "https://example.com/new-page" },
    ]);
    expect(keys.get("old")).toBe(keys.get("new"));
  });
});

describe("isSameHost", () => {
  it("treats www and apex as the same host", () => {
    expect(isSameHost("https://example.com/a", "https://www.example.com/b")).toBe(true);
  });
  it("distinguishes different hosts", () => {
    expect(isSameHost("https://example.com", "https://other.com")).toBe(false);
  });
});
