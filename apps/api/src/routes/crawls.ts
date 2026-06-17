// Crawl routes: start a crawl, poll status, read results — all tenant-scoped.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { requireAuth, tenantScope } from "../middleware.js";
import { config } from "../config.js";
import { crawlQueue } from "../queue.js";

export const crawlsRouter = Router();
crawlsRouter.use(requireAuth);

/** Ensure the given website is visible to the caller's tenant; returns it or null. */
async function getScopedWebsite(req: import("express").Request, websiteId: string) {
  const scope = tenantScope(req);
  return prisma.website.findFirst({
    where: { id: websiteId, ...(scope.clientId ? { clientId: scope.clientId } : {}) },
  });
}

/** Ensure a crawl job is visible to the caller's tenant. */
async function getScopedCrawl(req: import("express").Request, crawlId: string) {
  const scope = tenantScope(req);
  return prisma.crawlJob.findFirst({
    where: {
      id: crawlId,
      ...(scope.clientId ? { website: { clientId: scope.clientId } } : {}),
    },
    include: { website: { select: { id: true, domain: true, rootUrl: true } } },
  });
}

const startSchema = z.object({
  pageLimit: z.number().int().min(1).max(50000).optional(),
  maxDepth: z.number().int().min(0).max(50).optional(),
  includePatterns: z.array(z.string()).default([]),
  excludePatterns: z.array(z.string()).default([]),
  respectRobots: z.boolean().default(true),
});

const pageSpeedSchema = z.object({
  strategy: z.enum(["mobile", "desktop", "both"]).default("both"),
});

// POST /api/websites/:websiteId/crawls — start a crawl
crawlsRouter.post("/websites/:websiteId/crawls", async (req, res) => {
  const website = await getScopedWebsite(req, req.params.websiteId);
  if (!website) return res.status(404).json({ error: "website not found" });

  const parsed = startSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const o = parsed.data;
  const active = await prisma.crawlJob.findFirst({
    where: { websiteId: website.id, status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, pagesCrawled: true, createdAt: true, startedAt: true },
  });
  if (active) {
    return res.status(409).json({
      error: "crawl already running",
      message: "A crawl is already queued or running for this project. Wait for it to finish before starting another run.",
      crawlJob: active,
    });
  }

  const job = await prisma.crawlJob.create({
    data: {
      websiteId: website.id,
      pageLimit: o.pageLimit ?? config.defaultPageLimit,
      maxDepth: o.maxDepth ?? config.defaultMaxDepth,
      options: {
        includePatterns: o.includePatterns,
        excludePatterns: o.excludePatterns,
        respectRobots: o.respectRobots,
      },
    },
  });

  await crawlQueue.add("crawl:start", { crawlJobId: job.id }, { jobId: job.id });
  res.status(202).json({ crawlJob: job });
});

// GET /api/crawls/:id/status
crawlsRouter.get("/crawls/:id/status", async (req, res) => {
  const job = await getScopedCrawl(req, req.params.id);
  if (!job) return res.status(404).json({ error: "crawl not found" });
  const website = job.website ?? await getScopedWebsite(req, job.websiteId);
  res.json({
    id: job.id,
    status: job.status,
    pagesCrawled: job.pagesCrawled,
    errorCount: job.errorCount,
    siteScore: job.siteScore,
    website: website ? {
      id: website.id,
      domain: website.domain,
      rootUrl: website.rootUrl,
    } : null,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
  });
});

