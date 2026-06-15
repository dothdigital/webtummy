// Aggregate dashboard data for the web overview page. Tenant-scoped.
import { Router } from "express";
import { prisma } from "@webtummy/db";
import { requireAuth, tenantScope } from "../middleware.js";

export const overviewRouter = Router();
overviewRouter.use(requireAuth);

overviewRouter.get("/overview", async (req, res) => {
  const scope = tenantScope(req);
  const isSuper = req.user!.role === "super_admin";
  const websiteWhere = scope.clientId ? { clientId: scope.clientId } : {};
  const crawlWhere = scope.clientId ? { website: { clientId: scope.clientId } } : {};

  const [clientCount, websiteCount, crawlCount, completedCrawls, recent, issuesBySeverity, issuesByCategory] =
    await Promise.all([
      isSuper ? prisma.client.count() : Promise.resolve(0),
      prisma.website.count({ where: websiteWhere }),
      prisma.crawlJob.count({ where: crawlWhere }),
      prisma.crawlJob.findMany({
        where: { ...crawlWhere, status: "completed", siteScore: { not: null } },
        select: { siteScore: true },
      }),
      prisma.crawlJob.findMany({
        where: crawlWhere,
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { website: { select: { domain: true } } },
      }),
      prisma.issue.groupBy({
        by: ["severity"],
        where: { crawlJob: crawlWhere },
        _count: true,
      }),
      prisma.issue.groupBy({
        by: ["category"],
        where: { crawlJob: crawlWhere },
        _count: true,
      }),
    ]);

  const avgScore =
    completedCrawls.length > 0
      ? Math.round(
          completedCrawls.reduce((s, c) => s + (c.siteScore ?? 0), 0) / completedCrawls.length,
        )
      : null;

  res.json({
    role: req.user!.role,
    counts: { clients: clientCount, websites: websiteCount, crawls: crawlCount, avgScore },
    recentCrawls: recent.map((c) => ({
      id: c.id,
      domain: c.website.domain,
      status: c.status,
      siteScore: c.siteScore,
      pagesCrawled: c.pagesCrawled,
      createdAt: c.createdAt,
    })),
    issuesBySeverity: issuesBySeverity.map((i) => ({ severity: i.severity, count: i._count })),
    issuesByCategory: issuesByCategory.map((i) => ({ category: i.category, count: i._count })),
    scoreTrend: recent
      .filter((c) => c.siteScore != null)
      .reverse()
      .map((c) => ({ label: c.website.domain, score: c.siteScore })),
  });
});
