import { describe, expect, it } from "vitest";
import {
  createStaticWebsiteFiles,
  renderWebsiteComponentHtml,
  renderWebsitePageDocument,
} from "./websiteRenderer.js";
import {
  SENUKE_COMPONENT_REGISTRY_V1,
  type WebsiteComponentInstance,
  type WebsiteModel,
} from "./websiteModel.js";

const hero: WebsiteComponentInstance = {
  instanceId: "hero-1",
  componentId: "hero.local_service",
  componentVersion: "1.0.0",
  variant: "split",
  props: {
    headline: "Super Visa Insurance in Brampton",
    summary: "Compare coverage without unsupported claims.",
    primaryCtaLabel: "Request a Quote",
    primaryCtaUrl: "/contact/",
  },
};

const model: WebsiteModel = {
  modelId: "model-7",
  websiteId: "website-1",
  projectId: "project-1",
  version: 7,
  status: "validated",
  componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
  designSystem: {
    version: "1.0.0",
    colors: {
      primary: "#2563eb",
      secondary: "#0f766e",
      accent: "#f59e0b",
      background: "#f8fafc",
      surface: "#ffffff",
      text: "#0f172a",
      mutedText: "#475569",
    },
    typography: { headingFont: "Poppins", bodyFont: "Inter" },
    spacingScale: "comfortable",
    radiusScale: "medium",
  },
  pages: [{
    pageId: "page-1",
    name: "Super Visa Insurance in Brampton",
    slug: "/super-visa-insurance-brampton/",
    pageType: "local_service",
    primaryCta: { label: "Request a Quote", url: "/contact/" },
    sections: [
      hero,
      {
        instanceId: "content-1",
        componentId: "content.rich_text",
        componentVersion: "1.0.0",
        variant: "answer_first",
        props: { heading: "What to compare", body: "Review coverage.\n\n<script>alert('no')</script>" },
      },
    ],
    seo: {
      title: "Super Visa Insurance Brampton | Example",
      metaDescription: "Compare Super Visa insurance coverage in Brampton and understand the next step before requesting an appropriate quote.",
      canonicalUrl: "/super-visa-insurance-brampton/",
      robots: "index,follow",
      primaryKeyword: "super visa insurance Brampton",
      secondaryKeywords: [],
      dominantIntent: "local_commercial",
      internalLinks: [],
      faqs: [],
      schemaJsonLd: { "@context": "https://schema.org", "@type": "Service" },
      imageAltText: [],
    },
  }],
  navigation: [{ pageId: "page-1", label: "Super Visa Insurance" }],
  forms: [],
  mediaAssets: [],
};