// GET /api/crawls/:id/summary
crawlsRouter.get("/crawls/:id/summary", async (req, res) => {
  const job = await getScopedCrawl(req, req.params.id);
  if (!job) return res.status(404).json({ error: "crawl not found" });

  const [pageCount, indexable, broken, issuesBySeverity, byType] = await Promise.all([
    prisma.page.count({ where: { crawlJobId: job.id } }),
    prisma.page.count({ where: { crawlJobId: job.id, statusCode: 200 } }),
    prisma.link.count({ where: { isBroken: true, sourcePage: { crawlJobId: job.id } } }),
    prisma.issue.groupBy({ by: ["severity"], where: { crawlJobId: job.id }, _count: true }),
    prisma.issue.groupBy({ by: ["issueType"], where: { crawlJobId: job.id }, _count: true }),
  ]);

  // Bucket issue types into the headline categories shown at the top of the grid.
  const count = (...types: string[]) =>
    byType.filter((t) => types.includes(t.issueType)).reduce((s, t) => s + t._count, 0);

  const breakdown = {
    brokenLinks: broken,
    titleIssues: count("missing_title", "short_title", "long_title", "duplicate_title"),
    descriptionIssues: count(
      "missing_meta_description", "short_meta_description", "long_meta_description", "duplicate_meta_description",
    ),
    h1Issues: count("missing_h1", "multiple_h1", "duplicate_h1"),
    contentIssues: count("low_word_count"),
    indexabilityIssues: count(
      "noindex", "client_error", "server_error", "non_self_canonical", "missing_canonical",
      "robots_txt_missing", "robots_txt_empty", "robots_txt_missing_sitemap",
      "sitemap_missing", "sitemap_empty_or_invalid", "sitemap_url_error", "sitemap_url_not_crawled",
    ),
    siteFileIssues: count(
      "robots_txt_missing", "robots_txt_empty", "robots_txt_missing_sitemap",
      "sitemap_missing", "sitemap_empty_or_invalid", "sitemap_url_error", "sitemap_url_not_crawled",
      "llms_txt_missing", "llms_txt_invalid",
    ),
  };

  res.json({
    siteScore: job.siteScore,
    status: job.status,
    pageCount,
    indexable,
    brokenLinks: broken,
    duplicateTitles: count("duplicate_title"),
    issuesBySeverity,
    breakdown,
  });
});

// GET /api/crawls/:id/pages?skip=&take=
crawlsRouter.get("/crawls/:id/pages", async (req, res) => {
  const job = await getScopedCrawl(req, req.params.id);
  if (!job) return res.status(404).json({ error: "crawl not found" });
  const skip = Math.max(0, parseInt(String(req.query.skip ?? "0"), 10));
  const take = Math.min(1000, Math.max(1, parseInt(String(req.query.take ?? "50"), 10)));

  const [pages, total] = await Promise.all([
    prisma.page.findMany({
      where: { crawlJobId: job.id },
      include: {
        seo: {
          select: {
            title: true,
            titleLength: true,
            metaDescription: true,
            metaDescLength: true,
            h1Text: true,
            h1Count: true,
            looksJsDependent: true,
          },
        },
        images: {
          select: { issueType: true },
          take: 1000,
        },
        assets: {
          select: {
            id: true,
            url: true,
            type: true,
            renderBlocking: true,
            statusCode: true,
            sizeBytes: true,
            responseTimeMs: true,
            issueType: true,
          },
          take: 1000,
        },
      },
      orderBy: { depth: "asc" },
      skip,
      take,
    }),
    prisma.page.count({ where: { crawlJobId: job.id } }),
  ]);
  res.json({
    total,
    skip,
    take,
    pages: pages.map((page) => ({
      ...page,
      crawlerPerformance: crawlerPerformance(page),
      images: undefined,
    })),
  });
});

