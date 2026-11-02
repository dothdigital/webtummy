import { describe, expect, it } from "vitest";
import { extractWebsiteSourceDocument, websiteSourceDocumentComponents } from "./websiteSourceContent.js";
import { validateComponentInstance } from "./websiteModel.js";

describe("source document recovery", () => {
  it("preserves full policy sections and contact links without importing executable markup or navigation", () => {
    const body = "Existing approved policy sentence. ".repeat(250);
    const doc = extractWebsiteSourceDocument(`<nav>Navigation</nav><main><h1>Privacy Policy</h1><p>Last updated today</p><h2>Retention</h2><p>${body}</p><ul><li>Final retained clause</li></ul><h2>Contact</h2><p>Email <a href="mailto:privacy@example.com">our team</a>.</p><script>steal()</script></main><footer>Footer</footer>`, "https://example.com/privacy.html");
    const components = websiteSourceDocumentComponents(doc, "privacy");
    expect(components.flatMap(component => validateComponentInstance(component))).toEqual([]);
    const recovered = components.map(c => c.props.body).join(" ");
    expect(recovered.match(/Existing approved policy sentence\./g)).toHaveLength(250);
    expect(recovered).toContain("Final retained clause");
    expect(recovered).toContain("mailto:privacy@example.com");
    expect(recovered).not.toMatch(/Navigation|Footer|steal\(\)/);
  });
  it("stops on a login page or empty source instead of inventing replacement content", () => {
    expect(() => extractWebsiteSourceDocument("<body>Sign in</body>", "https://example.com")).toThrow();
  });
});
