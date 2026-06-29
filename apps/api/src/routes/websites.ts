// Website management — client_admin/client_user (scoped to their tenant) + super_admin.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";

export const websitesRouter = Router();
websitesRouter.use(requireAuth);

const WEBSITE_REPLACEMENT_DAYS = 90;

const localBusinessProfileSchema = z.object({
  businessName: z.string().min(2).max(180),
  phone: z.string().min(4).max(80),
  address: z.string().min(3).max(255),
  city: z.string().min(2).max(120),
  region: z.string().max(120).optional().nullable(),
  country: z.string().min(2).max(120).default("United States"),
  postalCode: z.string().max(40).optional().nullable(),
  mainCategory: z.string().min(2).max(160),
  services: z.array(z.string().max(120)).default([]),
  targetLocations: z.array(z.string().max(120)).default([]),
  googleBusinessProfileUrl: z.string().max(512).optional().nullable(),
});

const createSchema = z.object({
  domain: z.string().min(1),
  rootUrl: z.string().optional(),
  targetCountry: z.string().optional(),
  targetCities: z.array(z.string()).default([]),
  replaceWebsiteId: z.string().optional(),
  localBusinessProfile: localBusinessProfileSchema.optional(),
  // super_admin must pass clientId; client_* ignore it (forced from token).
  clientId: z.string().optional(),
});

function normalizeProjectUrl(input: string): { domain: string; rootUrl: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const domain = url.hostname.toLowerCase();
    if (!domain) return null;
    return { domain, rootUrl: `${url.protocol}//${domain}` };
  } catch {
    return null;
  }
}

function cleanText(value: string): string {
  return value.trim().replace(/,+$/g, "").trim();
}

function normalizeDisplayPhone(value: string): string {
  const digits = value.replace(/\D+/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalized.length === 10) return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
  return cleanText(value);
}

function profileData(input: z.infer<typeof localBusinessProfileSchema>, clientId: string, websiteId: string, domain: string) {
  return {
    clientId,
    websiteId,
    businessName: cleanText(input.businessName),
    domain,
    phone: normalizeDisplayPhone(input.phone),
    address: cleanText(input.address),
    city: cleanText(input.city),
    region: input.region ? cleanText(input.region) : null,
    country: cleanText(input.country),
    postalCode: input.postalCode ? cleanText(input.postalCode) : null,
    mainCategory: cleanText(input.mainCategory),
    services: input.services.map(cleanText).filter(Boolean),
    targetLocations: input.targetLocations.map(cleanText).filter(Boolean),
    googleBusinessProfileUrl: input.googleBusinessProfileUrl ?? null,
  };
}

const localProfileInclude = {
  orderBy: { updatedAt: "desc" as const },
  take: 1,
  include: {
    scores: { orderBy: { scoreDate: "desc" as const }, take: 1 },
    _count: { select: { keywords: true, recommendations: true } },
  },
};

websitesRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  const clientId = await projectClientIdForRequest(req, d.clientId);
  if (!clientId) return res.status(400).json({ error: "project context required" });
  const normalized = normalizeProjectUrl(d.rootUrl || d.domain);
  if (!normalized) return res.status(400).json({ error: "Enter a valid project domain or URL" });

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, activeWebsiteLimit: true, extraWebsiteSlots: true, lastWebsiteReplacementAt: true },
  });
  if (!client) return res.status(404).json({ error: "client not found" });

  const slotLimit = client.activeWebsiteLimit + client.extraWebsiteSlots;
  const activeCount = await prisma.website.count({ where: { clientId, status: "active" } });
  const adminBypass = req.user?.role === "super_admin";
  const replacementCutoff = client.lastWebsiteReplacementAt
    ? new Date(client.lastWebsiteReplacementAt.getTime() + WEBSITE_REPLACEMENT_DAYS * 24 * 60 * 60 * 1000)
    : null;

  if (!adminBypass && activeCount >= slotLimit && !d.replaceWebsiteId) {
    return res.status(409).json({
      error: "website slot limit reached",
      code: "website_slot_limit",
      message: "Your plan includes 1 active website. Replace your active website or add another website slot.",
      replacementAvailableAt: replacementCutoff?.toISOString() ?? null,
      activeWebsiteLimit: slotLimit,
    });
  }

  if (d.replaceWebsiteId) {
    const oldWebsite = await prisma.website.findFirst({ where: { id: d.replaceWebsiteId, clientId, status: "active" } });
    if (!oldWebsite) return res.status(404).json({ error: "active website to replace not found" });
    if (!adminBypass && replacementCutoff && replacementCutoff > new Date()) {
      return res.status(409).json({
        error: "website replacement locked",
        code: "website_replacement_locked",
        message: "Website replacement is allowed once every 90 days unless approved by an admin.",
        replacementAvailableAt: replacementCutoff.toISOString(),
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.website.update({ where: { id: oldWebsite.id }, data: { status: "archived", archivedAt: new Date() } });
      const website = await tx.website.create({
        data: {
          clientId,
          domain: normalized.domain,
          rootUrl: normalized.rootUrl,
          status: "active",
          targetCountry: d.targetCountry,
          targetCities: d.targetCities,
        },
      });
      if (d.localBusinessProfile) {
        await tx.localBusinessProfile.create({
          data: profileData(d.localBusinessProfile, clientId, website.id, normalized.domain),
        });
      }
      await tx.client.update({ where: { id: clientId }, data: { lastWebsiteReplacementAt: new Date() } });
      return tx.website.findUniqueOrThrow({
        where: { id: website.id },
        include: { localBusinessProfiles: localProfileInclude },
      });
    });
    return res.status(201).json({ website: result, archivedWebsiteId: oldWebsite.id });
  }

  const website = await prisma.$transaction(async (tx) => {
    const created = await tx.website.create({
      data: {
        clientId,
        domain: normalized.domain,
        rootUrl: normalized.rootUrl,
        status: "active",
        targetCountry: d.targetCountry,
        targetCities: d.targetCities,
      },
    });
    if (d.localBusinessProfile) {
      await tx.localBusinessProfile.create({
        data: profileData(d.localBusinessProfile, clientId, created.id, normalized.domain),
      });
    }
    return tx.website.findUniqueOrThrow({
      where: { id: created.id },
      include: { localBusinessProfiles: localProfileInclude },
    });
  });
  res.status(201).json({ website });
});

websitesRouter.get("/", async (req, res) => {
  const clientId = await projectClientIdForRequest(req);
  const websites = clientId ? await prisma.website.findMany({
    where: { clientId },
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
      localBusinessProfiles: localProfileInclude,
    },
  }) : [];
  const completedCrawls = websites.length
    ? await prisma.crawlJob.findMany({
        where: { websiteId: { in: websites.map((website) => website.id) }, status: "completed" },
        distinct: ["websiteId"],
        select: { websiteId: true },
      })
    : [];
  const completedWebsiteIds = new Set(completedCrawls.map((crawl) => crawl.websiteId));
  res.json({ websites: websites.map((website) => ({ ...website, hasCompletedCrawl: completedWebsiteIds.has(website.id) })) });
});

websitesRouter.get("/:id", async (req, res) => {
  const clientId = await projectClientIdForRequest(req);
  const website = await prisma.website.findFirst({
    where: { id: req.params.id, ...(clientId ? { clientId } : {}) },
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
      localBusinessProfiles: localProfileInclude,
    },
  });
  if (!website) {
    if (clientId) {
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