// GET /api/crawls/:id/generated-sitemap.xml — generate an XML sitemap from crawled 200 pages
crawlsRouter.get("/crawls/:id/generated-sitemap.xml", async (req, res) => {
  const job = await getScopedCrawl(req, req.params.id);
  if (!job) return res.status(404).send("crawl not found");

  const pages = await prisma.page.findMany({
    where: { crawlJobId: job.id, statusCode: 200 },
    select: { finalUrl: true, url: true },
    orderBy: { depth: "asc" },
    take: 50000,
  });
  const urls = [...new Set(pages.map((page) => page.finalUrl || page.url))];
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`),
    '</urlset>',
  ].join("\n");
  res.type("application/xml").send(body);
});

// GET /api/crawls/:id/compare-previous — compare this crawl to the previous crawl for the same website
crawlsRouter.get("/crawls/:id/compare-previous", async (req, res) => {
  const job = await prisma.crawlJob.findFirst({
    where: { id: req.params.id, ...(tenantScope(req).clientId ? { website: { clientId: tenantScope(req).clientId } } : {}) },
    include: { website: true },
  });
  if (!job) return res.status(404).json({ error: "crawl not found" });

  const previous = await prisma.crawlJob.findFirst({
    where: {
      websiteId: job.websiteId,
      createdAt: { lt: job.createdAt },
      status: "completed",
    },
    orderBy: { createdAt: "desc" },
  });
  if (!previous) return res.json({ current: job.id, previous: null });

  const [currentPages, previousPages, currentIssues, previousIssues] = await Promise.all([
    prisma.page.findMany({ where: { crawlJobId: job.id }, select: { normalizedUrl: true, url: true, statusCode: true } }),
    prisma.page.findMany({ where: { crawlJobId: previous.id }, select: { normalizedUrl: true, url: true, statusCode: true } }),
    prisma.issue.findMany({ where: { crawlJobId: job.id }, select: { issueType: true, severity: true } }),
    prisma.issue.findMany({ where: { crawlJobId: previous.id }, select: { issueType: true, severity: true } }),
  ]);
  const prevByUrl = new Map(previousPages.map((page) => [page.normalizedUrl, page]));
  const curByUrl = new Map(currentPages.map((page) => [page.normalizedUrl, page]));
  const addedPages = currentPages.filter((page) => !prevByUrl.has(page.normalizedUrl)).map((page) => page.url).slice(0, 100);
  const removedPages = previousPages.filter((page) => !curByUrl.has(page.normalizedUrl)).map((page) => page.url).slice(0, 100);
  const statusChanged = currentPages
    .filter((page) => prevByUrl.has(page.normalizedUrl) && prevByUrl.get(page.normalizedUrl)?.statusCode !== page.statusCode)
    .map((page) => ({
      url: page.url,
      previousStatus: prevByUrl.get(page.normalizedUrl)?.statusCode ?? null,
      currentStatus: page.statusCode,
    }))
    .slice(0, 100);
  const countIssues = (items: typeof currentIssues) => items.reduce<Record<string, number>>((acc, issue) => {
    const key = `${issue.severity}:${issue.issueType}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  res.json({
    current: { id: job.id, siteScore: job.siteScore, pages: currentPages.length },
    previous: { id: previous.id, siteScore: previous.siteScore, pages: previousPages.length },
    delta: {
      score: (job.siteScore ?? 0) - (previous.siteScore ?? 0),
      pages: currentPages.length - previousPages.length,
      issues: currentIssues.length - previousIssues.length,
    },
    addedPages,
    removedPages,
    statusChanged,
    issueCounts: {
      current: countIssues(currentIssues),
      previous: countIssues(previousIssues),
    },
  });
});

// POST /api/crawls/:id/pages/:pageId/pagespeed — run PageSpeed on demand for one page
crawlsRouter.post("/crawls/:id/pages/:pageId/pagespeed", async (req, res) => {
  const job = await getScopedCrawl(req, req.params.id);
  if (!job) return res.status(404).json({ error: "crawl not found" });

  const page = await prisma.page.findFirst({
    where: { id: req.params.pageId, crawlJobId: job.id },
    select: { id: true, url: true, finalUrl: true },
  });
  if (!page) return res.status(404).json({ error: "page not found" });

  const parsed = pageSpeedSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const strategies = parsed.data.strategy === "both" ? ["mobile", "desktop"] as const : [parsed.data.strategy];
  const results = await Promise.all(strategies.map((strategy) => runPageSpeed(page.finalUrl || page.url, strategy)));

  res.json({
    page: { id: page.id, url: page.url },
    results: Object.fromEntries(results.map((result) => [result.strategy, result])),
  });
});

