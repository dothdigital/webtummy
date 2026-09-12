import { describe, expect, it } from "vitest";
import { parseHtml } from "./parse.js";

describe("parseHtml links", () => {
  it("uses accessible image and aria labels instead of reporting empty weak anchors", () => {
    const parsed = parseHtml(`
      <html><body>
        <header><a href="/"><img src="/logo.png" alt="Example Insurance home"></a></header>
        <nav><a href="/contact" aria-label="Contact Example Insurance"><svg></svg></a></nav>
      </body></html>
    `, "https://example.com/");
    expect(parsed.links.find((link) => link.normalized === "https://example.com/")?.anchorText).toBe("Example Insurance home");
    expect(parsed.links.find((link) => link.normalized === "https://example.com/contact")?.anchorText).toBe("Contact Example Insurance");
  });

  it("keeps one destination per source page but prefers descriptive body-link evidence", () => {
    const parsed = parseHtml(`
      <html><body>
        <nav><a href="/life-insurance">More</a></nav>
        <main><p><a href="/life-insurance">Compare life insurance options</a></p></main>
      </body></html>
    `, "https://example.com/");
    const matches = parsed.links.filter((link) => link.normalized === "https://example.com/life-insurance");
    expect(matches).toHaveLength(1);
    expect(matches[0].anchorText).toBe("Compare life insurance options");
    expect(matches[0].placement).toBe("body");
  });
});
