// CrawlRunner: executes one crawl job end to end.
// BFS frontier with bounded concurrency. Persists pages/issues as it goes, then
// runs post-crawl passes (inlinks, broken links, duplicates, sitemap diff, scoring).
//
// Phase 1 simplification: one worker owns one crawl; the frontier + visited set live
// in-process (not a shared Redis set). Distributing a single crawl across workers via
// a Redis frontier is a Phase 1.5 enhancement (see ARCHITECTURE.md §2).
import { prisma, CrawlStatus, Severity } from "@webtummy/db";
import {
  parseHtml,
  parseRobots,
  parseSitemap,
  isAllowed,
  normalizeForDedup,
  dedupKey,
  detectPageIssues,
  type CrawlOptions,
  type DetectedIssue,
  type ParsedRobots,
} from "@webtummy/core";
import { fetchUrl, checkStatus, checkAsset } from "./fetch.js";

interface FrontierItem {
  url: string;
  depth: number;
}

export async function runCrawl(crawlJobId: string, options: CrawlOptions): Promise<void> {
  const job = await prisma.crawlJob.findUnique({
    where: { id: crawlJobId },
    include: { website: true },
  });
  if (!job) throw new Error(`crawl job ${crawlJobId} not found`);

  await prisma.crawlJob.update({
    where: { id: crawlJobId },
    data: { status: CrawlStatus.running, startedAt: new Date() },
  });

  const rootUrl = job.website.rootUrl;
  const allIssues: DetectedIssue[] = [];
  const visited = new Set<string>();
  let errorCount = 0;

  try {
    // ── robots.txt ───────────────────────────────────────────────────────────
    const robots = await loadRobots(crawlJobId, rootUrl, options);

    // ── sitemaps ───────────────────────────────────────────────────────────────
    const sitemapSeeds = await loadSitemaps(crawlJobId, rootUrl, robots, options);

    // ── llms.txt ───────────────────────────────────────────────────────────────
    await loadLlmsTxt(crawlJobId, rootUrl, options);

    // ── frontier ────────────────────────────────────────────────────────────────
    const frontier: FrontierItem[] = [{ url: rootUrl, depth: 0 }];
    for (const u of sitemapSeeds) frontier.push({ url: u, depth: 1 });

    let pagesCrawled = 0;
    const concurrency = Math.max(1, options.fetchConcurrency);

    // Process the frontier in concurrency-bounded waves.
    while (frontier.length > 0 && pagesCrawled < options.maxPages) {
      const batch: FrontierItem[] = [];
      while (batch.length < concurrency && frontier.length > 0 && pagesCrawled + batch.length < options.maxPages) {
        const item = frontier.shift()!;
        const key = dedupKey(item.url);
        if (visited.has(key)) continue;
        if (!shouldCrawl(item.url, robots, options)) continue;
        visited.add(key);
        batch.push(item);
      }
      if (batch.length === 0) break;

      const results = await Promise.all(
        batch.map((item) => crawlOnePage(crawlJobId, item, rootUrl, options)),
      );
      pagesCrawled += batch.length;

      for (const r of results) {
        if (!r) {
          errorCount++;
          continue;
        }
        allIssues.push(...r.issues);
        // enqueue newly discovered internal links
        if (r.depth < options.maxDepth) {
          for (const link of r.internalLinks) {
            const key = dedupKey(link);
            if (!visited.has(key)) frontier.push({ url: link, depth: r.depth + 1 });
          }
        }
      }

      await prisma.crawlJob.update({
        where: { id: crawlJobId },
        data: { pagesCrawled, errorCount },
      });
    }

    // ── post-crawl passes ─────────────────────────────────────────────────────
    // Resolves broken links, detects duplicates, computes per-page + site scores.
    const siteScore = await postCrawl(crawlJobId, options);

    await prisma.crawlJob.update({
      where: { id: crawlJobId },
      data: {
        status: CrawlStatus.completed,
        completedAt: new Date(),
        pagesCrawled,
        errorCount,
        siteScore,
      },
    });
  } catch (err) {
    await prisma.crawlJob.update({
      where: { id: crawlJobId },
      data: {
        status: CrawlStatus.failed,
        completedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────────

function shouldCrawl(url: string, robots: ParsedRobots | null, opts: CrawlOptions): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  if (opts.respectRobots && robots && !isAllowed(robots, path)) return false;
  if (opts.excludePatterns.some((p) => safeTest(p, url))) return false;
  if (opts.includePatterns.length > 0 && !opts.includePatterns.some((p) => safeTest(p, url)))
    return false;
  return true;
}

function safeTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

async function loadRobots(
  crawlJobId: string,
  rootUrl: string,
  opts: CrawlOptions,
): Promise<ParsedRobots | null> {
  const robotsUrl = new URL("/robots.txt", rootUrl).toString();
  const res = await fetchUrl(robotsUrl, opts);
  const content = res.body ?? "";
  const parsed = res.statusCode === 200 && content ? parseRobots(content, opts.userAgent) : null;
  await prisma.robotsFile.create({
    data: {
      crawlJobId,
      content: content.slice(0, 60000),
      statusCode: res.statusCode,
      parsedRules: parsed ? { ruleCount: parsed.rules.length } : {},
      sitemapRefs: parsed?.sitemaps ?? [],
    },
  });
  if (res.statusCode !== 200) {
    await createSiteIssue(crawlJobId, {
      issueType: "robots_txt_missing",
      category: "indexability",
      severity: Severity.low,
      weightImpact: 1,
      message: `robots.txt was not found or could not be read (${res.statusCode || "no response"}).`,
      recommendation: "Publish /robots.txt and include Sitemap directives for the canonical XML sitemap.",
    });
  } else if (!content.trim()) {
    await createSiteIssue(crawlJobId, {
      issueType: "robots_txt_empty",
      category: "indexability",
      severity: Severity.low,
      weightImpact: 1,
      message: "robots.txt was found but is empty.",
      recommendation: "Add clear crawling rules and a Sitemap directive to robots.txt.",
    });
  } else if (!parsed?.sitemaps.length) {
    await createSiteIssue(crawlJobId, {
      issueType: "robots_txt_missing_sitemap",
      category: "indexability",
      severity: Severity.low,
      weightImpact: 1,
      message: "robots.txt does not reference a sitemap.",
      recommendation: "Add a Sitemap: https://example.com/sitemap.xml directive to robots.txt.",
    });
  }
  return parsed;
}

async function loadSitemaps(
  crawlJobId: string,
  rootUrl: string,
  robots: ParsedRobots | null,
  opts: CrawlOptions,
): Promise<string[]> {
  // Sitemap URLs from robots, else the conventional /sitemap.xml.
  const candidates = new Set<string>(robots?.sitemaps ?? []);
  if (candidates.size === 0) candidates.add(new URL("/sitemap.xml", rootUrl).toString());

  const seeds: string[] = [];
  let totalEntries = 0;
  for (const sitemapUrl of candidates) {
    const res = await fetchUrl(sitemapUrl, opts);
    if (res.statusCode !== 200 || !res.body) {
      await prisma.sitemap.create({
        data: { crawlJobId, sitemapUrl, statusCode: res.statusCode, urlCount: 0 },
      });
      await createSiteIssue(crawlJobId, {
        issueType: "sitemap_missing",
        category: "indexability",
        severity: Severity.medium,
        weightImpact: 3,
        message: `Sitemap could not be read: ${sitemapUrl} (${res.statusCode || "no response"}).`,
        recommendation: "Publish a valid XML sitemap and reference it from robots.txt.",
      });
      continue;
    }
    const parsed = parseSitemap(res.body);
    // One level of sitemapindex expansion.
    for (const child of parsed.childSitemaps.slice(0, 50)) {
      const childRes = await fetchUrl(child, opts);
      if (childRes.statusCode === 200 && childRes.body) {
        const childParsed = parseSitemap(childRes.body);
        await saveSitemap(crawlJobId, child, childRes.statusCode, childParsed.entries);
        totalEntries += childParsed.entries.length;
        for (const e of childParsed.entries) seeds.push(e.url);
      }
    }
    await saveSitemap(crawlJobId, sitemapUrl, res.statusCode, parsed.entries);
    totalEntries += parsed.entries.length;
    for (const e of parsed.entries) seeds.push(e.url);
  }
  if (totalEntries === 0) {
    await createSiteIssue(crawlJobId, {
      issueType: "sitemap_empty_or_invalid",
      category: "indexability",
      severity: Severity.medium,
      weightImpact: 3,
      message: "No crawlable URLs were found in the sitemap XML.",
      recommendation: "Ensure the sitemap is valid XML and contains <url><loc> entries for canonical pages.",
    });
  }
  return seeds;
}

async function loadLlmsTxt(crawlJobId: string, rootUrl: string, opts: CrawlOptions): Promise<void> {
  const llmsUrl = new URL("/llms.txt", rootUrl).toString();
  const res = await fetchUrl(llmsUrl, opts);
  const content = res.body ?? "";
  const validation = validateLlmsTxt(content);

  await prisma.llmsFile.create({
    data: {
      crawlJobId,
      content: content.slice(0, 60000),
      statusCode: res.statusCode,
      sectionScore: res.statusCode === 200 ? validation.score : 0,
    },
  });

  if (res.statusCode !== 200) {
    await createSiteIssue(crawlJobId, {
      issueType: "llms_txt_missing",
      category: "ai_readiness",
      severity: Severity.medium,
      weightImpact: 2,
      message: `llms.txt was not found at /llms.txt (${res.statusCode || "no response"}).`,
      recommendation: "Publish /llms.txt with a short site summary, key links, sitemap link, and contact or brand details.",
    });
    return;
  }

  if (!validation.valid) {
    await createSiteIssue(crawlJobId, {
      issueType: "llms_txt_invalid",
      category: "ai_readiness",
      severity: Severity.medium,
      weightImpact: 2,
      message: `llms.txt is present but incomplete: ${validation.missing.join(", ")}.`,
      recommendation: "Use markdown with one # title, at least one ## section, key page links, a sitemap link, and brand/contact information.",
    });
  }
}

function validateLlmsTxt(content: string): { valid: boolean; score: number; missing: string[] } {
  const text = content.trim();
  const checks = [
    { name: "H1 title", ok: /^#\s+\S+/m.test(text) },
    { name: "section headings", ok: /^##\s+\S+/m.test(text) },
    { name: "markdown links", ok: /\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(text) },
    { name: "sitemap link", ok: /sitemap/i.test(text) },
    { name: "brand or contact details", ok: /(contact|email|about|company|brand|phone)/i.test(text) },
  ];
  const passed = checks.filter((c) => c.ok).length;
  return {
    valid: passed === checks.length,
    score: Math.round((passed / checks.length) * 100),
    missing: checks.filter((c) => !c.ok).map((c) => c.name),
  };
}

async function saveSitemap(
  crawlJobId: string,
  sitemapUrl: string,
  statusCode: number,
  entries: { url: string; lastmod: string | null }[],
): Promise<void> {
  const sitemap = await prisma.sitemap.create({
    data: { crawlJobId, sitemapUrl, statusCode, urlCount: entries.length },
  });
  if (entries.length > 0) {
    await prisma.sitemapUrl.createMany({
      data: entries.slice(0, 5000).map((e) => ({
        sitemapId: sitemap.id,
        url: e.url.slice(0, 512),
        lastmod: e.lastmod,
      })),
    });
  }
}

interface PageResult {
  depth: number;
  internalLinks: string[];
  issues: DetectedIssue[];
}

async function crawlOnePage(
  crawlJobId: string,
  item: FrontierItem,
  rootUrl: string,
  opts: CrawlOptions,
): Promise<PageResult | null> {
  const normalized = normalizeForDedup(item.url);
  const res = await fetchUrl(item.url, opts);
  const parsed = res.body && isHtmlContent(res.contentType) ? parseHtml(res.body, res.finalUrl) : null;
  const issues = detectPageIssues(res, parsed, normalized);

  const page = await prisma.page.upsert({
    where: { crawlJobId_normalizedUrl: { crawlJobId, normalizedUrl: dedupKey(item.url) } },
    create: {
      crawlJobId,
      url: item.url,
      normalizedUrl: dedupKey(item.url),
      finalUrl: res.finalUrl,
      statusCode: res.statusCode,
      contentType: res.contentType,
      wordCount: parsed?.wordCount,
      depth: item.depth,
      responseTimeMs: res.responseTimeMs,
      redirectChain: res.redirectChain,
      outlinkCount: parsed?.links.length ?? 0,
      fetchError: res.error ?? null,
    },
    update: { statusCode: res.statusCode },
  });

  if (parsed) {
    await prisma.pageSeo.upsert({
      where: { pageId: page.id },
      create: {
        pageId: page.id,
        title: parsed.title?.slice(0, 512),
        titleLength: parsed.title?.length,
        metaDescription: parsed.metaDescription,
        metaDescLength: parsed.metaDescription?.length,
        h1Count: parsed.h1.length,
        h1Text: parsed.h1,
        h2Json: parsed.h2,
        canonicalUrl: parsed.canonicalUrl?.slice(0, 512),
        robotsMeta: parsed.robotsMeta,
        hreflangJson: parsed.hreflangs ?? [],
        ampUrl: parsed.ampUrl ? parsed.ampUrl.slice(0, 512) : null,
        looksJsDependent: parsed.looksJsDependent ?? false,
        ogTags: parsed.ogTags ?? {},
        twitterTags: parsed.twitterTags ?? {},
        contentSimhash: parsed.visibleTextHash,
      },
      update: {
        hreflangJson: parsed.hreflangs ?? [],
        ampUrl: parsed.ampUrl ? parsed.ampUrl.slice(0, 512) : null,
        looksJsDependent: parsed.looksJsDependent ?? false,
      },
    });

    if (parsed.links.length > 0) {
      await prisma.link.createMany({
        data: parsed.links.slice(0, 2000).map((l) => ({
          sourcePageId: page.id,
          targetUrl: l.url,
          targetUrlNormalized: l.normalized.slice(0, 512),
          anchorText: l.anchorText || null,
          isInternal: l.isInternal,
          placement: l.placement,
          rel: l.rel,
        })),
      });
    }
    if (parsed.images.length > 0) {
      await prisma.image.createMany({
        data: parsed.images.slice(0, 1000).map((img) => ({
          pageId: page.id,
          src: img.src,
          alt: img.alt,
          width: img.width,
          height: img.height,
          issueType: img.alt == null ? "missing_alt" : img.alt === "" ? "empty_alt" : null,
        })),
      });
    }
    const assetsToCheck = [
      ...parsed.assets.slice(0, 80),
      ...parsed.images.slice(0, 40).map((img) => ({
        url: img.src,
        type: "image" as const,
        renderBlocking: false,
      })),
    ];
    if (assetsToCheck.length > 0) {
      const checkedAssets = await Promise.all(assetsToCheck.map(async (asset) => {
        const result = await checkAsset(asset.url, opts);
        const issueType =
          result.statusCode >= 400 || result.statusCode === 0 ? "asset_unreachable" :
          result.sizeBytes != null && asset.type === "image" && result.sizeBytes > 500_000 ? "large_image" :
          result.sizeBytes != null && asset.type === "javascript" && result.sizeBytes > 350_000 ? "large_javascript" :
          result.sizeBytes != null && asset.type === "css" && result.sizeBytes > 150_000 ? "large_css" :
          asset.renderBlocking ? "render_blocking" :
          null;
        return {
          pageId: page.id,
          url: asset.url,
          type: asset.type,
          renderBlocking: asset.renderBlocking,
          statusCode: result.statusCode,
          sizeBytes: result.sizeBytes,
          responseTimeMs: result.responseTimeMs,
          issueType,
        };
      }));
      await prisma.pageAsset.createMany({ data: checkedAssets });
    }
    if (parsed.schemas.length > 0) {
      await prisma.schema.createMany({
        data: parsed.schemas.map((s) => ({
          pageId: page.id,
          format: s.format,
          schemaType: s.schemaType,
          rawJson: s.rawJson as object,
          validJson: s.validJson,
        })),
      });
    }
  }

  if (issues.length > 0) {
    await prisma.issue.createMany({
      data: issues.map((i) => ({
        crawlJobId,
        pageId: page.id,
        issueType: i.issueType,
        category: i.category,
        severity: i.severity as Severity,
        weightImpact: i.weightImpact,
        message: i.message,
        recommendation: i.recommendation,
      })),
    });
  }

  const internalLinks = parsed
    ? parsed.links.filter((l) => l.isInternal).map((l) => l.url)
    : [];
  return { depth: item.depth, internalLinks, issues };
}

function isHtmlContent(contentType: string | null): boolean {
  if (!contentType) return true;
  const ct = contentType.toLowerCase();
  return ct.includes("text/html") || ct.includes("application/xhtml+xml");
}

/**
 * Post-crawl graph passes. Returns the computed site score.
 *  1. inlink counts + orphan detection
 *  2. broken-link resolution + broken_internal_link issues
 *  3. duplicate title / meta / H1 / exact content detection
 *  4. per-page scores (100 - issue deductions) + site score (avg of page scores)
 */
async function postCrawl(crawlJobId: string, opts: CrawlOptions): Promise<number> {
  const pages = await prisma.page.findMany({
    where: { crawlJobId },
    select: { id: true, url: true, normalizedUrl: true, statusCode: true, depth: true },
  });
  const byNorm = new Map(pages.map((p) => [p.normalizedUrl, p]));

  const internalLinks = await prisma.link.findMany({
    where: { isInternal: true, sourcePage: { crawlJobId } },
    select: {
      id: true,
      sourcePageId: true,
      targetUrl: true,
      targetUrlNormalized: true,
      anchorText: true,
      placement: true,
    },
  });

  // 1. inlink counts + internal linking score
  const inlinkCounts = new Map<string, number>();
  const contextualInlinkCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();
  const weakAnchorCounts = new Map<string, number>();
  const bodyOutgoingCounts = new Map<string, number>();
  for (const l of internalLinks) {
    const target = byNorm.get(l.targetUrlNormalized);
    outgoingCounts.set(l.sourcePageId, (outgoingCounts.get(l.sourcePageId) ?? 0) + 1);
    if (l.placement === "body") bodyOutgoingCounts.set(l.sourcePageId, (bodyOutgoingCounts.get(l.sourcePageId) ?? 0) + 1);
    if (isWeakAnchor(l.anchorText)) weakAnchorCounts.set(l.sourcePageId, (weakAnchorCounts.get(l.sourcePageId) ?? 0) + 1);
    if (target) {
      inlinkCounts.set(target.id, (inlinkCounts.get(target.id) ?? 0) + 1);
      if (l.placement === "body") contextualInlinkCounts.set(target.id, (contextualInlinkCounts.get(target.id) ?? 0) + 1);
    }
  }

  // 2. broken links — resolve status, then create issues on the SOURCE page.
  const knownStatus = new Map<string, number>();
  for (const p of pages) if (p.statusCode != null) knownStatus.set(p.normalizedUrl, p.statusCode);
  const unresolved = internalLinks.filter((l) => !knownStatus.has(l.targetUrlNormalized));
  const distinctTargets = [...new Set(unresolved.map((l) => l.targetUrlNormalized))].slice(0, 300);
  for (const target of distinctTargets) {
    knownStatus.set(target, await checkStatus(target, opts));
  }

  const brokenIssues: {
    crawlJobId: string; pageId: string; issueType: string; category: string;
    severity: Severity; weightImpact: number; message: string; recommendation: string;
  }[] = [];
  for (const l of internalLinks) {
    const status = knownStatus.get(l.targetUrlNormalized);
    if (status == null) continue;
    const broken = status === 0 || status >= 400;
    await prisma.link.update({ where: { id: l.id }, data: { isBroken: broken, targetStatus: status } });
    if (broken) {
      brokenIssues.push({
        crawlJobId,
        pageId: l.sourcePageId,
        issueType: "broken_internal_link",
        category: "links",
        severity: Severity.high,
        weightImpact: 5,
        message: `Broken internal link → ${l.targetUrl} (${status || "no response"})`,
        recommendation: "Fix or remove the link, or restore/redirect the target URL.",
      });
    }
  }
  if (brokenIssues.length > 0) {
    await prisma.issue.createMany({ data: brokenIssues });
  }

  await scoreInternalLinks(crawlJobId, pages, internalLinks, {
    inlinkCounts,
    contextualInlinkCounts,
    outgoingCounts,
    bodyOutgoingCounts,
    weakAnchorCounts,
    knownStatus,
  });

  // 3. duplicate detection across the crawl (title / meta / H1)
  await detectDuplicates(crawlJobId);
  await detectExactDuplicateContent(crawlJobId);

  // 3a. sitemap coverage + status issues
  await auditSitemapUrls(crawlJobId, knownStatus, byNorm, opts);

  // 4. per-page scores + site score
  const issues = await prisma.issue.findMany({
    where: { crawlJobId },
    select: { pageId: true, weightImpact: true },
  });
  const deductionByPage = new Map<string, number>();
  for (const i of issues) {
    if (!i.pageId) continue;
    deductionByPage.set(i.pageId, (deductionByPage.get(i.pageId) ?? 0) + i.weightImpact);
  }
  let scoreSum = 0;
  for (const p of pages) {
    const score = Math.max(0, Math.round(100 - (deductionByPage.get(p.id) ?? 0)));
    scoreSum += score;
    await prisma.page.update({ where: { id: p.id }, data: { score } });
  }
  return pages.length > 0 ? Math.round(scoreSum / pages.length) : 0;
}

async function auditSitemapUrls(
  crawlJobId: string,
  knownStatus: Map<string, number>,
  byNorm: Map<string, { id: string; normalizedUrl: string; statusCode: number | null }>,
  opts: CrawlOptions,
): Promise<void> {
  const sitemapUrls = await prisma.sitemapUrl.findMany({
    where: { sitemap: { crawlJobId } },
    select: { id: true, url: true },
    take: 1000,
  });
  if (sitemapUrls.length === 0) return;

  const issues: {
    crawlJobId: string; issueType: string; category: string; severity: Severity;
    weightImpact: number; message: string; recommendation: string;
  }[] = [];

  const distinctMissing = [...new Set(
    sitemapUrls
      .map((u) => dedupKey(u.url))
      .filter((key) => !knownStatus.has(key))
  )].slice(0, 300);
  for (const key of distinctMissing) {
    knownStatus.set(key, await checkStatus(key, opts));
  }

  for (const entry of sitemapUrls) {
    const key = dedupKey(entry.url);
    const inCrawl = byNorm.has(key);
    const status = knownStatus.get(key) ?? null;
    await prisma.sitemapUrl.update({
      where: { id: entry.id },
      data: { inCrawl, statusCode: status },
    });

    if (status != null && (status === 0 || status >= 400)) {
      issues.push({
        crawlJobId,
        issueType: "sitemap_url_error",
        category: "indexability",
        severity: Severity.high,
        weightImpact: 4,
        message: `Sitemap URL is not reachable: ${entry.url} (${status || "no response"}).`,
        recommendation: "Remove broken URLs from the sitemap or restore/redirect them to live canonical pages.",
      });
    } else if (!inCrawl) {
      issues.push({
        crawlJobId,
        issueType: "sitemap_url_not_crawled",
        category: "indexability",
        severity: Severity.low,
        weightImpact: 1,
        message: `Sitemap URL was not reached during this crawl: ${entry.url}.`,
        recommendation: "Check crawl depth, page limit, robots rules, and internal links so sitemap URLs are discoverable.",
      });
    }
  }

  if (issues.length > 0) await prisma.issue.createMany({ data: issues.slice(0, 500) });
}

type InternalPage = { id: string; url: string; normalizedUrl: string; statusCode: number | null; depth: number };
type InternalLink = {
  id: string;
  sourcePageId: string;
  targetUrl: string;
  targetUrlNormalized: string;
  anchorText: string | null;
  placement: string;
};

async function scoreInternalLinks(
  crawlJobId: string,
  pages: InternalPage[],
  internalLinks: InternalLink[],
  metrics: {
    inlinkCounts: Map<string, number>;
    contextualInlinkCounts: Map<string, number>;
    outgoingCounts: Map<string, number>;
    bodyOutgoingCounts: Map<string, number>;
    weakAnchorCounts: Map<string, number>;
    knownStatus: Map<string, number>;
  },
): Promise<void> {
  const linksBySource = new Map<string, InternalLink[]>();
  for (const link of internalLinks) {
    const links = linksBySource.get(link.sourcePageId);
    if (links) links.push(link);
    else linksBySource.set(link.sourcePageId, [link]);
  }
  const byNorm = new Map(pages.map((page) => [page.normalizedUrl, page]));
  const issues: {
    crawlJobId: string; pageId: string; issueType: string; category: string;
    severity: Severity; weightImpact: number; message: string; recommendation: string;
  }[] = [];

  for (const page of pages) {
    const incoming = metrics.inlinkCounts.get(page.id) ?? 0;
    const contextualIncoming = metrics.contextualInlinkCounts.get(page.id) ?? 0;
    const outgoing = metrics.outgoingCounts.get(page.id) ?? 0;
    const bodyOutgoing = metrics.bodyOutgoingCounts.get(page.id) ?? 0;
    const weakAnchors = metrics.weakAnchorCounts.get(page.id) ?? 0;
    const sourceLinks = linksBySource.get(page.id) ?? [];
    const brokenInternal = sourceLinks.filter((link) => {
      const status = metrics.knownStatus.get(link.targetUrlNormalized);
      return status === 0 || (status != null && status >= 400);
    }).length;
    const cluster = serviceClusterStatus(page, sourceLinks, pages, byNorm);
    const score = internalLinkScore({
      incoming,
      outgoing,
      depth: page.depth,
      weakAnchors,
      brokenInternal,
      bodyOutgoing,
      clusterOk: cluster.ok,
    });

    await prisma.page.update({
      where: { id: page.id },
      data: {
        inlinkCount: incoming,
        outgoingInternalLinkCount: outgoing,
        brokenInternalLinkCount: brokenInternal,
        weakAnchorCount: weakAnchors,
        internalLinkScore: score,
        internalLinkGrade: internalLinkGrade(score),
        isOrphan: incoming === 0,
      },
    });

    if (incoming === 0) {
      issues.push(linkIssue(crawlJobId, page.id, "orphan_page", Severity.high, 6, "Page has 0 incoming internal links.", "Add contextual links from relevant parent pages, service pages, or blog posts."));
    } else if (incoming <= 2) {
      issues.push(linkIssue(crawlJobId, page.id, "weak_incoming_internal_links", Severity.medium, 3, `Page has only ${incoming} incoming internal link(s).`, "Add more contextual links from related pages."));
    }
    if (outgoing === 0) {
      issues.push(linkIssue(crawlJobId, page.id, "no_outgoing_internal_links", Severity.medium, 3, "Page has no outgoing internal links.", "Add links to related services, case studies, contact, and relevant supporting pages."));
    }
    if (outgoing > 80) {
      issues.push(linkIssue(crawlJobId, page.id, "too_many_internal_links", Severity.low, 2, `Page has ${outgoing} outgoing internal links.`, "Review navigation/link blocks and keep the most relevant contextual links."));
    }
    if (outgoing > 0 && bodyOutgoing === 0) {
      issues.push(linkIssue(crawlJobId, page.id, "no_contextual_internal_links", Severity.medium, 3, "Internal links are only in header, footer, or navigation.", "Add body/contextual links inside the main content."));
    }
    if (weakAnchors > 0) {
      issues.push(linkIssue(crawlJobId, page.id, "weak_anchor_text", Severity.low, Math.min(3, weakAnchors), `${weakAnchors} internal link(s) use weak anchor text.`, "Replace anchors like “Read more” or “Learn more” with descriptive service or topic names."));
    }
    if (page.depth >= 4) {
      issues.push(linkIssue(crawlJobId, page.id, "deep_click_depth", Severity.medium, 3, `Page is ${page.depth} clicks from the homepage.`, "Link this page from higher-level service, location, or hub pages."));
    }
    for (const missing of cluster.missing) {
      issues.push(linkIssue(crawlJobId, page.id, missing.type, Severity.medium, 3, missing.message, missing.recommendation));
    }
  }

  if (issues.length > 0) await prisma.issue.createMany({ data: issues.slice(0, 1000) });
}

function internalLinkScore(input: {
  incoming: number;
  outgoing: number;
  depth: number;
  weakAnchors: number;
  brokenInternal: number;
  bodyOutgoing: number;
  clusterOk: boolean;
}): number {
  const incomingPoints = input.incoming === 0 ? 0 : input.incoming <= 2 ? 10 : input.incoming <= 5 ? 20 : 25;
  const outgoingPoints = input.outgoing === 0 ? 0 : input.outgoing > 80 ? 7 : input.bodyOutgoing === 0 ? 8 : 15;
  const depthPoints = input.incoming === 0 ? 0 : input.depth <= 1 ? 20 : input.depth === 2 ? 16 : input.depth === 3 ? 12 : 5;
  const anchorPoints = input.weakAnchors === 0 ? 15 : input.weakAnchors <= 2 ? 10 : input.weakAnchors <= 5 ? 6 : 0;
  const clusterPoints = input.clusterOk ? 15 : 5;
  const brokenPoints = input.brokenInternal === 0 ? 10 : Math.max(0, 10 - input.brokenInternal * 4);
  return Math.max(0, Math.min(100, incomingPoints + outgoingPoints + depthPoints + anchorPoints + clusterPoints + brokenPoints));
}

function internalLinkGrade(score: number): string {
  if (score >= 85) return "strong";
  if (score >= 70) return "good";
  if (score >= 50) return "weak";
  return "critical";
}

function isWeakAnchor(anchor: string | null): boolean {
  const value = (anchor || "").trim().toLowerCase();
  return !value || /^(click here|read more|learn more|more|view|details|here|continue|see more|find out more)$/i.test(value);
}

function linkIssue(
  crawlJobId: string,
  pageId: string,
  issueType: string,
  severity: Severity,
  weightImpact: number,
  message: string,
  recommendation: string,
) {
  return { crawlJobId, pageId, issueType, category: "links", severity, weightImpact, message, recommendation };
}

function serviceClusterStatus(
  page: InternalPage,
  links: InternalLink[],
  pages: InternalPage[],
  byNorm: Map<string, InternalPage>,
): { ok: boolean; missing: { type: string; message: string; recommendation: string }[] } {
  const slug = urlSlug(page.url);
  const linkedSlugs = new Set(links.map((link) => urlSlug(link.targetUrl)).filter(Boolean));
  const missing: { type: string; message: string; recommendation: string }[] = [];
  const parent = parentServiceSlug(slug);

  if (parent && byNormHasSlug(byNorm, parent) && !linkedSlugs.has(parent)) {
    missing.push({
      type: "missing_parent_service_link",
      message: `Local/service page does not link back to parent page /${parent}.`,
      recommendation: `Add a contextual link to /${parent} using descriptive parent-service anchor text.`,
    });
  }

  const childPages = pages.filter((candidate) => {
    const childSlug = urlSlug(candidate.url);
    return childSlug !== slug && childSlug.startsWith(`${slug}-`) && hasLocalModifier(childSlug.slice(slug.length + 1));
  });
  const missingChildren = childPages.filter((child) => !linkedSlugs.has(urlSlug(child.url))).slice(0, 5);
  if (missingChildren.length > 0) {
    missing.push({
      type: "missing_child_city_links",
      message: `Parent/service page is missing links to ${missingChildren.length} related city page(s).`,
      recommendation: "Add contextual links from parent service pages to relevant city/service landing pages.",
    });
  }

  if (isServiceLikeSlug(slug)) {
    const related = ["crm-automation", "ai-workflow-automation", "business-central", "mobile-app-development", "website-design", "web-design", "ecommerce-development", "case-studies", "contact"];
    const missingRelated = related.filter((term) => pages.some((p) => urlSlug(p.url).includes(term)) && ![...linkedSlugs].some((linked) => linked.includes(term))).slice(0, 4);
    if (missingRelated.length > 0) {
      missing.push({
        type: "missing_related_service_links",
        message: `Service page is missing related links: ${missingRelated.join(", ")}.`,
        recommendation: "Add a related-services block with links to CRM, AI automation, Business Central, case studies, and contact where relevant.",
      });
    }
  }

  return { ok: missing.length === 0, missing };
}

function urlSlug(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/+|\/+$/g, "").split("/").pop() || "";
  } catch {
    return "";
  }
}

function parentServiceSlug(slug: string): string | null {
  const parts = slug.split("-");
  if (parts.length < 3) return null;
  if (!hasLocalModifier(parts[parts.length - 1])) return null;
  return parts.slice(0, -1).join("-");
}

function hasLocalModifier(value: string): boolean {
  return /^(toronto|mississauga|brampton|vaughan|markham|oakville|burlington|hamilton|scarborough|etobicoke|ontario|canada)$/i.test(value);
}

function isServiceLikeSlug(slug: string): boolean {
  return /(service|services|software|crm|automation|ai|workflow|business-central|mobile-app|website|web-design|development|ecommerce)/i.test(slug);
}

function byNormHasSlug(byNorm: Map<string, InternalPage>, slug: string): boolean {
  for (const page of byNorm.values()) {
    if (urlSlug(page.url) === slug) return true;
  }
  return false;
}

async function createSiteIssue(
  crawlJobId: string,
  issue: {
    issueType: string;
    category: string;
    severity: Severity;
    weightImpact: number;
    message: string;
    recommendation: string;
  },
): Promise<void> {
  await prisma.issue.create({
    data: { crawlJobId, ...issue },
  });
}

/** Find pages sharing a title / meta description / H1 and raise duplicate issues. */
async function detectDuplicates(crawlJobId: string): Promise<void> {
  const seos = await prisma.pageSeo.findMany({
    where: { page: { crawlJobId } },
    select: { pageId: true, title: true, metaDescription: true, h1Text: true },
  });

  const groupBy = (key: (s: (typeof seos)[number]) => string | null) => {
    const groups = new Map<string, string[]>();
    for (const s of seos) {
      const raw = key(s);
      if (!raw) continue;
      const norm = raw.trim().toLowerCase();
      if (!norm) continue;
      (groups.get(norm) ?? groups.set(norm, []).get(norm)!).push(s.pageId);
    }
    return [...groups.values()].filter((ids) => ids.length > 1);
  };

  const firstH1 = (s: (typeof seos)[number]) => {
    const arr = Array.isArray(s.h1Text) ? (s.h1Text as string[]) : [];
    return arr[0] ?? null;
  };

  const mk = (
    pageId: string, issueType: string, weightImpact: number, message: string, recommendation: string,
  ) => ({
    crawlJobId, pageId, issueType, category: "onpage", severity: Severity.medium,
    weightImpact, message, recommendation,
  });

  const data: ReturnType<typeof mk>[] = [];
  for (const ids of groupBy((s) => s.title))
    for (const id of ids)
      data.push(mk(id, "duplicate_title", 3, `Duplicate title shared by ${ids.length} pages.`, "Make each page title unique."));
  for (const ids of groupBy((s) => s.metaDescription))
    for (const id of ids)
      data.push(mk(id, "duplicate_meta_description", 2, `Duplicate meta description shared by ${ids.length} pages.`, "Write a unique description per page."));
  for (const ids of groupBy(firstH1))
    for (const id of ids)
      data.push(mk(id, "duplicate_h1", 2, `Duplicate H1 shared by ${ids.length} pages.`, "Give each page a unique H1."));

  if (data.length > 0) await prisma.issue.createMany({ data });
}

/** Find pages with identical visible body text hashes. */
async function detectExactDuplicateContent(crawlJobId: string): Promise<void> {
  const seos = await prisma.pageSeo.findMany({
    where: { page: { crawlJobId }, contentSimhash: { not: null } },
    select: { pageId: true, contentSimhash: true },
  });

  const groups = new Map<string, string[]>();
  for (const seo of seos) {
    if (seo.contentSimhash == null) continue;
    const key = seo.contentSimhash.toString();
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(seo.pageId);
  }

  const data: {
    crawlJobId: string; pageId: string; issueType: string; category: string;
    severity: Severity; weightImpact: number; message: string; recommendation: string;
  }[] = [];

  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    for (const pageId of ids) {
      data.push({
        crawlJobId,
        pageId,
        issueType: "exact_duplicate_content",
        category: "onpage",
        severity: Severity.medium,
        weightImpact: 4,
        message: `Exact duplicate content shared by ${ids.length} pages.`,
        recommendation: "Canonicalize, consolidate, rewrite, or noindex duplicate pages so only the preferred URL is indexed.",
      });
    }
  }

  if (data.length > 0) await prisma.issue.createMany({ data });
}
