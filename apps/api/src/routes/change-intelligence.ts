import { Router } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware.js";

export const changeIntelligenceRouter = Router();
// Scope the admin guard to this router's actual prefix. This router is mounted
// at /api, so an unscoped guard would intercept unrelated customer routes.
changeIntelligenceRouter.use("/admin/change-intelligence", requireAuth, requireRole("super_admin"));

const statusTransitions: Record<string, readonly string[]> = {
  detected: ["review", "ignored"], review: ["ignored", "investigate", "validated"],
  investigate: ["ignored", "validated"], validated: ["approved", "investigate"], approved: [],
  deployed: ["rolled_back"], ignored: [], rolled_back: [],
};
const reviewSchema = z.object({ status: z.enum(["review", "ignored", "investigate", "validated", "approved"]), note: z.string().max(4000).optional() });
const sourceSchema = z.object({ key: z.string().regex(/^[a-z0-9-]+$/).max(120), name: z.string().min(2).max(255), sourceType: z.enum(["rss", "atom", "html"]), url: z.string().url().startsWith("https://"), categories: z.array(z.enum(["seo", "aeo", "geo", "local_seo", "social", "analytics", "privacy", "other"])).min(1), enabled: z.boolean().default(true), official: z.literal(true), discoveryOnly: z.boolean().default(false) });
const configurationSchema = z.object({ targetType: z.enum(["strategy_rule", "prompt", "scoring_rule", "recommendation_rule"]), targetKey: z.string().min(2).max(191).regex(/^[a-z0-9_.:-]+$/i), configuration: z.record(z.unknown()) });

changeIntelligenceRouter.get("/admin/change-intelligence", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const [sources, items, configurations, revalidations] = await Promise.all([
    prisma.changeIntelligenceSource.findMany({ orderBy: { name: "asc" } }),
    prisma.changeIntelligenceItem.findMany({ where: status ? { status } : {}, include: { source: { select: { key: true, name: true, official: true, discoveryOnly: true } }, configurationVersions: { orderBy: { version: "desc" } } }, orderBy: { detectedAt: "desc" }, take: 200 }),
    prisma.changeIntelligenceConfigurationVersion.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.changeIntelligenceRevalidation.groupBy({ by: ["status"], _count: true }),
  ]);
  res.json({ sources, items, configurations, revalidations, controls: { customerCapacityCharged: false, automaticProductionChanges: false, customerModule: false } });
});

changeIntelligenceRouter.post("/admin/change-intelligence/sources", async (req, res) => {
  const parsed = sourceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const host = new URL(data.url).hostname.toLowerCase();
  if (/news\.google\./i.test(host)) return res.status(400).json({ error: "Google News may be used only for discovery and cannot be registered as an official source of truth." });
  const values = { key: data.key, name: data.name, sourceType: data.sourceType, url: data.url, enabled: data.enabled, official: data.official, discoveryOnly: data.discoveryOnly, categoriesJson: data.categories };
  const source = await prisma.changeIntelligenceSource.upsert({ where: { key: data.key }, create: values, update: values });
  res.status(201).json({ source });
});

changeIntelligenceRouter.patch("/admin/change-intelligence/items/:itemId/status", async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const item = await prisma.changeIntelligenceItem.findUnique({ where: { id: req.params.itemId } });
  if (!item) return res.status(404).json({ error: "Change Intelligence item not found" });
  if (!statusTransitions[item.status]?.includes(parsed.data.status)) return res.status(409).json({ error: `Invalid status transition: ${item.status} -> ${parsed.data.status}` });
  if (parsed.data.status === "validated" && (!item.summary || item.confidence <= 0)) return res.status(409).json({ error: "Classification summary and confidence are required before validation." });
  if (parsed.data.status === "approved" && item.status !== "validated") return res.status(409).json({ error: "Only Validated items may be approved." });
  const now = new Date();
  const updated = await prisma.changeIntelligenceItem.update({ where: { id: item.id }, data: { status: parsed.data.status, reviewNote: parsed.data.note, reviewedByUserId: req.user!.userId, reviewedAt: now, ...(parsed.data.status === "approved" ? { approvedByUserId: req.user!.userId, approvedAt: now } : {}) } });
  res.json({ item: updated });
});

