import { describe, it, expect } from "vitest";
import { fileUrlWithoutTrailingSlash, normalizeForDedup, resolveUrl, isSameHost, urlAliasKey } from "./url.js";

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
  });

  it("does not merge a file URL with its slash-suffixed 404 variant", () => {
    expect(urlAliasKey("https://example.com/blog.html/")).not.toBe(
      urlAliasKey("https://example.com/blog.html"),
    );
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
