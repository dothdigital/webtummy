// HTML -> ParsedPage. Pure (no network). Cheerio-based static extraction.
import * as cheerio from "cheerio";
import { resolveUrl, normalizeForDedup, isSameHost } from "./url.js";
import type { ParsedPage, ExtractedLink, ExtractedImage, ExtractedSchema, ExtractedAsset } from "./types.js";

export function parseHtml(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);

  const title = $("head > title").first().text().trim() || null;
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() || null;

  const h1 = $("h1")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const h2 = $("h2")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  const canonicalRaw = $('link[rel="canonical"]').attr("href")?.trim();
  const canonicalUrl = canonicalRaw ? resolveUrl(pageUrl, canonicalRaw) : null;
  const ampRaw = $('link[rel="amphtml"]').attr("href")?.trim();
  const ampUrl = ampRaw ? resolveUrl(pageUrl, ampRaw) : null;

  const hreflangs = $('link[rel="alternate"][hreflang]')
    .map((_, el) => {
      const hrefRaw = $(el).attr("href")?.trim() || null;
      return {
        lang: $(el).attr("hreflang")?.trim() || null,
        href: hrefRaw ? resolveUrl(pageUrl, hrefRaw) : null,
      };
    })
    .get();

  const robotsMeta = $('meta[name="robots"]').attr("content")?.trim() || null;

  // Open Graph + Twitter
  const ogTags: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const p = $(el).attr("property");
    const c = $(el).attr("content");
    if (p && c) ogTags[p] = c;
  });
  const twitterTags: Record<string, string> = {};
  $('meta[name^="twitter:"]').each((_, el) => {
    const n = $(el).attr("name");
    const c = $(el).attr("content");
    if (n && c) twitterTags[n] = c;
  });

  // Links
  const links: ExtractedLink[] = [];
  const seenLinks = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = resolveUrl(pageUrl, href);
    if (!abs) return;
    const normalized = normalizeForDedup(abs);
    if (seenLinks.has(normalized)) return;
    seenLinks.add(normalized);
    links.push({
      url: abs,
      normalized,
      anchorText: $(el).text().trim().slice(0, 300),
      rel: $(el).attr("rel")?.trim() || null,
      isInternal: isSameHost(pageUrl, abs),
      placement: linkPlacement($, el),
    });
  });

  // Images
  const images: ExtractedImage[] = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    if (!src) return;
    const abs = resolveUrl(pageUrl, src);
    if (!abs) return;
    const w = parseInt($(el).attr("width") || "", 10);
    const h = parseInt($(el).attr("height") || "", 10);
    images.push({
      src: abs,
      alt: $(el).attr("alt") ?? null,
      width: Number.isFinite(w) ? w : null,
      height: Number.isFinite(h) ? h : null,
    });
  });

  const assets: ExtractedAsset[] = [];
  $('link[rel~="stylesheet"][href]').each((_, el) => {
    const href = $(el).attr("href");
    const abs = href ? resolveUrl(pageUrl, href) : null;
    if (!abs) return;
    assets.push({
      url: abs,
      type: "css",
      renderBlocking: !$(el).attr("media") || $(el).attr("media") === "all",
    });
  });
  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    const abs = src ? resolveUrl(pageUrl, src) : null;
    if (!abs) return;
    assets.push({
      url: abs,
      type: "javascript",
      renderBlocking: !$(el).attr("async") && !$(el).attr("defer") && $(el).parents("head").length > 0,
    });
  });

  // Structured data (JSON-LD; microdata/RDFa detection in Phase 2)
  const schemas: ExtractedSchema[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      const json = JSON.parse(raw);
      const nodes = Array.isArray(json) ? json : [json];
      for (const node of nodes) {
        schemas.push({
          format: "json-ld",
          schemaType: typeof node?.["@type"] === "string" ? node["@type"] : null,
          rawJson: node,
          validJson: true,
        });
      }
    } catch {
      schemas.push({ format: "json-ld", schemaType: null, rawJson: raw.slice(0, 2000), validJson: false });
    }
  });

  // Visible word count: drop script/style/noscript, collapse whitespace.
  const bodyClone = cheerio.load(html);
  bodyClone("script, style, noscript, template").remove();
  const visibleText = bodyClone("body").text().replace(/\s+/g, " ").trim();
  const wordCount = visibleText ? visibleText.split(" ").length : 0;
  const visibleTextHash = visibleText.length > 100 ? fnv1a64(visibleText.toLowerCase()) : null;

  // JS-dependence heuristic (see ARCHITECTURE.md §5).
  const hasAppRoot =
    $("#root").length > 0 || $("#app").length > 0 || $("[data-reactroot]").length > 0;
  const noscriptPrompt = /enable javascript/i.test($("noscript").text());
  const looksJsDependent = (wordCount < 50 && hasAppRoot) || noscriptPrompt;

  return {
    title,
    metaDescription,
    h1,
    h2,
    canonicalUrl,
    robotsMeta,
    hreflangs,
    ampUrl,
    ogTags,
    twitterTags,
    links,
    images,
    assets,
    schemas,
    wordCount,
    visibleTextHash,
    looksJsDependent,
  };
}

function linkPlacement($: cheerio.CheerioAPI, el: any): "header" | "footer" | "body" | "navigation" {
  const ancestors = $(el).parents().toArray();
  if (ancestors.some((node) => node.tagName?.toLowerCase() === "footer")) return "footer";
  if (ancestors.some((node) => node.tagName?.toLowerCase() === "header")) return "header";
  if (ancestors.some((node) => node.tagName?.toLowerCase() === "nav")) return "navigation";
  const classOrId = ancestors
    .map((node) => `${$(node).attr("id") || ""} ${$(node).attr("class") || ""}`)
    .join(" ")
    .toLowerCase();
  if (/(footer|site-footer)/.test(classOrId)) return "footer";
  if (/(header|site-header)/.test(classOrId)) return "header";
  if (/(nav|menu|navbar|navigation)/.test(classOrId)) return "navigation";
  return "body";
}

function fnv1a64(value: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return BigInt.asIntN(64, hash);
}
