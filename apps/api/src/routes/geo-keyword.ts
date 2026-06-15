import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { normalizeForDedup, scoreGeoKeywordPage } from "@webtummy/core";
import { requireAuth, tenantScope } from "../middleware.js";

export const geoKeywordRouter = Router();
geoKeywordRouter.use(requireAuth);

const createSchema = z.object({
  websiteId: z.string().min(1),
  targetKeyword: z.string().min(2),
  targetCity: z.string().optional().nullable(),
  secondaryKeywords: z.array(z.string()).default([]),
  targetUrl: z.string().url().optional().nullable(),
  maxPages: z.number().int().min(1).max(1000).default(500),
  useAi: z.boolean().default(false),
});

function firstString(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function scopedCampaign(req: Request, id: string) {
  const scope = tenantScope(req);
  return prisma.keywordAuditCampaign.findFirst({
    where: {
      id,
      website: scope.clientId ? { clientId: scope.clientId } : undefined,
    },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true } },
      pages: { orderBy: [{ isBestCandidate: "desc" }, { totalScore: "desc" }], take: 10 },
    },
  });
}

geoKeywordRouter.post("/geo-keyword-audits", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const input = parsed.data;
  const scope = tenantScope(req);

  const website = await prisma.website.findFirst({
    where: { id: input.websiteId, ...(scope.clientId ? { clientId: scope.clientId } : {}) },
  });
  if (!website) return res.status(404).json({ error: "website not found" });

  const crawl = await prisma.crawlJob.findFirst({
    where: { websiteId: website.id, status: "completed" },
    orderBy: { completedAt: "desc" },
  });
  if (!crawl) {
    return res.status(400).json({ error: "Run a completed crawl for this website before creating a Geo Keyword Intelligence audit." });
  }

  const campaign = await prisma.keywordAuditCampaign.create({
    data: {
      websiteId: website.id,
      crawlJobId: crawl.id,
      targetKeyword: input.targetKeyword,
      targetCity: input.targetCity || null,
      secondaryKeywords: input.secondaryKeywords,
      targetUrl: input.targetUrl || null,
      maxPages: input.maxPages,
      useAi: input.useAi,
      status: "running",
    },
  });

  const pages = await prisma.page.findMany({
    where: { crawlJobId: crawl.id, statusCode: { gte: 200, lt: 400 } },
    orderBy: [{ depth: "asc" }, { inlinkCount: "desc" }],
    take: input.maxPages,
    include: {
      seo: true,
      schemas: { select: { schemaType: true } },
      links: {
        where: { isInternal: true },
        select: { targetUrl: true, anchorText: true, placement: true },
        take: 80,
      },
    },
  });

  const targetNorm = input.targetUrl ? normalizeForDedup(input.targetUrl) : null;
  const scored = pages.map((page) => {
    const result = scoreGeoKeywordPage({
      url: page.url,
      title: page.seo?.title ?? null,
      metaDescription: page.seo?.metaDescription ?? null,
      h1: firstString(page.seo?.h1Text),
      h2: firstString(page.seo?.h2Json),
      wordCount: page.wordCount,
      schemaTypes: page.schemas.map((schema) => schema.schemaType).filter((type): type is string => Boolean(type)),
      internalLinks: page.links.map((link) => ({
        href: link.targetUrl,
        anchor: link.anchorText,
        placement: link.placement,
      })),
    }, input);
    return {
      page,
      result,
      isTargetUrl: targetNorm ? page.normalizedUrl === targetNorm : false,
    };
  }).sort((a, b) => b.result.total - a.result.total);

  const bestNormalized = scored[0]?.page.normalizedUrl ?? null;
  const strongPages = scored.filter((item) => item.result.total >= 80);
  const hasCannibalRisk = strongPages.length >= 2;

  await prisma.keywordAuditPage.createMany({
    data: scored.map((item) => ({
      campaignId: campaign.id,
      pageId: item.page.id,
      url: item.page.url,
      normalizedUrl: item.page.normalizedUrl,
      title: item.page.seo?.title ?? null,
      totalScore: item.result.total,
      intentMatch: item.result.intentMatch,
      isBestCandidate: item.page.normalizedUrl === bestNormalized,
      isTargetUrl: item.isTargetUrl,
      cannibalRisk: hasCannibalRisk && item.result.total >= 80 ? "high" : null,
      breakdownJson: item.result.breakdown as unknown as Prisma.InputJsonValue,
      missingJson: item.result.missing as unknown as Prisma.InputJsonValue,
      recommendationsJson: item.result.recommendations as unknown as Prisma.InputJsonValue,
    })),
  });

  const averageScore = scored.length
    ? Math.round(scored.reduce((sum, item) => sum + item.result.total, 0) / scored.length)
    : 0;
  const best = await prisma.keywordAuditPage.findFirst({
    where: { campaignId: campaign.id, isBestCandidate: true },
    select: { id: true },
  });

  const updated = await prisma.keywordAuditCampaign.update({
    where: { id: campaign.id },
    data: {
      status: "completed",
      averageScore,
      bestPageId: best?.id ?? null,
      weakPageCount: scored.filter((item) => item.result.total < 65).length,
      cannibalRiskCount: hasCannibalRisk ? strongPages.length : 0,
      completedAt: new Date(),
    },
  });

  res.status(201).json({ audit: updated });
});

geoKeywordRouter.get("/geo-keyword-audits", async (req, res) => {
  const scope = tenantScope(req);
  const audits = await prisma.keywordAuditCampaign.findMany({
    where: { website: scope.clientId ? { clientId: scope.clientId } : undefined },
    orderBy: { createdAt: "desc" },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true } },
      pages: { where: { isBestCandidate: true }, take: 1 },
    },
    take: 100,
  });
  res.json({ audits });
});

geoKeywordRouter.get("/geo-keyword-audits/:id", async (req, res) => {
  const campaign = await scopedCampaign(req, req.params.id);
  if (!campaign) return res.status(404).json({ error: "audit not found" });
  const [pageCount, topPages, weakPages, targetPage] = await Promise.all([
    prisma.keywordAuditPage.count({ where: { campaignId: campaign.id } }),
    prisma.keywordAuditPage.findMany({
      where: { campaignId: campaign.id },
      orderBy: [{ isBestCandidate: "desc" }, { totalScore: "desc" }],
      take: 8,
    }),
    prisma.keywordAuditPage.count({ where: { campaignId: campaign.id, totalScore: { lt: 65 } } }),
    prisma.keywordAuditPage.findFirst({ where: { campaignId: campaign.id, isTargetUrl: true } }),
  ]);
  res.json({ audit: { ...campaign, pageCount, topPages, weakPages, targetPage } });
});

geoKeywordRouter.get("/geo-keyword-audits/:id/pages", async (req, res) => {
  const campaign = await scopedCampaign(req, req.params.id);
  if (!campaign) return res.status(404).json({ error: "audit not found" });
  const pages = await prisma.keywordAuditPage.findMany({
    where: { campaignId: campaign.id },
    orderBy: [{ isBestCandidate: "desc" }, { totalScore: "desc" }],
    take: 500,
  });
  res.json({ pages });
});

geoKeywordRouter.get("/geo-keyword-audits/:id/pages/:pageId", async (req, res) => {
  const campaign = await scopedCampaign(req, req.params.id);
  if (!campaign) return res.status(404).json({ error: "audit not found" });
  const page = await prisma.keywordAuditPage.findFirst({
    where: { id: req.params.pageId, campaignId: campaign.id },
  });
  if (!page) return res.status(404).json({ error: "page not found" });
  res.json({ page });
});
