// Sitemap parsing. Handles <urlset> (page URLs) and <sitemapindex> (nested
// sitemaps). Uses cheerio in XML mode — no full XML lib needed for this shape.
import * as cheerio from "cheerio";

export interface SitemapEntry {
  url: string;
  lastmod: string | null;
}

export interface ParsedSitemap {
  /** Page URLs from a <urlset>. */
  entries: SitemapEntry[];
  /** Nested sitemap URLs from a <sitemapindex>. */
  childSitemaps: string[];
}

export function parseSitemap(xml: string): ParsedSitemap {
  const $ = cheerio.load(xml, { xmlMode: true });
  const entries: SitemapEntry[] = [];
  const childSitemaps: string[] = [];

  $("urlset > url").each((_, el) => {
    const loc = $(el).find("loc").first().text().trim();
    const lastmod = $(el).find("lastmod").first().text().trim() || null;
    if (loc) entries.push({ url: loc, lastmod });
  });

  $("sitemapindex > sitemap > loc").each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) childSitemaps.push(loc);
  });

  return { entries, childSitemaps };
}
