// Website management — client_admin/client_user (scoped to their tenant) + super_admin.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { requireAuth, tenantScope } from "../middleware.js";

export const websitesRouter = Router();
websitesRouter.use(requireAuth);

const createSchema = z.object({
  domain: z.string().min(1),
  rootUrl: z.string().url(),
  targetCountry: z.string().optional(),
  targetCities: z.array(z.string()).default([]),
  // super_admin must pass clientId; client_* ignore it (forced from token).
  clientId: z.string().optional(),
});

websitesRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  const user = req.user!;
  const clientId = user.role === "super_admin" ? d.clientId : user.clientId;
  if (!clientId) return res.status(400).json({ error: "clientId required" });

  const website = await prisma.website.create({
    data: {
      clientId,
      domain: d.domain,
      rootUrl: d.rootUrl,
      targetCountry: d.targetCountry,
      targetCities: d.targetCities,
    },
  });
  res.status(201).json({ website });
});

websitesRouter.get("/", async (req, res) => {
  const scope = tenantScope(req);
  const websites = await prisma.website.findMany({
    where: scope.clientId ? { clientId: scope.clientId } : {},
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { crawlJobs: true } },
      crawlJobs: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          status: true,
          siteScore: true,
          pagesCrawled: true,
          createdAt: true,
          completedAt: true,
        },
      },
    },
  });
  res.json({ websites });
});

websitesRouter.get("/:id", async (req, res) => {
  const scope = tenantScope(req);
  const website = await prisma.website.findFirst({
    where: { id: req.params.id, ...(scope.clientId ? { clientId: scope.clientId } : {}) },
    include: {
      _count: { select: { crawlJobs: true } },
      crawlJobs: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          siteScore: true,
          pagesCrawled: true,
          errorCount: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          error: true,
        },
      },
    },
  });
  if (!website) {
    if (scope.clientId) {
      const exists = await prisma.website.findUnique({
        where: { id: req.params.id },
        select: { id: true, domain: true },
      });
      if (exists) {
        return res.status(403).json({
          error: "website belongs to another client",
          domain: exists.domain,
        });
      }
    }
    return res.status(404).json({ error: "website not found" });
  }
  res.json({ website });
});