// GET /api/crawls/:id/health-report — summarized technical, AI, schema, FAQ, breadcrumb health
crawlsRouter.get("/crawls/:id/health-report", async (req, res) => {
  const job = await getScopedCrawl(req, req.params.id);
  if (!job) return res.status(404).json({ error: "crawl not found" });

  const weakAnchorTexts = ["", "click here", "read more", "learn more", "more", "view", "details", "here", "continue", "see more", "find out more"];
  const [pageCount, pagesForInternalLinks, issues, schemas, llms, robots, sitemaps, weakAnchorLinks, brokenInternalLinks] = await Promise.all([
    prisma.page.count({ where: { crawlJobId: job.id } }),
    prisma.page.findMany({
      where: { crawlJobId: job.id },
      select: {
        id: true,
        url: true,
        depth: true,
        internalLinkScore: true,
        isOrphan: true,
        brokenInternalLinkCount: true,
        weakAnchorCount: true,
        seo: { select: { title: true } },
      },
    }),
    prisma.issue.findMany({
      where: { crawlJobId: job.id },
      select: {
        issueType: true,
        category: true,
        severity: true,
        weightImpact: true,
        message: true,
        recommendation: true,
        page: { select: { url: true, seo: { select: { title: true } } } },
      },
    }),
    prisma.schema.findMany({
      where: { page: { crawlJobId: job.id } },
      select: {
        schemaType: true,
        validJson: true,
        issueType: true,
        page: { select: { url: true, seo: { select: { title: true } } } },
      },
    }),
    prisma.llmsFile.findFirst({ where: { crawlJobId: job.id }, orderBy: { id: "desc" } }),
    prisma.robotsFile.findFirst({ where: { crawlJobId: job.id }, orderBy: { id: "desc" } }),
    prisma.sitemap.findMany({ where: { crawlJobId: job.id }, select: { sitemapUrl: true, urlCount: true, statusCode: true } }),
    prisma.link.findMany({
      where: {
        isInternal: true,
        sourcePage: { crawlJobId: job.id },
        OR: [
          { anchorText: null },
          ...weakAnchorTexts.map((anchorText) => ({ anchorText })),
        ],
      },
      select: {
        targetUrl: true,
        anchorText: true,
        placement: true,
        sourcePage: { select: { url: true, seo: { select: { title: true } } } },
      },
      take: 100,
    }),
    prisma.link.findMany({
      where: { isInternal: true, isBroken: true, sourcePage: { crawlJobId: job.id } },
      select: {
        targetUrl: true,
        targetStatus: true,
        anchorText: true,
        sourcePage: { select: { url: true, seo: { select: { title: true } } } },
      },
      take: 100,
    }),
  ]);

  const issueCount = (predicate: (issue: (typeof issues)[number]) => boolean) => issues.filter(predicate).length;
  const technicalIssues = issues.filter((issue) => (
    issue.category === "indexability" ||
    issue.category === "links" ||
    issue.category === "performance"
  ));
  const severityCounts = {
    high: issueCount((issue) => issue.severity === "high"),
    medium: issueCount((issue) => issue.severity === "medium"),
    low: issueCount((issue) => issue.severity === "low"),
  };
  const technicalSeverityCounts = {
    high: technicalIssues.filter((issue) => issue.severity === "high").length,
    medium: technicalIssues.filter((issue) => issue.severity === "medium").length,
    low: technicalIssues.filter((issue) => issue.severity === "low").length,
  };
  const schemaTypes = schemas
    .map((schema) => schema.schemaType)
    .filter((schemaType): schemaType is string => Boolean(schemaType));
  const schemaTypeCounts = schemaTypes.reduce<Record<string, number>>((acc, type) => {
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});
  const hasSchema = (name: string) => schemaTypes.some((type) => type.toLowerCase() === name.toLowerCase());
  const hasSchemaIncludes = (name: string) => schemaTypes.some((type) => type.toLowerCase().includes(name.toLowerCase()));
  const invalidSchemaCount = schemas.filter((schema) => !schema.validJson).length;
  const sitemapUrlCount = sitemaps.reduce((sum, sitemap) => sum + sitemap.urlCount, 0);
  const healthySitemaps = sitemaps.filter((sitemap) => sitemap.statusCode === 200).length;
  const schemaDetails = Object.entries(
    schemas.reduce<Record<string, { url: string; title: string | null; valid: boolean; issueType: string | null }[]>>((acc, schema) => {
      const type = schema.schemaType || "Unknown";
      if (!acc[type]) acc[type] = [];
      if (acc[type].length < 50) {
        acc[type].push({
          url: schema.page.url,
          title: schema.page.seo?.title ?? null,
          valid: schema.validJson,
          issueType: schema.issueType ?? null,
        });
      }
      return acc;
    }, {}),
  ).reduce<Record<string, { url: string; title: string | null; valid: boolean; issueType: string | null }[]>>((acc, [type, rows]) => {
    acc[type] = rows;
    return acc;
  }, {});
  const pageSummary = (page: (typeof pagesForInternalLinks)[number]) => ({
    url: page.url,
    title: page.seo?.title ?? null,
    depth: page.depth,
    internalLinkScore: page.internalLinkScore,
    brokenInternalLinkCount: page.brokenInternalLinkCount,
    weakAnchorCount: page.weakAnchorCount,
  });
  const internalScores = pagesForInternalLinks
    .map((page) => page.internalLinkScore)
    .filter((score): score is number => score != null);
  const internalLinkingScore = internalScores.length > 0
    ? Math.round(internalScores.reduce((sum, score) => sum + score, 0) / internalScores.length)
    : null;
  const score = (base: number, deduction: number) => Math.max(0, Math.min(100, Math.round(base - deduction)));
  const technicalScore = score(
    100,
    technicalSeverityCounts.high * 10 + technicalSeverityCounts.medium * 4 + technicalSeverityCounts.low,
  );
  const schemaScore = score(100, invalidSchemaCount * 10 + (hasSchemaIncludes("Organization") ? 0 : 15) + (hasSchema("BreadcrumbList") ? 0 : 10));
  const aiScore = score(
    100,
    (llms?.statusCode === 200 ? 0 : 25) +
      issueCount((issue) => issue.category === "ai_readiness") * 10 +
      (hasSchemaIncludes("Organization") ? 0 : 10) +
      (sitemapUrlCount > 0 ? 0 : 10),
  );
  const overallScore = Math.round(((job.siteScore ?? technicalScore) + technicalScore + schemaScore + aiScore) / 4);

  res.json({
    overallScore,
    pageCount,
    severityCounts,
    technical: {
      score: technicalScore,
      issueCount: technicalIssues.length,
      brokenLinks: issueCount((issue) => issue.issueType.includes("broken")),
      indexabilityIssues: issueCount((issue) => issue.category === "indexability"),
    },
    internalLinking: {
      score: internalLinkingScore,
      orphanPages: pagesForInternalLinks.filter((page) => page.isOrphan).length,
      brokenInternalLinks: pagesForInternalLinks.reduce((sum, page) => sum + page.brokenInternalLinkCount, 0),
      weakAnchorText: pagesForInternalLinks.reduce((sum, page) => sum + page.weakAnchorCount, 0),
    },
    aiSearch: {
      score: aiScore,
      llmsTxtPresent: llms?.statusCode === 200,
      llmsTxtScore: llms?.sectionScore ?? null,
      sitemapUrls: sitemapUrlCount,
      organizationSchema: hasSchemaIncludes("Organization"),
    },
    schema: {
      score: schemaScore,
      total: schemas.length,
      invalid: invalidSchemaCount,
      types: schemaTypeCounts,
      hasOrganization: hasSchemaIncludes("Organization"),
      hasWebsite: hasSchema("WebSite"),
      hasBreadcrumb: hasSchema("BreadcrumbList"),
      hasFAQ: hasSchema("FAQPage"),
    },
    faq: {
      hasFAQSchema: hasSchema("FAQPage"),
      issue: hasSchema("FAQPage") ? null : "No FAQPage schema found in the crawl.",
    },
    breadcrumb: {
      hasBreadcrumbSchema: hasSchema("BreadcrumbList"),
      issue: hasSchema("BreadcrumbList") ? null : "No BreadcrumbList schema found in the crawl.",
    },
    siteFiles: {
      robotsStatus: robots?.statusCode ?? null,
      sitemapCount: sitemaps.length,
      healthySitemaps,
      sitemapUrls: sitemapUrlCount,
    },
    details: {
      technicalIssues: technicalIssues.slice(0, 100).map((issue) => ({
        issueType: issue.issueType,
        category: issue.category,
        severity: issue.severity,
        message: issue.message,
        recommendation: issue.recommendation,
        pageUrl: issue.page?.url ?? null,
        pageTitle: issue.page?.seo?.title ?? null,
      })),
      orphanPages: pagesForInternalLinks.filter((page) => page.isOrphan).slice(0, 100).map(pageSummary),
      weakAnchorLinks: weakAnchorLinks.map((link) => ({
        anchorText: link.anchorText,
        placement: link.placement,
        targetUrl: link.targetUrl,
        sourceUrl: link.sourcePage.url,
        sourceTitle: link.sourcePage.seo?.title ?? null,
      })),
      brokenInternalLinks: brokenInternalLinks.map((link) => ({
        anchorText: link.anchorText,
        targetUrl: link.targetUrl,
        targetStatus: link.targetStatus,
        sourceUrl: link.sourcePage.url,
        sourceTitle: link.sourcePage.seo?.title ?? null,
      })),
      schemas: schemaDetails,
      faqPages: schemaDetails.FAQPage ?? [],
      breadcrumbPages: schemaDetails.BreadcrumbList ?? [],
      siteFiles: {
        robots: robots ? { statusCode: robots.statusCode, sitemapRefs: robots.sitemapRefs } : null,
        sitemaps: sitemaps.map((sitemap) => ({
          url: sitemap.sitemapUrl,
          statusCode: sitemap.statusCode,
          urlCount: sitemap.urlCount,
        })),
        llms: llms ? { statusCode: llms.statusCode, sectionScore: llms.sectionScore } : null,
      },
    },
  });
});

