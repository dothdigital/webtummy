import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { load } from "cheerio";
import postcss from "postcss";
import { createStaticWebsiteFiles, SENUKE_STATIC_CSS } from "./websiteRenderer.js";
import { applyWebsiteGovernance, SENUKE_COMPONENT_REGISTRY_V1, type WebsiteModel, type WebsitePageModel } from "./websiteModel.js";

const labels = ["Home", "Our Solution", "About Us", "Contact Us", "Simahi Blog"];
const extras = ["Privacy Policy", "Professional Online Insurance Quote Systems", "Terms and Conditions", "Security & Privacy Overview"];
const page = (name: string, index: number): WebsitePageModel => ({
  pageId: `page-${index}`, name, slug: index ? `/${index}/` : "/", pageType: index ? "service" : "home", primaryCta: { label: "Contact Us", url: "/3/" }, sections: [],
  seo: { title: name, metaDescription: name, canonicalUrl: index ? `/${index}/` : "/", robots: "index,follow", primaryKeyword: name, secondaryKeywords: [], dominantIntent: "commercial", internalLinks: [], faqs: [], schemaJsonLd: {}, imageAltText: [] },
});
const pages = [...labels, ...extras, "Insurance CRM"].map(page);
const saved = [...labels.map((label, index) => ({ label, pageId: `page-${index}` })), { label: "Insurance CRM", pageId: "page-9", parentPageId: "page-1" }];
const governance = applyWebsiteGovernance(pages, saved);
const model: WebsiteModel = {
  modelId: "header-regression", websiteId: "website", projectId: "project", version: 1, status: "validated",
  componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
  identity: { businessName: "Menu regression" },
  designSystem: {
    version: "1.0.0", colors: { primary: "#2563eb", secondary: "#0f766e", accent: "#f59e0b", background: "#f8fafc", surface: "#ffffff", text: "#0f172a", mutedText: "#475569" },
    typography: { headingFont: "Poppins", bodyFont: "Inter" }, spacingScale: "comfortable", radiusScale: "medium",
  },
  ...governance, forms: [], mediaAssets: [],
};

describe("saved header navigation", () => {
  it("renders exactly the saved top-level links on desktop and mobile, including historical utility menus", () => {
    // Approved snapshots can still contain the old automatically inferred utility menu.
    const legacy = { ...model, navigationModel: { ...model.navigationModel!, utilityMenu: [saved[3], ...extras.map((label, index) => ({ label, pageId: `page-${index + 5}` }))] } };
    const files = createStaticWebsiteFiles(legacy);
    const htmlFiles = files.filter(file => file.path.endsWith(".html"));
    expect(htmlFiles).toHaveLength(pages.length);
    for (const file of htmlFiles) {
      const $ = load(String(file.content));
      for (const selector of [".senuke-header-navigation", ".senuke-mobile-menu-panel"]) {
        expect($(selector).find("nav > ul > li > a").map((_, el) => $(el).text()).get()).toEqual(labels);
        expect($(selector).find("nav > ul > li > ul > li > a").text()).toBe("Insurance CRM");
        expect($(selector).find('a[role="button"], a.senuke-button')).toHaveLength(0);
      }
      expect($("header .senuke-utility-nav")).toHaveLength(0);
      expect($("footer").text()).toContain("Privacy Policy");
    }
  });

  it("does not assign button styling according to a header link's position in HTML or WordPress", () => {
    const theme = readFileSync(new URL("../../../wordpress-theme/senuke-theme/style.css", import.meta.url), "utf8");
    for (const css of [SENUKE_STATIC_CSS, theme]) {
      postcss.parse(css).walkRules(rule => {
        if (!/senuke-(?:header-navigation|primary-nav)/.test(rule.selector)) return;
        expect(rule.selector).not.toMatch(/:(?:last-child|last-of-type|nth-child|nth-last-child)/);
      });
    }
    // The release stylesheet resets older installed theme CTA styling for every
    // top-level WP menu link (including dropdown parents and the final blog link).
    const root = postcss.parse(SENUKE_STATIC_CSS);
    let reset: Record<string, string> = {};
    root.walkRules(rule => {
      if (rule.selector === ".senuke-site-header .senuke-primary-nav>.senuke-menu>li.menu-item>a") {
        rule.walkDecls(decl => { reset[decl.prop] = decl.value; });
      }
    });
    expect(reset).toMatchObject({ background: "transparent", "box-shadow": "none", "margin-left": "0", color: "var(--senuke-text)" });
  });
});
