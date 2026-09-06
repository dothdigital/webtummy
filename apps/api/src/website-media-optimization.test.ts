import { describe, expect, it } from "vitest";
import sharp from "sharp";
import type { WebsiteModel } from "@webtummy/core/website-model";
import { optimizeEmbeddedWebsiteMedia, optimizeWebsiteImage, websiteAssetRole } from "./website-media-optimization.js";

const model = (sourceUrl: string): WebsiteModel => ({
  modelId: "model-1",
  websiteId: "website-1",
  projectId: "project-1",
  version: 1,
  status: "validated",
  componentRegistryVersion: "1.0.0",
  designSystem: {
    version: "1.0.0",
    colors: { primary: "#000000", secondary: "#111111", accent: "#222222", background: "#ffffff", surface: "#ffffff", text: "#111111", mutedText: "#555555" },
    typography: { headingFont: "Inter", bodyFont: "Inter" },
    spacingScale: "comfortable",
    radiusScale: "medium",
  },
  pages: [{
    pageId: "home",
    name: "Home",
    slug: "/",
    pageType: "home",
    sections: [{ instanceId: "hero", componentId: "hero.local_service", componentVersion: "1.0.0", variant: "split", props: { headline: "Example", summary: "Example summary", primaryCtaLabel: "Contact", primaryCtaUrl: "/contact/", imageAssetId: "hero-image" } }],
    seo: { title: "Example", metaDescription: "Example description", canonicalUrl: "/", robots: "index, follow", primaryKeyword: "example", secondaryKeywords: [], dominantIntent: "commercial", internalLinks: [], faqs: [], schemaJsonLd: {}, imageAltText: [] },
  }],
  navigation: [{ pageId: "home", label: "Home" }],
  forms: [],
  mediaAssets: [{ assetId: "hero-image", status: "approved", altText: "Example hero", sourceUrl }],
});

describe("website publication image optimization", () => {
  it("resizes a large PNG hero and publishes WebP", async () => {
    const png = await sharp({ create: { width: 2400, height: 1600, channels: 4, background: { r: 20, g: 120, b: 220, alpha: 1 } } }).png().toBuffer();
    const optimized = await optimizeWebsiteImage(png, "image/png", "hero");
    expect(optimized.mimeType).toBe("image/webp");
    expect(optimized.extension).toBe("webp");
    expect(optimized.width).toBe(1600);
    expect(optimized.height).toBe(1067);
    expect(optimized.bytes.length).toBeLessThan(png.length);
  });

  it("rewrites embedded release media without changing the approved model object", async () => {
    const png = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: "#0f766e" } }).png().toBuffer();
    const original = model(`data:image/png;base64,${png.toString("base64")}`);
    const result = await optimizeEmbeddedWebsiteMedia(original);
    expect(result.model).not.toBe(original);
    expect(original.mediaAssets[0].sourceUrl).toMatch(/^data:image\/png/);
    expect(result.model.mediaAssets[0].sourceUrl).toMatch(/^data:image\/webp/);
    expect(result.optimizedCount).toBe(1);
    expect(result.publishedBytes).toBeLessThan(result.originalBytes);
    expect(websiteAssetRole(original, "hero-image")).toBe("hero");
  });

  it("does not fetch or rewrite externally hosted approved media", async () => {
    const original = model("https://cdn.example.com/hero.webp");
    const result = await optimizeEmbeddedWebsiteMedia(original);
    expect(result.model.mediaAssets[0].sourceUrl).toBe("https://cdn.example.com/hero.webp");
    expect(result.optimizedCount).toBe(0);
  });
});