describe("Approved Release website renderer", () => {
  it("renders only registered component data and escapes content", () => {
    const html = renderWebsiteComponentHtml(model.pages[0].sections[1]);
    expect(html).toContain("<h2>What to compare</h2>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("rejects unsupported components at the renderer boundary", () => {
    expect(() => renderWebsiteComponentHtml({ ...hero, componentId: "custom.javascript" })).toThrow("Unsupported website component");
  });

  it("renders metadata and schema from the exact model page", () => {
    const html = renderWebsitePageDocument(model, model.pages[0], { approvedReleaseId: "release-1" });
    expect(html).toContain("<title>Super Visa Insurance Brampton | Example</title>");
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain("All rights reserved.");
    expect(html).not.toContain("approved SENuke AI release");
  });

  it("renders the uploaded WordPress media URL inside the first-fold hero", () => {
    const heroWithImage: WebsiteComponentInstance = {
      ...hero,
      props: { ...hero.props, imageAssetId: "home-hero" },
    };
    const html = renderWebsiteComponentHtml(heroWithImage, {
      mediaAssets: [{ assetId: "home-hero", status: "approved", altText: "Team helping a customer", sourceUrl: "data:image/png;base64,ignored" }],
      assetUrls: { "home-hero": "https://wordpress.example/wp-content/uploads/home-hero.png" },
    });
    expect(html).toContain('class="senuke-hero-image"');
    expect(html).toContain('src="https://wordpress.example/wp-content/uploads/home-hero.png"');
    expect(html).toContain('alt="Team helping a customer"');
  });

  it("renders verified contact details and custom copyright in the global footer", () => {
    const withFooter: WebsiteModel = {
      ...model,
      identity: {
        businessName: "Example Insurance",
        contactPhone: "+1 905 555 0100",
        contactEmail: "hello@example.com",
        businessAddress: "Brampton, Ontario",
        copyrightText: "© 2026 Example Insurance. Coverage subject to policy terms.",
      },
    };
    const html = renderWebsitePageDocument(withFooter, withFooter.pages[0]);
    expect(html).toContain('href="tel:+19055550100"');
    expect(html).toContain('href="mailto:hello@example.com"');
    expect(html).toContain("Brampton, Ontario");
    expect(html).toContain("© 2026 Example Insurance. Coverage subject to policy terms.");
  });

  it("renders only confirmed social profiles as accessible global-footer icons", () => {
    const withSocialProfiles: WebsiteModel = {
      ...model,
      identity: {
        businessName: "Example Insurance",
        socialProfiles: [
          { network: "linkedin", url: "https://linkedin.com/company/example-insurance" },
          { network: "instagram", url: "" },
        ],
      },
    };
    const html = renderWebsitePageDocument(withSocialProfiles, withSocialProfiles.pages[0]);
    expect(html).toContain('class="senuke-social-links"');
    expect(html).toContain('href="https://linkedin.com/company/example-insurance"');
    expect(html).toContain('aria-label="LinkedIn"');
    expect(html).not.toContain('aria-label="Instagram"');
  });

  it("renders a usable registered contact form and WordPress form replacement", () => {
    const contactForm: WebsiteComponentInstance = {
      instanceId: "contact-form-1",
      componentId: "conversion.contact_form",
      componentVersion: "1.0.0",
      variant: "split",
      props: {
        heading: "Contact us",
        introduction: "Tell us what you need.",
        formId: "primary-contact",
        fields: [
          { label: "Name", name: "name", inputType: "text", required: true },
          { label: "Email", name: "email", inputType: "email", required: true },
          { label: "Message", name: "message", inputType: "textarea", required: true },
          { label: "I agree to be contacted.", name: "consent", inputType: "checkbox", required: true },
        ],
        submitLabel: "Send enquiry",
        successMessage: "Thank you. Your enquiry has been received.",
      },
    };
    const html = renderWebsiteComponentHtml(contactForm);
    expect(html).toContain('data-senuke-form-id="primary-contact"');
    expect(html).toContain('type="email"');
    expect(html).toContain("<textarea");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('type="submit"');
    expect(renderWebsiteComponentHtml(contactForm, { formShortcode: "[contact-form-7 id=\"12\"]" })).toContain("[contact-form-7");
  });

  it("routes the standard contact CTA to the generated Contact page slug", () => {
    const contactPage = {
      ...model.pages[0],
      pageId: "page-contact",
      name: "Contact Us",
      slug: "/contact-us/",
      pageType: "conversion",
      seo: { ...model.pages[0].seo, title: "Contact Us", canonicalUrl: "/contact-us/", primaryKeyword: "contact" },
    };
    const withContact = {
      ...model,
      pages: [model.pages[0], contactPage],
      navigation: [...model.navigation, { pageId: "page-contact", label: "Contact Us" }],
    };
    const html = renderWebsitePageDocument(withContact, withContact.pages[0]);
    expect(html).toContain('href="/contact-us/"');
    expect(html).not.toContain('href="/contact/"');
  });

  it("renders the approved business logo and saved navigation branches", () => {
    const brandedModel: WebsiteModel = {
      ...model,
      identity: { businessName: "Top Financial", logoAssetId: "brand-logo" },
      navigation: [
        { pageId: "custom-services", label: "Services", custom: true },
        { ...model.navigation[0], parentPageId: "custom-services" },
      ],
      mediaAssets: [{ assetId: "brand-logo", status: "approved", altText: "Top Financial logo", sourceUrl: "https://example.com/logo.svg" }],
    };
    const html = renderWebsitePageDocument(brandedModel, brandedModel.pages[0]);
    expect(html).toContain('class="senuke-brand-logo"');
    expect(html).toContain("https://example.com/logo.svg");
    expect(html).toContain("<span>Services</span>");
    expect(html).toContain("Super Visa Insurance");
  });

  it("renders an accessible responsive hamburger menu with the same navigation tree", () => {
    const html = renderWebsitePageDocument(model, model.pages[0]);
    expect(html).toContain('class="senuke-mobile-menu"');
    expect(html).toContain('aria-label="Open navigation menu"');
    expect(html).toContain('class="senuke-mobile-menu-panel"');
    expect(html.match(/Super Visa Insurance/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("creates a complete static website package file map", () => {
    const files = createStaticWebsiteFiles(model, { approvedReleaseId: "release-1", snapshotHash: "abc123" });
    expect(files.map((file) => file.path)).toEqual(expect.arrayContaining([
      "super-visa-insurance-brampton/index.html",
      "assets/senuke.css",
      "sitemap.xml",
      "robots.txt",
      "llms.txt",
      "senuke-release.json",
    ]));
    expect(files.find((file) => file.path === "senuke-release.json")?.content).toContain('"approvedReleaseId": "release-1"');
    expect(files.find((file) => file.path === "super-visa-insurance-brampton/index.html")?.content).toContain('href="../assets/senuke.css"');
    const css = files.find((file) => file.path === "assets/senuke.css")?.content || "";
    expect(css).toContain("@media(max-width:860px)");
    expect(css).toContain(".senuke-mobile-menu{display:block");
    expect(css).toContain(".senuke-header-navigation{display:none");
  });

  it("publishes the required root Home page as index.html", () => {
    const homeModel: WebsiteModel = {
      ...model,
      pages: [{
        ...model.pages[0],
        pageId: "home-page",
        name: "Home",
        slug: "/",
        pageType: "home",
        seo: { ...model.pages[0].seo, canonicalUrl: "/" },
      }],
      navigation: [{ pageId: "home-page", label: "Home" }],
    };
    const files = createStaticWebsiteFiles(homeModel, { approvedReleaseId: "release-home" });
    expect(files.some((file) => file.path === "index.html")).toBe(true);
    expect(files.find((file) => file.path === "sitemap.xml")?.content).toContain("<loc>/</loc>");
    expect(files.find((file) => file.path === "llms.txt")?.content).toContain("[Home](/)");
  });

  it("packages release-owned media and renders its approved asset reference", () => {
    const withMedia: WebsiteModel = {
      ...model,
      pages: [{
        ...model.pages[0],
        sections: [{ ...hero, props: { ...hero.props, imageAssetId: "hero-media-1" } }, ...model.pages[0].sections.slice(1)],
      }],
      mediaAssets: [{
        assetId: "hero-media-1",
        status: "approved",
        altText: "Family reviewing Super Visa insurance",
        sourceUrl: "data:image/png;base64,iVBORw0KGgo=",
      }],
    };
    const files = createStaticWebsiteFiles(withMedia, { approvedReleaseId: "release-2" });
    expect(files.find((file) => file.path === "assets/media/hero-media-1.png")?.base64).toBe(true);
    expect(files[0].content).toContain('src="../assets/media/hero-media-1.png"');
    expect(files[0].content).toContain('alt="Family reviewing Super Visa insurance"');
  });
});