// GET /api/crawls/:id/broken-links
crawlsRouter.get("/crawls/:id/broken-links", async (req, res) => {
  const job = await getScopedCrawl(req, req.params.id);
  if (!job) return res.status(404).json({ error: "crawl not found" });

  const links = await prisma.link.findMany({
    where: { isBroken: true, sourcePage: { crawlJobId: job.id } },
    select: {
      id: true,
      targetUrl: true,
      targetStatus: true,
      anchorText: true,
      sourcePage: {
        select: {
          url: true,
          seo: { select: { title: true } },
        },
      },
    },
    orderBy: [{ targetStatus: "desc" }, { targetUrl: "asc" }],
    take: 1000,
  });

  res.json({ links });
});

// POST /api/crawls/:id/broken-links/:linkId/recheck — live-check one target URL
crawlsRouter.post("/crawls/:id/broken-links/:linkId/recheck", async (req, res) => {
  const job = await getScopedCrawl(req, req.params.id);
  if (!job) return res.status(404).json({ error: "crawl not found" });

  const link = await prisma.link.findFirst({
    where: { id: req.params.linkId, sourcePage: { crawlJobId: job.id } },
    include: {
      sourcePage: {
        select: {
          url: true,
          seo: { select: { title: true } },
        },
      },
    },
  });
  if (!link) return res.status(404).json({ error: "broken link not found" });

  const status = await liveCheckStatus(link.targetUrl);
  const isBroken = status === 0 || status >= 400;
  const updated = await prisma.link.update({
    where: { id: link.id },
    data: { targetStatus: status, isBroken },
    select: {
      id: true,
      targetUrl: true,
      targetStatus: true,
      anchorText: true,
      sourcePage: {
        select: {
          url: true,
          seo: { select: { title: true } },
        },
      },
    },
  });

  if (!isBroken) {
    await prisma.issue.deleteMany({
      where: {
        crawlJobId: job.id,
        pageId: link.sourcePageId,
        issueType: "broken_internal_link",
        message: { contains: link.targetUrl },
      },
    });
  }

  res.json({ link: updated, checkedAt: new Date().toISOString() });
});