changeIntelligenceRouter.post("/admin/change-intelligence/items/:itemId/configurations", async (req, res) => {
  const parsed = configurationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const item = await prisma.changeIntelligenceItem.findUnique({ where: { id: req.params.itemId } });
  if (!item) return res.status(404).json({ error: "Change Intelligence item not found" });
  if (item.status !== "approved") return res.status(409).json({ error: "Only an Approved item may create a production configuration draft." });
  const latest = await prisma.changeIntelligenceConfigurationVersion.findFirst({ where: { targetType: parsed.data.targetType, targetKey: parsed.data.targetKey }, orderBy: { version: "desc" } });
  const configuration = await prisma.changeIntelligenceConfigurationVersion.create({ data: { itemId: item.id, targetType: parsed.data.targetType, targetKey: parsed.data.targetKey, version: (latest?.version ?? 0) + 1, configurationJson: parsed.data.configuration as Prisma.InputJsonValue, previousVersionId: latest?.status === "deployed" ? latest.id : latest?.previousVersionId, createdByUserId: req.user!.userId } });
  res.status(201).json({ configuration });
});

changeIntelligenceRouter.post("/admin/change-intelligence/configurations/:configurationId/approve", async (req, res) => {
  const configuration = await prisma.changeIntelligenceConfigurationVersion.findUnique({ where: { id: req.params.configurationId }, include: { item: true } });
  if (!configuration) return res.status(404).json({ error: "Configuration version not found" });
  if (configuration.status !== "draft" || configuration.item.status !== "approved") return res.status(409).json({ error: "A draft tied to an Approved item is required." });
  const updated = await prisma.changeIntelligenceConfigurationVersion.update({ where: { id: configuration.id }, data: { status: "approved", approvedByUserId: req.user!.userId, approvedAt: new Date() } });
  res.json({ configuration: updated });
});

changeIntelligenceRouter.post("/admin/change-intelligence/configurations/:configurationId/deploy", async (req, res) => {
  const configuration = await prisma.changeIntelligenceConfigurationVersion.findUnique({ where: { id: req.params.configurationId }, include: { item: true } });
  if (!configuration) return res.status(404).json({ error: "Configuration version not found" });
  if (configuration.status !== "approved" || configuration.item.status !== "approved") return res.status(409).json({ error: "Only an Approved configuration tied to an Approved item may be deployed." });
  const capabilities = Array.isArray(configuration.item.affectedCapabilitiesJson) ? configuration.item.affectedCapabilitiesJson as string[] : [];
  const projects = await prisma.project.findMany({ where: { status: "active", strategyPlans: { some: { status: "approved" } } }, select: { id: true } });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.changeIntelligenceConfigurationVersion.updateMany({ where: { targetType: configuration.targetType, targetKey: configuration.targetKey, status: "deployed" }, data: { status: "superseded" } });
    await tx.changeIntelligenceConfigurationVersion.update({ where: { id: configuration.id }, data: { status: "deployed", deployedByUserId: req.user!.userId, deployedAt: now } });
    await tx.changeIntelligenceItem.update({ where: { id: configuration.itemId }, data: { status: "deployed", deployedAt: now } });
    if (projects.length) await tx.changeIntelligenceRevalidation.createMany({ data: projects.map((project) => ({ itemId: configuration.itemId, configurationId: configuration.id, projectId: project.id, capabilitiesJson: capabilities })), skipDuplicates: true });
  });
  res.json({ deployed: true, version: configuration.version, affectedProjectsQueued: projects.length, customerCapacityCharged: false });
});

changeIntelligenceRouter.post("/admin/change-intelligence/configurations/:configurationId/rollback", async (req, res) => {
  const configuration = await prisma.changeIntelligenceConfigurationVersion.findUnique({ where: { id: req.params.configurationId } });
  if (!configuration) return res.status(404).json({ error: "Configuration version not found" });
  if (configuration.status !== "deployed") return res.status(409).json({ error: "Only the deployed version may be rolled back." });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.changeIntelligenceConfigurationVersion.update({ where: { id: configuration.id }, data: { status: "rolled_back", rolledBackByUserId: req.user!.userId, rolledBackAt: now } });
    if (configuration.previousVersionId) await tx.changeIntelligenceConfigurationVersion.updateMany({ where: { id: configuration.previousVersionId, status: { in: ["superseded", "rolled_back"] } }, data: { status: "deployed", deployedByUserId: req.user!.userId, deployedAt: now } });
    await tx.changeIntelligenceItem.update({ where: { id: configuration.itemId }, data: { status: "rolled_back", rolledBackAt: now } });
    await tx.changeIntelligenceRevalidation.updateMany({ where: { configurationId: configuration.id, status: "pending" }, data: { status: "cancelled", checkedAt: now, resultJson: { reason: "Configuration rolled back before revalidation" } } });
  });
  res.json({ rolledBack: true, restoredVersionId: configuration.previousVersionId });
});
