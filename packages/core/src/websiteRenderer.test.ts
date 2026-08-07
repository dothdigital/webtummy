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

  it("renders a saved section alignment into publishable website HTML and CSS", () => {
    const aligned = {
      ...model.pages[0].sections[1],
      props: { ...model.pages[0].sections[1].props, alignment: "center", headingSize: "large", headingWeight: "black", headingColor: "primary" },
    } as WebsiteComponentInstance;
    expect(renderWebsiteComponentHtml(aligned)).toContain("senuke-align-center");
    expect(renderWebsiteComponentHtml(aligned)).toContain("senuke-heading-large senuke-heading-black senuke-heading-color-primary");
    const alignedModel: WebsiteModel = {
      ...model,
      pages: [{ ...model.pages[0], sections: [hero, aligned] }],
    };
    const css = String(createStaticWebsiteFiles(alignedModel).find((file) => file.path === "assets/senuke.css")?.content ?? "");
    expect(css).toContain(".senuke-align-center");
  });

  it("renders nested section columns, colours, and a saved background image for static and WordPress output", () => {
    const layout: WebsiteComponentInstance = {
      instanceId: "layout-1",
      componentId: "layout.section",
      componentVersion: "1.0.0",
      variant: "two_left_wide",
      props: {
        backgroundColor: "secondary",
        textColor: "white",
        backgroundImageAssetId: "section-background",
        backgroundOverlay: 60,
        spacing: "spacious",
        columnOne: [{
          instanceId: "nested-copy",
          componentId: "content.rich_text",
          componentVersion: "1.0.0",
          variant: "answer_first",
          props: { heading: "Nested decision support", body: "This content remains inside the first website column." },
        }],
        columnTwo: [{
          instanceId: "nested-image",
          componentId: "media.image",
          componentVersion: "1.0.0",
          variant: "card",
          props: { imageAssetId: "section-background", altText: "Advisor helping a customer" },
        }],
        columnThree: [],
      },
    };
    const html = renderWebsiteComponentHtml(layout, {
      mediaAssets: [{ assetId: "section-background", status: "approved", sourceUrl: "https://example.com/advisor.jpg", altText: "Advisor helping a customer" }],
    });
    expect(html).toContain("senuke-layout-two_left_wide");
    expect(html).toContain("senuke-layout-bg-secondary");
    expect(html).toContain("Nested decision support");
    expect(html.match(/https:\/\/example.com\/advisor.jpg/g)).toHaveLength(2);

    const layoutModel: WebsiteModel = {
      ...model,
      mediaAssets: [{ assetId: "section-background", status: "approved", sourceUrl: "https://example.com/advisor.jpg", altText: "Advisor helping a customer" }],
      pages: [{ ...model.pages[0], sections: [hero, layout] }],
    };
    const css = String(createStaticWebsiteFiles(layoutModel).find((file) => file.path === "assets/senuke.css")?.content ?? "");
    expect(css).toContain(".senuke-layout-two_left_wide");
    expect(css).toContain(".senuke-layout-background-image");
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

  it("merges duplicate legacy footer columns while preserving their links", () => {
    const secondPage = { ...model.pages[0], pageId: "page-2", name: "Critical Illness Insurance", slug: "/critical-illness/" };
    const legacyModel: WebsiteModel = {
      ...model,
      pages: [...model.pages, secondPage],
      navigationModel: {
        primaryMenu: model.navigation,
        utilityMenu: [],
        breadcrumbs: [],
        clusterNavigationBlocks: [],
        contextualNavRules: [],
        footerMenus: [
          { groupId: "services-one", label: "Services", items: [{ pageId: "page-1", label: "Services" }] },
          { groupId: "services-two", label: "Services", items: [{ pageId: "page-2", label: "Services" }] },
        ],
      },
    };
    const html = renderWebsitePageDocument(legacyModel, legacyModel.pages[0]);
    expect(html.match(/<h2>Services<\/h2>/g)).toHaveLength(1);
    expect(html).toContain(">Super Visa Insurance in Brampton</a>");
    expect(html).toContain(">Critical Illness Insurance</a>");
  });

  it("centres the first post-hero H2 even when the second fold is not rich text", () => {
    const secondFoldModel: WebsiteModel = {
      ...model,
      pages: [{
        ...model.pages[0],
        sections: [
          hero,
          {
            instanceId: "services-first-fold",
            componentId: "service.grid",
            componentVersion: "1.0.0",
            variant: "three_column",
            props: { heading: "Insurance options for your needs", introduction: "Review the available options.", items: [] },
          },
        ],
      }],
    };
    const files = createStaticWebsiteFiles(secondFoldModel);
    const html = String(files.find((file) => file.path.endsWith("index.html"))?.content ?? "");
    const css = String(files.find((file) => file.path === "assets/senuke.css")?.content ?? "");
    expect(html).toContain('class="senuke-component senuke-second-fold senuke-services');
    expect(css).toContain(".senuke-second-fold>h2");
    expect(css).toContain("text-align:center");
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
    const html = renderWebsiteComponentHtml(contactForm, {
      formAction: "https://app.example.com/api/public/website-forms/release-1/signed-token",
    });
    expect(html).toContain('data-senuke-form-id="primary-contact"');
    expect(html).toContain('action="https://app.example.com/api/public/website-forms/release-1/signed-token"');
    expect(html).toContain("data-senuke-managed-form");
    expect(html).toContain('name="_senuke_company_website"');
    expect(html).toContain('type="email"');
    expect(html).toContain("<textarea");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('type="submit"');
    expect(renderWebsiteComponentHtml(contactForm, { formShortcode: "[contact-form-7 id=\"12\"]" })).toContain("[contact-form-7");
  });

  it("adds a managed fallback form to a contact page even when no form component was registered", () => {
    const contactPage = {
      ...model.pages[0],
      pageId: "contact-page",
      name: "Contact Us",
      slug: "/contact-us/",
      pageType: "contact",
      sections: [hero],
      seo: { ...model.pages[0].seo, title: "Contact Us", canonicalUrl: "/contact-us/" },
    };
    const contactModel: WebsiteModel = {
      ...model,
      pages: [contactPage],
      navigation: [{ pageId: "contact-page", label: "Contact" }],
      forms: [{
        formId: "primary-contact",
        type: "lead",
        destination: "hello@example.com",
        fields: ["Name", "Email", "Phone", "Message", "Consent"],
      }],
    };
    const html = renderWebsitePageDocument(contactModel, contactPage, {
      formAction: "https://app.example.com/api/public/website-forms/release-1/signed-token",
    });
    expect(html).toContain('class="senuke-component senuke-contact-form"');
    expect(html).toContain('name="email"');
    expect(html).toContain('type="email"');
    expect(html).toContain("<textarea");
    expect(html).toContain('data-senuke-managed-form');
    expect(html).toContain('document.querySelectorAll("[data-senuke-managed-form]")');
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

  it("uses file-compatible relative links throughout the downloaded static website", () => {
    const homePage = {
      ...model.pages[0],
      pageId: "home-page",
      name: "Home",
      slug: "/",
      pageType: "home",
      seo: { ...model.pages[0].seo, title: "Home", canonicalUrl: "/" },
    };
    const nestedPage = {
      ...model.pages[0],
      pageId: "nested-page",
      name: "Insurance Services",
      slug: "/services/insurance/",
      pageType: "service",
      seo: { ...model.pages[0].seo, title: "Insurance Services", canonicalUrl: "/services/insurance/" },
    };
    const contactPage = {
      ...model.pages[0],
      pageId: "contact-page",
      name: "Contact Us",
      slug: "/contact-us/",
      pageType: "conversion",
      seo: { ...model.pages[0].seo, title: "Contact Us", canonicalUrl: "/contact-us/" },
    };
    const fileModel: WebsiteModel = {
      ...model,
      pages: [homePage, nestedPage, contactPage],
      navigation: [
        { pageId: "home-page", label: "Home" },
        { pageId: "nested-page", label: "Services" },
        { pageId: "contact-page", label: "Contact" },
      ],
    };

    const files = createStaticWebsiteFiles(fileModel, { approvedReleaseId: "release-file-preview" });
    const homeHtml = files.find((file) => file.path === "index.html")?.content || "";
    const nestedHtml = files.find((file) => file.path === "services/insurance/index.html")?.content || "";

    expect(homeHtml).toContain('href="index.html"');
    expect(homeHtml).toContain('href="services/insurance/index.html"');
    expect(homeHtml).toContain('href="contact-us/index.html"');
    expect(nestedHtml).toContain('href="../../index.html"');
    expect(nestedHtml).toContain('href="../../contact-us/index.html"');
    expect(nestedHtml).toContain('href="../../assets/senuke.css"');
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