// GET /api/crawls/:id/issues?severity=high
crawlsRouter.get("/crawls/:id/issues", async (req, res) => {
  const job = await getScopedCrawl(req, req.params.id);
  if (!job) return res.status(404).json({ error: "crawl not found" });
  const severity = req.query.severity as "high" | "medium" | "low" | undefined;

  const issues = await prisma.issue.findMany({
    where: { crawlJobId: job.id, ...(severity ? { severity } : {}) },
    include: {
      page: {
        select: {
          url: true,
          seo: {
            select: {
              title: true,
              titleLength: true,
              metaDescription: true,
              metaDescLength: true,
              h1Text: true,
              h1Count: true,
            },
          },
        },
      },
    },
    orderBy: { severity: "asc" },
    take: 1000,
  });

  const needsDuplicateContext = issues.some((issue) => issue.issueType.startsWith("duplicate_"));
  if (!needsDuplicateContext) return res.json({ issues });

  const seos = await prisma.pageSeo.findMany({
    where: { page: { crawlJobId: job.id } },
    select: {
      pageId: true,
      title: true,
      metaDescription: true,
      h1Text: true,
      page: { select: { url: true } },
    },
  });

  const grouped = {
    duplicate_title: groupDuplicatePages(seos, (seo) => seo.title),
    duplicate_meta_description: groupDuplicatePages(seos, (seo) => seo.metaDescription),
    duplicate_h1: groupDuplicatePages(seos, (seo) => firstH1(seo.h1Text)),
  };

  const enriched = issues.map((issue) => {
    if (!issue.issueType.startsWith("duplicate_") || !issue.pageId) return issue;
    const pages = grouped[issue.issueType as keyof typeof grouped]?.get(issue.pageId) ?? [];
    return { ...issue, relatedPages: pages };
  });

  res.json({ issues: enriched });
});

async function liveCheckStatus(url: string): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; WebtummyBot/0.1; +https://webtummy.local)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
      },
    });
    await res.body?.cancel();
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timeout);
  }
}

async function runPageSpeed(url: string, strategy: "mobile" | "desktop") {
  const apiUrl = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  apiUrl.searchParams.set("url", url);
  apiUrl.searchParams.set("strategy", strategy);
  apiUrl.searchParams.set("category", "performance");
  apiUrl.searchParams.append("category", "accessibility");
  apiUrl.searchParams.append("category", "best-practices");
  apiUrl.searchParams.append("category", "seo");
  if (process.env.PAGESPEED_API_KEY) apiUrl.searchParams.set("key", process.env.PAGESPEED_API_KEY);

  try {
    const response = await fetch(apiUrl, { headers: { accept: "application/json" } });
    const payload = await response.json() as {
      lighthouseResult?: {
        categories?: Record<string, { score?: number }>;
        audits?: Record<string, { displayValue?: string; numericValue?: number }>;
      };
      error?: { message?: string };
    };
    if (!response.ok || !payload.lighthouseResult) {
      return { strategy, ok: false, error: payload.error?.message ?? `PageSpeed returned ${response.status}` };
    }
    const categories = payload.lighthouseResult.categories ?? {};
    const audits = payload.lighthouseResult.audits ?? {};
    const pct = (score?: number) => score == null ? null : Math.round(score * 100);
    const auditValue = (key: string) => audits[key]?.displayValue ?? null;
    return {
      strategy,
      ok: true,
      scores: {
        performance: pct(categories.performance?.score),
        accessibility: pct(categories.accessibility?.score),
        bestPractices: pct(categories["best-practices"]?.score),
        seo: pct(categories.seo?.score),
      },
      metrics: {
        firstContentfulPaint: auditValue("first-contentful-paint"),
        largestContentfulPaint: auditValue("largest-contentful-paint"),
        cumulativeLayoutShift: auditValue("cumulative-layout-shift"),
        totalBlockingTime: auditValue("total-blocking-time"),
        speedIndex: auditValue("speed-index"),
      },
    };
  } catch (err) {
    return {
      strategy,
      ok: false,
      error: err instanceof Error ? err.message : "PageSpeed check failed",
    };
  }
}

function crawlerPerformance(page: {
  responseTimeMs: number | null;
  wordCount: number | null;
  redirectChain: unknown;
  fetchError: string | null;
  seo: { looksJsDependent: boolean } | null;
  images: { issueType: string | null }[];
  assets: { type: string; renderBlocking: boolean; statusCode: number | null; sizeBytes: number | null; issueType: string | null }[];
}) {
  let score = 100;
  const issues: string[] = [];
  const responseTime = page.responseTimeMs ?? null;
  const redirectCount = Array.isArray(page.redirectChain) ? page.redirectChain.length : 0;
  const imageIssues = page.images.filter((image) => image.issueType).length;
  const cssAssets = page.assets.filter((asset) => asset.type === "css");
  const jsAssets = page.assets.filter((asset) => asset.type === "javascript");
  const imageAssets = page.assets.filter((asset) => asset.type === "image");
  const totalAssetBytes = page.assets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);
  const cssBytes = cssAssets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);
  const jsBytes = jsAssets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);
  const imageBytes = imageAssets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);
  const renderBlockingAssets = page.assets.filter((asset) => asset.renderBlocking).length;
  const unreachableAssets = page.assets.filter((asset) => asset.statusCode === 0 || (asset.statusCode ?? 0) >= 400).length;
  const largeAssets = page.assets.filter((asset) => /large_/.test(asset.issueType ?? "")).length;

  if (page.fetchError) {
    score -= 30;
    issues.push("Fetch error");
  }
  if (responseTime != null) {
    if (responseTime > 3000) {
      score -= 30;
      issues.push("Slow server response");
    } else if (responseTime > 1500) {
      score -= 18;
      issues.push("Moderate server response");
    } else if (responseTime > 800) {
      score -= 8;
      issues.push("Response can improve");
    }
  }
  if (redirectCount > 2) {
    score -= 15;
    issues.push("Long redirect chain");
  } else if (redirectCount > 0) {
    score -= 5;
    issues.push("Redirect present");
  }
  if (page.seo?.looksJsDependent) {
    score -= 20;
    issues.push("Likely JavaScript-dependent content");
  }
  if (totalAssetBytes > 3_000_000) {
    score -= 18;
    issues.push("Heavy page assets");
  } else if (totalAssetBytes > 1_500_000) {
    score -= 10;
    issues.push("Asset weight can improve");
  }
  if (jsBytes > 900_000 || jsAssets.length > 20) {
    score -= 12;
    issues.push("Heavy JavaScript");
  } else if (jsBytes > 400_000 || jsAssets.length > 10) {
    score -= 6;
    issues.push("JavaScript can improve");
  }
  if (cssBytes > 300_000 || cssAssets.length > 10) {
    score -= 8;
    issues.push("Heavy CSS");
  }
  if (imageBytes > 1_500_000 || largeAssets > 3) {
    score -= 12;
    issues.push("Large images");
  }
  if (renderBlockingAssets > 8) {
    score -= 10;
    issues.push("Many render-blocking assets");
  } else if (renderBlockingAssets > 3) {
    score -= 5;
    issues.push("Render-blocking assets");
  }
  if (unreachableAssets > 0) {
    score -= Math.min(15, unreachableAssets * 3);
    issues.push("Broken assets");
  }
  if (imageIssues > 10) {
    score -= 12;
    issues.push("Many image issues");
  } else if (imageIssues > 0) {
    score -= 5;
    issues.push("Image issues");
  }
  if ((page.wordCount ?? 0) > 0 && (page.wordCount ?? 0) < 150) {
    score -= 8;
    issues.push("Very thin visible HTML");
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: finalScore,
    grade: finalScore >= 85 ? "fast" : finalScore >= 65 ? "okay" : "slow",
    responseTimeMs: responseTime,
    redirectCount,
    imageIssues,
    assetCount: page.assets.length,
    cssCount: cssAssets.length,
    jsCount: jsAssets.length,
    imageAssetCount: imageAssets.length,
    totalAssetBytes,
    cssBytes,
    jsBytes,
    imageBytes,
    renderBlockingAssets,
    unreachableAssets,
    largeAssets,
    jsDependent: page.seo?.looksJsDependent ?? false,
    issues,
  };
}

function groupDuplicatePages<T extends { pageId: string; page: { url: string }; title: string | null }>(
  seos: T[],
  getValue: (seo: T) => string | null,
): Map<string, { url: string; title: string | null }[]> {
  const groups = new Map<string, T[]>();
  for (const seo of seos) {
    const value = getValue(seo)?.trim().toLowerCase();
    if (!value) continue;
    const existing = groups.get(value);
    if (existing) existing.push(seo);
    else groups.set(value, [seo]);
  }

  const byPageId = new Map<string, { url: string; title: string | null }[]>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const pages = group.map((seo) => ({ url: seo.page.url, title: seo.title }));
    for (const seo of group) byPageId.set(seo.pageId, pages);
  }
  return byPageId;
}

function firstH1(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  return typeof value[0] === "string" ? value[0] : null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
